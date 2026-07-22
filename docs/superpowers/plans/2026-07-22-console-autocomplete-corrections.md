# Console 自动补全错误修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除“请求内容”自动补全中的错误候选，并在相同位置补上与 HTTP 方法、API 路径、请求体协议、Elasticsearch/OpenSearch 产品及版本相匹配的正确候选。

**Architecture:** 在现有 `context.ts → index.ts → capabilities.ts/suggestions.ts` 管线中增加规范化的请求上下文和请求体模式，把路径、查询参数、JSON/NDJSON 请求体的候选选择从宽泛回退改为显式白名单。产品与版本能力仍集中在 snippet availability 中，JSON 光标分析只增加约束候选所需的祖先信息，不承担 endpoint 判定；Monaco provider 继续只负责范围计算和候选渲染。

**Tech Stack:** TypeScript、Monaco Editor、Vitest、pnpm、Vite/Tauri

## Global Constraints

- 仅修改自动补全及其测试、文档；不改请求发送、解析器或格式化行为。
- 默认在当前分支工作，不创建新分支。
- 每个实现任务遵循 RED → GREEN → REFACTOR；先看到目标测试失败，再写最小实现。
- 未知或无法可靠识别的上下文采用保守策略：宁可少提示，也不返回已知错误候选。
- 不在循环中查询 SQL；本计划不需要数据库访问。
- 每次任务提交使用 `<type>: <中文描述>` 格式。

## File Structure

- `request-context.ts`：只负责从请求首行识别 method、规范化 path、endpoint 和 body mode。
- `body-context.ts`：只负责普通 JSON 与 Bulk/MSearch NDJSON 的当前正文状态，不选择具体 snippet。
- `snippets.ts`：声明候选内容、方法/产品/版本元数据，不读取编辑器状态。
- `capabilities.ts`：按 cluster、endpoint、HTTP method 过滤静态候选。
- `json-path.ts`：分析 JSON 光标路径、对象祖先及已出现属性。
- `suggestions.ts`：把 JSON 路径/祖先上下文映射到属性和值白名单。
- `index.ts`：Monaco 适配层，计算光标替换范围并按 request/body context 分发。
- `__tests__/request-context.test.ts` 与 `body-context.test.ts`：测试两个纯状态分析器。
- `__tests__/capabilities.test.ts`、`suggestions.test.ts`、`json-path.test.ts`：测试过滤与上下文选择。
- `__tests__/index.test.ts`：从编辑器入口验证错误候选消失且正确候选出现。

---

### Task 1: 建立规范化请求上下文边界

**Files:**

- Create: `src/lib/console-autocomplete/request-context.ts`
- Create: `src/lib/console-autocomplete/__tests__/request-context.test.ts`
- Modify: `src/lib/console-autocomplete/context.ts`
- Modify: `src/lib/console-autocomplete/__tests__/context.test.ts`

**Interfaces:**

- Consumes: `buildConsoleAutocompleteContext(requests, currentContent, metadata)` 的现有 `currentContent` 字符串。
- Produces: `parseConsoleRequestContext(content: string): ConsoleRequestContext`，以及带 `request: ConsoleRequestContext` 的 `ConsoleAutocompleteContext`。

- [x] **Step 1: 先写 endpoint 与 body mode 分类失败测试**

在 `request-context.test.ts` 中覆盖方法、路径和正文协议：

```ts
import { describe, expect, it } from "vitest"
import { parseConsoleRequestContext } from "../request-context"

describe("parseConsoleRequestContext", () => {
  it.each([
    ["POST /orders/_search\n{}", "search", "search-json"],
    ["POST /_search/scroll\n{}", "scroll", "scroll-json"],
    ["POST /orders/_count\n{}", "count", "count-json"],
    ["POST /_bulk\n", "bulk", "bulk-ndjson"],
    ["POST /orders/_msearch\n", "msearch", "msearch-ndjson"],
    ["PUT /orders\n{}", "create-index", "create-index-json"],
    ["POST /orders/_update/42\n{}", "update-document", "update-json"],
    ["POST /orders/_doc\n{}", "index-document", "document-json"],
  ] as const)("分类 %s", (content, endpoint, bodyMode) => {
    expect(parseConsoleRequestContext(content)).toMatchObject({ endpoint, bodyMode })
  })

  it("去掉查询串但保留原始路径", () => {
    expect(parseConsoleRequestContext("POST /_search/scroll?scroll=1m\n{}")).toMatchObject({
      rawPath: "/_search/scroll?scroll=1m",
      path: "/_search/scroll",
      pathSegments: ["_search", "scroll"],
    })
  })

  it("不完整请求头仍保留方法并使用根上下文", () => {
    expect(parseConsoleRequestContext("POST ")).toMatchObject({
      method: "POST",
      path: "/",
      endpoint: "root",
      bodyMode: "unknown",
    })
  })

  it("未知 API 不猜测正文模式", () => {
    expect(parseConsoleRequestContext("POST /orders/_made_up\n{}")).toMatchObject({
      endpoint: "unknown",
      bodyMode: "unknown",
    })
  })
})
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/request-context.test.ts
```

Expected: FAIL，提示 `../request-context` 不存在。

- [x] **Step 3: 实现最小请求上下文解析器**

在 `request-context.ts` 定义并导出：

```ts
export type ConsoleEndpoint =
  | "root"
  | "search"
  | "scroll"
  | "count"
  | "bulk"
  | "msearch"
  | "create-index"
  | "update-document"
  | "index-document"
  | "mapping"
  | "settings"
  | "tasks"
  | "snapshot"
  | "cat"
  | "unknown"

export type ConsoleBodyMode =
  | "search-json"
  | "scroll-json"
  | "count-json"
  | "create-index-json"
  | "update-json"
  | "document-json"
  | "bulk-ndjson"
  | "msearch-ndjson"
  | "unknown"

export interface ConsoleRequestContext {
  method: string
  rawPath: string
  path: string
  pathSegments: string[]
  endpoint: ConsoleEndpoint
  bodyMode: ConsoleBodyMode
}

export function parseConsoleRequestContext(content: string): ConsoleRequestContext
```

实现为两个纯函数，endpoint 顺序固定：

```ts
function classifyEndpoint(method: string, segments: string[]): ConsoleEndpoint {
  const first = segments[0]
  const last = segments.at(-1)
  if (segments.length === 0) return "root"
  if (first === "_search" && segments[1] === "scroll") return "scroll"
  if (last === "_search") return "search"
  if (last === "_count") return "count"
  if (last === "_bulk") return "bulk"
  if (last === "_msearch") return "msearch"
  if (first === "_cat") return "cat"
  if (last === "_mapping") return "mapping"
  if (last === "_settings") return "settings"
  if (first === "_tasks") return "tasks"
  if (first === "_snapshot") return "snapshot"
  if (segments.length >= 3 && segments.at(-2) === "_update" && method === "POST") {
    return "update-document"
  }
  if (
    segments.length >= 2 &&
    segments[1] === "_doc" &&
    (method === "POST" || method === "PUT")
  ) {
    return "index-document"
  }
  if (segments.length === 1 && !first?.startsWith("_") && method === "PUT") {
    return "create-index"
  }
  return "unknown"
}

function bodyModeFor(endpoint: ConsoleEndpoint): ConsoleBodyMode {
  const modes: Partial<Record<ConsoleEndpoint, ConsoleBodyMode>> = {
    search: "search-json",
    scroll: "scroll-json",
    count: "count-json",
    bulk: "bulk-ndjson",
    msearch: "msearch-ndjson",
    "create-index": "create-index-json",
    "update-document": "update-json",
    "index-document": "document-json",
  }
  return modes[endpoint] ?? "unknown"
}

export function parseConsoleRequestContext(content: string): ConsoleRequestContext {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? ""
  const match = firstLine.match(/^([A-Za-z]+)(?:\s+(\S*))?/)
  const method = match?.[1]?.toUpperCase() ?? ""
  const rawPath = match?.[2] ?? ""
  const withoutQuery = rawPath.split("?", 1)[0] || "/"
  const path = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`
  const pathSegments = path.split("/").filter(Boolean)
  const endpoint = classifyEndpoint(method, pathSegments)
  return { method, rawPath, path, pathSegments, endpoint, bodyMode: bodyModeFor(endpoint) }
}
```

实现要求：

- 只解析第一行的 method/path；method 统一转大写。
- `path` 去掉 `?` 及其后内容，空路径规范化为 `/`。
- endpoint 判定按“精确 API 形态优先、通用文档路径最后”的顺序执行，避免 `/_search/scroll` 被识别成 Search。
- `PUT /{index}` 是 `create-index`；`POST|PUT /{index}/_doc[/id]` 是 `index-document`；`POST /{index}/_update/{id}` 是 `update-document`。
- 无法确认时返回 `unknown`，不猜测为 Search。

- [x] **Step 4: 将请求上下文接入共享上下文**

修改 `ConsoleAutocompleteContext`：

```ts
export interface ConsoleAutocompleteContext {
  indexNames: string[]
  aliasNames: string[]
  historyTargetNames: string[]
  fieldNames: string[]
  cluster: typeof DEFAULT_CLUSTER_METADATA
  request: ConsoleRequestContext
}
```

`buildConsoleAutocompleteContext` 调用 `parseConsoleRequestContext(content)`，删除 `context.ts` 内重复的第一行路径提取逻辑，并补测试断言 method、endpoint、bodyMode。

- [x] **Step 5: 运行聚焦测试并确认 GREEN**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/request-context.test.ts src/lib/console-autocomplete/__tests__/context.test.ts
```

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add src/lib/console-autocomplete/request-context.ts src/lib/console-autocomplete/context.ts src/lib/console-autocomplete/__tests__/request-context.test.ts src/lib/console-autocomplete/__tests__/context.test.ts
git commit -m "refactor: 增加自动补全请求上下文"
```

---

### Task 2: 支持产品与次版本级 DSL 候选约束

**Files:**

- Modify: `src/lib/console-autocomplete/snippets.ts`
- Modify: `src/lib/console-autocomplete/capabilities.ts`
- Modify: `src/lib/console-autocomplete/__tests__/capabilities.test.ts`
- Modify: `src/lib/console-autocomplete/__tests__/suggestions.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `ConsoleAutocompleteContext.cluster`，其版本包含 `major` 与 `minor`。
- Produces: 支持 `minVersion/maxVersion` 的 `SnippetAvailability`；`selectPropertySuggestions(["query"], context)` 只返回当前产品/版本可用的 DSL。

