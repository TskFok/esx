# DSL Autocomplete Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展 Console 的 Elasticsearch/OpenSearch Query DSL 自动补全，让常用官方 Query DSL、搜索请求体属性和聚合 DSL 在正确上下文中可补全。

**Architecture:** 沿用现有 `src/lib/console-autocomplete` 分层：`snippets.ts` 负责静态词库，`suggestions.ts` 负责 JSON path 到建议列表的选择，`index.ts` 负责 Monaco completion provider 渲染。实现不引入运行时 schema，也不改变 metadata 拉取和请求执行。

**Tech Stack:** TypeScript、Vitest、Monaco Editor、Vite/Tauri 前端项目。

---

## File Structure

- Modify: `src/lib/console-autocomplete/snippets.ts`
  - 扩展 root search body 属性、Query DSL 分类词库、聚合词库。
  - 保持 `QUERY_LEAF_PROPERTY_SNIPPETS`、`QUERY_LEAF_VALUE_SNIPPETS`、`AGG_TYPE_PROPERTY_SNIPPETS` 等现有导出名称兼容。
- Modify: `src/lib/console-autocomplete/suggestions.ts`
  - 扩展 Query DSL 位置识别。
  - 扩展字段名补全位置识别。
- Modify: `src/lib/request-analyzer.ts`
  - 补齐本地请求分析器的查询和聚合标签，让它与新增补全词库保持一致。
- Modify: `src/lib/console-autocomplete/__tests__/snippets.test.ts`
  - 增加词库存在性和关键 snippet 插入文本测试。
- Modify: `src/lib/console-autocomplete/__tests__/suggestions.test.ts`
  - 增加 JSON path 到建议列表的上下文测试。
- Modify: `src/lib/console-autocomplete/__tests__/index.test.ts`
  - 增加 Monaco provider 层真实请求体位置测试。
- Modify: `src/lib/__tests__/request-analyzer.test.ts`
  - 增加新增 DSL 类型的分析描述测试。

---

### Task 1: Add Failing Snippet Coverage

**Files:**
- Modify: `src/lib/console-autocomplete/__tests__/snippets.test.ts`
- Test: `src/lib/console-autocomplete/__tests__/snippets.test.ts`

- [ ] **Step 1: Write failing tests for expanded Query DSL and root properties**

Update the existing import from `../snippets` to include `AGG_PROPERTY_SNIPPETS_BY_TYPE`, then append these tests to `src/lib/console-autocomplete/__tests__/snippets.test.ts`:

```typescript
import {
  AGG_PROPERTY_SNIPPETS_BY_TYPE,
  AGG_TYPE_PROPERTY_SNIPPETS,
  AGGS_CONTAINER_PROPERTY_SNIPPET,
  BOOL_PROPERTY_SNIPPETS,
  QUERY_LEAF_PROPERTY_SNIPPETS,
  QUERY_LEAF_VALUE_SNIPPETS,
  ROOT_PROPERTY_SNIPPETS,
} from "../snippets";
```

Append these tests:

