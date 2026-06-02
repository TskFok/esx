import { buildConsoleContent } from "./console-parser";
import { computeNextSortOrder, REQUEST_SORT_ORDER_STEP } from "./request-list";
import { normalizeRequestTags } from "./request-tags";
import type { SavedRequest } from "../types/requests";

export const REQUEST_EXPORT_VERSION = 1 as const;

export type RequestExportEntry = {
  name: string;
  method: string;
  path: string;
  body: string;
  tags: string[];
  sortOrder: number;
};

export type RequestExportPayload = {
  version: typeof REQUEST_EXPORT_VERSION;
  exportedAt: string;
  connectionName: string;
  requests: RequestExportEntry[];
};

export type RequestImportMode = "merge" | "replace";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeExportEntry(value: unknown, index: number): RequestExportEntry {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条请求格式无效。`);
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const method = typeof value.method === "string" ? value.method.trim().toUpperCase() : "";
  const path = typeof value.path === "string" ? value.path.trim() : "";
  const body = typeof value.body === "string" ? value.body : "";

  if (!name || !method || !path) {
    throw new Error(`第 ${index + 1} 条请求缺少名称、方法或路径。`);
  }

  return {
    name,
    method,
    path,
    body,
    tags: normalizeRequestTags(Array.isArray(value.tags) ? (value.tags as string[]) : []),
    sortOrder: typeof value.sortOrder === "number" && Number.isFinite(value.sortOrder) ? value.sortOrder : index * REQUEST_SORT_ORDER_STEP,
  };
}

export function buildRequestExportPayload(connectionName: string, requests: SavedRequest[]): RequestExportPayload {
  return {
    version: REQUEST_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    connectionName,
    requests: [...requests]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((request) => ({
        name: request.name,
        method: request.method,
        path: request.path,
        body: request.body,
        tags: normalizeRequestTags(request.tags),
        sortOrder: request.sortOrder,
      })),
  };
}

export function parseRequestImportPayload(json: unknown): RequestExportPayload {
  if (!isRecord(json)) {
    throw new Error("导入文件不是有效的 JSON 对象。");
  }

  if (json.version !== REQUEST_EXPORT_VERSION) {
    throw new Error("不支持的导入文件版本。");
  }

  if (!Array.isArray(json.requests)) {
    throw new Error("导入文件缺少 requests 数组。");
  }

  return {
    version: REQUEST_EXPORT_VERSION,
    exportedAt: typeof json.exportedAt === "string" ? json.exportedAt : new Date().toISOString(),
    connectionName: typeof json.connectionName === "string" ? json.connectionName.trim() : "未命名连接",
    requests: json.requests.map((entry, index) => normalizeExportEntry(entry, index)),
  };
}

export function serializeRequestExportPayload(payload: RequestExportPayload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function parseRequestImportFile(json: unknown, password?: string | null) {
  const { isEncryptedRequestExportFile, decryptRequestExportFile } = await import("./request-export-crypto");

  if (isEncryptedRequestExportFile(json)) {
    if (!password?.trim()) {
      throw new Error("该文件已加密，请输入导出密码。");
    }

    return decryptRequestExportFile(json, password);
  }

  return parseRequestImportPayload(json);
}

export function downloadExportContent(content: string, filename: string, mimeType = "application/json;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadRequestExport(payload: RequestExportPayload, filename: string) {
  downloadExportContent(serializeRequestExportPayload(payload), filename);
}

export function buildImportedRequests(
  connectionId: string,
  entries: RequestExportEntry[],
  existingRequests: SavedRequest[],
  mode: RequestImportMode,
  timestamp = new Date().toISOString(),
): SavedRequest[] {
  const connectionRequests = existingRequests.filter((request) => request.connectionId === connectionId);
  const startSortOrder =
    mode === "merge" ? computeNextSortOrder(connectionRequests) : 0;

  const imported = entries.map((entry, index) => ({
    id: crypto.randomUUID(),
    connectionId,
    name: entry.name,
    method: entry.method,
    path: entry.path,
    body: entry.body,
    headers: {},
    tags: normalizeRequestTags(entry.tags),
    sortOrder: mode === "merge" ? startSortOrder + index * REQUEST_SORT_ORDER_STEP : entry.sortOrder,
    lastResponse: null,
    lastStatus: null,
    lastDurationMs: null,
    updatedAt: timestamp,
  } satisfies SavedRequest));

  if (mode === "replace") {
    const otherRequests = existingRequests.filter((request) => request.connectionId !== connectionId);
    return [...otherRequests, ...imported];
  }

  return [...existingRequests, ...imported];
}

export function buildExportFilename(connectionName: string, exportedAt = new Date()) {
  const safeName = connectionName.trim().replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "") || "connection";
  const stamp = exportedAt.toISOString().slice(0, 10);
  return `esx-requests-${safeName}-${stamp}.json`;
}

export function buildRequestContentFromEntry(entry: Pick<RequestExportEntry, "method" | "path" | "body">) {
  return buildConsoleContent(entry.method, entry.path, entry.body);
}