- [x] **Step 1: 写 Elasticsearch 次版本与 OpenSearch KNN 失败测试**

测试至少覆盖：

```ts
it("Elasticsearch 8.11 不提示 query knn、semantic 和 sparse_vector", () => {
  const snippets = selectPropertySuggestions(["query"], context({
    product: "elasticsearch",
    version: { number: "8.11.3", major: 8, minor: 11 },
  }))
  expect(labelsOf(snippets)).not.toContain("knn")
  expect(labelsOf(snippets)).not.toContain("semantic")
  expect(labelsOf(snippets)).not.toContain("sparse_vector")
})

it("Elasticsearch 8.12 开始提示 query knn", () => {
  expect(labelsOf(selectPropertySuggestions(["query"], context({
    product: "elasticsearch",
    version: { number: "8.12.0", major: 8, minor: 12 },
  })))).toContain("knn")
})

it("Elasticsearch 8.15 开始提示 semantic 和 sparse_vector", () => {
  const result = labelsOf(selectPropertySuggestions(["query"], context({
    product: "elasticsearch",
    version: { number: "8.15.0", major: 8, minor: 15 },
  }))
  expect(result).toEqual(expect.arrayContaining(["semantic", "sparse_vector"]))
})

it("Elasticsearch 8.14 仍隐藏 semantic 和 sparse_vector", () => {
  const result = labelsOf(selectPropertySuggestions(["query"], context({
    product: "elasticsearch",
    version: { number: "8.14.3", major: 8, minor: 14 },
  })))
  expect(result).not.toEqual(expect.arrayContaining(["semantic", "sparse_vector"]))
})

it("未知版本隐藏强版本约束候选", () => {
  const result = labelsOf(selectPropertySuggestions(["query"], context({
    product: "elasticsearch",
    version: { number: null, major: null, minor: null },
  })))
  expect(result).not.toEqual(expect.arrayContaining(["knn", "semantic", "sparse_vector"]))
})

it("OpenSearch knn 使用动态字段和 vector 参数", () => {
  const knn = selectPropertySuggestions(["query"], context({
    product: "opensearch",
    version: { number: "2.14.0", major: 2, minor: 14 },
  }))
    .find((snippet) => snippet.label === "knn")
  expect(knn?.insertText).toContain('"${1:field}"')
  expect(knn?.insertText).toContain('"vector"')
  expect(knn?.insertText).not.toContain('"query_vector"')
})
```

复用现有 `context(overrides)` 和 `labelsOf` helper；Task 1 给 `ConsoleAutocompleteContext` 新增 `request` 后，也在这个 helper 中填入 `parseConsoleRequestContext("GET /")`，不要复制第二套 cluster fixture。

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/capabilities.test.ts src/lib/console-autocomplete/__tests__/suggestions.test.ts
```

Expected: FAIL，8.11 仍出现高版本候选，OpenSearch 模板仍是 Elasticsearch 形态。

- [x] **Step 3: 扩展 availability 版本模型**

在 `SnippetAvailability` 增加：

```ts
minVersion?: readonly [major: number, minor: number]
maxVersion?: readonly [major: number, minor: number]
```

`isAvailableForCluster` 从现有 cluster version 解析 `[major, minor]`，按字典序比较；保留 `minMajor/maxMajor` 兼容现有 snippet。无法解析 minor 时使用 `0`，未知产品仍按当前保守逻辑处理。

在现有 major 检查之后加入：

```ts
function compareVersion(
  left: readonly [number, number],
  right: readonly [number, number],
) {
  return left[0] === right[0] ? left[1] - right[1] : left[0] - right[0]
}

const currentVersion = cluster.version.major === null
  ? null
  : [cluster.version.major, cluster.version.minor ?? 0] as const
if ((availability.minVersion || availability.maxVersion) && !currentVersion) return false
if (availability.minVersion && compareVersion(currentVersion!, availability.minVersion) < 0) return false
if (availability.maxVersion && compareVersion(currentVersion!, availability.maxVersion) > 0) return false
```

- [x] **Step 4: 拆分同名但不同产品的 KNN 候选**

保持两个 label 都为 `knn`，由 availability 保证同一 cluster 只返回一个：

```ts
const ELASTICSEARCH_KNN_QUERY_SNIPPET = propertySnippet(
  "knn",
  "Elasticsearch kNN 查询",
  "执行 Elasticsearch 向量相似度查询。",
  '"knn": {\n\t"field": "${1:field}",\n\t"query_vector": [${2:0.0}],\n\t"k": ${3:10},\n\t"num_candidates": ${4:100}\n}',
  "097-knn-elasticsearch",
  { products: ["elasticsearch"], minVersion: [8, 12] },
)

const OPENSEARCH_KNN_QUERY_SNIPPET = propertySnippet(
  "knn",
  "OpenSearch k-NN 查询",
  "执行 OpenSearch k-NN 向量相似度查询。",
  '"knn": {\n\t"${1:field}": {\n\t\t"vector": [${2:0.0}],\n\t\t"k": ${3:10}\n\t}\n}',
  "097-knn-opensearch",
  { products: ["opensearch"], minMajor: 1 },
)
```

并设置：

- Elasticsearch query `semantic`：`minVersion: [8, 15]`。
- Elasticsearch query `sparse_vector`：`minVersion: [8, 15]`。
- Elasticsearch 顶层 Search `knn`：`products: ["elasticsearch"], minMajor: 8`。

- [x] **Step 5: 运行聚焦测试并确认 GREEN**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/capabilities.test.ts src/lib/console-autocomplete/__tests__/suggestions.test.ts
```

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add src/lib/console-autocomplete/snippets.ts src/lib/console-autocomplete/capabilities.ts src/lib/console-autocomplete/__tests__/capabilities.test.ts src/lib/console-autocomplete/__tests__/suggestions.test.ts
git commit -m "fix: 按产品版本约束向量查询候选"
```

---

### Task 3: 按 HTTP 方法和路径层级修正 API 路径候选

**Files:**

- Modify: `src/lib/console-autocomplete/snippets.ts`
- Modify: `src/lib/console-autocomplete/capabilities.ts`
- Modify: `src/lib/console-autocomplete/index.ts`
- Modify: `src/lib/console-autocomplete/__tests__/capabilities.test.ts`
- Modify: `src/lib/console-autocomplete/__tests__/index.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `ConsoleRequestContext.method` 与 `pathSegments`，Task 2 的 availability 过滤。
- Produces: `selectApiSegments(scope, context, method): ApiSegment[]`，其中 `scope` 是 `"global" | "index" | "cat"`。

- [x] **Step 1: 写路径候选精确性失败测试**

通过公开 autocomplete provider 或现有 path suggestion helper 断言：

```ts
it("索引路径只提示索引级 API", async () => {
  const labels = await completeLabels("GET /orders/")
  expect(labels).toEqual(expect.arrayContaining(["_search", "_mapping", "_refresh"]))
  expect(labels).not.toEqual(expect.arrayContaining(["_cluster/health", "_cat/indices", "orders"]))
})

it("cat 命名空间只提示相对子路径", async () => {
  const labels = await completeLabels("GET /_cat/")
  expect(labels).toContain("indices")
  expect(labels).not.toContain("_cat/indices")
  expect(labels).not.toContain("orders")
})

it("POST 根路径只提示允许 POST 的全局 API", async () => {
  const labels = await completeLabels("POST /")
  expect(labels).toEqual(expect.arrayContaining(["_search", "_bulk", "_msearch"]))
  expect(labels).not.toContain("_cluster/health")
})

it("文档 API 末尾不回退到全局或索引候选", async () => {
  expect(await completeLabels("GET /orders/_doc/")).toEqual([])
})
```

在 `index.test.ts` 基于现有 Monaco fake/model helper 增加一次并复用：

```ts
function completeLabels(content: string, searchMetadata = metadata({})) {
  const marker = "<cursor>"
  const markerOffset = content.indexOf(marker)
  const normalized = markerOffset >= 0 ? content.replace(marker, "") : content
  const cursorOffset = markerOffset >= 0 ? markerOffset : normalized.length
  const beforeCursor = normalized.slice(0, cursorOffset)
  const lines = beforeCursor.split(/\r?\n/)
  const lineNumber = lines.length
  const column = (lines[lineNumber - 1]?.length ?? 0) + 1
  return completionLabelsAt(normalized, lineNumber, column, searchMetadata)
}
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/capabilities.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
```

Expected: FAIL，出现全局 API、重复 `_cat/` 前缀或无关索引名。

