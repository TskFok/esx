import type { ResponseSnapshot } from "../types/requests";

export class DetailedError extends Error {
  diagnostics: string[];
  rawText?: string;

  constructor(message: string, diagnostics: string[] = [], rawText?: string) {
    super(message);
    this.name = "DetailedError";
    this.diagnostics = diagnostics;
    this.rawText = rawText;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function deduplicate(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

export function isGenericFailureMessage(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    normalized === "请求失败" ||
    normalized === "request failed" ||
    normalized === "failed" ||
    normalized === "request_failed" ||
    normalized === "unknown error"
  );
}

function collectErrorTexts(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) {
    return [];
  }

  const direct = normalizeText(value);
  if (direct) {
    return [direct];
  }

  if (value instanceof Error) {
    return deduplicate([
      value.message,
      value.name,
      ...collectErrorTexts((value as Error & { cause?: unknown }).cause, depth + 1),
    ]);
  }

  if (Array.isArray(value)) {
    return deduplicate(value.flatMap((item) => collectErrorTexts(item, depth + 1)));
  }

  if (!isRecord(value)) {
    return [];
  }

  const prioritizedKeys = ["message", "error", "reason", "detail", "details", "description", "statusText", "cause", "data"];
  const prioritized = prioritizedKeys.flatMap((key) => collectErrorTexts(value[key], depth + 1));
  const rest = Object.entries(value)
    .filter(([key]) => !prioritizedKeys.includes(key))
    .flatMap(([, entryValue]) => collectErrorTexts(entryValue, depth + 1));

  return deduplicate([...prioritized, ...rest]);
}

function describeUnknownError(value: unknown) {
  if (value instanceof DetailedError) {
    return {
      message: value.message || "请求失败",
      diagnostics: deduplicate([
        value.message,
        ...value.diagnostics,
        ...(value.rawText?.trim() ? [`原始错误内容：\n${value.rawText.trim()}`] : []),
      ]),
    };
  }

  const textCandidates = collectErrorTexts(value);
  const bestMessage = textCandidates.find((item) => !isGenericFailureMessage(item)) ?? textCandidates[0] ?? "请求失败";
  const rawDump = safeStringify(value);
  const diagnostics = deduplicate([
    ...textCandidates,
    ...(value instanceof Error && value.stack ? [value.stack] : []),
    ...(rawDump && rawDump !== "{}" && rawDump !== "[]" ? [`原始错误对象：\n${rawDump}`] : []),
  ]);

  return {
    message: bestMessage,
    diagnostics,
  };
}

export function extractUnknownErrorMessage(error: unknown, fallback = "请求失败") {
  const { message } = describeUnknownError(error);
  return message || fallback;
}

export function extractUnknownErrorDiagnostics(error: unknown) {
  return describeUnknownError(error).diagnostics;
}

export function getResponseErrorMessage(snapshot: ResponseSnapshot, fallback = "请求失败") {
  const candidates = [
    snapshot.errorMessage?.trim(),
    ...[...snapshot.diagnostics].reverse().map((item) => item.trim()),
    snapshot.bodyText.trim(),
    snapshot.statusText.trim(),
  ].filter((item): item is string => Boolean(item));

  const specific = candidates.find((item) => !isGenericFailureMessage(item));
  return specific ?? candidates[0] ?? fallback;
}