```typescript

it("query snippets include common official DSL families", () => {
  const labels = QUERY_LEAF_PROPERTY_SNIPPETS.map((item) => item.label);

  expect(labels).toEqual(expect.arrayContaining([
    "match_bool_prefix",
    "match_phrase",
    "match_phrase_prefix",
    "multi_match",
    "combined_fields",
    "simple_query_string",
    "terms_set",
    "regexp",
    "fuzzy",
    "boosting",
    "constant_score",
    "dis_max",
    "function_score",
    "geo_distance",
    "geo_bounding_box",
    "has_child",
    "has_parent",
    "parent_id",
    "span_near",
    "span_term",
    "script",
    "script_score",
    "more_like_this",
    "distance_feature",
    "rank_feature",
    "pinned",
    "wrapper",
    "knn",
  ]));
});

it("query value snippets mirror expanded property snippets", () => {
  const labels = QUERY_LEAF_VALUE_SNIPPETS.map((item) => item.label);

  expect(labels).toEqual(expect.arrayContaining([
    "match_phrase",
    "multi_match",
    "regexp",
    "constant_score",
    "geo_distance",
    "nested",
    "span_near",
    "script_score",
    "knn",
  ]));
});

it("root snippets include extended search body properties", () => {
  const labels = ROOT_PROPERTY_SNIPPETS.map((item) => item.label);

  expect(labels).toEqual(expect.arrayContaining([
    "post_filter",
    "fields",
    "docvalue_fields",
    "stored_fields",
    "script_fields",
    "runtime_mappings",
    "min_score",
    "terminate_after",
    "track_scores",
    "profile",
    "explain",
    "version",
    "seq_no_primary_term",
    "pit",
    "knn",
  ]));
});

it("aggregation snippets include common bucket metric and pipeline aggregations", () => {
  const labels = AGG_TYPE_PROPERTY_SNIPPETS.map((item) => item.label);

  expect(labels).toEqual(expect.arrayContaining([
    "filter",
    "nested",
    "reverse_nested",
    "global",
    "missing",
    "significant_terms",
    "composite",
    "extended_stats",
    "percentiles",
    "percentile_ranks",
    "weighted_avg",
    "top_hits",
    "top_metrics",
    "bucket_script",
    "bucket_selector",
    "bucket_sort",
    "derivative",
    "moving_fn",
    "cumulative_sum",
  ]));

  expect(Object.keys(AGG_PROPERTY_SNIPPETS_BY_TYPE)).toEqual(expect.arrayContaining([
    "extended_stats",
    "filter",
    "nested",
    "top_hits",
    "bucket_script",
  ]));
});
```

- [ ] **Step 2: Run snippet tests to verify they fail**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/snippets.test.ts
```

Expected: FAIL because新增 DSL/root/aggregation labels are missing.

---

### Task 2: Add Failing Context Coverage

**Files:**
- Modify: `src/lib/console-autocomplete/__tests__/suggestions.test.ts`
- Modify: `src/lib/console-autocomplete/__tests__/index.test.ts`
- Test: `src/lib/console-autocomplete/__tests__/suggestions.test.ts`
- Test: `src/lib/console-autocomplete/__tests__/index.test.ts`

- [ ] **Step 1: Add path selection tests**

Append to `src/lib/console-autocomplete/__tests__/suggestions.test.ts`:

```typescript
it("suggests expanded query DSL inside query and post_filter contexts", () => {
  expect(labelsOf(selectPropertySuggestions(["query"]))).toEqual(
    expect.arrayContaining(["multi_match", "constant_score", "geo_distance", "script_score"]),
  );
  expect(labelsOf(selectPropertySuggestions(["post_filter"]))).toEqual(
    expect.arrayContaining(["term", "range", "bool", "geo_bounding_box"]),
  );
});

it("suggests query DSL inside compound query child contexts", () => {
  expect(labelsOf(selectPropertySuggestions(["query", "constant_score", "filter"]))).toEqual(
    expect.arrayContaining(["term", "range", "bool", "nested"]),
  );
  expect(labelsOf(selectPropertySuggestions(["query", "function_score", "query"]))).toEqual(
    expect.arrayContaining(["match", "bool", "script_score"]),
  );
  expect(labelsOf(selectPropertySuggestions(["query", "script_score", "query"]))).toEqual(
    expect.arrayContaining(["match", "bool", "constant_score"]),
  );
});

it("suggests query DSL inside joining and vector filter contexts", () => {
  expect(labelsOf(selectPropertySuggestions(["query", "nested", "query"]))).toEqual(
    expect.arrayContaining(["match", "term", "bool"]),
  );
  expect(labelsOf(selectPropertySuggestions(["query", "has_child", "query"]))).toEqual(
    expect.arrayContaining(["match", "term", "bool"]),
  );
  expect(labelsOf(selectPropertySuggestions(["knn", "filter"]))).toEqual(
    expect.arrayContaining(["term", "range", "bool"]),
  );
});