- [x] **Step 3: 为 API segment 增加方法与命名空间元数据**

扩展 `ApiSegment` 并新增 cat scope：

```ts
export type ApiSegment = {
  label: string
  detail: string
  documentation: string
  insertText: string
  availability?: SnippetAvailability
  methods?: readonly string[]
}
```

规则：

- `global` snippet 使用完整第一段，如 `_search`、`_bulk`、`_cluster/health`。
- `index` snippet 使用索引后的相对段，如 `_search`、`_mapping`。
- `cat` snippet 使用 `/_cat/` 后的相对段，如 `indices`、`nodes`。
- 新增 `CAT_API_SEGMENTS`，每条 snippet 明确声明 Elasticsearch/OpenSearch API 支持的方法，不用默认“所有方法”。

使用显式方法表补齐现有 snippet，并新增 cat 相对候选：

```ts
export const CAT_API_SEGMENTS: ReadonlyArray<ApiSegment> = [
  { label: "indices", detail: "索引列表", documentation: "列出索引。", insertText: "indices?v=true" },
  { label: "aliases", detail: "别名列表", documentation: "列出 alias。", insertText: "aliases?v=true" },
  { label: "nodes", detail: "节点列表", documentation: "列出节点。", insertText: "nodes?v=true" },
  { label: "health", detail: "集群健康", documentation: "显示集群健康摘要。", insertText: "health?v=true" },
  { label: "shards", detail: "分片列表", documentation: "列出分片。", insertText: "shards?v=true" },
]

const GLOBAL_API_METHODS: Record<string, readonly string[]> = {
  "_cluster/health": ["GET"], "_cat/indices": ["GET"],
  "_search": ["GET", "POST"], "_count": ["GET", "POST"],
  "_mapping": ["GET"], "_settings": ["GET"], "_aliases": ["GET"],
  "_bulk": ["POST", "PUT"], "_msearch": ["GET", "POST"],
  "_tasks": ["GET"], "_nodes/stats": ["GET"],
  "_security/_authenticate": ["GET"], "_license": ["GET"],
  "_ml/anomaly_detectors": ["GET"],
  "_plugins/_security/api/account": ["GET"],
  "_plugins/_security/authinfo": ["GET"],
  "_plugins/_ism/policies": ["GET"], "_plugins/_knn/stats": ["GET"],
}

const INDEX_API_METHODS: Record<string, readonly string[]> = {
  "_search": ["GET", "POST"], "_count": ["GET", "POST"],
  "_mapping": ["GET", "PUT"], "_settings": ["GET", "PUT"],
  "_refresh": ["GET", "POST"],
  "_doc": ["GET", "POST", "PUT", "DELETE", "HEAD"],
  "_bulk": ["POST", "PUT"],
  "_update_by_query": ["POST"], "_delete_by_query": ["POST"],
}

const CAT_API_METHODS: Record<string, readonly string[]> = Object.fromEntries(
  CAT_API_SEGMENTS.map((segment) => [segment.label, ["GET"] as const]),
)
```

更新选择器签名：

```ts
export function selectApiSegments(
  scope: "global" | "index" | "cat",
  context: CompletionCapabilityContext | null | undefined,
  method: string,
): ApiSegment[]
```

选择器在 availability 和去重后按方法表过滤：

```ts
export function selectApiSegments(
  scope: "global" | "index" | "cat",
  context: CompletionCapabilityContext | null | undefined,
  method: string,
): ApiSegment[] {
  const base = scope === "index"
    ? INDEX_API_SEGMENTS
    : scope === "cat"
      ? CAT_API_SEGMENTS
      : GLOBAL_API_SEGMENTS
  const productSpecific = scope === "global" ? PRODUCT_GLOBAL_API_SEGMENTS : []
  const methods = scope === "index"
    ? INDEX_API_METHODS
    : scope === "cat"
      ? CAT_API_METHODS
      : GLOBAL_API_METHODS

  return deduplicateByLabel(filterAvailableSnippets([...base, ...productSpecific], context))
    .filter((segment) => methods[segment.label]?.includes(method) === true)
    .map((segment) => ({ ...segment, methods: methods[segment.label] }))
}
```

- [x] **Step 4: 用路径状态机替换 segmentCount 宽泛分支**

`buildPathSuggestions` 使用 `context.request.method` 和已完成 segments 分类：

- `/`：目标索引/别名 + method 允许的 global API。
- `/{target}/`：只返回 method 允许的 index API。
- `/_cat/`：只返回 cat 相对子路径。
- 已进入已知叶子 API（如 `/{target}/_doc/`）或未知深层：返回空数组。
- 动态目标名只允许出现在第一路径段，不能在 `_cat` 或 API 子路径后出现。

以当前 segment 的起始列为边界，只对已经完成的 segment 分类：

```ts
type PathSuggestionScope = "root" | "index" | "cat" | "none"

function resolvePathSuggestionScope(
  lineContent: string,
  segmentRange: monacoEditor.IRange,
): PathSuggestionScope {
  const prefix = lineContent.slice(0, segmentRange.startColumn - 1)
  const pathPrefix = prefix.trim().split(/\s+/, 2)[1]?.split("?", 1)[0] ?? ""
  const completed = pathPrefix.split("/").filter(Boolean)
  if (completed.length === 0) return "root"
  if (completed.length === 1 && completed[0] === "_cat") return "cat"
  if (completed.length === 1 && !completed[0]?.startsWith("_")) return "index"
  return "none"
}

const scope = resolvePathSuggestionScope(lineContent, range)
if (scope === "none") return []
const apiScope = scope === "root" ? "global" : scope
const apiSegments = selectApiSegments(apiScope, autocompleteContext, autocompleteContext.request.method)
const apiSuggestions = apiSegments.map((segment, index) => ({
  label: segment.label,
  kind: monacoInstance.languages.CompletionItemKind.Function,
  detail: segment.detail,
  documentation: segment.documentation,
  insertText: segment.insertText,
  insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  range,
  sortText: `3${index.toString().padStart(3, "0")}-${segment.label}`,
}))
const targetSuggestions = scope === "root"
  ? [...indexSuggestions, ...aliasSuggestions, ...historySuggestions]
  : []
return [...targetSuggestions, ...apiSuggestions]
```

- [x] **Step 5: 运行聚焦测试并确认 GREEN**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/capabilities.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
```

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add src/lib/console-autocomplete/snippets.ts src/lib/console-autocomplete/capabilities.ts src/lib/console-autocomplete/index.ts src/lib/console-autocomplete/__tests__/capabilities.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
git commit -m "fix: 按方法和层级约束接口路径候选"
```

---

### Task 4: 按 endpoint 精确提供查询参数和值

**Files:**

- Modify: `src/lib/console-autocomplete/snippets.ts`
- Modify: `src/lib/console-autocomplete/capabilities.ts`
- Modify: `src/lib/console-autocomplete/index.ts`
- Modify: `src/lib/console-autocomplete/__tests__/capabilities.test.ts`
- Modify: `src/lib/console-autocomplete/__tests__/index.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `ConsoleEndpoint`、Task 3 的 method/path 分发。
- Produces: `selectQueryParameterSnippets(endpoint, context, usedKeys): QueryParameterSnippet[]` 和 `selectQueryParameterValueSnippets(endpoint, key, context): RawSnippet[]`。

- [x] **Step 1: 写 Scroll、已用参数和值模式失败测试**

```ts
it("Scroll 路径只提示 Scroll 参数", async () => {
  const labels = await completeLabels("POST /_search/scroll?")
  expect(labels).toEqual(expect.arrayContaining(["scroll", "scroll_id", "rest_total_hits_as_int"]))
  expect(labels).not.toEqual(expect.arrayContaining(["from", "size", "sort", "search_type"]))
})

it("不重复提示已经使用的查询参数", async () => {
  const labels = await completeLabels("GET /orders/_search?size=10&")
  expect(labels).not.toContain("size")
  expect(labels).toContain("from")
})

it("等号后提供参数值而不是参数名", async () => {
  const labels = await completeLabels("GET /orders/_search?pretty=")
  expect(labels).toEqual(expect.arrayContaining(["true", "false"]))
  expect(labels).not.toEqual(expect.arrayContaining(["from", "size", "pretty"]))
})

it("枚举参数只提供合法枚举值", async () => {
  const labels = await completeLabels("GET /orders/_search?search_type=")
  expect(labels).toEqual(["query_then_fetch", "dfs_query_then_fetch"])
})
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/capabilities.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
```

Expected: FAIL，Scroll 被 Search 参数污染，等号后仍提示参数名。

- [x] **Step 3: 建立 endpoint 参数白名单**

导出参数类型与两个选择器，并为 `scroll` 增加独立参数集合：

```ts
export type QueryParameterSnippet = RawSnippet & {
  endpoints: Array<ConsoleEndpoint | "common">
}

const SCROLL_QUERY_PARAMETER_SNIPPETS: QueryParameterSnippet[] = [
  {
    label: "scroll",
    detail: "保留滚动上下文",
    documentation: "延长 Scroll 搜索上下文的有效期。",
    insertText: "scroll=${1:1m}",
    kind: "keyword",
    endpoints: ["scroll"],
  },
  {
    label: "scroll_id",
    detail: "Scroll ID",
    documentation: "指定需要继续读取的 Scroll 上下文。",
    insertText: "scroll_id=${1:id}",
    kind: "keyword",
    endpoints: ["scroll"],
  },
  {
    label: "rest_total_hits_as_int",
    detail: "整数命中总数",
    documentation: "以整数形式返回 hits.total。",
    insertText: "rest_total_hits_as_int=${1:true}",
    kind: "keyword",
    endpoints: ["scroll"],
  },
]

