import { describe, expect, it } from "vitest";
import {
  selectPropertySuggestions,
  selectValueSuggestions,
  shouldSuggestFieldsForKey,
  shouldSuggestFieldsForStringValue,
} from "../suggestions";

function labelsOf(list: readonly { label: string }[]) {
  return list.map((item) => item.label);
}

describe("selectPropertySuggestions", () => {
  it("suggests root keys at top-level", () => {
    const labels = labelsOf(selectPropertySuggestions([]));
    expect(labels).toEqual(expect.arrayContaining(["query", "size", "aggs", "sort", "_source"]));
  });

  it("suggests only bool subkeys under bool", () => {
    const labels = labelsOf(selectPropertySuggestions(["query", "bool"]));
    expect(labels).toEqual([
      "must",
      "should",
      "filter",
      "must_not",
      "minimum_should_match",
      "boost",
    ]);
  });

  it("suggests leaf queries inside must[N]", () => {
    const labels = labelsOf(selectPropertySuggestions(["query", "bool", "must", 0]));
    expect(labels).toEqual(expect.arrayContaining(["match", "term", "range", "exists"]));
    expect(labels).not.toEqual(expect.arrayContaining(["size", "aggs"]));
  });

  it("suggests placeholder agg_name directly under aggs", () => {
    const labels = labelsOf(selectPropertySuggestions(["aggs"]));
    expect(labels).toEqual(["<agg_name>"]);
  });

  it("suggests aggregation types under aggs.<name>", () => {
    const labels = labelsOf(selectPropertySuggestions(["aggs", "my_agg"]));
    expect(labels).toEqual(expect.arrayContaining(["terms", "date_histogram", "avg", "sum", "aggs"]));
  });
});

describe("selectValueSuggestions", () => {
  it("includes bool/match/term for array item position under must", () => {
    const labels = labelsOf(selectValueSuggestions(["query", "bool", "must"]));
    expect(labels).toEqual(expect.arrayContaining(["bool", "match", "term", "range", "exists"]));
  });

  it("includes literal values for any value position", () => {
    const labels = labelsOf(selectValueSuggestions([]));
    expect(labels).toEqual(expect.arrayContaining(["true", "false", "null"]));
  });
});

describe("shouldSuggestFieldsForKey", () => {
  it("returns true inside a leaf query like match/term", () => {
    expect(shouldSuggestFieldsForKey(["query", "match"])).toBe(true);
    expect(shouldSuggestFieldsForKey(["query", "bool", "must", 0, "term"])).toBe(true);
  });

  it("returns false for top-level and for highlight container", () => {
    expect(shouldSuggestFieldsForKey([])).toBe(false);
    expect(shouldSuggestFieldsForKey(["highlight"])).toBe(false);
  });
});

describe("shouldSuggestFieldsForStringValue", () => {
  it("returns true inside a field/path string value", () => {
    expect(shouldSuggestFieldsForStringValue(["aggs", "my_agg", "terms", "field"])).toBe(true);
    expect(shouldSuggestFieldsForStringValue(["query", "nested", "path"])).toBe(true);
  });

  it("returns false otherwise", () => {
    expect(shouldSuggestFieldsForStringValue(["query", "match_all"])).toBe(false);
  });
});
