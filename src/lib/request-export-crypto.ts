import { serializeRequestExportPayload, type RequestExportPayload } from "./request-import-export";

export const REQUEST_EXPORT_CRYPTO_VERSION = 1 as const;
export const REQUEST_EXPORT_PBKDF2_ITERATIONS = 100_000;

export type EncryptedRequestExportFile = {
  version: typeof REQUEST_EXPORT_CRYPTO_VERSION;
  encrypted: true;
  exportedAt: string;
  cipher: {
    kdf: "PBKDF2";
    iterations: number;
    salt: string;
    iv: string;
    ciphertext: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function isEncryptedRequestExportFile(value: unknown): value is EncryptedRequestExportFile {
  if (!isRecord(value) || value.encrypted !== true || value.version !== REQUEST_EXPORT_CRYPTO_VERSION) {
    return false;
  }

  const cipher = value.cipher;
  return (
    isRecord(cipher) &&
    cipher.kdf === "PBKDF2" &&
    typeof cipher.iterations === "number" &&
    typeof cipher.salt === "string" &&
    typeof cipher.iv === "string" &&
    typeof cipher.ciphertext === "string"
  );
}

async function deriveExportKey(password: string, salt: Uint8Array, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptRequestExportPayload(
  payload: RequestExportPayload,
  password: string,
): Promise<EncryptedRequestExportFile> {
  const trimmedPassword = password.trim();
  if (!trimmedPassword) {
    throw new Error("加密导出需要设置密码。");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveExportKey(trimmedPassword, salt, REQUEST_EXPORT_PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(serializeRequestExportPayload(payload)),
  );

  return {
    version: REQUEST_EXPORT_CRYPTO_VERSION,
    encrypted: true,
    exportedAt: payload.exportedAt,
    cipher: {
      kdf: "PBKDF2",
      iterations: REQUEST_EXPORT_PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    },
  };
}

export async function decryptRequestExportFile(
  file: EncryptedRequestExportFile,
  password: string,
): Promise<RequestExportPayload> {
  const trimmedPassword = password.trim();
  if (!trimmedPassword) {
    throw new Error("请输入导出密码。");
  }

  const key = await deriveExportKey(trimmedPassword, base64ToBytes(file.cipher.salt), file.cipher.iterations);
  let decrypted: ArrayBuffer;

  try {
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(file.cipher.iv) },
      key,
      base64ToBytes(file.cipher.ciphertext),
    );
  } catch {
    throw new Error("密码错误或文件已损坏。");
  }

  const { parseRequestImportPayload } = await import("./request-import-export");
  return parseRequestImportPayload(JSON.parse(new TextDecoder().decode(decrypted)));
}

export function serializeEncryptedRequestExportFile(file: EncryptedRequestExportFile) {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function buildEncryptedExportFilename(connectionName: string, exportedAt = new Date()) {
  const safeName = connectionName.trim().replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "") || "connection";
  const stamp = exportedAt.toISOString().slice(0, 10);
  return `esx-requests-${safeName}-${stamp}.encrypted.json`;
}