export function selectQueryParameterSnippets(
  endpoint: ConsoleEndpoint,
  context?: CompletionCapabilityContext | null,
  usedKeys: readonly string[] = [],
): QueryParameterSnippet[]

export function selectQueryParameterValueSnippets(
  endpoint: ConsoleEndpoint,
  key: string,
  context?: CompletionCapabilityContext | null,
): RawSnippet[]
```

`selectQueryParameterSnippets` 不再解析 path，直接按 endpoint 过滤并排除已使用 key：

```ts
export function selectQueryParameterSnippets(
  endpoint: ConsoleEndpoint,
  context?: CompletionCapabilityContext | null,
  usedKeys: readonly string[] = [],
): QueryParameterSnippet[] {
  if (endpoint === "unknown" || endpoint === "root") return []
  const used = new Set(usedKeys)
  return filterAvailableSnippets(
    [...COMMON_QUERY_PARAMETERS, ...ENDPOINT_QUERY_PARAMETERS, ...SCROLL_QUERY_PARAMETER_SNIPPETS],
    context,
  ).filter((snippet) =>
    !used.has(snippet.label) &&
    (snippet.endpoints.includes("common") || snippet.endpoints.includes(endpoint)),
  )
}
```

把选择器从“路径包含 `_search`”改为接收 `ConsoleEndpoint`，至少为 `search`、`scroll`、`count`、`bulk`、`msearch` 建立显式集合；不存在参数白名单的 endpoint 返回空数组。

- [x] **Step 4: 区分参数名模式和值模式**

解析 `?` 后当前 token：

- 当前 `&` 分段不含 `=`：返回 endpoint 参数名候选，并排除前面已经出现的 key。
- 当前分段含 `=`：只返回该 key 的值候选。
- boolean 参数值为 `true`、`false`。
- `search_type` 值为 `query_then_fetch`、`dfs_query_then_fetch`。
- 没有已知值集合的自由文本/数值参数返回空数组，不返回其他参数名。

值候选的 `from/to` 只覆盖等号后的当前值，避免重复插入 `key=`。

在 `index.ts` 增加纯游标解析 helper，并由它决定调用哪个选择器：

```ts
type QueryParameterCursor = {
  mode: "name" | "value"
  key: string
  usedKeys: string[]
  startColumn: number
  endColumn: number
}

function analyzeQueryParameterCursor(lineContent: string, column: number): QueryParameterCursor | null {
  const cursorIndex = column - 1
  const questionIndex = lineContent.lastIndexOf("?", cursorIndex)
  if (questionIndex < 0) return null
  const ampersandIndex = lineContent.lastIndexOf("&", cursorIndex - 1)
  const currentStart = Math.max(questionIndex, ampersandIndex) + 1
  const current = lineContent.slice(currentStart, cursorIndex)
  const equalsOffset = current.indexOf("=")
  const completed = lineContent.slice(questionIndex + 1, currentStart)
  const usedKeys = completed
    .split("&")
    .map((part) => part.split("=", 1)[0]?.trim() ?? "")
    .filter(Boolean)
  let endIndex = cursorIndex
  while (endIndex < lineContent.length && lineContent[endIndex] !== "&" && !/\s/.test(lineContent[endIndex] ?? "")) {
    endIndex += 1
  }

  if (equalsOffset >= 0) {
    return {
      mode: "value",
      key: current.slice(0, equalsOffset),
      usedKeys,
      startColumn: currentStart + equalsOffset + 2,
      endColumn: endIndex + 1,
    }
  }
  return {
    mode: "name",
    key: current,
    usedKeys,
    startColumn: currentStart + 1,
    endColumn: endIndex + 1,
  }
}

const cursor = analyzeQueryParameterCursor(lineContent, column)
if (!cursor) return []
const snippets = cursor.mode === "value"
  ? selectQueryParameterValueSnippets(autocompleteContext.request.endpoint, cursor.key, autocompleteContext)
  : selectQueryParameterSnippets(
      autocompleteContext.request.endpoint,
      autocompleteContext,
      cursor.usedKeys,
    )
const range = new monacoInstance.Range(1, cursor.startColumn, 1, cursor.endColumn)
```

在 `capabilities.ts` 明确值集合：

```ts
const BOOLEAN_QUERY_PARAMETER_KEYS = new Set([
  "pretty", "human", "error_trace", "rest_total_hits_as_int", "allow_partial_search_results",
])
const BOOLEAN_QUERY_PARAMETER_VALUES: RawSnippet[] = [
  { label: "true", detail: "启用", documentation: "使用 true。", insertText: "true", kind: "keyword" },
  { label: "false", detail: "禁用", documentation: "使用 false。", insertText: "false", kind: "keyword" },
]
const SEARCH_TYPE_VALUES: RawSnippet[] = [
  { label: "query_then_fetch", detail: "默认搜索类型", documentation: "先查询再拉取。", insertText: "query_then_fetch", kind: "keyword" },
  { label: "dfs_query_then_fetch", detail: "全局词频搜索", documentation: "先收集全局词频再查询。", insertText: "dfs_query_then_fetch", kind: "keyword" },
]

export function selectQueryParameterValueSnippets(
  endpoint: ConsoleEndpoint,
  key: string,
  context?: CompletionCapabilityContext | null,
): RawSnippet[] {
  const allowed = selectQueryParameterSnippets(endpoint, context).some((item) => item.label === key)
  if (!allowed) return []
  if (BOOLEAN_QUERY_PARAMETER_KEYS.has(key)) return BOOLEAN_QUERY_PARAMETER_VALUES
  if (key === "search_type") return SEARCH_TYPE_VALUES
  return []
}
```

- [x] **Step 5: 运行聚焦测试并确认 GREEN**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/capabilities.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
```

Expected: PASS。

- [x] **Step 6: 提交本任务**

```bash
git add src/lib/console-autocomplete/snippets.ts src/lib/console-autocomplete/capabilities.ts src/lib/console-autocomplete/index.ts src/lib/console-autocomplete/__tests__/capabilities.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
git commit -m "fix: 精确匹配接口查询参数候选"
```

---

### Task 5: 按 endpoint 与 NDJSON 行状态提供请求体候选

**Files:**

- Create: `src/lib/console-autocomplete/body-context.ts`
- Create: `src/lib/console-autocomplete/__tests__/body-context.test.ts`
- Modify: `src/lib/console-autocomplete/snippets.ts`
- Modify: `src/lib/console-autocomplete/index.ts`
- Modify: `src/lib/console-autocomplete/__tests__/index.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `ConsoleRequestContext` 与 `ConsoleBodyMode`，现有 `analyzeJsonCursor` 和 mapping `fieldNames`。
- Produces: `analyzeBodyCompletion(content, request): BodyCompletionContext`，以及按 JSON/NDJSON body kind 分发的 Monaco 候选。

- [x] **Step 1: 写请求体模式和 NDJSON 状态失败测试**

`body-context.test.ts` 直接测试纯函数，`index.test.ts` 测最终候选：

```ts
it.each([
  ["POST /_bulk\n", "bulk-action"],
  ['POST /_bulk\n{"index":{"_index":"orders"}}\n', "bulk-source"],
  ['POST /_bulk\n{"update":{"_index":"orders","_id":"1"}}\n', "bulk-update"],
  ['POST /_bulk\n{"delete":{"_index":"orders","_id":"1"}}\n', "bulk-action"],
  ["POST /_msearch\n", "msearch-header"],
  ['POST /_msearch\n{"index":"orders"}\n', "msearch-body"],
] as const)("分析 NDJSON 状态 %s", (content, kind) => {
  expect(analyzeBodyCompletion(content, parseConsoleRequestContext(content)).kind).toBe(kind)
})

it.each([
  "POST /_bulk\nnot-json\n",
  "POST /_msearch\nnot-json\n",
])("无效 NDJSON 使用 unknown 保守状态", (content) => {
  expect(analyzeBodyCompletion(content, parseConsoleRequestContext(content)).kind).toBe("unknown")
})

it("Create Index 根对象不提示 Search 属性", async () => {
  const labels = await completeLabels("PUT /orders\n{\n  <cursor>\n}")
  expect(labels).toEqual(expect.arrayContaining(["settings", "mappings", "aliases"]))
  expect(labels).not.toEqual(expect.arrayContaining(["query", "from", "size", "sort"]))
})

it("Count 根对象只提示 Count 支持的属性", async () => {
  const labels = await completeLabels("POST /orders/_count\n{\n  <cursor>\n}")
  expect(labels).toEqual(expect.arrayContaining(["query", "runtime_mappings"]))
  expect(labels).not.toEqual(expect.arrayContaining(["aggs", "from", "size", "sort"]))
})

it("Update 根对象提示更新属性而非 Search 属性", async () => {
  const labels = await completeLabels("POST /orders/_update/42\n{\n  <cursor>\n}")
  expect(labels).toEqual(expect.arrayContaining([
    "doc", "script", "upsert", "doc_as_upsert", "scripted_upsert", "detect_noop", "_source",
  ]))
  expect(labels).not.toEqual(expect.arrayContaining(["query", "aggs", "size"]))
})