it("suggests fields for expanded field-bearing query contexts", () => {
  expect(shouldSuggestFieldsForKey(["query", "multi_match"])).toBe(false);
  expect(shouldSuggestFieldsForStringValue(["query", "multi_match", "fields", 0])).toBe(true);
  expect(shouldSuggestFieldsForStringValue(["query", "geo_distance", "distance"])).toBe(false);
  expect(shouldSuggestFieldsForStringValue(["knn", "field"])).toBe(true);
});
```

- [ ] **Step 2: Add provider-level tests**

Append to `src/lib/console-autocomplete/__tests__/index.test.ts`:

```typescript
function completionLabelsAt(content: string, lineNumber: number, column: number, searchMetadata: ConnectionSearchMetadata) {
  const context = buildConsoleAutocompleteContext([], content, searchMetadata);
  const suggestions = provideConsoleCompletionItems(
    fakeMonaco,
    modelFor(content),
    { lineNumber, column } as never,
    context,
  );
  return suggestions.map((item) => String(item.label));
}

it("suggests expanded root search body properties in JSON body", () => {
  const content = "POST /orders/_search\n{\n  \n}";
  const labels = completionLabelsAt(content, 3, 3, metadata({}));

  expect(labels).toEqual(expect.arrayContaining(["post_filter", "runtime_mappings", "knn", "profile"]));
});

it("suggests expanded query DSL in JSON body query contexts", () => {
  const content = "POST /orders/_search\n{\n  \"query\": {\n    \n  }\n}";
  const labels = completionLabelsAt(content, 4, 5, metadata({}));

  expect(labels).toEqual(expect.arrayContaining(["multi_match", "constant_score", "geo_distance", "script_score"]));
});
```

- [ ] **Step 3: Run context tests to verify they fail**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/suggestions.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
```

Expected: FAIL because新增上下文和 provider labels are missing.

---

### Task 3: Implement Expanded Static Snippets

**Files:**
- Modify: `src/lib/console-autocomplete/snippets.ts`
- Test: `src/lib/console-autocomplete/__tests__/snippets.test.ts`

- [ ] **Step 1: Add helper functions in snippets.ts**

Add helper builders near the top of `src/lib/console-autocomplete/snippets.ts`, after type declarations:

```typescript
function queryValueSnippet(snippet: RawSnippet): RawSnippet {
  return {
    ...snippet,
    kind: "value",
    insertText: `{\n\t${snippet.insertText}\n}`,
  };
}

function propertySnippet(
  label: string,
  detail: string,
  documentation: string,
  insertText: string,
  sortText: string,
  availability?: SnippetAvailability,
): RawSnippet {
  return {
    label,
    detail,
    documentation,
    insertText,
    kind: "property",
    sortText,
    availability,
  };
}
```

- [ ] **Step 2: Expand root search body snippets**

Update `ROOT_PROPERTY_SNIPPETS` by inserting these properties after existing query-related entries while preserving existing labels and sort order:

```typescript
propertySnippet("post_filter", "后置过滤", "在聚合计算后过滤搜索命中。", '"post_filter": {\n\t$0\n}', "021-post_filter"),
propertySnippet("fields", "返回字段", "返回 runtime fields 或 mapping 字段。", '"fields": [\n\t"$0"\n]', "032-fields"),
propertySnippet("docvalue_fields", "Doc values 字段", "从 doc values 返回字段值。", '"docvalue_fields": [\n\t"$0"\n]', "033-docvalue_fields"),
propertySnippet("stored_fields", "Stored fields", "返回显式 stored 的字段。", '"stored_fields": [\n\t"$0"\n]', "034-stored_fields"),
propertySnippet("script_fields", "脚本字段", "在响应中返回脚本计算字段。", '"script_fields": {\n\t"${1:computed_field}": {\n\t\t"script": {\n\t\t\t"source": "$0"\n\t\t}\n\t}\n}', "035-script_fields"),
propertySnippet("runtime_mappings", "运行时字段", "为当前搜索请求定义 runtime fields。", '"runtime_mappings": {\n\t"${1:field_name}": {\n\t\t"type": "${2:keyword}",\n\t\t"script": {\n\t\t\t"source": "$0"\n\t\t}\n\t}\n}', "036-runtime_mappings"),
propertySnippet("min_score", "最低分数", "过滤低于指定 _score 的命中。", '"min_score": ${1:0.1}', "041-min_score"),
propertySnippet("terminate_after", "提前终止", "每个分片收集到指定文档数后提前终止。", '"terminate_after": ${1:10000}', "042-terminate_after"),
propertySnippet("track_scores", "跟踪分数", "排序时仍计算并跟踪 _score。", '"track_scores": ${1:true}', "043-track_scores"),
propertySnippet("profile", "性能分析", "开启搜索 profile 输出。", '"profile": ${1:true}', "044-profile"),
propertySnippet("explain", "评分解释", "为每条命中返回评分解释。", '"explain": ${1:true}', "045-explain"),
propertySnippet("version", "返回版本", "为命中文档返回版本号。", '"version": ${1:true}', "046-version"),
propertySnippet("seq_no_primary_term", "返回序列号", "返回 seq_no 和 primary_term。", '"seq_no_primary_term": ${1:true}', "047-seq_no_primary_term"),
propertySnippet("pit", "Point in time", "使用 point in time 上下文搜索。", '"pit": {\n\t"id": "$1",\n\t"keep_alive": "${2:1m}"\n}', "048-pit"),
propertySnippet("knn", "向量搜索", "在搜索请求体中执行 kNN 向量检索。", '"knn": {\n\t"field": "$1",\n\t"query_vector": [\n\t\t$2\n\t],\n\t"k": ${3:10},\n\t"num_candidates": ${4:100}\n}', "049-knn"),
```

