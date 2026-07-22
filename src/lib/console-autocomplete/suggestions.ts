import {
  AGGS_CONTAINER_PROPERTY_SNIPPET,
  AGG_PROPERTY_SNIPPETS_BY_TYPE,
  AGG_TYPE_PROPERTY_SNIPPETS,
  BOOL_PROPERTY_SNIPPETS,
  FIELD_QUERY_VALUE_PROPERTY_SNIPPETS_BY_TYPE,
  LITERAL_VALUE_SNIPPETS,
  MULTI_TERM_QUERY_PROPERTY_SNIPPETS,
  QUERY_LEAF_PROPERTY_SNIPPETS,
  QUERY_LEAF_VALUE_SNIPPETS,
  RANGE_VALUE_PROPERTY_SNIPPETS,
  ROOT_PROPERTY_SNIPPETS,
  SPAN_QUERY_PROPERTY_SNIPPETS,
  TERM_VALUE_PROPERTY_SNIPPETS,
  type RawSnippet,
} from "./snippets";
import type { JsonObjectFrame, JsonPathSegment } from "./json-path";
import { filterAvailableSnippets } from "./capabilities";
import type { ConsoleAutocompleteContext } from "./context";

export const BOOL_ARRAY_KEYS = new Set(["must", "should", "filter", "must_not"]);

export const FIELD_OBJECT_QUERY_KEYS = new Set([
  "match",
  "match_bool_prefix",
  "match_phrase",
  "match_phrase_prefix",
  "term",
  "terms",
  "terms_set",
  "range",
  "wildcard",
  "prefix",
  "regexp",
  "fuzzy",
  "span_term",
  "geo_distance",
  "geo_bounding_box",
  "geo_polygon",
  "geo_shape",
  "shape",
  "xy_shape",
]);

export const FIELD_VALUE_KEYS = new Set(["field", "path"]);
export const FIELD_ARRAY_VALUE_KEYS = new Set(["fields", "docvalue_fields", "stored_fields"]);
const QUERY_CHILD_KEYS_BY_PARENT: Readonly<Record<string, ReadonlySet<string>>> = {
  boosting: new Set(["positive", "negative"]),
  constant_score: new Set(["filter"]),
  function_score: new Set(["query"]),
  has_child: new Set(["query"]),
  has_parent: new Set(["query"]),
  knn: new Set(["filter"]),
  nested: new Set(["query"]),
  pinned: new Set(["organic"]),
  script_score: new Set(["query"]),
};
const SPAN_CHILD_KEYS = new Set(["match", "include", "exclude", "big", "little", "query"]);
const SPAN_CLAUSE_ARRAY_PARENTS = new Set(["span_near", "span_or"]);
const MULTI_TERM_QUERY_LABELS = new Set(["fuzzy", "prefix", "range", "regexp", "wildcard"]);
const PARENT_PIPELINE_AGGREGATIONS = new Set([
  "bucket_script",
  "bucket_selector",
  "bucket_sort",
]);
const HISTOGRAM_PIPELINE_AGGREGATIONS = new Set([
  "derivative",
  "moving_fn",
  "cumulative_sum",
]);
const MULTI_BUCKET_AGGREGATIONS = new Set([
  "adjacency_matrix",
  "auto_date_histogram",
  "composite",
  "date_histogram",
  "date_range",
  "filters",
  "geotile_grid",
  "histogram",
  "ip_range",
  "multi_terms",
  "range",
  "rare_terms",
  "significant_terms",
  "significant_text",
  "terms",
]);
const QUERY_TYPE_LABELS = new Set(QUERY_LEAF_PROPERTY_SNIPPETS.map((snippet) => snippet.label));
const QUERY_FIELD_ARRAY_TYPES = new Set([
  "multi_match",
  "combined_fields",
  "simple_query_string",
  "more_like_this",
]);