it("Document 根对象只提示 mapping 字段", async () => {
  const labels = await completeLabels(
    "POST /orders/_doc\n{\n  <cursor>\n}",
    metadataWithFields(["title", "price"]),
  )
  expect(labels).toEqual(expect.arrayContaining(["title", "price"]))
  expect(labels).not.toEqual(expect.arrayContaining(["query", "aggs", "size"]))
})

it("Document 缺少 mapping metadata 时不猜测属性", async () => {
  expect(await completeLabels("POST /orders/_doc\n{\n  <cursor>\n}")).toEqual([])
})

it("Bulk 动作行提示动作对象", async () => {
  expect(await completeLabels("POST /_bulk\n<cursor>")).toEqual(
    expect.arrayContaining(["index", "create", "update", "delete"]),
  )
})

it("Bulk index 动作后提示文档字段而非 Search 根属性", async () => {
  const labels = await completeLabels(
    'POST /_bulk\n{"index":{"_index":"orders"}}\n<cursor>',
    metadataWithFields(["title", "price"]),
  )
  expect(labels).toEqual(expect.arrayContaining(["title", "price"]))
  expect(labels).not.toEqual(expect.arrayContaining(["query", "aggs", "size"]))
})

it("Bulk update 动作后提示 Update 属性", async () => {
  const labels = await completeLabels(
    'POST /_bulk\n{"update":{"_index":"orders","_id":"42"}}\n<cursor>',
  )
  expect(labels).toEqual(expect.arrayContaining(["doc", "upsert", "script"]))
  expect(labels).not.toEqual(expect.arrayContaining(["query", "aggs", "size"]))
})

it("MSearch header 提示标头候选", async () => {
  const labels = await completeLabels("POST /_msearch\n<cursor>")
  expect(labels).toEqual(expect.arrayContaining([
    "index", "routing", "preference", "search_type", "request_cache", "empty header",
  ]))
  expect(labels).not.toEqual(expect.arrayContaining(["query", "aggs", "size"]))
})

it("MSearch 标头后进入 Search 请求体", async () => {
  const labels = await completeLabels('POST /_msearch\n{"index":"orders"}\n<cursor>')
  expect(labels).toEqual(expect.arrayContaining(["query", "aggs", "size"]))
})

it("Search 根候选不退化", async () => {
  const labels = await completeLabels("POST /orders/_search\n{\n  <cursor>\n}")
  expect(labels).toEqual(expect.arrayContaining(["query", "aggs", "from", "size", "sort"]))
})
```

在 `index.test.ts` 增加测试 metadata helper；字段仅存在测试 fixture 中，不进入生产候选：

```ts
function metadataWithFields(fields: string[]) {
  return {
    ...metadata({}),
    fields,
    fieldsByIndex: { orders: fields },
  }
}
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/body-context.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
```

Expected: FAIL，缺少 body context 模块且非 Search body 仍收到 Search 候选。

- [x] **Step 3: 实现独立的正文状态分析器**

在 `body-context.ts` 定义：

```ts
export type BodyCompletionKind =
  | "search-json"
  | "scroll-json"
  | "count-json"
  | "create-index-json"
  | "update-json"
  | "document-json"
  | "bulk-action"
  | "bulk-source"
  | "bulk-update"
  | "msearch-header"
  | "msearch-body"
  | "unknown"

export interface BodyCompletionContext {
  kind: BodyCompletionKind
  currentLine: string
}

export function analyzeBodyCompletion(
  content: string,
  request: ConsoleRequestContext,
): BodyCompletionContext
```

实现规则：

- 普通 JSON endpoint 直接映射到对应 kind。
- Bulk 只检查请求行后的已完成非空 NDJSON 行；动作行识别顶层动作 key。
- `index/create` 后一行为 `bulk-source`，`update` 后一行为 `bulk-update`，`delete` 后立即回到 `bulk-action`。
- MSearch 偶数数据行是 `msearch-header`，奇数数据行是 `msearch-body`；空 `{}` 也计作一行。
- 某个已完成 NDJSON 行无法解析时返回 `unknown`，不猜测后续状态。

状态机主体使用以下实现；`JSON.parse` 只处理已完成的单行：

```ts
const JSON_BODY_KIND: Partial<Record<ConsoleBodyMode, BodyCompletionKind>> = {
  "search-json": "search-json",
  "scroll-json": "scroll-json",
  "count-json": "count-json",
  "create-index-json": "create-index-json",
  "update-json": "update-json",
  "document-json": "document-json",
}

export function analyzeBodyCompletion(
  content: string,
  request: ConsoleRequestContext,
): BodyCompletionContext {
  const lines = content.split(/\r?\n/)
  const bodyLines = lines.slice(1)
  const currentLine = bodyLines.at(-1) ?? ""
  const completedLines = bodyLines.slice(0, -1).filter((line) => line.trim().length > 0)
  const jsonKind = JSON_BODY_KIND[request.bodyMode]
  if (jsonKind) return { kind: jsonKind, currentLine }

  if (request.bodyMode === "msearch-ndjson") {
    try {
      completedLines.forEach((line) => JSON.parse(line))
    } catch {
      return { kind: "unknown", currentLine }
    }
    return {
      kind: completedLines.length % 2 === 0 ? "msearch-header" : "msearch-body",
      currentLine,
    }
  }

  if (request.bodyMode !== "bulk-ndjson") return { kind: "unknown", currentLine }

  let kind: BodyCompletionKind = "bulk-action"
  for (const line of completedLines) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return { kind: "unknown", currentLine }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "unknown", currentLine }
    }
    if (kind !== "bulk-action") {
      kind = "bulk-action"
      continue
    }
    const action = parsed && typeof parsed === "object" ? Object.keys(parsed)[0] : undefined
    if (action === "delete") kind = "bulk-action"
    else if (action === "update") kind = "bulk-update"
    else if (action === "index" || action === "create") kind = "bulk-source"
    else return { kind: "unknown", currentLine }
  }
  return { kind, currentLine }
}
```

- [x] **Step 4: 增加非 Search 请求体根候选**

在 `snippets.ts` 明确声明：

```ts
export const CREATE_INDEX_ROOT_PROPERTY_SNIPPETS: RawSnippet[] = [
  propertySnippet("settings", "索引设置", "配置索引 settings。", '"settings": {\n\t$0\n}', "000-settings"),
  propertySnippet("mappings", "索引映射", "配置索引 mappings。", '"mappings": {\n\t$0\n}', "001-mappings"),
  propertySnippet("aliases", "索引别名", "配置索引 aliases。", '"aliases": {\n\t$0\n}', "002-aliases"),
]

export const COUNT_ROOT_PROPERTY_SNIPPETS: RawSnippet[] = [
  propertySnippet("query", "计数查询", "配置 Count API 查询。", '"query": {\n\t$0\n}', "000-query"),
  propertySnippet("runtime_mappings", "运行时映射", "配置 Count API 运行时字段。", '"runtime_mappings": {\n\t$0\n}', "001-runtime-mappings"),
]

export const SCROLL_ROOT_PROPERTY_SNIPPETS: RawSnippet[] = [
  propertySnippet("scroll", "滚动保留时间", "延长 Scroll 上下文。", '"scroll": "${1:1m}"', "000-scroll"),
  propertySnippet("scroll_id", "Scroll ID", "指定 Scroll 上下文。", '"scroll_id": "${1:id}"', "001-scroll-id"),
]

export const UPDATE_ROOT_PROPERTY_SNIPPETS: RawSnippet[] = [
  propertySnippet("doc", "局部文档", "提供需要合并的字段。", '"doc": {\n\t$0\n}', "000-doc"),
  propertySnippet("script", "更新脚本", "使用脚本更新文档。", '"script": {\n\t"source": "$0"\n}', "001-script"),
  propertySnippet("upsert", "不存在时写入", "提供 upsert 文档。", '"upsert": {\n\t$0\n}', "002-upsert"),
  propertySnippet("doc_as_upsert", "将 doc 用作 upsert", "文档不存在时使用 doc。", '"doc_as_upsert": ${1:true}', "003-doc-as-upsert"),
  propertySnippet("scripted_upsert", "脚本处理 upsert", "文档不存在时仍执行更新脚本。", '"scripted_upsert": ${1:true}', "004-scripted-upsert"),
  propertySnippet("detect_noop", "检测无变化更新", "字段未变化时跳过写入。", '"detect_noop": ${1:true}', "005-detect-noop"),
  propertySnippet("_source", "返回源字段", "控制更新响应中的 _source。", '"_source": ${1:true}', "006-source"),
]

function lineSnippet(label: string, detail: string, insertText: string, sortText: string): RawSnippet {
  return {
    label,
    detail,
    documentation: detail,
    insertText,
    kind: "keyword",
    sortText,
  }
}

export const BULK_ACTION_SNIPPETS: RawSnippet[] = [
  lineSnippet("index", "Bulk index 动作", '{"index":{"_index":"${1:index}","_id":"${2:id}"}}', "000-index"),
  lineSnippet("create", "Bulk create 动作", '{"create":{"_index":"${1:index}","_id":"${2:id}"}}', "001-create"),
  lineSnippet("update", "Bulk update 动作", '{"update":{"_index":"${1:index}","_id":"${2:id}"}}', "002-update"),
  lineSnippet("delete", "Bulk delete 动作", '{"delete":{"_index":"${1:index}","_id":"${2:id}"}}', "003-delete"),
]

