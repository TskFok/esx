import { describe, expect, it } from "vitest";
import {
  selectPropertySuggestions,
  selectValueSuggestions,
  shouldSuggestFieldsForKey,
  shouldSuggestFieldsForStringValue,
} from "../suggestions";
import { DEFAULT_CLUSTER_METADATA } from "../capabilities";

function labelsOf(list: readonly { label: string }[]) {
  return list.map((item) => item.label);
}

function expectLabelsAbsent(labels: readonly string[], forbidden: readonly string[]) {
  expect(labels.filter((label) => forbidden.includes(label))).toEqual([]);
}

function elasticsearchContext(major: number, minor: number) {
  return {
    cluster: {
      ...DEFAULT_CLUSTER_METADATA,
      product: "elasticsearch" as const,
      version: { number: `${major}.${minor}.0`, major, minor },
    },
  };
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
    expectLabelsAbsent(labels, ["size", "aggs"]);
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
    expectLabelsAbsent(labels, ["date_histogram", "avg", "aggs"]);
  });

  it("suggests terms aggregation properties inside aggregations.<name>.terms", () => {
    const labels = labelsOf(selectPropertySuggestions(["aggregations", "key", "terms"]));
    expect(labels).toEqual(expect.arrayContaining(["field", "size", "order"]));
    expectLabelsAbsent(labels, ["date_histogram", "avg", "aggs"]);
  });

  it("suggests aggregation properties inside nested sub aggregations", () => {
    const labels = labelsOf(selectPropertySuggestions(["aggs", "outer", "aggs", "inner", "terms"]));
    expect(labels).toEqual(expect.arrayContaining(["field", "size", "order"]));
    expectLabelsAbsent(labels, ["date_histogram", "avg", "aggs"]);
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

  it("suggests query DSL inside filter aggregation bodies", () => {
    const labels = labelsOf(selectPropertySuggestions(["aggs", "paid_orders", "filter"]));

    expect(labels).toEqual(expect.arrayContaining(["term", "range", "bool"]));
    expect(labels).not.toEqual(["filter"]);
  });

  it("returns no property suggestions for an unknown object context", () => {
    expect(selectPropertySuggestions(["unknown"])).toEqual([]);
  });

  it("suggests only term parameters inside a term field object", () => {
    const labels = labelsOf(selectPropertySuggestions(
      ["query", "term", "status"],
      elasticsearchContext(8, 12),
    ));

    expect(labels).toEqual(expect.arrayContaining(["value", "boost", "case_insensitive"]));
    expectLabelsAbsent(labels, ["status", "bool", "query"]);
  });

  it("filters case_insensitive by product version inside a term field object", () => {
    const es79 = labelsOf(selectPropertySuggestions(
      ["query", "term", "status"],
      elasticsearchContext(7, 9),
    ));
    const es710 = labelsOf(selectPropertySuggestions(
      ["query", "term", "status"],
      elasticsearchContext(7, 10),
    ));

    expect(es79).not.toContain("case_insensitive");
    expect(es710).toContain("case_insensitive");
  });

  it("suggests only range parameters inside a range field object", () => {
    const labels = labelsOf(selectPropertySuggestions(["query", "range", "created_at"]));

    expect(labels).toEqual(expect.arrayContaining(["gt", "gte", "lt", "lte", "format", "time_zone", "boost"]));
    expectLabelsAbsent(labels, ["created_at", "bool", "query"]);
  });

  it("suggests long-form parameters inside supported field query objects", () => {
    expect(labelsOf(selectPropertySuggestions(["query", "match", "title"]))).toEqual(
      expect.arrayContaining(["query", "analyzer", "operator", "fuzziness", "boost"]),
    );
    expect(labelsOf(selectPropertySuggestions(["query", "prefix", "title"]))).toEqual(
      expect.arrayContaining(["value", "rewrite", "boost"]),
    );
    expect(labelsOf(selectPropertySuggestions(["query", "regexp", "title"]))).toEqual(
      expect.arrayContaining(["value", "flags", "max_determinized_states", "rewrite", "boost"]),
    );
  });

  it("restricts span children and span_multi.match to their legal query families", () => {
    const clauses = labelsOf(selectPropertySuggestions(["query", "span_near", "clauses", 0]));
    const spanMultiMatch = labelsOf(selectPropertySuggestions(["query", "span_multi", "match"]));

    expect(clauses).toEqual(expect.arrayContaining(["span_term", "span_first", "span_multi"]));
    expectLabelsAbsent(clauses, ["match", "knn", "semantic"]);
    expect(spanMultiMatch).toEqual(expect.arrayContaining(["fuzzy", "prefix", "range", "regexp", "wildcard"]));
    expectLabelsAbsent(spanMultiMatch, ["match", "term", "bool"]);
  });

  it("restricts span_or clauses to the Span query family", () => {
    const labels = labelsOf(selectPropertySuggestions(["query", "span_or", "clauses", 0]));

    expect(labels).toEqual(expect.arrayContaining(["span_term", "span_first", "span_multi"]));
    expectLabelsAbsent(labels, ["match", "term", "bool"]);
  });

  it("does not infer Query DSL from an unknown filter or term path", () => {
    expect(selectPropertySuggestions(["unknown", "filter"])).toEqual([]);
    expect(selectPropertySuggestions(["unknown", "term", "status"])).toEqual([]);
  });

  it("does not infer a filter aggregation below an invalid aggregation container", () => {
    expect(selectPropertySuggestions(["unknown", "aggs", "x", "filter"])).toEqual([]);
    expect(selectValueSuggestions(["unknown", "aggs", "x", "filter"])).toEqual([]);
  });

  it("does not reinterpret an unknown aggregation type as an aggregation definition", () => {
    expect(selectPropertySuggestions(["aggs", "x", "mystery"])).toEqual([]);
  });

  it("keeps dedicated field-query parameters when field names collide with DSL names", () => {
    const context = elasticsearchContext(8, 12);

    expect(labelsOf(selectPropertySuggestions(["query", "term", "bool"], context))).toEqual([
      "value",
      "boost",
      "case_insensitive",
    ]);
    expect(labelsOf(selectPropertySuggestions(["query", "range", "range"], context))).toEqual([
      "gt",
      "gte",
      "lt",
      "lte",
      "format",
      "time_zone",
      "boost",
    ]);
    expect(labelsOf(selectPropertySuggestions(["query", "match", "term"], context))).toEqual([
      "query",
      "analyzer",
      "operator",
      "fuzziness",
      "boost",
    ]);
  });

  it("restricts aggregation types by level and nested ancestry", () => {
    const topLevel = labelsOf(selectPropertySuggestions(["aggs", "x"]));
    const child = labelsOf(selectPropertySuggestions(["aggs", "x", "aggs", "child"]));
    const nestedChild = labelsOf(selectPropertySuggestions(
      ["aggs", "n", "aggs", "back"],
      undefined,
      [{ currentKey: "aggs", seenKeys: ["nested", "aggs"] }],
    ));

    expect(topLevel).toEqual(expect.arrayContaining(["global", "terms"]));
    expect(topLevel).not.toContain("reverse_nested");
    expect(child).toEqual(expect.arrayContaining(["terms", "filter"]));
    expectLabelsAbsent(child, ["global", "reverse_nested"]);
    expect(nestedChild).toContain("reverse_nested");
    expect(nestedChild).not.toContain("global");
  });
});

