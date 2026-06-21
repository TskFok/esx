import { describe, expect, it } from "vitest";
import {
  AGG_PROPERTY_SNIPPETS_BY_TYPE,
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

  it("root snippets include query/aggs/size/sort/search_after", () => {
    const labels = ROOT_PROPERTY_SNIPPETS.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["query", "aggs", "size", "sort", "search_after", "from", "_source"]));
  });

  it("search_after snippet inserts an array value", () => {
    const snippet = bySnippetLabel(ROOT_PROPERTY_SNIPPETS, "search_after");
    expect(snippet.insertText).toBe('"search_after": [\n\t$0\n]');
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
});