export const MSEARCH_HEADER_SNIPPETS: RawSnippet[] = [
  lineSnippet("index", "MSearch 索引标头", '{"index":"${1:index}"}', "000-index"),
  lineSnippet("routing", "MSearch routing 标头", '{"routing":"${1:routing}"}', "001-routing"),
  lineSnippet("preference", "MSearch preference 标头", '{"preference":"${1:_local}"}', "002-preference"),
  lineSnippet("search_type", "MSearch 搜索类型标头", '{"search_type":"${1:query_then_fetch}"}', "003-search-type"),
  lineSnippet("request_cache", "MSearch 请求缓存标头", '{"request_cache":${1:true}}', "004-request-cache"),
  lineSnippet("empty header", "MSearch 空标头", "{}", "005-empty"),
]
```

Scroll 根候选至少包含 `scroll`、`scroll_id`，且不复用 Search 根候选。文档正文和 Bulk source 使用 mapping 字段候选；Bulk update 使用 Update 根候选。

- [x] **Step 5: 在 provider 中按正文 kind 分发**

`provideConsoleCompletionItems` 在进入正文后先调用 `analyzeBodyCompletion`：

- JSON kind 继续使用 `analyzeJsonCursor`，但传入各自 root 白名单。
- NDJSON 动作/标头行直接按当前行范围返回整行 snippet。
- `msearch-body` 将当前 Search JSON 行构造成独立 JSON 片段交给现有 JSON 分析器，候选替换范围仍映射回原文档。
- `document-json` 和 `bulk-source` 只提示 mapping 字段，禁止 Search 根属性和 Query DSL。
- `unknown` 返回 `null` 或空 candidates，不做 Search 回退。

把现有 JSON helper 改成接收分析前缀和根白名单，避免复制 Monaco 渲染代码：

```ts
function buildJsonSuggestions(
  monacoInstance: typeof monacoEditor,
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position,
  autocompleteContext: ConsoleAutocompleteContext,
  analysisPrefix: string,
  rootPropertySnippets: readonly RawSnippet[],
  allowRootFieldKeys = false,
): monacoEditor.languages.CompletionItem[] {
  const range = model.getWordUntilPosition(position)
  const replaceRange = new monacoInstance.Range(
    position.lineNumber,
    range.startColumn,
    position.lineNumber,
    range.endColumn,
  )
  const cursorInfo = analyzeJsonCursor(analysisPrefix)
  const insideStringFallback = isInsideString(analysisPrefix)
  const textBeforeCurrentWord = range.word
    ? analysisPrefix.slice(0, -range.word.length)
    : analysisPrefix
  const previousCharacter = getPreviousMeaningfulCharacter(textBeforeCurrentWord)
  const preferValueSnippets = cursorInfo.expectingValue || previousCharacter === ":" || previousCharacter === "["
  const path = cursorInfo.path
  const suggestionsList: monacoEditor.languages.CompletionItem[] = []
  const allowFields = allowRootFieldKeys && path.length === 0

  if (cursorInfo.insideString || insideStringFallback) {
    if (cursorInfo.insideStringAsKey) {
      if ((allowFields || shouldSuggestFieldsForKey(path)) && autocompleteContext.fieldNames.length > 0) {
        suggestionsList.push(
          ...buildFieldSuggestions(monacoInstance, autocompleteContext.fieldNames, replaceRange, "string-value"),
        )
      }
      return suggestionsList
    }
    if (shouldSuggestFieldsForStringValue(path) && autocompleteContext.fieldNames.length > 0) {
      suggestionsList.push(
        ...buildFieldSuggestions(monacoInstance, autocompleteContext.fieldNames, replaceRange, "string-value"),
      )
    }
    return suggestionsList
  }

  if (!preferValueSnippets) {
    if ((allowFields || shouldSuggestFieldsForKey(path)) && autocompleteContext.fieldNames.length > 0) {
      suggestionsList.push(
        ...buildFieldSuggestions(monacoInstance, autocompleteContext.fieldNames, replaceRange, "key"),
      )
    }
    const properties = path.length === 0
      ? filterAvailableSnippets(rootPropertySnippets, autocompleteContext)
      : selectPropertySuggestions(path, autocompleteContext)
    properties.forEach((snippet) => {
      suggestionsList.push(renderSnippet(monacoInstance, snippet, replaceRange, false))
    })
    return suggestionsList
  }

  selectValueSuggestions(path).forEach((snippet) => {
    suggestionsList.push(renderSnippet(monacoInstance, snippet, replaceRange, false))
  })
  return suggestionsList
}

const ROOT_SNIPPETS_BY_KIND: Partial<Record<BodyCompletionKind, readonly RawSnippet[]>> = {
  "search-json": ROOT_PROPERTY_SNIPPETS,
  "msearch-body": ROOT_PROPERTY_SNIPPETS,
  "scroll-json": SCROLL_ROOT_PROPERTY_SNIPPETS,
  "count-json": COUNT_ROOT_PROPERTY_SNIPPETS,
  "create-index-json": CREATE_INDEX_ROOT_PROPERTY_SNIPPETS,
  "update-json": UPDATE_ROOT_PROPERTY_SNIPPETS,
  "bulk-update": UPDATE_ROOT_PROPERTY_SNIPPETS,
  "document-json": [],
  "bulk-source": [],
}

function buildBodySuggestions(
  monacoInstance: typeof monacoEditor,
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position,
  autocompleteContext: ConsoleAutocompleteContext,
) {
  const textBeforeCursor = model.getValueInRange(
    new monacoInstance.Range(1, 1, position.lineNumber, position.column),
  )
  const bodyContext = analyzeBodyCompletion(textBeforeCursor, autocompleteContext.request)
  const lineContent = model.getLineContent(position.lineNumber)
  const lineRange = new monacoInstance.Range(position.lineNumber, 1, position.lineNumber, lineContent.length + 1)

  if (bodyContext.kind === "bulk-action" || bodyContext.kind === "msearch-header") {
    const snippets = bodyContext.kind === "bulk-action"
      ? BULK_ACTION_SNIPPETS
      : MSEARCH_HEADER_SNIPPETS
    return snippets.map((snippet) => renderSnippet(monacoInstance, snippet, lineRange, false))
  }
  if (bodyContext.kind === "unknown") return []

  const rootSnippets = ROOT_SNIPPETS_BY_KIND[bodyContext.kind]
  if (!rootSnippets) return []
  const analysisPrefix = bodyContext.kind === "msearch-body"
    ? `POST /_search\n${bodyContext.currentLine}`
    : textBeforeCursor
  const allowRootFieldKeys = bodyContext.kind === "document-json" || bodyContext.kind === "bulk-source"
  return buildJsonSuggestions(
    monacoInstance,
    model,
    position,
    autocompleteContext,
    analysisPrefix,
    rootSnippets,
    allowRootFieldKeys,
  )
}
```

同时从 `capabilities.ts` 导入 `filterAvailableSnippets`。`msearch-body` 的 `analysisPrefix` 是 `` `POST /_search\n${bodyContext.currentLine}` ``，普通 JSON 使用光标前完整文本；Bulk 动作/标头用 `renderSnippet` 直接渲染 `BULK_ACTION_SNIPPETS` 或 `MSEARCH_HEADER_SNIPPETS`。

- [x] **Step 6: 运行聚焦测试并确认 GREEN**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/body-context.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
```

Expected: PASS。

- [x] **Step 7: 提交本任务**

```bash
git add src/lib/console-autocomplete/body-context.ts src/lib/console-autocomplete/snippets.ts src/lib/console-autocomplete/index.ts src/lib/console-autocomplete/__tests__/body-context.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
git commit -m "fix: 按请求体协议提供自动补全候选"
```

---

### Task 6: 精确约束 JSON 属性、值、Span 子句和聚合层级

**Files:**

- Modify: `src/lib/console-autocomplete/json-path.ts`
- Modify: `src/lib/console-autocomplete/snippets.ts`
- Modify: `src/lib/console-autocomplete/suggestions.ts`
- Modify: `src/lib/console-autocomplete/__tests__/json-path.test.ts`
- Modify: `src/lib/console-autocomplete/__tests__/suggestions.test.ts`
- Modify: `src/lib/console-autocomplete/__tests__/index.test.ts`

**Interfaces:**

- Consumes: Task 5 已限定的 JSON body kind、现有 `JsonPathSegment[]`。
- Produces: 带 `objectFrames` 的 `JsonCursorInfo`，以及 `selectPropertySuggestions(path, context, objectFrames): RawSnippet[]` 的精确白名单行为。

- [x] **Step 1: 为六类错误上下文写失败测试**

覆盖如下断言：