function isQuerySuggestionContext(path: JsonPathSegment[]): boolean {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];
  const thirdLast = path[path.length - 3];

  if (path.length === 1 && (last === "query" || last === "post_filter")) {
    return true;
  }

  if (typeof last === "string" && secondLast === "bool" && BOOL_ARRAY_KEYS.has(last)) {
    return isQuerySuggestionContext(path.slice(0, -2));
  }

  if (typeof last === "number" && typeof secondLast === "string" && BOOL_ARRAY_KEYS.has(secondLast)) {
    return thirdLast === "bool" && isQuerySuggestionContext(path.slice(0, -3));
  }

  if (typeof last === "string" && typeof secondLast === "string") {
    const allowedChildren = QUERY_CHILD_KEYS_BY_PARENT[secondLast];
    if (allowedChildren?.has(last)) {
      return (secondLast === "knn" && path.length === 2) ||
        isQuerySuggestionContext(path.slice(0, -2));
    }
  }

  if (typeof last === "number" && secondLast === "queries" && thirdLast === "dis_max") {
    return isQuerySuggestionContext(path.slice(0, -3));
  }

  if (last === "filter" && isAggregationDefinitionPath(path.slice(0, -1))) {
    return true;
  }

  return false;
}

function isSpanChildContext(path: JsonPathSegment[]): boolean {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];
  const thirdLast = path[path.length - 3];
  let spanQueryIndex = -1;

  if (
    typeof last === "number" &&
    secondLast === "clauses" &&
    typeof thirdLast === "string" &&
    SPAN_CLAUSE_ARRAY_PARENTS.has(thirdLast)
  ) {
    spanQueryIndex = path.length - 3;
  } else if (
    typeof last === "string" &&
    SPAN_CHILD_KEYS.has(last) &&
    typeof secondLast === "string" &&
    secondLast.startsWith("span_")
  ) {
    spanQueryIndex = path.length - 2;
  }

  if (spanQueryIndex < 0) return false;
  const parentPath = path.slice(0, spanQueryIndex);
  return isQuerySuggestionContext(parentPath) || isSpanChildContext(parentPath);
}

function isKnownQueryDefinitionPath(path: JsonPathSegment[]) {
  const queryType = path[path.length - 1];
  if (typeof queryType !== "string" || !QUERY_TYPE_LABELS.has(queryType)) return false;
  const parentPath = path.slice(0, -1);
  return isQuerySuggestionContext(parentPath) || isSpanChildContext(parentPath);
}

function isFieldQueryValueObjectContext(path: JsonPathSegment[]) {
  const queryType = path[path.length - 2];
  const field = path[path.length - 1];

  return typeof queryType === "string" &&
    FIELD_OBJECT_QUERY_KEYS.has(queryType) &&
    typeof field === "string" &&
    (isQuerySuggestionContext(path.slice(0, -2)) || isSpanChildContext(path.slice(0, -2)));
}

function selectFieldQueryValuePropertySuggestions(path: JsonPathSegment[]) {
  if (!isFieldQueryValueObjectContext(path)) return null;
  const queryType = path[path.length - 2];

  if (queryType === "term") return TERM_VALUE_PROPERTY_SNIPPETS;
  if (queryType === "range") return RANGE_VALUE_PROPERTY_SNIPPETS;
  return typeof queryType === "string"
    ? FIELD_QUERY_VALUE_PROPERTY_SNIPPETS_BY_TYPE[queryType] ?? null
    : null;
}

function isAggregationContainerPath(path: JsonPathSegment[]): boolean {
  const last = path[path.length - 1];
  if (last !== "aggs" && last !== "aggregations") return false;
  return path.length === 1 || isAggregationDefinitionPath(path.slice(0, -1));
}

function isAggregationDefinitionPath(path: JsonPathSegment[]): boolean {
  return path.length >= 2 && isAggregationContainerPath(path.slice(0, -1));
}

