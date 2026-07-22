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
]);

export const FIELD_VALUE_KEYS = new Set(["field", "path"]);
export const FIELD_ARRAY_VALUE_KEYS = new Set(["fields", "docvalue_fields", "stored_fields"]);
const QUERY_CONTAINER_KEYS = new Set(["query", "post_filter"]);
const QUERY_CHILD_KEYS = new Set([
  "filter",
  "must",
  "must_not",
  "should",
  "query",
  "positive",
  "negative",
  "organic",
  "include",
  "exclude",
  "big",
  "little",
  "match",
]);
const QUERY_ARRAY_KEYS = new Set(["queries"]);

function isQuerySuggestionContext(path: JsonPathSegment[]) {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  if (typeof last === "string" && QUERY_CONTAINER_KEYS.has(last)) {
    return true;
  }

  if (typeof last === "number" && typeof secondLast === "string" && QUERY_ARRAY_KEYS.has(secondLast)) {
    return true;
  }

  if (typeof last === "string" && QUERY_CHILD_KEYS.has(last)) {
    return true;
  }

  return false;
}

function isSpanChildContext(path: JsonPathSegment[]) {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];
  const thirdLast = path[path.length - 3];

  if (typeof last === "number" && secondLast === "clauses" && thirdLast === "span_near") {
    return true;
  }

  return ["match", "include", "exclude", "big", "little", "query"].includes(String(last)) &&
    path.some((segment) => typeof segment === "string" && segment.startsWith("span_"));
}

function selectFieldQueryValuePropertySuggestions(path: JsonPathSegment[]) {
  const queryType = path[path.length - 2];
  const field = path[path.length - 1];

  if (typeof queryType !== "string" || typeof field !== "string") {
    return null;
  }
  if (queryType === "term") return TERM_VALUE_PROPERTY_SNIPPETS;
  if (queryType === "range") return RANGE_VALUE_PROPERTY_SNIPPETS;
  return FIELD_QUERY_VALUE_PROPERTY_SNIPPETS_BY_TYPE[queryType] ?? null;
}

function selectAggregationTypeSuggestions(
  path: JsonPathSegment[],
  objectFrames: readonly JsonObjectFrame[],
) {
  const topLevel = path.length === 2 && (path[0] === "aggs" || path[0] === "aggregations");
  const insideNested = objectFrames.some((frame) => frame.seenKeys.includes("nested"));

  return AGG_TYPE_PROPERTY_SNIPPETS.filter((snippet) => {
    if (snippet.label === "global") return topLevel;
    if (snippet.label === "reverse_nested") return insideNested;
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
  const thirdLast = path[path.length - 3];
  const aggregationProperties = selectAggregationPropertySuggestions(path);
  const fieldQueryProperties = selectFieldQueryValuePropertySuggestions(path);

  if (path.length === 0) {
    return filterAvailableSnippets(ROOT_PROPERTY_SNIPPETS, autocompleteContext);
  }

  if (last === "bool") {
    return filterAvailableSnippets(BOOL_PROPERTY_SNIPPETS, autocompleteContext);
  }

  if (fieldQueryProperties) {
    return filterAvailableSnippets(fieldQueryProperties, autocompleteContext);
  }

  if (isSpanChildContext(path)) {
    const snippets = last === "match" && secondLast === "span_multi"
      ? MULTI_TERM_QUERY_PROPERTY_SNIPPETS
      : SPAN_QUERY_PROPERTY_SNIPPETS;
    return filterAvailableSnippets(snippets, autocompleteContext);
  }

  if (typeof last === "number" && typeof secondLast === "string" && BOOL_ARRAY_KEYS.has(secondLast)) {
    return filterAvailableSnippets(QUERY_LEAF_PROPERTY_SNIPPETS, autocompleteContext);
  }

  if (secondLast === "bool" && BOOL_ARRAY_KEYS.has(String(last))) {
    return filterAvailableSnippets(QUERY_LEAF_PROPERTY_SNIPPETS, autocompleteContext);
  }

  if (aggregationProperties) {
    return filterAvailableSnippets(aggregationProperties, autocompleteContext);
  }

  if (isQuerySuggestionContext(path)) {
    return filterAvailableSnippets(QUERY_LEAF_PROPERTY_SNIPPETS, autocompleteContext);
  }

  if (last === "aggs" || last === "aggregations") {
    return filterAvailableSnippets([AGGS_CONTAINER_PROPERTY_SNIPPET], autocompleteContext);
  }

  if (secondLast === "aggs" || secondLast === "aggregations") {
    return filterAvailableSnippets(
      selectAggregationTypeSuggestions(path, objectFrames),
      autocompleteContext,
    );
  }

  if (typeof thirdLast === "string" && (thirdLast === "aggs" || thirdLast === "aggregations")) {
    return filterAvailableSnippets(
      selectAggregationTypeSuggestions(path, objectFrames),
      autocompleteContext,
    );
  }

  return [];
}

function selectAggregationPropertySuggestions(path: JsonPathSegment[]) {
  const last = path[path.length - 1];
  const thirdLast = path[path.length - 3];

  if (typeof last !== "string" || (thirdLast !== "aggs" && thirdLast !== "aggregations")) {
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

export function selectValueSuggestions(path: JsonPathSegment[]): RawSnippet[] {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  if (last === "track_total_hits") return TRACK_TOTAL_HITS_VALUE_SNIPPETS;
  if (typeof last === "string" && NUMBER_VALUE_KEYS.has(last)) return NUMBER_VALUE_SNIPPETS;
  if (typeof last === "string" && BOOLEAN_VALUE_KEYS.has(last)) return BOOLEAN_VALUE_SNIPPETS;
  if (last === "query" || (typeof last === "string" && QUERY_CHILD_KEYS.has(last))) {
    return [...QUERY_LEAF_VALUE_SNIPPETS];
  }
  if (typeof last === "number" && typeof secondLast === "string" && BOOL_ARRAY_KEYS.has(secondLast)) {
    return [...QUERY_LEAF_VALUE_SNIPPETS];
  }
  return [];
}

export function shouldSuggestFieldsForKey(path: JsonPathSegment[]) {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  if (typeof last === "string" && FIELD_OBJECT_QUERY_KEYS.has(last)) {
    return true;
  }

  if (last === "highlight") {
    return false;
  }

  if (secondLast === "fields" && typeof last === "string") {
    return true;
  }

  if (last === "sort" || secondLast === "sort") {
    return true;
  }

  return false;
}

export function shouldSuggestFieldsForStringValue(path: JsonPathSegment[]) {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  if (typeof last === "string" && FIELD_VALUE_KEYS.has(last)) {
    return true;
  }

  if (typeof last === "number" && typeof secondLast === "string" && FIELD_ARRAY_VALUE_KEYS.has(secondLast)) {
    return true;
  }

  return false;
}