```ts
it("size 值位置只提示数值，不提示 Query DSL 和 null", async () => {
  const labels = await completeLabels('POST /orders/_search\n{"size": <cursor>}')
  expect(labels).toContain("0")
  expect(labels).not.toEqual(expect.arrayContaining(["bool", "match", "term", "null"]))
})

it("profile 值位置只提示布尔值", async () => {
  const labels = await completeLabels('POST /orders/_search\n{"profile": <cursor>}')
  expect(labels).toEqual(expect.arrayContaining(["true", "false"]))
  expect(labels).not.toEqual(expect.arrayContaining(["bool", "match", "null", "0"]))
})

it("未知对象不回退到 Search 根属性或 Query DSL", async () => {
  const labels = await completeLabels('POST /orders/_search\n{"unknown":{ <cursor>}}')
  expect(labels).toEqual([])
})

it("term 字段参数对象只提示 term 参数", async () => {
  const labels = await completeLabels(
    'POST /orders/_search\n{"query":{"term":{"status":{ <cursor>}}}}',
  )
  expect(labels).toEqual(expect.arrayContaining(["value", "boost", "case_insensitive"]))
  expect(labels).not.toEqual(expect.arrayContaining(["status", "bool", "query"]))
})

it("range 字段参数对象只提示 range 参数", async () => {
  const labels = await completeLabels(
    'POST /orders/_search\n{"query":{"range":{"created_at":{ <cursor>}}}}',
  )
  expect(labels).toEqual(
    expect.arrayContaining(["gt", "gte", "lt", "lte", "format", "time_zone", "boost"]),
  )
  expect(labels).not.toEqual(expect.arrayContaining(["created_at", "bool", "query"]))
})

it("match 字段参数对象提示长格式参数", async () => {
  const labels = await completeLabels(
    'POST /orders/_search\n{"query":{"match":{"title":{ <cursor>}}}}',
  )
  expect(labels).toEqual(expect.arrayContaining(["query", "analyzer", "operator", "fuzziness", "boost"]))
  expect(labels).not.toEqual(expect.arrayContaining(["title", "bool", "aggs"]))
})

it("span_near clauses 只提示 Span 查询", async () => {
  const labels = await completeLabels(
    'POST /orders/_search\n{"query":{"span_near":{"clauses":[{ <cursor>}]}}}',
  )
  expect(labels).toEqual(expect.arrayContaining(["span_term", "span_first", "span_multi"]))
  expect(labels).not.toEqual(expect.arrayContaining(["match", "knn", "semantic"]))
})

it("子聚合不提示 global", async () => {
  const labels = await completeLabels(
    'POST /orders/_search\n{"aggs":{"by_status":{"terms":{"field":"status"},"aggs":{"child":{ <cursor>}}}}}',
  )
  expect(labels).not.toContain("global")
  expect(labels).toEqual(expect.arrayContaining(["terms", "filter"]))
})

it("reverse_nested 只在 nested 子聚合中出现", async () => {
  const topLevel = await completeLabels('POST /orders/_search\n{"aggs":{"x":{ <cursor>}}}')
  expect(topLevel).not.toContain("reverse_nested")
  expect(topLevel).toEqual(expect.arrayContaining(["global", "terms"]))

  const nestedChild = await completeLabels(
    'POST /orders/_search\n{"aggs":{"n":{"nested":{"path":"items"},"aggs":{"back":{ <cursor>}}}}}',
  )
  expect(nestedChild).toContain("reverse_nested")
})
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/json-path.test.ts src/lib/console-autocomplete/__tests__/suggestions.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
```

Expected: FAIL，宽泛 fallback、通用值候选和无层级聚合候选仍存在。

- [x] **Step 3: 扩展 JSON 光标上下文的祖先证据**

在不实现完整 AST 的前提下，让现有 `JsonCursorInfo` 暴露当前对象从远到近的祖先 frame 和已完成兄弟 key：

```ts
export type JsonObjectFrame = {
  currentKey: string | null
  seenKeys: string[]
}

export type JsonCursorInfo = {
  path: JsonPathSegment[]
  insideString: boolean
  insideStringAsKey: boolean
  expectingKey: boolean
  expectingValue: boolean
  previousMeaningfulChar: string
  bodyStartIndex: number
  objectFrames: JsonObjectFrame[]
}
```

内部 `Frame` 增加 `seenKeys: Set<string>`；读完属性名后把它加入当前 object frame，返回结果时用 `stack.filter(frame.kind === "object")` 映射为数组副本。nested aggregation 示例必须能识别某个祖先聚合对象已出现 `nested`。

- [x] **Step 4: 将属性选择改为显式上下文白名单**

增加并使用以下 snippet 集合：

```ts
function caseInsensitivePropertySnippets(sortText: string): RawSnippet[] {
  return [
    propertySnippet(
      "case_insensitive", "忽略大小写", "对 ASCII 字符执行大小写不敏感匹配。",
      '"case_insensitive": ${1:true}', sortText,
      { products: ["elasticsearch"], minVersion: [7, 10] },
    ),
    propertySnippet(
      "case_insensitive", "忽略大小写", "对 ASCII 字符执行大小写不敏感匹配。",
      '"case_insensitive": ${1:true}', sortText,
      { products: ["opensearch"], minMajor: 1 },
    ),
  ]
}

export const TERM_VALUE_PROPERTY_SNIPPETS: RawSnippet[] = [
  propertySnippet("value", "精确值", "指定 term 查询值。", '"value": "${1:value}"', "000-value"),
  propertySnippet("boost", "权重", "设置 term 查询权重。", '"boost": ${1:1.0}', "001-boost"),
  ...caseInsensitivePropertySnippets("002-case-insensitive"),
]

export const RANGE_VALUE_PROPERTY_SNIPPETS: RawSnippet[] = [
  propertySnippet("gt", "大于", "匹配大于给定值的文档。", '"gt": "${1:value}"', "000-gt"),
  propertySnippet("gte", "大于等于", "匹配大于等于给定值的文档。", '"gte": "${1:value}"', "001-gte"),
  propertySnippet("lt", "小于", "匹配小于给定值的文档。", '"lt": "${1:value}"', "002-lt"),
  propertySnippet("lte", "小于等于", "匹配小于等于给定值的文档。", '"lte": "${1:value}"', "003-lte"),
  propertySnippet("format", "日期格式", "指定日期值格式。", '"format": "${1:strict_date_optional_time}"', "004-format"),
  propertySnippet("time_zone", "时区", "指定日期范围查询时区。", '"time_zone": "${1:+00:00}"', "005-time-zone"),
  propertySnippet("boost", "权重", "设置 range 查询权重。", '"boost": ${1:1.0}', "006-boost"),
]

export const FIELD_QUERY_VALUE_PROPERTY_SNIPPETS_BY_TYPE: Readonly<
  Record<string, ReadonlyArray<RawSnippet>>
> = {
  match: [
    propertySnippet("query", "查询值", "指定 match 查询文本。", '"query": "${1:value}"', "000-query"),
    propertySnippet("analyzer", "分析器", "指定查询分析器。", '"analyzer": "${1:standard}"', "001-analyzer"),
    propertySnippet("operator", "布尔运算符", "指定分词之间的运算符。", '"operator": "${1|or,and|}"', "002-operator"),
    propertySnippet("fuzziness", "模糊度", "指定允许的编辑距离。", '"fuzziness": "${1:AUTO}"', "003-fuzziness"),
    propertySnippet("boost", "权重", "设置查询权重。", '"boost": ${1:1.0}', "004-boost"),
  ],
  prefix: [
    propertySnippet("value", "前缀值", "指定前缀。", '"value": "${1:value}"', "000-value"),
    propertySnippet("rewrite", "重写方式", "指定 multi-term rewrite。", '"rewrite": "${1:constant_score}"', "001-rewrite"),
    ...caseInsensitivePropertySnippets("002-case-insensitive"),
    propertySnippet("boost", "权重", "设置查询权重。", '"boost": ${1:1.0}', "003-boost"),
  ],
  wildcard: [
    propertySnippet("value", "通配表达式", "指定通配符模式。", '"value": "${1:value*}"', "000-value"),
    propertySnippet("rewrite", "重写方式", "指定 multi-term rewrite。", '"rewrite": "${1:constant_score}"', "001-rewrite"),
    ...caseInsensitivePropertySnippets("002-case-insensitive"),
    propertySnippet("boost", "权重", "设置查询权重。", '"boost": ${1:1.0}', "003-boost"),
  ],
  regexp: [
    propertySnippet("value", "正则表达式", "指定正则模式。", '"value": "${1:pattern}"', "000-value"),
    propertySnippet("flags", "正则标志", "指定可选正则语法。", '"flags": "${1:ALL}"', "001-flags"),
    propertySnippet("max_determinized_states", "最大状态数", "限制自动机状态数。", '"max_determinized_states": ${1:10000}', "002-max-states"),
    propertySnippet("rewrite", "重写方式", "指定 multi-term rewrite。", '"rewrite": "${1:constant_score}"', "003-rewrite"),
    ...caseInsensitivePropertySnippets("004-case-insensitive"),
    propertySnippet("boost", "权重", "设置查询权重。", '"boost": ${1:1.0}', "005-boost"),
  ],
  fuzzy: [
    propertySnippet("value", "模糊查询值", "指定模糊查询文本。", '"value": "${1:value}"', "000-value"),
    propertySnippet("fuzziness", "模糊度", "指定允许的编辑距离。", '"fuzziness": "${1:AUTO}"', "001-fuzziness"),
    propertySnippet("prefix_length", "固定前缀长度", "指定不参与模糊匹配的前缀长度。", '"prefix_length": ${1:0}', "002-prefix-length"),
    propertySnippet("max_expansions", "最大扩展数", "限制模糊词项扩展数。", '"max_expansions": ${1:50}', "003-max-expansions"),
    propertySnippet("transpositions", "允许换位", "允许相邻字符换位。", '"transpositions": ${1:true}', "004-transpositions"),
    propertySnippet("rewrite", "重写方式", "指定 multi-term rewrite。", '"rewrite": "${1:constant_score}"', "005-rewrite"),
    propertySnippet("boost", "权重", "设置查询权重。", '"boost": ${1:1.0}', "006-boost"),
  ],
}
```

同时：

