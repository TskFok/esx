import { describe, expect, it } from "vitest";
import {
  AGG_TYPE_PROPERTY_SNIPPETS,
  AGGS_CONTAINER_PROPERTY_SNIPPET,
  BOOL_PROPERTY_SNIPPETS,
  QUERY_LEAF_PROPERTY_SNIPPETS,
  QUERY_LEAF_VALUE_SNIPPETS,
  ROOT_PROPERTY_SNIPPETS,
} from "../snippets";

function bySnippetLabel<T extends { label: string }>(list: readonly T[], label: string) {
  const found = list.find((item) => item.label === label);
  if (!found) {
    throw new Error(`missing snippet: ${label}`);
  }
  return found;
}

describe("snippet templates", () => {
  it("bool does not prefill must", () => {
    const snippet = bySnippetLabel(QUERY_LEAF_PROPERTY_SNIPPETS, "bool");
    expect(snippet.insertText).toBe('"bool": {\n\t$0\n}');
  });

  it("must/should/filter/must_not prefill an object inside the array", () => {
    for (const key of ["must", "should", "filter", "must_not"] as const) {
      const snippet = bySnippetLabel(BOOL_PROPERTY_SNIPPETS, key);
      expect(snippet.insertText).toContain(`"${key}": [\n\t{\n\t\t$0\n\t}\n]`);
    }
  });

  it("bool value snippet wraps bool in a container object", () => {
    const snippet = bySnippetLabel(QUERY_LEAF_VALUE_SNIPPETS, "bool");
    expect(snippet.insertText).toContain('"bool"');
  });

  it("root snippets include query/aggs/size/sort", () => {
    const labels = ROOT_PROPERTY_SNIPPETS.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["query", "aggs", "size", "sort", "from", "_source"]));
  });

  it("agg type snippets contain common aggregations", () => {
    const labels = AGG_TYPE_PROPERTY_SNIPPETS.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining([
      "terms",
      "date_histogram",
      "histogram",
      "avg",
      "sum",
      "max",
      "min",
      "cardinality",
      "aggs",
    ]));
  });

  it("aggs container snippet produces a named sub-agg placeholder", () => {
    expect(AGGS_CONTAINER_PROPERTY_SNIPPET.insertText).toContain("${1:agg_name}");
    expect(AGGS_CONTAINER_PROPERTY_SNIPPET.insertText).toContain('"terms"');
  });
});
