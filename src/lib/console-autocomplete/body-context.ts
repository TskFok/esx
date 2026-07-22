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
  targetNames: string[] | null;
}

const JSON_BODY_KIND: Partial<Record<ConsoleBodyMode, BodyCompletionKind>> = {
  "search-json": "search-json",
  "scroll-json": "scroll-json",
  "count-json": "count-json",
  "create-index-json": "create-index-json",
  "update-json": "update-json",
  "document-json": "document-json",
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseTargetNames(value: unknown, allowArray: boolean): string[] | null {
  if (value === undefined) return null;
  const values = typeof value === "string"
    ? [value]
    : allowArray && Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value
      : null;
  if (!values) return [];

  const names = values.flatMap((item) => item.split(",").map((name) => name.trim()));
  if (
    names.length === 0 ||
    names.some((name) =>
      !name ||
      name.startsWith("_") ||
      name.includes("*") ||
      name.includes("{") ||
      name.includes("}")
    )
  ) {
    return [];
  }

  return [...new Set(names)];
}

export function analyzeBodyCompletion(
  content: string,
  request: ConsoleRequestContext,
): BodyCompletionContext {
  const lines = content.split(/\r?\n/);
  const bodyLines = lines.slice(1);
  const currentLine = bodyLines[bodyLines.length - 1] ?? "";
  const completedLines = bodyLines.slice(0, -1).filter((line) => line.trim().length > 0);
  const jsonKind = JSON_BODY_KIND[request.bodyMode];
  if (jsonKind) return { kind: jsonKind, currentLine, targetNames: null };

  if (request.bodyMode === "msearch-ndjson") {
    let targetNames: string[] | null = null;
    for (let index = 0; index < completedLines.length; index += 1) {
      const line = completedLines[index] ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return { kind: "unknown", currentLine, targetNames: null };
      }
      if (!isJsonObject(parsed)) return { kind: "unknown", currentLine, targetNames: null };
      if (index % 2 === 0) targetNames = parseTargetNames(parsed.index, true);
    }
    const kind = completedLines.length % 2 === 0 ? "msearch-header" : "msearch-body";
    return {
      kind,
      currentLine,
      targetNames: kind === "msearch-body" ? targetNames : null,
    };
  }

  if (request.bodyMode !== "bulk-ndjson") {
    return { kind: "unknown", currentLine, targetNames: null };
  }

  let kind: BodyCompletionKind = "bulk-action";
  let targetNames: string[] | null = null;
  for (const line of completedLines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { kind: "unknown", currentLine, targetNames: null };
    }
    if (!isJsonObject(parsed)) {
      return { kind: "unknown", currentLine, targetNames: null };
    }
    if (kind !== "bulk-action") {
      kind = "bulk-action";
      targetNames = null;
      continue;
    }
    const actionKeys = Object.keys(parsed);
    if (actionKeys.length !== 1) {
      return { kind: "unknown", currentLine, targetNames: null };
    }
    const action = actionKeys[0];
    const actionMetadata = parsed[action!];
    if (!isJsonObject(actionMetadata)) {
      return { kind: "unknown", currentLine, targetNames: null };
    }
    if (action === "delete") {
      kind = "bulk-action";
      targetNames = null;
    } else if (action === "update") {
      kind = "bulk-update";
      targetNames = parseTargetNames(actionMetadata._index, false);
    } else if (action === "index" || action === "create") {
      kind = "bulk-source";
      targetNames = parseTargetNames(actionMetadata._index, false);
    } else {
      return { kind: "unknown", currentLine, targetNames: null };
    }
  }
  return { kind, currentLine, targetNames };
}