function selectAggregationTypeSuggestions(
  path: JsonPathSegment[],
  objectFrames: readonly JsonObjectFrame[],
) {
  const topLevel = path.length === 2 && (path[0] === "aggs" || path[0] === "aggregations");
  const insideNested = objectFrames.some((frame) => frame.seenKeys.includes("nested"));
  const parentAggregationTypes = new Set(objectFrames.flatMap((frame) => frame.seenKeys));
  const hasMultiBucketParent = [...parentAggregationTypes].some((type) => MULTI_BUCKET_AGGREGATIONS.has(type));
  const hasHistogramParent = parentAggregationTypes.has("date_histogram") || parentAggregationTypes.has("histogram");

  return AGG_TYPE_PROPERTY_SNIPPETS.filter((snippet) => {
    if (snippet.label === "global") return topLevel;
    if (snippet.label === "reverse_nested") return insideNested;
    if (PARENT_PIPELINE_AGGREGATIONS.has(snippet.label)) return !topLevel && hasMultiBucketParent;
    if (HISTOGRAM_PIPELINE_AGGREGATIONS.has(snippet.label)) return !topLevel && hasHistogramParent;
    return true;
  });
}

export function selectPropertySuggestions(
  path: JsonPathSegment[],
  autocompleteContext?: Pick<ConsoleAutocompleteContext, "cluster"> | null,
  objectFrames: readonly JsonObjectFrame[] = [],
): RawSnippet[] {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];
  const aggregationProperties = selectAggregationPropertySuggestions(path);
  const fieldQueryProperties = selectFieldQueryValuePropertySuggestions(path);

  if (path.length === 0) {
    return filterAvailableSnippets(ROOT_PROPERTY_SNIPPETS, autocompleteContext);
  }

  if (fieldQueryProperties) {
    return filterAvailableSnippets(fieldQueryProperties, autocompleteContext);
  }

  if (last === "bool" && isQuerySuggestionContext(path.slice(0, -1))) {
    return filterAvailableSnippets(BOOL_PROPERTY_SNIPPETS, autocompleteContext);
  }

  if (isSpanChildContext(path)) {
    const snippets = last === "match" && secondLast === "span_multi"
      ? MULTI_TERM_QUERY_PROPERTY_SNIPPETS
      : SPAN_QUERY_PROPERTY_SNIPPETS;
    return filterAvailableSnippets(snippets, autocompleteContext);
  }

  if (aggregationProperties) {
    return filterAvailableSnippets(aggregationProperties, autocompleteContext);
  }

  if (isQuerySuggestionContext(path)) {
    return filterAvailableSnippets(QUERY_LEAF_PROPERTY_SNIPPETS, autocompleteContext);
  }

  if (isAggregationContainerPath(path)) {
    return filterAvailableSnippets([AGGS_CONTAINER_PROPERTY_SNIPPET], autocompleteContext);
  }

  if (isAggregationDefinitionPath(path)) {
    return filterAvailableSnippets(
      selectAggregationTypeSuggestions(path, objectFrames),
      autocompleteContext,
    );
  }

  return [];
}

function selectAggregationPropertySuggestions(path: JsonPathSegment[]) {
  const last = path[path.length - 1];

  if (typeof last !== "string" || !isAggregationDefinitionPath(path.slice(0, -1))) {
    return null;
  }

  return AGG_PROPERTY_SNIPPETS_BY_TYPE[last] ?? null;
}

const NUMBER_VALUE_KEYS = new Set(["size", "from", "terminate_after"]);
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
]);

