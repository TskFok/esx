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
    expect(labels).toEqual(expect.arrayContaining(["query", "size", "aggs", "sort", "search_after", "_source"]));
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

  it("suggests terms aggregation properties inside aggs.<name>.terms", () => {
    const labels = labelsOf(selectPropertySuggestions(["aggs", "key", "terms"]));
    expect(labels).toEqual(expect.arrayContaining(["field", "size", "order"]));
    expect(labels).not.toEqual(expect.arrayContaining(["date_histogram", "avg", "aggs"]));
  });

  it("suggests terms aggregation properties inside aggregations.<name>.terms", () => {
    const labels = labelsOf(selectPropertySuggestions(["aggregations", "key", "terms"]));
    expect(labels).toEqual(expect.arrayContaining(["field", "size", "order"]));
    expect(labels).not.toEqual(expect.arrayContaining(["date_histogram", "avg", "aggs"]));
  });

  it("suggests aggregation properties inside nested sub aggregations", () => {
    const labels = labelsOf(selectPropertySuggestions(["aggs", "outer", "aggs", "inner", "terms"]));
    expect(labels).toEqual(expect.arrayContaining(["field", "size", "order"]));
    expect(labels).not.toEqual(expect.arrayContaining(["date_histogram", "avg", "aggs"]));
  });

  it("suggests type-specific properties for aggregation leaf objects", () => {
    expect(labelsOf(selectPropertySuggestions(["aggs", "key", "date_histogram"]))).toEqual(
      expect.arrayContaining(["field", "calendar_interval"]),
    );
    expect(labelsOf(selectPropertySuggestions(["aggs", "key", "histogram"]))).toEqual(
      expect.arrayContaining(["field", "interval"]),
    );
    expect(labelsOf(selectPropertySuggestions(["aggs", "key", "range"]))).toEqual(
      expect.arrayContaining(["field", "ranges"]),
    );
    expect(labelsOf(selectPropertySuggestions(["aggs", "key", "cardinality"]))).toEqual(
      expect.arrayContaining(["field", "precision_threshold"]),
    );
  });

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

  it("returns true for expanded field array and vector field values", () => {
    expect(shouldSuggestFieldsForKey(["query", "multi_match"])).toBe(false);
    expect(shouldSuggestFieldsForStringValue(["query", "multi_match", "fields", 0])).toBe(true);
    expect(shouldSuggestFieldsForStringValue(["query", "geo_distance", "distance"])).toBe(false);
    expect(shouldSuggestFieldsForStringValue(["knn", "field"])).toBe(true);
  });
});
