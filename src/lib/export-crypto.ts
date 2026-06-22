export const EXPORT_CRYPTO_VERSION = 1 as const;
export const EXPORT_PBKDF2_ITERATIONS = 100_000;

export type ExportFileKind = "requests" | "connections";

export type EncryptedJsonExportFile = {
  version: typeof EXPORT_CRYPTO_VERSION;
  encrypted: true;
  exportedAt: string;
  kind: ExportFileKind;
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

export function isEncryptedJsonFile(value: unknown, kind?: ExportFileKind): value is EncryptedJsonExportFile {
  if (!isRecord(value) || value.encrypted !== true || value.version !== EXPORT_CRYPTO_VERSION) {
    return false;
  }

  if (kind && value.kind !== kind) {
    return false;
  }

  const cipher = value.cipher;
  return (
    (value.kind === "requests" || value.kind === "connections") &&
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

export async function encryptJsonPayload(payload: {
  kind: ExportFileKind;
  password: string;
  payload: unknown;
  exportedAt?: string;
}): Promise<EncryptedJsonExportFile> {
  const trimmedPassword = payload.password.trim();
  if (!trimmedPassword) {
    throw new Error("加密导出需要设置密码。");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveExportKey(trimmedPassword, salt, EXPORT_PBKDF2_ITERATIONS);
  const plaintext = `${JSON.stringify(payload.payload, null, 2)}\n`;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  return {
    version: EXPORT_CRYPTO_VERSION,
    encrypted: true,
    exportedAt: payload.exportedAt ?? new Date().toISOString(),
    kind: payload.kind,
    cipher: {
      kdf: "PBKDF2",
      iterations: EXPORT_PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    },
  };
}

export async function decryptJsonPayload<T>(payload: {
  file: unknown;
  kind: ExportFileKind;
  password: string;
  invalidKindMessage?: string;
}): Promise<T> {
  const trimmedPassword = payload.password.trim();
  if (!trimmedPassword) {
    throw new Error("请输入导出密码。");
  }

  if (!isEncryptedJsonFile(payload.file, payload.kind)) {
    throw new Error(payload.invalidKindMessage ?? "不支持的连接导入文件。");
  }

  const key = await deriveExportKey(
    trimmedPassword,
    base64ToBytes(payload.file.cipher.salt),
    payload.file.cipher.iterations,
  );
  let decrypted: ArrayBuffer;

  try {
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(payload.file.cipher.iv) },
      key,
      base64ToBytes(payload.file.cipher.ciphertext),
    );
  } catch {
    throw new Error("密码错误或文件已损坏。");
  }

  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

export function serializeEncryptedJsonFile(file: EncryptedJsonExportFile) {
  return `${JSON.stringify(file, null, 2)}\n`;
}