describe("selectValueSuggestions", () => {
  it("includes bool/match/term for array item position under must", () => {
    const labels = labelsOf(selectValueSuggestions(["query", "bool", "must"]));
    expect(labels).toEqual(expect.arrayContaining(["bool", "match", "term", "range", "exists"]));
    expectLabelsAbsent(labels, ["true", "false", "null"]);
  });

  it("returns no suggestions for an unknown scalar value position", () => {
    expect(selectValueSuggestions(["unknown"])).toEqual([]);
  });

  it("selects numeric, boolean, and track_total_hits values by property", () => {
    expect(labelsOf(selectValueSuggestions(["size"]))).toEqual(["0"]);
    expect(labelsOf(selectValueSuggestions(["profile"]))).toEqual(["true", "false"]);
    expect(labelsOf(selectValueSuggestions(["track_total_hits"]))).toEqual(["true", "false", "10000"]);
  });

  it("returns no Query DSL values for an unknown filter path", () => {
    expect(selectValueSuggestions(["unknown", "filter"])).toEqual([]);
  });

  it("returns Query DSL values for explicit post_filter and dis_max queries paths", () => {
    expect(labelsOf(selectValueSuggestions(["post_filter"]))).toEqual(
      expect.arrayContaining(["bool", "match", "term", "range"]),
    );
    expect(labelsOf(selectValueSuggestions(["query", "dis_max", "queries", 0]))).toEqual(
      expect.arrayContaining(["bool", "match", "term", "range"]),
    );
  });

  it("returns only multi-term query values for span_multi.match", () => {
    expect(labelsOf(selectValueSuggestions(["query", "span_multi", "match"])).sort()).toEqual([
      "fuzzy",
      "prefix",
      "range",
      "regexp",
      "wildcard",
    ]);
  });
});

describe("shouldSuggestFieldsForKey", () => {
  it("returns true inside a leaf query like match/term", () => {
    expect(shouldSuggestFieldsForKey(["query", "match"])).toBe(true);
    expect(shouldSuggestFieldsForKey(["query", "bool", "must", 0, "term"])).toBe(true);
  });

  it("does not repeat mapping fields inside a field query parameter object", () => {
    expect(shouldSuggestFieldsForKey(["query", "term", "status"])).toBe(false);
    expect(shouldSuggestFieldsForKey(["query", "range", "created_at"])).toBe(false);
  });

  it("does not repeat mapping fields when a concrete field name collides with a DSL name", () => {
    expect(shouldSuggestFieldsForKey(["query", "term", "term"])).toBe(false);
    expect(shouldSuggestFieldsForKey(["query", "range", "range"])).toBe(false);
    expect(shouldSuggestFieldsForKey(["query", "match", "bool"])).toBe(false);
  });

  it("does not suggest mapping fields for a query-like key below an unknown object", () => {
    expect(shouldSuggestFieldsForKey(["unknown", "term"])).toBe(false);
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
