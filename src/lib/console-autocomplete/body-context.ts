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

export interface NdjsonCompletionState {
  kind: "bulk-action" | "bulk-source" | "bulk-update" | "msearch-header" | "msearch-body" | "unknown";
  targetNames: string[] | null;
  completedLineCount: number;
}

export function initialNdjsonCompletionState(mode: ConsoleBodyMode): NdjsonCompletionState {
  return {
    kind: mode === "bulk-ndjson" ? "bulk-action" : mode === "msearch-ndjson" ? "msearch-header" : "unknown",
    targetNames: null,
    completedLineCount: 0,
  };
}

export function advanceNdjsonCompletionState(
  state: NdjsonCompletionState,
  line: string,
  mode: ConsoleBodyMode,
): NdjsonCompletionState {
  if (!line.trim() || state.kind === "unknown") return state;
  const invalid: NdjsonCompletionState = { kind: "unknown", targetNames: null, completedLineCount: state.completedLineCount + 1 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return invalid;
  }
  if (!isJsonObject(parsed)) return invalid;

  const completedLineCount = state.completedLineCount + 1;
  if (mode === "msearch-ndjson") {
    return state.kind === "msearch-header"
      ? { kind: "msearch-body", targetNames: parseTargetNames(parsed.index, true), completedLineCount }
      : { kind: "msearch-header", targetNames: null, completedLineCount };
  }
  if (mode !== "bulk-ndjson") return invalid;
  if (state.kind !== "bulk-action") {
    return { kind: "bulk-action", targetNames: null, completedLineCount };
  }
  const actionKeys = Object.keys(parsed);
  if (actionKeys.length !== 1) return invalid;
  const action = actionKeys[0]!;
  const metadata = parsed[action];
  if (!isJsonObject(metadata)) return invalid;
  if (action === "delete") return { kind: "bulk-action", targetNames: null, completedLineCount };
  if (action === "update") {
    return { kind: "bulk-update", targetNames: parseTargetNames(metadata._index, false), completedLineCount };
  }
  if (action === "index" || action === "create") {
    return { kind: "bulk-source", targetNames: parseTargetNames(metadata._index, false), completedLineCount };
  }
  return invalid;
}

export function analyzeBodyCompletion(
  content: string,
  request: ConsoleRequestContext,
): BodyCompletionContext {
  const lines = content.split(/\r?\n/);
  const bodyLines = lines.slice(1);
  const currentLine = bodyLines[bodyLines.length - 1] ?? "";
  const jsonKind = JSON_BODY_KIND[request.bodyMode];
  if (jsonKind) return { kind: jsonKind, currentLine, targetNames: null };
  if (request.bodyMode !== "bulk-ndjson" && request.bodyMode !== "msearch-ndjson") {
    return { kind: "unknown", currentLine, targetNames: null };
  }
  let state = initialNdjsonCompletionState(request.bodyMode);
  for (const line of bodyLines.slice(0, -1)) {
    state = advanceNdjsonCompletionState(state, line, request.bodyMode);
  }
  return { kind: state.kind, currentLine, targetNames: state.targetNames };
}