- `term/{field}` 返回 TERM 集合，不再返回 mapping fields、root 或 Query DSL。
- `range/{field}` 返回 RANGE 集合。
- `match/prefix/wildcard/regexp/fuzzy/{field}` 返回 `FIELD_QUERY_VALUE_PROPERTY_SNIPPETS_BY_TYPE` 中对应的长格式集合。
- 已知对象上下文有专用集合时只返回专用集合。
- 删除 `selectPropertySuggestions` 末尾的 `root + query` 宽泛 fallback；无法识别时返回 `[]`。

选择器签名固定为：

```ts
export function selectPropertySuggestions(
  path: JsonPathSegment[],
  autocompleteContext?: Pick<ConsoleAutocompleteContext, "cluster"> | null,
  objectFrames: readonly JsonObjectFrame[] = [],
): RawSnippet[]
```

`index.ts` 调用时传 `cursorInfo.objectFrames`；Task 2 现有两参数调用继续有效。

- [x] **Step 5: 将值候选改为按属性类型选择**

替换通用“Query DSL + true/false/null”逻辑：

- `size/from/terminate_after/track_total_hits` 等数值位置只返回数值 snippet；`size/from` 默认 `0`。
- boolean 属性只返回 `true`、`false`。
- `query/filter/must/must_not/should` 等明确 query 容器才返回 Query DSL。
- `null` 只在已确认 API 允许 null 的属性中返回；本次列出的上下文均不返回。
- 未知标量位置返回空数组。

实现为显式 key 集合，不再以通用 literals 收尾：

```ts
const NUMBER_VALUE_KEYS = new Set(["size", "from", "terminate_after"])
const BOOLEAN_VALUE_KEYS = new Set([
  "explain",
  "profile",
  "version",
  "seq_no_primary_term",
  "track_scores",
  "doc_as_upsert",
  "scripted_upsert",
  "detect_noop",
  "_source",
])

const NUMBER_VALUE_SNIPPETS: RawSnippet[] = [
  { label: "0", detail: "数值", documentation: "插入非负整数。", insertText: "${1:0}", kind: "value", sortText: "000-number" },
]
const BOOLEAN_VALUE_SNIPPETS = LITERAL_VALUE_SNIPPETS.filter((item) => item.label !== "null")
const TRACK_TOTAL_HITS_VALUE_SNIPPETS: RawSnippet[] = [
  ...BOOLEAN_VALUE_SNIPPETS,
  { label: "10000", detail: "命中计数上限", documentation: "精确统计到指定命中数量。", insertText: "${1:10000}", kind: "value", sortText: "002-track-total-hits" },
]

export function selectValueSuggestions(path: JsonPathSegment[]): RawSnippet[] {
  const last = path[path.length - 1]
  const secondLast = path[path.length - 2]

  if (last === "track_total_hits") return TRACK_TOTAL_HITS_VALUE_SNIPPETS
  if (typeof last === "string" && NUMBER_VALUE_KEYS.has(last)) return NUMBER_VALUE_SNIPPETS
  if (typeof last === "string" && BOOLEAN_VALUE_KEYS.has(last)) return BOOLEAN_VALUE_SNIPPETS
  if (last === "query" || (typeof last === "string" && QUERY_CHILD_KEYS.has(last))) {
    return QUERY_LEAF_VALUE_SNIPPETS
  }
  if (typeof last === "number" && typeof secondLast === "string" && BOOL_ARRAY_KEYS.has(secondLast)) {
    return QUERY_LEAF_VALUE_SNIPPETS
  }
  return []
}
```

- [x] **Step 6: 拆分 Span 与聚合候选集合**

导出 `SPAN_QUERY_PROPERTY_SNIPPETS`，只包含 Span family；`span_multi.match` 仅允许 multi-term 查询，其他 Span 子句不复用全部 Query DSL：

```ts
export const SPAN_QUERY_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = SPAN_QUERY_SNIPPETS
export const MULTI_TERM_QUERY_PROPERTY_SNIPPETS = QUERY_LEAF_PROPERTY_SNIPPETS.filter((snippet) =>
  ["fuzzy", "prefix", "range", "regexp", "wildcard"].includes(snippet.label),
)

function isSpanChildContext(path: JsonPathSegment[]) {
  const last = path[path.length - 1]
  const secondLast = path[path.length - 2]
  const thirdLast = path[path.length - 3]
  if (typeof last === "number" && secondLast === "clauses" && thirdLast === "span_near") return true
  return ["match", "include", "exclude", "big", "little", "query"].includes(String(last)) &&
    path.some((segment) => typeof segment === "string" && segment.startsWith("span_"))
}

if (isSpanChildContext(path)) {
  return last === "match" && secondLast === "span_multi"
    ? filterAvailableSnippets(MULTI_TERM_QUERY_PROPERTY_SNIPPETS, autocompleteContext)
    : filterAvailableSnippets(SPAN_QUERY_PROPERTY_SNIPPETS, autocompleteContext)
}
```

聚合选择器接收层级上下文：

- `global` 只在 Search 根 `aggs` 的直接聚合定义中出现。
- `reverse_nested` 只在某个祖先聚合定义的 `seenKeys` 含 `nested` 时出现。
- 普通子聚合排除 `global` 和 `reverse_nested`。

聚合类型过滤使用以下判定，且在通用 aggregation 分支返回过滤结果：

```ts
function selectAggregationTypeSuggestions(
  path: JsonPathSegment[],
  objectFrames: readonly JsonObjectFrame[],
) {
  const topLevel = path.length === 2 && (path[0] === "aggs" || path[0] === "aggregations")
  const insideNested = objectFrames.some((frame) => frame.seenKeys.includes("nested"))

  return AGG_TYPE_PROPERTY_SNIPPETS.filter((snippet) => {
    if (snippet.label === "global") return topLevel
    if (snippet.label === "reverse_nested") return insideNested
    return true
  })
}
```

- [x] **Step 7: 运行聚焦测试并确认 GREEN**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__/json-path.test.ts src/lib/console-autocomplete/__tests__/suggestions.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
```

Expected: PASS。

- [x] **Step 8: 提交本任务**

```bash
git add src/lib/console-autocomplete/json-path.ts src/lib/console-autocomplete/snippets.ts src/lib/console-autocomplete/suggestions.ts src/lib/console-autocomplete/__tests__/json-path.test.ts src/lib/console-autocomplete/__tests__/suggestions.test.ts src/lib/console-autocomplete/__tests__/index.test.ts
git commit -m "fix: 按 JSON 上下文约束补全候选"
```

---

### Task 7: 完成十类问题的回归覆盖与全量验收

**Files:**

- Modify: `src/lib/console-autocomplete/__tests__/index.test.ts`
- Modify: `src/lib/console-autocomplete/__tests__/capabilities.test.ts`
- Modify: `src/lib/console-autocomplete/__tests__/suggestions.test.ts`
- Modify: `docs/superpowers/plans/2026-07-22-console-autocomplete-corrections.md`

**Interfaces:**

- Consumes: Tasks 1–6 的公开选择器与 Monaco provider 行为。
- Produces: 十类审计问题的一对一回归证据、全量测试与生产构建结果；不增加新的生产接口。

- [x] **Step 1: 建立审计问题到测试的显式映射**

确认测试名可直接搜索到以下十类回归；缺失的先补测试并看到失败：

1. Bulk/MSearch/Create Index 等 endpoint 不再收到 Search 根属性。
2. `size` 等标量值位置不再收到 Query DSL 和通用 null。
3. term/range 字段参数对象只收到专用参数。
4. API 路径候选受 HTTP method 约束。
5. 索引层级与 `/_cat/` 层级不再混入全局/重复候选。
6. Scroll 查询参数不再复用 Search 参数。
7. OpenSearch KNN 使用动态字段 + `vector`。
8. Elasticsearch query KNN、semantic、sparse_vector 按次版本过滤。
9. Span 子查询位置不再提示非 Span 查询。
10. 子聚合不提示 `global`，`reverse_nested` 仅在 nested 子聚合出现。

每类至少保留一个“错误候选不存在”断言和一个“对应正确候选存在”断言，落实“移除错误候选的同时补上正确候选”。

- [x] **Step 2: 运行自动补全目录测试**

Run:

```bash
pnpm vitest run src/lib/console-autocomplete/__tests__
```

Expected: PASS，所有自动补全测试通过。

- [x] **Step 3: 运行全量测试**

Run:

```bash
pnpm test
```

Expected: PASS，Vitest 全量测试无失败。

- [x] **Step 4: 运行生产构建**

Run:

```bash
pnpm run build
```

Expected: exit code 0，无 TypeScript 或 Vite 构建错误。

- [x] **Step 5: 检查补丁质量与范围**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~6..HEAD
```

Expected:

- `git diff --check` 无输出。
- 只有自动补全源码、对应测试和两份 superpowers 文档在任务范围内。
- 不含依赖锁文件、生成物、真实凭据或无关格式化修改。

- [x] **Step 6: 提交计划勾选与最终测试补充**

若本任务产生测试或计划勾选改动：

```bash
git add src/lib/console-autocomplete/__tests__/index.test.ts src/lib/console-autocomplete/__tests__/capabilities.test.ts src/lib/console-autocomplete/__tests__/suggestions.test.ts docs/superpowers/plans/2026-07-22-console-autocomplete-corrections.md
git commit -m "test: 补充自动补全错误候选回归覆盖"
```

若没有文件变化，跳过提交；不要创建空提交。

- [x] **Step 7: 记录最终证据**

Run:

```bash
git status --short
git log -7 --oneline
```

Expected: 工作树干净，最近提交依次对应上下文、版本、路径、参数、正文、JSON 约束及最终回归（无最终补充时可少一条）。
