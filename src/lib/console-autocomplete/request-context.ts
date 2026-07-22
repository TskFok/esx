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

function classifyEndpoint(method: string, segments: string[]): ConsoleEndpoint {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (segments.length === 0) return "root";
  if (first === "_search" && segments[1] === "scroll") return "scroll";
  if (last === "_search") return "search";
  if (last === "_count") return "count";
  if (last === "_bulk") return "bulk";
  if (last === "_msearch") return "msearch";
  if (first === "_cat") return "cat";
  if (last === "_mapping") return "mapping";
  if (last === "_settings") return "settings";
  if (first === "_tasks") return "tasks";
  if (first === "_snapshot") return "snapshot";
  if (segments.length >= 3 && segments[segments.length - 2] === "_update" && method === "POST") {
    return "update-document";
  }
  if (
    segments.length >= 2 &&
    segments[1] === "_doc" &&
    (method === "POST" || method === "PUT")
  ) {
    return "index-document";
  }
  if (segments.length === 1 && !first?.startsWith("_") && method === "PUT") {
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
