import { describe, expect, it } from "vitest";
import { buildConsoleAutocompleteContext, provideConsoleCompletionItems } from "../index";
import type { ConnectionSearchMetadata } from "../../../types/requests";

const fakeMonaco = {
  Range: class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
  languages: {
    CompletionItemKind: {
      Field: 1,
      Function: 2,
      Keyword: 3,
      Property: 4,
      Reference: 5,
      Snippet: 6,
      Text: 7,
    },
    CompletionItemInsertTextRule: {
      InsertAsSnippet: 4,
    },
  },
} as never;

function modelFor(content: string) {
  const lines = content.split(/\r?\n/);
  return {
    getLineContent(lineNumber: number) {
      return lines[lineNumber - 1] ?? "";
    },
    getWordUntilPosition(position: { lineNumber: number; column: number }) {
      const line = lines[position.lineNumber - 1] ?? "";
      const before = line.slice(0, position.column - 1);
      const word = before.match(/[A-Za-z0-9_.-]+$/)?.[0] ?? "";
      return {
        word,
        startColumn: position.column - word.length,
        endColumn: position.column,
      };
    },
    getValueInRange(range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) {
      if (range.startLineNumber === range.endLineNumber) {
        return (lines[range.startLineNumber - 1] ?? "").slice(range.startColumn - 1, range.endColumn - 1);
      }
      const selected: string[] = [];
      for (let lineNumber = range.startLineNumber; lineNumber <= range.endLineNumber; lineNumber += 1) {
        const line = lines[lineNumber - 1] ?? "";
        if (lineNumber === range.startLineNumber) {
          selected.push(line.slice(range.startColumn - 1));
        } else if (lineNumber === range.endLineNumber) {
          selected.push(line.slice(0, range.endColumn - 1));
        } else {
          selected.push(line);
        }
      }
      return selected.join("\n");
    },
  } as never;
}

function metadata(overrides: Partial<ConnectionSearchMetadata["cluster"]>): ConnectionSearchMetadata {
  const cluster = {
    product: "elasticsearch" as const,
    version: { number: "8.12.1", major: 8, minor: 12 },
    distribution: null,
    buildFlavor: "default",
    license: { type: "basic", status: "active", source: "elastic-license" as const },
  };

  return {
    connectionId: "conn",
    indices: ["orders"],
    aliases: [],
    fields: [],
    fieldsByIndex: {},
    aliasToIndices: {},
    cluster: {
      ...cluster,
      ...overrides,
      version: {
        ...cluster.version,
        ...overrides.version,
      },
      license: {
        ...cluster.license,
        ...overrides.license,
      },
    },
    fetchedAt: "",
    expiresAt: "",
  };
}

function metadataWithFields(fields: string[]) {
  return {
    ...metadata({}),
    fields,
    fieldsByIndex: { orders: fields },
  };
}

function metadataWithTargetFields(): ConnectionSearchMetadata {
  return {
    ...metadata({}),
    indices: ["orders", "users"],
    aliases: ["orders-read"],
    fields: ["order_id", "order_total", "user_email", "user_id"],
    fieldsByIndex: {
      orders: ["order_id", "order_total"],
      users: ["user_email", "user_id"],
    },
    aliasToIndices: {
      "orders-read": ["orders"],
    },
  };
}

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

function completionLabels(content: string, searchMetadata = metadata({})) {
  return completionSuggestions(content, searchMetadata).map((item) => String(item.label));
}

function expectLabelsAbsent(labels: readonly string[], forbidden: readonly string[]) {
  expect(labels.filter((label) => forbidden.includes(label))).toEqual([]);
}

function completionSuggestions(content: string, searchMetadata = metadata({})) {
  const marker = "<cursor>";
  const markerOffset = content.indexOf(marker);
  const normalized = markerOffset >= 0 ? content.replace(marker, "") : content;
  const cursorOffset = markerOffset >= 0 ? markerOffset : normalized.length;
  const beforeCursor = normalized.slice(0, cursorOffset);
  const lines = beforeCursor.split(/\r?\n/);
  const lineNumber = lines.length;
  const column = (lines[lineNumber - 1]?.length ?? 0) + 1;
  const context = buildConsoleAutocompleteContext([], normalized, searchMetadata);
  return provideConsoleCompletionItems(
    fakeMonaco,
    modelFor(normalized),
    { lineNumber, column } as never,
    context,
  );
}