- [ ] **Step 3: Replace query snippet arrays with categorized snippets**

In `snippets.ts`, define category arrays and compose existing exports:

```typescript
const FULL_TEXT_QUERY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("match", "全文匹配", "match 查询。", '"match": {\n\t"${1:field}": "$0"\n}', "010-match"),
  propertySnippet("match_bool_prefix", "布尔前缀匹配", "将最后一个词作为 prefix 查询的 match 变体。", '"match_bool_prefix": {\n\t"${1:field}": "$0"\n}', "011-match_bool_prefix"),
  propertySnippet("match_phrase", "短语匹配", "match_phrase 查询。", '"match_phrase": {\n\t"${1:field}": "$0"\n}', "012-match_phrase"),
  propertySnippet("match_phrase_prefix", "短语前缀匹配", "match_phrase_prefix 查询。", '"match_phrase_prefix": {\n\t"${1:field}": "$0"\n}', "013-match_phrase_prefix"),
  propertySnippet("multi_match", "多字段匹配", "multi_match 查询。", '"multi_match": {\n\t"query": "$1",\n\t"fields": [\n\t\t"${2:field}"\n\t]\n}', "014-multi_match"),
  propertySnippet("combined_fields", "组合字段匹配", "combined_fields 查询。", '"combined_fields": {\n\t"query": "$1",\n\t"fields": [\n\t\t"${2:field}"\n\t]\n}', "015-combined_fields"),
  propertySnippet("query_string", "Lucene 语法", "query_string 查询。", '"query_string": {\n\t"query": "$0"\n}', "016-query_string"),
  propertySnippet("simple_query_string", "简易查询字符串", "simple_query_string 查询。", '"simple_query_string": {\n\t"query": "$1",\n\t"fields": [\n\t\t"${2:field}"\n\t]\n}', "017-simple_query_string"),
  propertySnippet("intervals", "Intervals 查询", "按词项顺序和距离匹配文本。", '"intervals": {\n\t"${1:field}": {\n\t\t"match": {\n\t\t\t"query": "$0"\n\t\t}\n\t}\n}', "018-intervals"),
];

const TERM_LEVEL_QUERY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("term", "精确匹配", "term 查询。", '"term": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}', "030-term"),
  propertySnippet("terms", "多值匹配", "terms 查询。", '"terms": {\n\t"${1:field}": [\n\t\t"$0"\n\t]\n}', "031-terms"),
  propertySnippet("terms_set", "多值集合匹配", "terms_set 查询。", '"terms_set": {\n\t"${1:field}": {\n\t\t"terms": [\n\t\t\t"$2"\n\t\t],\n\t\t"minimum_should_match_script": {\n\t\t\t"source": "$0"\n\t\t}\n\t}\n}', "032-terms_set"),
  propertySnippet("range", "范围查询", "range 查询。", '"range": {\n\t"${1:field}": {\n\t\t"gte": $2,\n\t\t"lte": $0\n\t}\n}', "033-range"),
  propertySnippet("exists", "字段存在", "exists 查询。", '"exists": {\n\t"field": "$0"\n}', "034-exists"),
  propertySnippet("ids", "按 ID 查询", "ids 查询。", '"ids": {\n\t"values": [\n\t\t"$0"\n\t]\n}', "035-ids"),
  propertySnippet("prefix", "前缀查询", "prefix 查询。", '"prefix": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}', "036-prefix"),
  propertySnippet("wildcard", "通配符查询", "wildcard 查询。", '"wildcard": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}', "037-wildcard"),
  propertySnippet("regexp", "正则查询", "regexp 查询。", '"regexp": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}', "038-regexp"),
  propertySnippet("fuzzy", "模糊查询", "fuzzy 查询。", '"fuzzy": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}', "039-fuzzy"),
];

const COMPOUND_QUERY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("bool", "布尔查询", "布尔查询，支持 must / should / filter / must_not。", '"bool": {\n\t$0\n}', "001-bool"),
  propertySnippet("boosting", "Boosting 查询", "降低 negative 查询匹配文档的相关性。", '"boosting": {\n\t"positive": {\n\t\t$1\n\t},\n\t"negative": {\n\t\t$2\n\t},\n\t"negative_boost": ${3:0.5}\n}', "050-boosting"),
  propertySnippet("constant_score", "常量评分", "用固定分数包装 filter 查询。", '"constant_score": {\n\t"filter": {\n\t\t$0\n\t}\n}', "051-constant_score"),
  propertySnippet("dis_max", "Disjunction max", "取多个查询中的最佳评分。", '"dis_max": {\n\t"queries": [\n\t\t{\n\t\t\t$0\n\t\t}\n\t],\n\t"tie_breaker": ${1:0.0}\n}', "052-dis_max"),
  propertySnippet("function_score", "函数评分", "用函数修改查询评分。", '"function_score": {\n\t"query": {\n\t\t$1\n\t},\n\t"functions": [\n\t\t{\n\t\t\t"weight": ${2:1}\n\t\t}\n\t],\n\t"boost_mode": "${3:multiply}"\n}', "053-function_score"),
];
```

