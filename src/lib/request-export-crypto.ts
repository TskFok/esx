import {
  EXPORT_CRYPTO_VERSION,
  EXPORT_PBKDF2_ITERATIONS,
  decryptJsonPayload,
  encryptJsonPayload,
  isEncryptedJsonFile,
  serializeEncryptedJsonFile,
  type EncryptedJsonExportFile,
} from "./export-crypto";
import { type RequestExportPayload } from "./request-import-export";

export const REQUEST_EXPORT_CRYPTO_VERSION = EXPORT_CRYPTO_VERSION;
export const REQUEST_EXPORT_PBKDF2_ITERATIONS = EXPORT_PBKDF2_ITERATIONS;

export type EncryptedRequestExportFile = EncryptedJsonExportFile & {
  kind: "requests";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withRequestKind(file: unknown): unknown {
  if (!isRecord(file) || "kind" in file) {
    return file;
  }
  return {
    ...file,
    kind: "requests",
  };
}

export function isEncryptedRequestExportFile(value: unknown): value is EncryptedRequestExportFile {
  return isEncryptedJsonFile(value, "requests") || isEncryptedJsonFile(withRequestKind(value), "requests");
}

export async function encryptRequestExportPayload(
  payload: RequestExportPayload,
  password: string,
): Promise<EncryptedRequestExportFile> {
  return encryptJsonPayload({
    kind: "requests",
    password,
    payload,
    exportedAt: payload.exportedAt,
  }) as Promise<EncryptedRequestExportFile>;
}

export async function decryptRequestExportFile(
  file: EncryptedRequestExportFile,
  password: string,
): Promise<RequestExportPayload> {
  const decrypted = await decryptJsonPayload<unknown>({
    file: withRequestKind(file),
    kind: "requests",
    password,
    invalidKindMessage: "不支持的导入文件版本。",
  });
  const { parseRequestImportPayload } = await import("./request-import-export");
  return parseRequestImportPayload(decrypted);
}

export function serializeEncryptedRequestExportFile(file: EncryptedRequestExportFile) {
  return serializeEncryptedJsonFile(file);
}

export function buildEncryptedExportFilename(connectionName: string, exportedAt = new Date()) {
  const safeName = connectionName.trim().replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "") || "connection";
  const stamp = exportedAt.toISOString().slice(0, 10);
  return `esx-requests-${safeName}-${stamp}.encrypted.json`;
}
