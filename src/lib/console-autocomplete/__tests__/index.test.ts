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

function completionLabels(content: string, searchMetadata: ConnectionSearchMetadata) {
  const context = buildConsoleAutocompleteContext([], content, searchMetadata);
  const suggestions = provideConsoleCompletionItems(
    fakeMonaco,
    modelFor(content),
    { lineNumber: 1, column: content.length + 1 } as never,
    context,
  );
  return suggestions.map((item) => String(item.label));
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

describe("provideConsoleCompletionItems", () => {
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
});
