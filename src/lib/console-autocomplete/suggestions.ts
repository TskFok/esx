import {
  AGGS_CONTAINER_PROPERTY_SNIPPET,
  AGG_TYPE_PROPERTY_SNIPPETS,
  BOOL_PROPERTY_SNIPPETS,
  LITERAL_VALUE_SNIPPETS,
  QUERY_LEAF_PROPERTY_SNIPPETS,
  QUERY_LEAF_VALUE_SNIPPETS,
  ROOT_PROPERTY_SNIPPETS,
  type RawSnippet,
} from "./snippets";
import type { JsonPathSegment } from "./json-path";

export const BOOL_ARRAY_KEYS = new Set(["must", "should", "filter", "must_not"]);

export const LEAF_QUERY_KEYS = new Set([
  "match",
  "match_phrase",
  "match_phrase_prefix",
  "term",
  "terms",
  "range",
  "exists",
  "wildcard",
  "prefix",
  "regexp",
  "fuzzy",
  "span_term",
  "multi_match",
]);

export const FIELD_VALUE_KEYS = new Set(["field", "path"]);

export function selectPropertySuggestions(path: JsonPathSegment[]): RawSnippet[] {
  const last = path[path.length - 1];
  const secondLast = path[path.length - 2];
  const thirdLast = path[path.length - 3];

  if (path.length === 0) {
    return [...ROOT_PROPERTY_SNIPPETS];
  }

  if (last === "query" && path.length === 1) {
    return deduplicateByLabel([
      ...QUERY_LEAF_PROPERTY_SNIPPETS,
      {
        label: "bool",
        detail: "布尔查询",
        documentation: "布尔查询，支持 must / should / filter / must_not。",
        insertText: '"bool": {\n\t$0\n}',
        kind: "property" as const,
        sortText: "001-bool",
      },
    ]);
  }

  if (last === "bool") {
    return [...BOOL_PROPERTY_SNIPPETS];
  }

  if (typeof last === "number" && typeof secondLast === "string" && BOOL_ARRAY_KEYS.has(secondLast)) {
    return [...QUERY_LEAF_PROPERTY_SNIPPETS];
  }

  if (secondLast === "bool" && BOOL_ARRAY_KEYS.has(String(last))) {
    return [...QUERY_LEAF_PROPERTY_SNIPPETS];
  }

  if (last === "aggs" || last === "aggregations") {
    return [AGGS_CONTAINER_PROPERTY_SNIPPET];
  }

  if (secondLast === "aggs" || secondLast === "aggregations") {
    return [...AGG_TYPE_PROPERTY_SNIPPETS];
  }

  if (typeof thirdLast === "string" && (thirdLast === "aggs" || thirdLast === "aggregations")) {
    return [...AGG_TYPE_PROPERTY_SNIPPETS];
  }

  return [...ROOT_PROPERTY_SNIPPETS, ...QUERY_LEAF_PROPERTY_SNIPPETS];
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

  if (typeof last === "string" && LEAF_QUERY_KEYS.has(last)) {
    return true;
  }

  if (typeof secondLast === "string" && LEAF_QUERY_KEYS.has(secondLast) && typeof last === "string") {
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
  return typeof last === "string" && FIELD_VALUE_KEYS.has(last);
}

function deduplicateByLabel<T extends { label: string }>(list: T[]): T[] {
  return list.filter((item, index, array) => array.findIndex((other) => other.label === item.label) === index);
}
