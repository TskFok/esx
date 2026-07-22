export type ConsoleEndpoint =
  | "root"
  | "search"
  | "scroll"
  | "count"
  | "bulk"
  | "msearch"
  | "create-index"
  | "update-document"
  | "index-document"
  | "mapping"
  | "settings"
  | "tasks"
  | "snapshot"
  | "cat"
  | "unknown";

export type ConsoleBodyMode =
  | "search-json"
  | "scroll-json"
  | "count-json"
  | "create-index-json"
  | "update-json"
  | "document-json"
  | "bulk-ndjson"
  | "msearch-ndjson"
  | "unknown";

export interface ConsoleRequestContext {
  method: string;
  rawPath: string;
  path: string;
  pathSegments: string[];
  endpoint: ConsoleEndpoint;
  bodyMode: ConsoleBodyMode;
}

const GET_OR_POST = new Set(["GET", "POST"]);
const POST_OR_PUT = new Set(["POST", "PUT"]);
const GET_OR_PUT = new Set(["GET", "PUT"]);
const CAT_ENDPOINTS = new Set(["indices", "aliases", "nodes", "health", "shards"]);

function isMultiTargetSegment(segment: string | undefined) {
  return !!segment && (!segment.startsWith("_") || segment === "_all");
}

function isSingleConcreteTargetSegment(segment: string | undefined) {
  return !!segment &&
    !segment.startsWith("_") &&
    !segment.includes(",") &&
    !segment.includes("*") &&
    !segment.includes("?") &&
    !/%(?:2a|2c|3f)/i.test(segment);
}

function isGlobalOrTargetEndpoint(segments: string[], endpoint: string) {
  return (
    (segments.length === 1 && segments[0] === endpoint) ||
    (segments.length === 2 && segments[1] === endpoint && isMultiTargetSegment(segments[0]))
  );
}

function isSnapshotEndpoint(method: string, segments: string[]) {
  if (segments[0] !== "_snapshot") return false;
  if (segments.length === 1) return method === "GET";
  if (segments.length === 2) return method === "GET" || method === "PUT" || method === "DELETE";
  if (segments.length === 3) {
    return method === "GET" || method === "PUT" || method === "POST" || method === "DELETE";
  }
  return segments.length === 4 && segments[3] === "_restore" && method === "POST";
}

function classifyEndpoint(method: string, segments: string[]): ConsoleEndpoint {
  if (segments.length === 0) return "root";
  if (
    GET_OR_POST.has(method) &&
    segments.length === 2 &&
    segments[0] === "_search" &&
    segments[1] === "scroll"
  ) {
    return "scroll";
  }
  if (GET_OR_POST.has(method) && isGlobalOrTargetEndpoint(segments, "_search")) return "search";
  if (GET_OR_POST.has(method) && isGlobalOrTargetEndpoint(segments, "_count")) return "count";
  if (POST_OR_PUT.has(method) && isGlobalOrTargetEndpoint(segments, "_bulk")) return "bulk";
  if (GET_OR_POST.has(method) && isGlobalOrTargetEndpoint(segments, "_msearch")) return "msearch";
  if (
    method === "GET" &&
    segments.length === 2 &&
    segments[0] === "_cat" &&
    CAT_ENDPOINTS.has(segments[1] ?? "")
  ) {
    return "cat";
  }
  if (
    (segments.length === 1 && segments[0] === "_mapping" && method === "GET") ||
    (segments.length === 2 && segments[1] === "_mapping" &&
      isMultiTargetSegment(segments[0]) && GET_OR_PUT.has(method))
  ) {
    return "mapping";
  }
  if (
    (segments.length === 1 && segments[0] === "_settings" && method === "GET") ||
    (segments.length === 2 && segments[1] === "_settings" &&
      isMultiTargetSegment(segments[0]) && GET_OR_PUT.has(method))
  ) {
    return "settings";
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "_tasks") return "tasks";
  if (isSnapshotEndpoint(method, segments)) return "snapshot";
  if (
    segments.length === 3 &&
    segments[1] === "_update" &&
    isSingleConcreteTargetSegment(segments[0]) &&
    method === "POST"
  ) {
    return "update-document";
  }
  if (
    segments.length === 2 &&
    segments[1] === "_doc" &&
    isSingleConcreteTargetSegment(segments[0]) &&
    method === "POST"
  ) {
    return "index-document";
  }
  if (
    segments.length === 3 &&
    segments[1] === "_doc" &&
    isSingleConcreteTargetSegment(segments[0]) &&
    POST_OR_PUT.has(method)
  ) {
    return "index-document";
  }
  if (segments.length === 1 && isSingleConcreteTargetSegment(segments[0]) && method === "PUT") {
    return "create-index";
  }
  return "unknown";
}

function bodyModeFor(endpoint: ConsoleEndpoint): ConsoleBodyMode {
  const modes: Partial<Record<ConsoleEndpoint, ConsoleBodyMode>> = {
    search: "search-json",
    scroll: "scroll-json",
    count: "count-json",
    bulk: "bulk-ndjson",
    msearch: "msearch-ndjson",
    "create-index": "create-index-json",
    "update-document": "update-json",
    "index-document": "document-json",
  };
  return modes[endpoint] ?? "unknown";
}

export function parseConsoleRequestContext(content: string): ConsoleRequestContext {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = firstLine.match(/^([A-Za-z]+)(?:\s+(\S*))?/);
  const method = match?.[1]?.toUpperCase() ?? "";
  const rawPath = match?.[2] ?? "";
  const withoutQuery = rawPath.split("?", 1)[0] || "/";
  const path = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const pathSegments = path.split("/").filter(Boolean);
  const endpoint = classifyEndpoint(method, pathSegments);

  return { method, rawPath, path, pathSegments, endpoint, bodyMode: bodyModeFor(endpoint) };
}
