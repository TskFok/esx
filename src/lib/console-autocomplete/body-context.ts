import type { ConsoleBodyMode, ConsoleRequestContext } from "./request-context";

export type BodyCompletionKind =
  | "search-json"
  | "scroll-json"
  | "count-json"
  | "create-index-json"
  | "update-json"
  | "document-json"
  | "bulk-action"
  | "bulk-source"
  | "bulk-update"
  | "msearch-header"
  | "msearch-body"
  | "unknown";

export interface BodyCompletionContext {
  kind: BodyCompletionKind;
  currentLine: string;
}

const JSON_BODY_KIND: Partial<Record<ConsoleBodyMode, BodyCompletionKind>> = {
  "search-json": "search-json",
  "scroll-json": "scroll-json",
  "count-json": "count-json",
  "create-index-json": "create-index-json",
  "update-json": "update-json",
  "document-json": "document-json",
};

export function analyzeBodyCompletion(
  content: string,
  request: ConsoleRequestContext,
): BodyCompletionContext {
  const lines = content.split(/\r?\n/);
  const bodyLines = lines.slice(1);
  const currentLine = bodyLines[bodyLines.length - 1] ?? "";
  const completedLines = bodyLines.slice(0, -1).filter((line) => line.trim().length > 0);
  const jsonKind = JSON_BODY_KIND[request.bodyMode];
  if (jsonKind) return { kind: jsonKind, currentLine };

  if (request.bodyMode === "msearch-ndjson") {
    try {
      completedLines.forEach((line) => JSON.parse(line));
    } catch {
      return { kind: "unknown", currentLine };
    }
    return {
      kind: completedLines.length % 2 === 0 ? "msearch-header" : "msearch-body",
      currentLine,
    };
  }

  if (request.bodyMode !== "bulk-ndjson") return { kind: "unknown", currentLine };

  let kind: BodyCompletionKind = "bulk-action";
  for (const line of completedLines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { kind: "unknown", currentLine };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "unknown", currentLine };
    }
    if (kind !== "bulk-action") {
      kind = "bulk-action";
      continue;
    }
    const action = Object.keys(parsed)[0];
    if (action === "delete") kind = "bulk-action";
    else if (action === "update") kind = "bulk-update";
    else if (action === "index" || action === "create") kind = "bulk-source";
    else return { kind: "unknown", currentLine };
  }
  return { kind, currentLine };
}
