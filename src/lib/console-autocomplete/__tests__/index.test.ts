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
    expect(labels).not.toEqual(expect.arrayContaining(["_cluster/health", "_cat/indices", "orders"]));
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
    expect(labels).not.toEqual(expect.arrayContaining(["_cluster/health", "_cat/indices"]));
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
    expect(labels).not.toEqual(expect.arrayContaining(["from", "size", "sort", "search_type"]));
  });

  it("does not suggest an already used query parameter", () => {
    const labels = completionLabels("GET /orders/_search?size=10&");

    expect(labels).not.toContain("size");
    expect(labels).toContain("from");
  });

  it("suggests parameter values instead of names after an equals sign", () => {
    const labels = completionLabels("GET /orders/_search?pretty=");

    expect(labels).toEqual(expect.arrayContaining(["true", "false"]));
    expect(labels).not.toEqual(expect.arrayContaining(["from", "size", "pretty"]));
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

  it("Create Index 根对象不提示 Search 属性", () => {
    const labels = completionLabels("PUT /orders\n{\n  <cursor>\n}");

    expect(labels).toEqual(expect.arrayContaining(["settings", "mappings", "aliases"]));
    expect(labels).not.toEqual(expect.arrayContaining(["query", "from", "size", "sort"]));
  });

  it("Count 根对象只提示 Count 支持的属性", () => {
    const labels = completionLabels("POST /orders/_count\n{\n  <cursor>\n}");

    expect(labels).toEqual(expect.arrayContaining(["query", "runtime_mappings"]));
    expect(labels).not.toEqual(expect.arrayContaining(["aggs", "from", "size", "sort"]));
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
    expect(labels).not.toEqual(expect.arrayContaining(["query", "aggs", "size"]));
  });

  it("Document 根对象只提示 mapping 字段", () => {
    const labels = completionLabels(
      "POST /orders/_doc\n{\n  <cursor>\n}",
      metadataWithFields(["title", "price"]),
    );

    expect(labels).toEqual(expect.arrayContaining(["title", "price"]));
    expect(labels).not.toEqual(expect.arrayContaining(["query", "aggs", "size"]));
  });

  it("Document 缺少 mapping metadata 时不猜测属性", () => {
    expect(completionLabels("POST /orders/_doc\n{\n  <cursor>\n}")).toEqual([]);
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
    expect(labels).not.toEqual(expect.arrayContaining(["query", "aggs", "size"]));
  });

  it("Bulk update 动作后提示 Update 属性", () => {
    const labels = completionLabels(
      'POST /_bulk\n{"update":{"_index":"orders","_id":"42"}}\n<cursor>',
    );

    expect(labels).toEqual(expect.arrayContaining(["doc", "upsert", "script"]));
    expect(labels).not.toEqual(expect.arrayContaining(["query", "aggs", "size"]));
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
    expect(labels).not.toEqual(expect.arrayContaining(["query", "aggs", "size"]));
  });

  it("MSearch 标头后进入 Search 请求体", () => {
    const labels = completionLabels('POST /_msearch\n{"index":"orders"}\n<cursor>');

    expect(labels).toEqual(expect.arrayContaining(["query", "aggs", "size"]));
  });

  it("Search 根候选不退化", () => {
    const labels = completionLabels("POST /orders/_search\n{\n  <cursor>\n}");

    expect(labels).toEqual(expect.arrayContaining(["query", "aggs", "from", "size", "sort"]));
  });
});
