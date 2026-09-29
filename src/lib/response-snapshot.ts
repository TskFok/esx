import type { ResponseSnapshot } from "../types/requests";
import { serializeJson } from "./utils";

export const RESPONSE_PREVIEW_BYTES = 256 * 1024;
export const MIN_RESPONSE_PREVIEW_BYTES = 16 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type ResponseSnapshotSource = {
  ok: boolean;
  status: number;
  statusText: string;
  durationMs: number;
  executedAt: string;
  bodyText: string;
  totalBytes?: number;
  truncated?: boolean;
  errorMessage?: string;
  diagnostics?: string[];
};

type TextPreview = {
  text: string;
  totalBytes: number;
  previewBytes: number;
  truncated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeResponsePreviewBytes(value: unknown, fallback = RESPONSE_PREVIEW_BYTES) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(MIN_RESPONSE_PREVIEW_BYTES, Math.round(numeric));
}

function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number) {
  const end = Math.min(bytes.length, Math.max(0, maxBytes));
  if (end >= bytes.length) {
    return textDecoder.decode(bytes);
  }

  for (let currentEnd = end; currentEnd >= Math.max(0, end - 4); currentEnd -= 1) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, currentEnd));
    } catch {
      // Try a smaller prefix until the byte boundary is valid.
    }
  }

  return textDecoder.decode(bytes.slice(0, end));
}

export function createTextPreview(text: string, maxBytes = RESPONSE_PREVIEW_BYTES): TextPreview {
  const normalizedMaxBytes = typeof maxBytes === "number" && Number.isFinite(maxBytes)
    ? Math.max(0, Math.round(maxBytes))
    : RESPONSE_PREVIEW_BYTES;
  const bytes = textEncoder.encode(text);
  const truncated = bytes.length > normalizedMaxBytes;
  const previewText = truncated ? decodeUtf8Prefix(bytes, normalizedMaxBytes) : text;
  const previewBytes = truncated ? textEncoder.encode(previewText).length : bytes.length;

  return {
    text: previewText,
    totalBytes: bytes.length,
    previewBytes,
    truncated,
  };
}

export function buildResponseSnapshot(
  source: ResponseSnapshotSource,
  maxPreviewBytes = RESPONSE_PREVIEW_BYTES,
): ResponseSnapshot {
  const normalizedMaxBytes = normalizeResponsePreviewBytes(maxPreviewBytes);
  const bodyPreview = createTextPreview(source.bodyText, normalizedMaxBytes);
  const totalBytes = Number.isSafeInteger(source.totalBytes) && source.totalBytes! >= 0
    ? source.totalBytes! : bodyPreview.totalBytes;
  const truncated = bodyPreview.truncated || (source.truncated ?? totalBytes > bodyPreview.previewBytes);
  let isJson = false;
  let prettyPreview: string | undefined;

  if (!truncated && source.bodyText.trim() && bodyPreview.totalBytes <= normalizedMaxBytes) {
    try {
      const pretty = serializeJson(JSON.parse(source.bodyText));
      const preview = createTextPreview(pretty, normalizedMaxBytes);
      isJson = true;
      prettyPreview = preview.truncated ? undefined : preview.text;
    } catch {
      isJson = false;
    }
  }

  return {
    ok: source.ok,
    status: source.status,
    statusText: source.statusText,
    durationMs: source.durationMs,
    sizeBytes: totalBytes,
    executedAt: source.executedAt,
    bodyPreview: bodyPreview.text,
    prettyPreview,
    truncated,
    previewBytes: bodyPreview.previewBytes,
    isJson,
    errorMessage: source.errorMessage,
    diagnostics: source.diagnostics ?? [],
  };
}

export function normalizeResponseSnapshot(value: unknown, maxPreviewBytes = RESPONSE_PREVIEW_BYTES): ResponseSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const normalizedMaxBytes = normalizeResponsePreviewBytes(maxPreviewBytes);
  const bodySource = asString(value.bodyPreview, asString(value.bodyText));
  const bodyPreview = createTextPreview(bodySource, normalizedMaxBytes);
  const sizeBytes = Number.isSafeInteger(value.sizeBytes) && (value.sizeBytes as number) >= 0
    ? value.sizeBytes as number : bodyPreview.totalBytes;
  const legacyPrettySource = asString(value.prettyPreview, asString(value.bodyPretty));
  const legacyPrettyPreview = legacyPrettySource ? createTextPreview(legacyPrettySource, normalizedMaxBytes) : null;
  const prettyPreview = legacyPrettyPreview?.truncated ? undefined : legacyPrettyPreview?.text;
  const previewBytes = Math.min(asNumber(value.previewBytes, bodyPreview.previewBytes), bodyPreview.previewBytes);
  // 旧快照曾把美化文本超限误记为正文截断，仅修复这一已知旧格式。
  const legacyPrettyOnlyTruncation = asBoolean(value.isJson) && sizeBytes === bodyPreview.totalBytes
    && legacyPrettyPreview?.truncated;
  const bodyTruncated = bodyPreview.truncated || (legacyPrettyOnlyTruncation ? false
    : typeof value.truncated === "boolean" ? value.truncated : sizeBytes > bodyPreview.previewBytes);

  return {
    ok: asBoolean(value.ok),
    status: asNumber(value.status),
    statusText: asString(value.statusText),
    durationMs: asNumber(value.durationMs),
    sizeBytes,
    executedAt: asString(value.executedAt, new Date(0).toISOString()),
    bodyPreview: bodyPreview.text,
    prettyPreview,
    truncated: bodyTruncated,
    previewBytes,
    isJson: asBoolean(value.isJson),
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : undefined,
    diagnostics: Array.isArray(value.diagnostics)
      ? value.diagnostics.filter((item): item is string => typeof item === "string")
      : [],
    previewEvicted: asBoolean(value.previewEvicted) || undefined,
  };
}

export function getResponseDisplayText(response: ResponseSnapshot) {
  return response.isJson && response.prettyPreview ? response.prettyPreview : response.bodyPreview;
}