const NUMBER_VALUE_SNIPPETS: RawSnippet[] = [
  {
    label: "0",
    detail: "数值",
    documentation: "插入非负整数。",
    insertText: "${1:0}",
    kind: "value",
    sortText: "000-number",
  },
];
const BOOLEAN_VALUE_SNIPPETS = LITERAL_VALUE_SNIPPETS.filter((item) => item.label !== "null");
const TRACK_TOTAL_HITS_VALUE_SNIPPETS: RawSnippet[] = [
  ...BOOLEAN_VALUE_SNIPPETS,
  {
    label: "10000",
    detail: "命中计数上限",
    documentation: "精确统计到指定命中数量。",
    insertText: "${1:10000}",
    kind: "value",
    sortText: "002-track-total-hits",
  },
];
const MULTI_TERM_QUERY_VALUE_SNIPPETS = QUERY_LEAF_VALUE_SNIPPETS.filter((snippet) =>
  MULTI_TERM_QUERY_LABELS.has(snippet.label)
);
const SPAN_QUERY_VALUE_SNIPPETS = QUERY_LEAF_VALUE_SNIPPETS.filter((snippet) =>
  snippet.label.startsWith("span_")
);

function filterAvailableValueSnippets(
  snippets: readonly RawSnippet[],
  autocompleteContext?: Pick<ConsoleAutocompleteContext, "cluster"> | null,
) {
  return filterAvailableSnippets(snippets, autocompleteContext).filter(
    (snippet, index, available) =>
      available.findIndex((candidate) => candidate.label === snippet.label) === index,
  );
}

export function selectValueSuggestions(
  path: JsonPathSegment[],
  autocompleteContext?: Pick<ConsoleAutocompleteContext, "cluster"> | null,
): RawSnippet[] {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  if (last === "track_total_hits") return TRACK_TOTAL_HITS_VALUE_SNIPPETS;
  if (typeof last === "string" && NUMBER_VALUE_KEYS.has(last)) return NUMBER_VALUE_SNIPPETS;
  if (typeof last === "string" && BOOLEAN_VALUE_KEYS.has(last)) return BOOLEAN_VALUE_SNIPPETS;
  if (isSpanChildContext(path)) {
    return filterAvailableValueSnippets(
      last === "match" && secondLast === "span_multi"
        ? MULTI_TERM_QUERY_VALUE_SNIPPETS
        : SPAN_QUERY_VALUE_SNIPPETS,
      autocompleteContext,
    );
  }
  if (isQuerySuggestionContext(path)) {
    return filterAvailableValueSnippets(QUERY_LEAF_VALUE_SNIPPETS, autocompleteContext);
  }
  return [];
}

export function shouldSuggestFieldsForKey(path: JsonPathSegment[]) {
  const last = path[path.length - 1];

  if (isFieldQueryValueObjectContext(path)) {
    return false;
  }

  if (
    typeof last === "string" &&
    FIELD_OBJECT_QUERY_KEYS.has(last) &&
    (isQuerySuggestionContext(path.slice(0, -1)) || isSpanChildContext(path.slice(0, -1)))
  ) {
    return true;
  }

  if (last === "highlight") {
    return false;
  }

  if (path.length === 2 && path[0] === "highlight" && last === "fields") {
    return true;
  }

  if (
    (path.length === 1 && last === "sort") ||
    (path.length === 2 && path[0] === "sort" && typeof last === "number")
  ) {
    return true;
  }

  return false;
}

export function shouldSuggestFieldsForStringValue(path: JsonPathSegment[]) {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];
  const thirdLast = path[path.length - 3];

  if (typeof last === "string" && FIELD_VALUE_KEYS.has(last)) {
    if (
      path.length === 2 &&
      last === "field" &&
      (path[0] === "collapse" || path[0] === "knn")
    ) {
      return true;
    }

    const aggregationProperties = selectAggregationPropertySuggestions(path.slice(0, -1));
    if (aggregationProperties?.some((snippet) => snippet.label === last)) {
      return true;
    }

    return isKnownQueryDefinitionPath(path.slice(0, -1));
  }

  if (typeof last === "number" && typeof secondLast === "string" && FIELD_ARRAY_VALUE_KEYS.has(secondLast)) {
    if (path.length === 2) return true;
    return secondLast === "fields" &&
      typeof thirdLast === "string" &&
      QUERY_FIELD_ARRAY_TYPES.has(thirdLast) &&
      isKnownQueryDefinitionPath(path.slice(0, -2));
  }

  return false;
}
