import {
  AGGS_CONTAINER_PROPERTY_SNIPPET,
  AGG_PROPERTY_SNIPPETS_BY_TYPE,
  AGG_TYPE_PROPERTY_SNIPPETS,
  BOOL_PROPERTY_SNIPPETS,
  LITERAL_VALUE_SNIPPETS,
  QUERY_LEAF_PROPERTY_SNIPPETS,
  QUERY_LEAF_VALUE_SNIPPETS,
  ROOT_PROPERTY_SNIPPETS,
  type RawSnippet,
} from "./snippets";
import type { JsonPathSegment } from "./json-path";
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

export function selectPropertySuggestions(
  path: JsonPathSegment[],
  autocompleteContext?: Pick<ConsoleAutocompleteContext, "cluster"> | null,
): RawSnippet[] {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];
  const thirdLast = path[path.length - 3];
  const aggregationProperties = selectAggregationPropertySuggestions(path);

  if (path.length === 0) {
    return filterAvailableSnippets(ROOT_PROPERTY_SNIPPETS, autocompleteContext);
  }

  if (last === "bool") {
    return filterAvailableSnippets(BOOL_PROPERTY_SNIPPETS, autocompleteContext);
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
    return filterAvailableSnippets(AGG_TYPE_PROPERTY_SNIPPETS, autocompleteContext);
  }

  if (typeof thirdLast === "string" && (thirdLast === "aggs" || thirdLast === "aggregations")) {
    return filterAvailableSnippets(AGG_TYPE_PROPERTY_SNIPPETS, autocompleteContext);
  }

  return filterAvailableSnippets([...ROOT_PROPERTY_SNIPPETS, ...QUERY_LEAF_PROPERTY_SNIPPETS], autocompleteContext);
}

function selectAggregationPropertySuggestions(path: JsonPathSegment[]) {
  const last = path[path.length - 1];
  const thirdLast = path[path.length - 3];

  if (typeof last !== "string" || (thirdLast !== "aggs" && thirdLast !== "aggregations")) {
    return null;
  }

  return AGG_PROPERTY_SNIPPETS_BY_TYPE[last] ?? null;
}

export function selectValueSuggestions(path: JsonPathSegment[]): RawSnippet[] {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  if (typeof last === "string" && BOOL_ARRAY_KEYS.has(last)) {
    return [...QUERY_LEAF_VALUE_SNIPPETS, ...LITERAL_VALUE_SNIPPETS];
  }

  if (typeof last === "number" && typeof secondLast === "string" && BOOL_ARRAY_KEYS.has(secondLast)) {
    return [...QUERY_LEAF_VALUE_SNIPPETS, ...LITERAL_VALUE_SNIPPETS];
  }

  if (last === "query") {
    return [...QUERY_LEAF_VALUE_SNIPPETS, ...LITERAL_VALUE_SNIPPETS];
  }

  return [...QUERY_LEAF_VALUE_SNIPPETS, ...LITERAL_VALUE_SNIPPETS];
}

export function shouldSuggestFieldsForKey(path: JsonPathSegment[]) {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];

  if (typeof last === "string" && FIELD_OBJECT_QUERY_KEYS.has(last)) {
    return true;
  }

  if (typeof secondLast === "string" && FIELD_OBJECT_QUERY_KEYS.has(secondLast) && typeof last === "string") {
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