Also define geo, joining, span, specialized arrays with the same `propertySnippet` pattern, then set:

```typescript
export const QUERY_LEAF_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  ...COMPOUND_QUERY_SNIPPETS,
  { label: "match_all", detail: "匹配全部", documentation: "match_all 查询。", insertText: '"match_all": {}', kind: "property", sortText: "002-match_all" },
  ...FULL_TEXT_QUERY_SNIPPETS,
  ...TERM_LEVEL_QUERY_SNIPPETS,
  ...GEO_QUERY_SNIPPETS,
  ...JOINING_QUERY_SNIPPETS,
  ...SPAN_QUERY_SNIPPETS,
  ...SPECIALIZED_QUERY_SNIPPETS,
  propertySnippet("type", "类型查询", "Elasticsearch 7 的类型查询兼容语法，Elasticsearch 8 起不再建议使用。", '"type": {\n\t"value": "${1:_doc}"\n}', "990-type", { products: ["elasticsearch"], minMajor: 7, maxMajor: 7 }),
];

export const QUERY_LEAF_VALUE_SNIPPETS: ReadonlyArray<RawSnippet> = QUERY_LEAF_PROPERTY_SNIPPETS
  .filter((snippet) => snippet.label !== "type")
  .map(queryValueSnippet);
```

- [ ] **Step 4: Expand aggregation snippets**

Add the missing aggregation type snippets to `AGG_TYPE_PROPERTY_SNIPPETS` and add matching keys in `AGG_PROPERTY_SNIPPETS_BY_TYPE`. Required labels:

```typescript
"filter",
"nested",
"reverse_nested",
"global",
"missing",
"significant_terms",
"composite",
"sampler",
"extended_stats",
"percentiles",
"percentile_ranks",
"weighted_avg",
"top_hits",
"top_metrics",
"median_absolute_deviation",
"bucket_script",
"bucket_selector",
"bucket_sort",
"derivative",
"moving_fn",
"cumulative_sum",
```

Use these representative property arrays:

```typescript
filter: [
  propertySnippet("filter", "过滤查询", "filter 聚合使用的 Query DSL。", '"filter": {\n\t$0\n}', "001-filter"),
  AGG_MISSING_PROPERTY_SNIPPET,
],
nested: [
  propertySnippet("path", "嵌套路径", "nested 聚合路径。", '"path": "$0"', "001-path"),
],
top_hits: [
  propertySnippet("size", "命中数量", "top_hits 返回的命中数量。", '"size": ${1:3}', "001-size"),
  propertySnippet("sort", "命中排序", "top_hits 内部排序。", '"sort": [\n\t{\n\t\t"$1": {\n\t\t\t"order": "${2:desc}"\n\t\t}\n\t}\n]', "002-sort"),
  propertySnippet("_source", "源字段", "top_hits 返回的 source 字段。", '"_source": [\n\t"$0"\n]', "003-_source"),
],
bucket_script: [
  propertySnippet("buckets_path", "桶路径", "pipeline 聚合输入路径。", '"buckets_path": {\n\t"${1:metric}": "$2"\n}', "001-buckets_path"),
  propertySnippet("script", "脚本", "pipeline 聚合脚本。", '"script": "$0"', "002-script"),
],
```

- [ ] **Step 5: Run snippet tests to verify they pass**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/snippets.test.ts
```

Expected: PASS.

---

### Task 4: Implement Context Selection Rules

**Files:**
- Modify: `src/lib/console-autocomplete/suggestions.ts`
- Test: `src/lib/console-autocomplete/__tests__/suggestions.test.ts`
- Test: `src/lib/console-autocomplete/__tests__/index.test.ts`

- [ ] **Step 1: Add query context helpers**

In `src/lib/console-autocomplete/suggestions.ts`, add these helpers above `selectPropertySuggestions`:

```typescript
const QUERY_CONTAINER_KEYS = new Set(["query", "post_filter"]);
const QUERY_CHILD_KEYS = new Set(["filter", "query", "positive", "negative"]);
const QUERY_ARRAY_KEYS = new Set(["queries"]);

function isQuerySuggestionContext(path: JsonPathSegment[]) {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  if (typeof last === "string" && QUERY_CONTAINER_KEYS.has(last)) {
    return true;
  }

  if (typeof last === "number" && typeof secondLast === "string" && QUERY_ARRAY_KEYS.has(secondLast)) {
    return true;
  }

  if (typeof last === "string" && QUERY_CHILD_KEYS.has(last)) {
    return true;
  }

  return false;
}
```

- [ ] **Step 2: Use helper in selectPropertySuggestions**

Replace the current `if (last === "query" && path.length === 1)` block and bool child checks with:

```typescript
if (isQuerySuggestionContext(path)) {
  return filterAvailableSnippets(QUERY_LEAF_PROPERTY_SNIPPETS, autocompleteContext);
}
```

Keep the `last === "bool"` and bool array checks after this block so bool subkeys still work inside an existing bool object.

- [ ] **Step 3: Expand field suggestion contexts**

Update `FIELD_VALUE_KEYS` and add array value detection:

```typescript
export const FIELD_VALUE_KEYS = new Set(["field", "path"]);
export const FIELD_ARRAY_VALUE_KEYS = new Set(["fields", "docvalue_fields", "stored_fields"]);
```

Update `shouldSuggestFieldsForStringValue`:

```typescript
export function shouldSuggestFieldsForStringValue(path: JsonPathSegment[]) {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  if (typeof last === "string" && FIELD_VALUE_KEYS.has(last)) {
    return true;
  }

  if (typeof last === "number" && typeof secondLast === "string" && FIELD_ARRAY_VALUE_KEYS.has(secondLast)) {
    return true;
  }

  return false;
}
```

- [ ] **Step 4: Run context/provider tests to verify they pass**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/suggestions.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
```

Expected: PASS.

---

### Task 5: Align Request Analyzer Labels

**Files:**
- Modify: `src/lib/request-analyzer.ts`
- Modify: `src/lib/__tests__/request-analyzer.test.ts`
- Test: `src/lib/__tests__/request-analyzer.test.ts`

- [ ] **Step 1: Write failing analyzer tests**

Append to `src/lib/__tests__/request-analyzer.test.ts`:

```typescript
it("describes expanded query DSL types", () => {
  const result = analyzeRequestContentLocally(`POST /orders/_search
{
  "query": {
    "constant_score": {
      "filter": {
        "geo_distance": {
          "distance": "10km",
          "location": "40,-70"
        }
      }
    }
  }
}`);

  expect(result.valid).toBe(true);
  if (result.valid) {
    expect(result.details.join("；")).toContain("常量评分查询");
    expect(result.details.join("；")).toContain("地理距离查询");
  }
});

it("describes expanded aggregation types", () => {
  const result = analyzeRequestContentLocally(`POST /orders/_search
{
  "aggs": {
    "nested_items": {
      "nested": {
        "path": "items"
      }
    },
    "price_stats": {
      "extended_stats": {
        "field": "price"
      }
    }
  }
}`);

  expect(result.valid).toBe(true);
  if (result.valid) {
    expect(result.details).toEqual(expect.arrayContaining([
      "聚合「nested_items」：嵌套聚合",
      "聚合「price_stats」：扩展统计聚合",
    ]));
  }
});
```

- [ ] **Step 2: Run analyzer tests to verify they fail**

Run:

```bash
pnpm vitest run src/lib/__tests__/request-analyzer.test.ts
```

Expected: FAIL because `constant_score` and nested child traversal are not fully described.

- [ ] **Step 3: Expand analyzer label maps and traversal**

In `src/lib/request-analyzer.ts`, update `QUERY_TYPE_LABELS` and `AGG_TYPE_LABELS` with the same labels introduced in snippets. Also update `describeQuery` so it recursively visits query child keys:

```typescript
const QUERY_CHILD_KEYS = ["query", "filter", "positive", "negative"] as const;

QUERY_CHILD_KEYS.forEach((key) => {
  const nested = record[key];
  descriptions.push(...describeQuery(nested, depth + 1));
});

const queryArray = record.queries;
if (Array.isArray(queryArray)) {
  queryArray.forEach((item) => {
    descriptions.push(...describeQuery(item, depth + 1));
  });
}
```

Keep the existing bool traversal and nested traversal.

- [ ] **Step 4: Run analyzer tests to verify they pass**

Run:

```bash
pnpm vitest run src/lib/__tests__/request-analyzer.test.ts
```

Expected: PASS.

---

### Task 6: Full Verification

**Files:**
- No source edits unless verification exposes a regression.
- Test: full project test suite.

- [ ] **Step 1: Run focused autocomplete and analyzer tests**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/snippets.test.ts src/lib/console-autocomplete/__tests__/suggestions.test.ts src/lib/console-autocomplete/__tests__/index.test.ts src/lib/__tests__/request-analyzer.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git diff -- src/lib/console-autocomplete/snippets.ts src/lib/console-autocomplete/suggestions.ts src/lib/request-analyzer.ts src/lib/console-autocomplete/__tests__/snippets.test.ts src/lib/console-autocomplete/__tests__/suggestions.test.ts src/lib/console-autocomplete/__tests__/index.test.ts src/lib/__tests__/request-analyzer.test.ts
```

Expected: diff only contains DSL autocomplete, analyzer label, and test changes.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add src/lib/console-autocomplete/snippets.ts src/lib/console-autocomplete/suggestions.ts src/lib/request-analyzer.ts src/lib/console-autocomplete/__tests__/snippets.test.ts src/lib/console-autocomplete/__tests__/suggestions.test.ts src/lib/console-autocomplete/__tests__/index.test.ts src/lib/__tests__/request-analyzer.test.ts
git commit -m "补全 Query DSL 自动补全词库"
```

Expected: commit succeeds.

---

## Self-Review

- Spec coverage: 设计文档要求的 Query DSL、root search body、聚合、上下文选择、能力过滤和测试策略均有任务覆盖。
- Placeholder scan: 本计划没有待补文本、空步骤或外部未定义任务。
- Type consistency: 使用现有 `RawSnippet`、`SnippetAvailability`、`JsonPathSegment`、`ConsoleAutocompleteContext`、`provideConsoleCompletionItems` 和 `analyzeRequest` 命名。
- Scope check: 计划只修改 Console 自动补全、请求分析标签和对应测试，不触碰请求执行、metadata 拉取或 UI 组件。