describe("provideConsoleCompletionItems", () => {
  it("only suggests index-level APIs after an index path", () => {
    const labels = completionLabels("GET /orders/");

    expect(labels).toEqual(expect.arrayContaining(["_search", "_mapping", "_refresh"]));
    expect(labels).not.toContain("_cluster/health");
    expect(labels).not.toContain("_cat/indices");
    expect(labels).not.toContain("orders");
  });

  it("only suggests relative child paths in the cat namespace", () => {
    const labels = completionLabels("GET /_cat/");

    expect(labels).toContain("indices");
    expect(labels).not.toContain("_cat/indices");
    expect(labels).not.toContain("orders");
  });

  it("only suggests global APIs allowed for POST at the root path", () => {
    const labels = completionLabels("POST /");

    expect(labels).toEqual(expect.arrayContaining(["_search", "_bulk", "_msearch"]));
    expect(labels).not.toContain("_cluster/health");
  });

  it("does not fall back to global or index suggestions after a document API", () => {
    expect(completionLabels("GET /orders/_doc/")).toEqual([]);
  });

  it("suggests search query parameters after question mark", () => {
    const labels = completionLabels("GET /_search?", metadata({}));

    expect(labels).toEqual(expect.arrayContaining(["pretty", "size", "allow_partial_search_results"]));
    expectLabelsAbsent(labels, ["_cluster/health", "_cat/indices"]);
  });

  it("suggests cat query parameters after ampersand", () => {
    const labels = completionLabels("GET /_cat/indices?format=json&", metadata({}));

    expect(labels).toEqual(expect.arrayContaining(["h", "s", "v"]));
  });

  it("suggests mapping query parameters based on detected version", () => {
    const es7Labels = completionLabels("GET /orders/_mapping?", metadata({
      version: { number: "7.17.0", major: 7, minor: 17 },
    }));
    const es8Labels = completionLabels("GET /orders/_mapping?", metadata({
      version: { number: "8.12.1", major: 8, minor: 12 },
    }));

    expect(es7Labels).toContain("include_type_name");
    expect(es8Labels).not.toContain("include_type_name");
  });

  it("only suggests Scroll query parameters on the Scroll endpoint", () => {
    const labels = completionLabels("POST /_search/scroll?");

    expect(labels).toEqual(expect.arrayContaining(["scroll", "scroll_id", "rest_total_hits_as_int"]));
    expectLabelsAbsent(labels, ["from", "size", "sort", "search_type"]);
  });

  it("does not suggest an already used query parameter", () => {
    const labels = completionLabels("GET /orders/_search?size=10&");

    expect(labels).not.toContain("size");
    expect(labels).toContain("from");
  });

  it("suggests parameter values instead of names after an equals sign", () => {
    const labels = completionLabels("GET /orders/_search?pretty=");

    expect(labels).toEqual(expect.arrayContaining(["true", "false"]));
    expectLabelsAbsent(labels, ["from", "size", "pretty"]);
  });

  it("suggests only legal enum values", () => {
    expect(completionLabels("GET /orders/_search?search_type=")).toEqual([
      "query_then_fetch",
      "dfs_query_then_fetch",
    ]);
  });

  it("does not suggest query parameters after trailing whitespace", () => {
    expect(completionLabels("GET /orders/_search?pretty=true ")).toEqual([]);
  });

  it.each([
    "DELETE /orders/_search",
    "GET /_bulk",
    "POST /_search/scroll/extra",
    "POST /orders/_doc/42/extra",
    "POST /foo/bar/_search",
  ])("非法 endpoint 不返回查询参数或正文候选：%s", (requestLine) => {
    const searchMetadata = metadataWithFields(["order_id", "user_email"]);

    expect(completionLabels(`${requestLine}?<cursor>`, searchMetadata)).toEqual([]);
    expect(completionLabels(`${requestLine}\n{<cursor>}`, searchMetadata)).toEqual([]);
  });

  it("replaces only the current parameter name or value", () => {
    const nameSuggestion = completionSuggestions("GET /orders/_search?size=10&fr<cursor>om=20")
      .find((item) => item.label === "from");
    const valueSuggestion = completionSuggestions("GET /orders/_search?pretty=tr<cursor>ue&size=10")
      .find((item) => item.label === "true");

    expect(nameSuggestion?.range).toEqual({
      startLineNumber: 1,
      startColumn: 29,
      endLineNumber: 1,
      endColumn: 33,
    });
    expect(valueSuggestion?.range).toEqual({
      startLineNumber: 1,
      startColumn: 28,
      endLineNumber: 1,
      endColumn: 32,
    });
  });

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

  it("Query DSL 值候选只保留 OpenSearch 可用的 knn 模板", () => {
    const suggestions = completionSuggestions(
      'POST /orders/_search\n{"query": <cursor>}',
      metadata({
        product: "opensearch",
        version: { number: "2.19.0", major: 2, minor: 19 },
        distribution: "opensearch",
        buildFlavor: null,
      }),
    );
    const labels = suggestions.map((item) => String(item.label));
    const knnSuggestions = suggestions.filter((item) => item.label === "knn");

    expect(knnSuggestions).toHaveLength(1);
    expect(knnSuggestions[0]?.insertText).toContain('"vector"');
    expect(knnSuggestions[0]?.insertText).not.toContain('"query_vector"');
    expectLabelsAbsent(labels, ["semantic", "sparse_vector"]);
  });

  it("Query DSL 值候选遵守 Elasticsearch 次版本边界", () => {
    const labelsFor = (minor: number) => completionLabels(
      'POST /orders/_search\n{"query": <cursor>}',
      metadata({
        version: { number: `8.${minor}.0`, major: 8, minor },
      }),
    );

    expectLabelsAbsent(labelsFor(11), ["knn", "semantic", "sparse_vector"]);
    expect(labelsFor(14)).toContain("knn");
    expectLabelsAbsent(labelsFor(14), ["semantic", "sparse_vector"]);
    expect(labelsFor(15)).toEqual(expect.arrayContaining(["knn", "semantic", "sparse_vector"]));
  });

  it("Create Index 根对象不提示 Search 属性", () => {
    const labels = completionLabels("PUT /orders\n{\n  <cursor>\n}");

    expect(labels).toEqual(expect.arrayContaining(["settings", "mappings", "aliases"]));
    ["query", "from", "size", "sort"].forEach((label) => expect(labels).not.toContain(label));
  });

  it("Count 根对象只提示 Count 支持的属性", () => {
    const labels = completionLabels("POST /orders/_count\n{\n  <cursor>\n}");

    expect(labels).toEqual(expect.arrayContaining(["query", "runtime_mappings"]));
    ["aggs", "from", "size", "sort"].forEach((label) => expect(labels).not.toContain(label));
  });

  it("Update 根对象提示更新属性而非 Search 属性", () => {
    const labels = completionLabels("POST /orders/_update/42\n{\n  <cursor>\n}");

    expect(labels).toEqual(expect.arrayContaining([
      "doc",
      "script",
      "upsert",
      "doc_as_upsert",
      "scripted_upsert",
      "detect_noop",
      "_source",
    ]));
    ["query", "aggs", "size"].forEach((label) => expect(labels).not.toContain(label));
  });

  it.each([
    'PUT /orders\n{"query": <cursor>}',
    'POST /_search/scroll\n{"query": <cursor>}',
    'POST /orders/_update/42\n{"query": <cursor>}',
  ])("非 Search 正文的非法 query 值不提示 Query DSL：%s", (content) => {
    expect(completionLabels(content)).toEqual([]);
  });

  it.each([
    'POST /orders/_search\n{"query": <cursor>}',
    'POST /orders/_count\n{"query": <cursor>}',
    'POST /_msearch\n{"index":"orders"}\n{"query": <cursor>}',
  ])("合法 Search 语义正文的 query 值继续提示 Query DSL：%s", (content) => {
    expect(completionLabels(content)).toEqual(expect.arrayContaining(["bool", "match", "term"]));
  });

  it("Document 根对象只提示 mapping 字段", () => {
    const labels = completionLabels(
      "POST /orders/_doc\n{\n  <cursor>\n}",
      metadataWithFields(["title", "price"]),
    );

    expect(labels).toEqual(expect.arrayContaining(["title", "price"]));
    ["query", "aggs", "size"].forEach((label) => expect(labels).not.toContain(label));
  });

  it("Document 缺少 mapping metadata 时不猜测属性", () => {
    expect(completionLabels("POST /orders/_doc\n{\n  <cursor>\n}")).toEqual([]);
  });

  it("Document 嵌套对象缺少 mapping metadata 时不泄漏通用候选", () => {
    expect(completionLabels('POST /orders/_doc\n{\n  "metadata": {\n    <cursor>\n  }\n}')).toEqual([]);
  });

  it("Bulk 动作行提示动作对象", () => {
    expect(completionLabels("POST /_bulk\n<cursor>")).toEqual(
      expect.arrayContaining(["index", "create", "update", "delete"]),
    );
  });

  it("Bulk index 动作后提示文档字段而非 Search 根属性", () => {
    const labels = completionLabels(
      'POST /_bulk\n{"index":{"_index":"orders"}}\n<cursor>',
      metadataWithFields(["title", "price"]),
    );

    expect(labels).toEqual(expect.arrayContaining(["title", "price"]));
    ["query", "aggs", "size"].forEach((label) => expect(labels).not.toContain(label));
  });

  it("全局 Bulk 按 action 目标隔离 source mapping 字段", () => {
    const labels = completionLabels(
      'POST /_bulk\n{"index":{"_index":"orders"}}\n<cursor>',
      metadataWithTargetFields(),
    );

    expect(labels).toEqual(expect.arrayContaining(["order_id", "order_total"]));
    expectLabelsAbsent(labels, ["user_email", "user_id"]);
  });

  it("全局 Bulk 缺少、未知或 wildcard 目标时不混入动态字段", () => {
    const searchMetadata = metadataWithTargetFields();

    expect(completionLabels('POST /_bulk\n{"index":{}}\n<cursor>', searchMetadata)).toEqual([]);
    expect(completionLabels(
      'POST /_bulk\n{"index":{"_index":"missing"}}\n<cursor>',
      searchMetadata,
    )).toEqual([]);
    expect(completionLabels(
      'POST /_bulk\n{"index":{"_index":"orders-*"}}\n<cursor>',
      searchMetadata,
    )).toEqual([]);
  });

  it("索引级 Bulk 在 action 未给目标时回退 URL target", () => {
    expect(completionLabels(
      'POST /orders/_bulk\n{"index":{}}\n<cursor>',
      metadataWithTargetFields(),
    )).toEqual(expect.arrayContaining(["order_id", "order_total"]));
  });

  it("Bulk 支持 alias 与逗号分隔目标并去重字段", () => {
    const searchMetadata = metadataWithTargetFields();
    const aliasLabels = completionLabels(
      'POST /_bulk\n{"index":{"_index":"orders-read"}}\n<cursor>',
      searchMetadata,
    );
    const multiTargetLabels = completionLabels(
      'POST /_bulk\n{"index":{"_index":"orders,users"}}\n<cursor>',
      searchMetadata,
    );

    expect(aliasLabels).toEqual(expect.arrayContaining(["order_id", "order_total"]));
    expectLabelsAbsent(aliasLabels, ["user_email", "user_id"]);
    expect(multiTargetLabels).toEqual(expect.arrayContaining([
      "order_id",
      "order_total",
      "user_email",
      "user_id",
    ]));
  });

  it("Bulk source 嵌套对象不泄漏通用候选", () => {
    const labels = completionLabels(
      'POST /_bulk\n{"index":{"_index":"orders"}}\n{"metadata":{<cursor>',
      metadataWithFields(["title", "price"]),
    );

    expect(labels).toEqual([]);
    ["query", "match", "aggs", "size"].forEach((label) => expect(labels).not.toContain(label));
  });

  it("Bulk update 动作后提示 Update 属性", () => {
    const labels = completionLabels(
      'POST /_bulk\n{"update":{"_index":"orders","_id":"42"}}\n<cursor>',
    );

    expect(labels).toEqual(expect.arrayContaining(["doc", "upsert", "script"]));
    ["query", "aggs", "size"].forEach((label) => expect(labels).not.toContain(label));
  });

  it("MSearch header 提示标头候选", () => {
    const labels = completionLabels("POST /_msearch\n<cursor>");

    expect(labels).toEqual(expect.arrayContaining([
      "index",
      "routing",
      "preference",
      "search_type",
      "request_cache",
      "empty header",
    ]));
    ["query", "aggs", "size"].forEach((label) => expect(labels).not.toContain(label));
  });

  it("MSearch 标头后进入 Search 请求体", () => {
    const labels = completionLabels('POST /_msearch\n{"index":"orders"}\n<cursor>');

    expect(labels).toEqual(expect.arrayContaining(["query", "aggs", "size"]));
  });

  it("全局 MSearch 按 header 目标隔离字段查询键", () => {
    const labels = completionLabels(
      'POST /_msearch\n{"index":"orders"}\n{"query":{"term":{<cursor>}}}',
      metadataWithTargetFields(),
    );

    expect(labels).toEqual(expect.arrayContaining(["order_id", "order_total"]));
    expectLabelsAbsent(labels, ["user_email", "user_id"]);
  });

  it("全局 MSearch 缺少目标时不混入动态字段", () => {
    expect(completionLabels(
      'POST /_msearch\n{}\n{"query":{"term":{<cursor>}}}',
      metadataWithTargetFields(),
    )).toEqual([]);
  });

  it("索引级 MSearch 在 header 未给目标时回退 URL target", () => {
    expect(completionLabels(
      'POST /orders/_msearch\n{}\n{"query":{"term":{<cursor>}}}',
      metadataWithTargetFields(),
    )).toEqual(expect.arrayContaining(["order_id", "order_total"]));
  });

  it("MSearch 字符串数组目标合并字段", () => {
    expect(completionLabels(
      'POST /_msearch\n{"index":["orders","users"]}\n{"query":{"term":{<cursor>}}}',
      metadataWithTargetFields(),
    )).toEqual(expect.arrayContaining(["order_id", "order_total", "user_email", "user_id"]));
  });

  it("Search 根候选不退化", () => {
    const labels = completionLabels("POST /orders/_search\n{\n  <cursor>\n}");

    expect(labels).toEqual(expect.arrayContaining(["query", "aggs", "from", "size", "sort"]));
  });

  it("size 值位置只提示数值，不提示 Query DSL 和 null", () => {
    const labels = completionLabels('POST /orders/_search\n{"size": <cursor>}');

    expect(labels).toContain("0");
    expectLabelsAbsent(labels, ["bool", "match", "term", "null"]);
  });

  it("profile 值位置只提示布尔值", () => {
    const labels = completionLabels('POST /orders/_search\n{"profile": <cursor>}');

    expect(labels).toEqual(expect.arrayContaining(["true", "false"]));
    expectLabelsAbsent(labels, ["bool", "match", "null", "0"]);
  });

  it("未知对象不回退到 Search 根属性或 Query DSL", () => {
    expect(completionLabels('POST /orders/_search\n{"unknown":{ <cursor>}}')).toEqual([]);
  });

  it.each([
    'POST /orders/_search\n{"unknown":{"sort":{<cursor>}}}',
    'POST /orders/_search\n{"unknown":{"field":"<cursor>"}}',
    'POST /orders/_search\n{"unknown":{"path":"<cursor>"}}',
  ])("未知字段引用路径不提示 mapping 字段：%s", (content) => {
    expect(completionLabels(
      content,
      metadataWithFields(["order_id", "customer_name"]),
    )).toEqual([]);
  });

  it.each([
    'POST /orders/_search\n{"sort":{<cursor>}}',
    'POST /orders/_search\n{"query":{"exists":{"field":"<cursor>"}}}',
    'POST /orders/_search\n{"query":{"nested":{"path":"<cursor>"}}}',
    'POST /orders/_search\n{"aggs":{"by_customer":{"terms":{"field":"<cursor>"}}}}',
  ])("合法字段引用路径继续提示 mapping 字段：%s", (content) => {
    expect(completionLabels(
      content,
      metadataWithFields(["order_id", "customer_name"]),
    )).toEqual(expect.arrayContaining(["order_id", "customer_name"]));
  });

  it("term 字段参数对象只提示 term 参数且不重复 mapping 字段", () => {
    const labels = completionLabels(
      'POST /orders/_search\n{"query":{"term":{"status":{ <cursor>}}}}',
      metadataWithFields(["status", "created_at"]),
    );

    expect(labels).toEqual(expect.arrayContaining(["value", "boost", "case_insensitive"]));
    expectLabelsAbsent(labels, ["status", "created_at", "bool", "query"]);
  });

  it("range 字段参数对象只提示 range 参数且不重复 mapping 字段", () => {
    const labels = completionLabels(
      'POST /orders/_search\n{"query":{"range":{"created_at":{ <cursor>}}}}',
      metadataWithFields(["status", "created_at"]),
    );

    expect(labels).toEqual(expect.arrayContaining(["gt", "gte", "lt", "lte", "format", "time_zone", "boost"]));
    expectLabelsAbsent(labels, ["status", "created_at", "bool", "query"]);
  });

  it("match 字段参数对象提示长格式参数", () => {
    const labels = completionLabels(
      'POST /orders/_search\n{"query":{"match":{"title":{ <cursor>}}}}',
    );

    expect(labels).toEqual(expect.arrayContaining(["query", "analyzer", "operator", "fuzziness", "boost"]));
    expectLabelsAbsent(labels, ["title", "bool", "aggs"]);
  });

  it("span_near clauses 只提示 Span 查询", () => {
    const labels = completionLabels(
      'POST /orders/_search\n{"query":{"span_near":{"clauses":[{ <cursor>}]}}}',
    );

    expect(labels).toEqual(expect.arrayContaining(["span_term", "span_first", "span_multi"]));
    expectLabelsAbsent(labels, ["match", "knn", "semantic"]);
  });

  it("span_or clauses 只提示 Span 查询", () => {
    const labels = completionLabels(
      'POST /orders/_search\n{"query":{"span_or":{"clauses":[{ <cursor>}]}}}',
    );

    expect(labels).toEqual(expect.arrayContaining(["span_term", "span_first", "span_multi"]));
    expectLabelsAbsent(labels, ["match", "knn", "semantic"]);
  });

  it("span_multi match 值位置只提示 multi-term 查询", () => {
    const labels = completionLabels(
      'POST /orders/_search\n{"query":{"span_multi":{"match": <cursor>}}}',
    );

    expect(labels.sort()).toEqual(["fuzzy", "prefix", "range", "regexp", "wildcard"]);
  });

  it("DSL 同名字段进入参数对象后不再提示 mapping 字段或 bool 子键", () => {
    const labels = completionLabels(
      'POST /orders/_search\n{"query":{"term":{"bool":{ <cursor>}}}}',
      metadataWithFields(["term", "range", "bool"]),
    );

    expect(labels).toEqual(["value", "boost", "case_insensitive"]);
  });

  it("未知 filter 和 term 路径不触发 Query DSL 或 term 参数", () => {
    expect(completionLabels(
      'POST /orders/_search\n{"unknown":{"filter": <cursor>}}',
    )).toEqual([]);
    expect(completionLabels(
      'POST /orders/_search\n{"unknown":{"term":{"status":{ <cursor>}}}}',
    )).toEqual([]);
  });

  it("未知聚合类型对象不回退到聚合类型候选", () => {
    expect(completionLabels(
      'POST /orders/_search\n{"aggs":{"x":{"mystery":{ <cursor>}}}}',
    )).toEqual([]);
  });

  it("子聚合不提示 global", () => {
    const labels = completionLabels(
      'POST /orders/_search\n{"aggs":{"by_status":{"terms":{"field":"status"},"aggs":{"child":{ <cursor>}}}}}',
    );

    expect(labels).not.toContain("global");
    expect(labels).toEqual(expect.arrayContaining(["terms", "filter"]));
  });

  it("reverse_nested 只在 nested 子聚合中出现", () => {
    const topLevel = completionLabels('POST /orders/_search\n{"aggs":{"x":{ <cursor>}}}');
    const nestedChild = completionLabels(
      'POST /orders/_search\n{"aggs":{"n":{"nested":{"path":"items"},"aggs":{"back":{ <cursor>}}}}}',
    );

    expect(topLevel).not.toContain("reverse_nested");
    expect(topLevel).toEqual(expect.arrayContaining(["global", "terms"]));
    expect(nestedChild).toContain("reverse_nested");
  });
});
