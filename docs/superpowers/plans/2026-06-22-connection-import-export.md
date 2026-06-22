# 连接导入导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在连接管理页增加加密导出和解密导入，导出内容包含连接、SSH 通道和对应敏感凭据。

**Architecture:** 先抽出通用 JSON 加密工具，让请求导出和连接导出共用 `PBKDF2 + AES-GCM` 实现。连接导入导出的数据转换放在 `src/lib/connection-import-export.ts`，React state 只负责读取 secret、写入 secret 和追加状态。页面新增两个弹窗组件，并复用现有 `Button`、`Dialog`、`Input` 和 lucide 图标。

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Tauri store, Tauri secret vault APIs, Web Crypto API, Testing Library。

---

## File Structure

- Create: `src/lib/export-crypto.ts`
  - 通用 base64、PBKDF2 和 AES-GCM JSON 加解密。
- Modify: `src/lib/request-export-crypto.ts`
  - 保持现有 public API 不变，对内复用 `export-crypto.ts`。
- Create: `src/lib/connection-import-export.ts`
  - 连接导出 payload、加密文件包装、导入解析、ID 重映射和文件名。
- Create: `src/lib/__tests__/export-crypto.test.ts`
  - 覆盖通用加解密、空密码和错误密码。
- Create: `src/lib/__tests__/connection-import-export.test.ts`
  - 覆盖 payload 构建、解析、加密文件识别、导入重映射和 secret 写入计划。
- Modify: `src/lib/__tests__/request-export-crypto.test.ts`
  - 保留现有测试，确认请求导出兼容。
- Modify: `src/providers/app-state.tsx`
  - 增加 `exportConnections` 和 `importConnections`，连接 secret 与 SSH secret 写入 secret vault。
- Create: `src/components/connections/connection-export-dialog.tsx`
  - 导出密码弹窗。
- Create: `src/components/connections/connection-import-dialog.tsx`
  - 导入密码解析、预览和确认弹窗。
- Modify: `src/pages/connections-page-content.tsx`
  - 增加导入导出按钮、隐藏文件选择 input、弹窗状态和调用逻辑。

---

### Task 1: 通用导出加密工具

**Files:**
- Create: `src/lib/export-crypto.ts`
- Create: `src/lib/__tests__/export-crypto.test.ts`
- Modify: `src/lib/request-export-crypto.ts`
- Test: `src/lib/__tests__/export-crypto.test.ts`
- Test: `src/lib/__tests__/request-export-crypto.test.ts`

- [ ] **Step 1: Write the failing test for generic JSON encryption**

Create `src/lib/__tests__/export-crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  decryptJsonPayload,
  encryptJsonPayload,
  isEncryptedJsonFile,
  serializeEncryptedJsonFile,
} from "../export-crypto";

describe("export crypto", () => {
  it("encrypts and decrypts json payloads by kind", async () => {
    const encrypted = await encryptJsonPayload({
      kind: "connections",
      password: "test-password",
      payload: { version: 1, name: "生产集群" },
    });

    expect(isEncryptedJsonFile(encrypted, "connections")).toBe(true);
    expect(serializeEncryptedJsonFile(encrypted)).toContain('"kind": "connections"');

    const decrypted = await decryptJsonPayload<{ version: number; name: string }>({
      file: encrypted,
      kind: "connections",
      password: "test-password",
    });

    expect(decrypted).toEqual({ version: 1, name: "生产集群" });
  });

  it("rejects empty encryption passwords", async () => {
    await expect(
      encryptJsonPayload({
        kind: "connections",
        password: " ",
        payload: { version: 1 },
      }),
    ).rejects.toThrow("加密导出需要设置密码。");
  });

  it("rejects wrong passwords", async () => {
    const encrypted = await encryptJsonPayload({
      kind: "connections",
      password: "right-password",
      payload: { version: 1 },
    });

    await expect(
      decryptJsonPayload({
        file: encrypted,
        kind: "connections",
        password: "wrong-password",
      }),
    ).rejects.toThrow("密码错误或文件已损坏。");
  });

  it("rejects files for another export kind", async () => {
    const encrypted = await encryptJsonPayload({
      kind: "requests",
      password: "test-password",
      payload: { version: 1 },
    });

    expect(isEncryptedJsonFile(encrypted, "connections")).toBe(false);
    await expect(
      decryptJsonPayload({
        file: encrypted,
        kind: "connections",
        password: "test-password",
      }),
    ).rejects.toThrow("不支持的连接导入文件。");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test src/lib/__tests__/export-crypto.test.ts
```

Expected: FAIL with a module resolution error for `../export-crypto`.

- [ ] **Step 3: Implement `src/lib/export-crypto.ts`**

Create `src/lib/export-crypto.ts`:

```ts
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
```

- [ ] **Step 4: Refactor request export crypto to reuse the generic helper**

Replace `src/lib/request-export-crypto.ts` with:

```ts
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

export function isEncryptedRequestExportFile(value: unknown): value is EncryptedRequestExportFile {
  return isEncryptedJsonFile(value, "requests");
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
    file,
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
```

- [ ] **Step 5: Run tests to verify generic crypto and request crypto pass**

Run:

```bash
pnpm test src/lib/__tests__/export-crypto.test.ts src/lib/__tests__/request-export-crypto.test.ts
```

Expected: PASS for both files.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/lib/export-crypto.ts src/lib/request-export-crypto.ts src/lib/__tests__/export-crypto.test.ts
git commit -m "抽取导出加密工具"
```

---

### Task 2: 连接导入导出纯逻辑

**Files:**
- Create: `src/lib/connection-import-export.ts`
- Create: `src/lib/__tests__/connection-import-export.test.ts`
- Test: `src/lib/__tests__/connection-import-export.test.ts`

- [ ] **Step 1: Write failing tests for connection payload and import mapping**

Create `src/lib/__tests__/connection-import-export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildConnectionExportFilename,
  buildConnectionExportPayload,
  buildConnectionImportPlan,
  decryptConnectionExportFile,
  encryptConnectionExportPayload,
  isEncryptedConnectionExportFile,
  parseConnectionImportPayload,
  serializeEncryptedConnectionExportFile,
} from "../connection-import-export";
import type { ConnectionProfile, SshProfile } from "../../types/connections";

const timestamp = "2026-06-22T00:00:00.000Z";

function createConnection(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: "conn-1",
    name: "生产集群",
    baseUrl: "https://es.example.com:9200",
    username: "elastic",
    auth: { type: "basic" },
    tls: { mode: "default" },
    environment: "prod",
    readonly: false,
    insecureTls: false,
    sshProfileId: "ssh-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: timestamp,
    ...overrides,
  };
}

function createSshProfile(overrides: Partial<SshProfile> = {}): SshProfile {
  return {
    id: "ssh-1",
    name: "跳板机",
    tunnel: {
      host: "jump.example.com",
      port: 22,
      username: "deploy",
      authMethod: "password",
      privateKeyPath: "",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastVerifiedAt: timestamp,
    hostKeyPolicy: "trustOnFirstUse",
    trustedHostKeySha256: "sha256-host-key",
    ...overrides,
  };
}

describe("connection import export", () => {
  it("builds and parses export payload with secrets", async () => {
    const payload = await buildConnectionExportPayload({
      connections: [createConnection()],
      sshProfiles: [createSshProfile()],
      getConnectionSecret: async () => "elastic:secret",
      getSshSecret: async () => "ssh-secret",
      exportedAt: timestamp,
    });

    const parsed = parseConnectionImportPayload(payload);

    expect(parsed.exportedAt).toBe(timestamp);
    expect(parsed.connections[0]?.secret).toBe("elastic:secret");
    expect(parsed.sshProfiles[0]?.secret).toBe("ssh-secret");
  });

  it("rejects invalid connection entries", () => {
    expect(() =>
      parseConnectionImportPayload({
        version: 1,
        exportedAt: timestamp,
        connections: [{ name: "", baseUrl: "", username: "", auth: { type: "basic" } }],
        sshProfiles: [],
      }),
    ).toThrow("第 1 条连接格式无效。");
  });

  it("encrypts and decrypts connection export files", async () => {
    const payload = await buildConnectionExportPayload({
      connections: [createConnection()],
      sshProfiles: [createSshProfile()],
      getConnectionSecret: async () => "elastic:secret",
      getSshSecret: async () => "ssh-secret",
      exportedAt: timestamp,
    });

    const encrypted = await encryptConnectionExportPayload(payload, "test-password");
    expect(isEncryptedConnectionExportFile(encrypted)).toBe(true);
    expect(serializeEncryptedConnectionExportFile(encrypted)).toContain('"kind": "connections"');

    const decrypted = await decryptConnectionExportFile(encrypted, "test-password");
    expect(decrypted.connections[0]?.name).toBe("生产集群");
  });

  it("builds import plan with new ids and remapped ssh profile ids", () => {
    const payload = parseConnectionImportPayload({
      version: 1,
      exportedAt: timestamp,
      connections: [
        {
          name: "生产集群",
          baseUrl: "https://es.example.com:9200",
          username: "elastic",
          auth: { type: "basic" },
          tls: { mode: "default" },
          environment: "prod",
          readonly: false,
          insecureTls: false,
          sshProfileId: "ssh-1",
          secret: "elastic:secret",
          createdAt: timestamp,
          updatedAt: timestamp,
          lastUsedAt: timestamp,
        },
      ],
      sshProfiles: [
        {
          id: "ssh-1",
          name: "跳板机",
          tunnel: {
            host: "jump.example.com",
            port: 22,
            username: "deploy",
            authMethod: "password",
            privateKeyPath: "",
          },
          hostKeyPolicy: "trustOnFirstUse",
          trustedHostKeySha256: "sha256-host-key",
          secret: "ssh-secret",
          createdAt: timestamp,
          updatedAt: timestamp,
          lastVerifiedAt: timestamp,
        },
      ],
    });

    const plan = buildConnectionImportPlan(payload, {
      now: () => "2026-06-22T01:00:00.000Z",
      randomId: (() => {
        const ids = ["new-ssh-1", "new-conn-1"];
        return () => ids.shift() ?? "extra-id";
      })(),
    });

    expect(plan.sshProfiles[0]?.id).toBe("new-ssh-1");
    expect(plan.connections[0]?.id).toBe("new-conn-1");
    expect(plan.connections[0]?.sshProfileId).toBe("new-ssh-1");
    expect(plan.connectionSecrets).toEqual([
      {
        connectionId: "new-conn-1",
        auth: { type: "basic" },
        username: "elastic",
        secret: "elastic:secret",
      },
    ]);
    expect(plan.sshSecrets).toEqual([{ profileId: "new-ssh-1", secret: "ssh-secret" }]);
  });

  it("builds encrypted export filename", () => {
    expect(buildConnectionExportFilename(new Date("2026-06-22T08:00:00.000Z"))).toBe(
      "esx-connections-2026-06-22.encrypted.json",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test src/lib/__tests__/connection-import-export.test.ts
```

Expected: FAIL with a module resolution error for `../connection-import-export`.

- [ ] **Step 3: Implement `src/lib/connection-import-export.ts`**

Create `src/lib/connection-import-export.ts` with these exports and helper implementations:

```ts
import {
  decryptJsonPayload,
  encryptJsonPayload,
  isEncryptedJsonFile,
  serializeEncryptedJsonFile,
  type EncryptedJsonExportFile,
} from "./export-crypto";
import { normalizeAuthConfig, normalizeConnectionProfileSecurity, normalizeTlsConfig } from "./connection-security";
import type {
  ConnectionAuthConfig,
  ConnectionEnvironment,
  ConnectionProfile,
  ConnectionTlsConfig,
  SshHostKeyPolicy,
  SshProfile,
  SshTunnelConfig,
} from "../types/connections";

export const CONNECTION_EXPORT_VERSION = 1 as const;

export type ConnectionExportEntry = {
  name: string;
  baseUrl: string;
  username: string;
  auth: ConnectionAuthConfig;
  tls: ConnectionTlsConfig;
  environment: ConnectionEnvironment;
  readonly: boolean;
  insecureTls: boolean;
  sshProfileId: string | null;
  secret: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
};

export type SshProfileExportEntry = {
  id: string;
  name: string;
  tunnel: SshTunnelConfig;
  hostKeyPolicy: SshHostKeyPolicy;
  trustedHostKeySha256: string | null;
  secret: string | null;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string;
};

export type ConnectionExportPayload = {
  version: typeof CONNECTION_EXPORT_VERSION;
  exportedAt: string;
  connections: ConnectionExportEntry[];
  sshProfiles: SshProfileExportEntry[];
};

export type EncryptedConnectionExportFile = EncryptedJsonExportFile & {
  kind: "connections";
};

export type ConnectionSecretImportPlan = {
  connectionId: string;
  auth: ConnectionAuthConfig;
  username: string;
  secret: string;
};

export type SshSecretImportPlan = {
  profileId: string;
  secret: string;
};

export type ConnectionImportPlan = {
  connections: ConnectionProfile[];
  sshProfiles: SshProfile[];
  connectionSecrets: ConnectionSecretImportPlan[];
  sshSecrets: SshSecretImportPlan[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEnvironment(value: unknown): ConnectionEnvironment {
  return value === "dev" || value === "test" || value === "staging" || value === "prod" ? value : "dev";
}

function normalizeHostKeyPolicy(value: unknown): SshHostKeyPolicy {
  return value === "strict" || value === "trustOnFirstUse" ? value : "trustOnFirstUse";
}

function normalizeSshTunnel(value: unknown, index: number): SshTunnelConfig {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条 SSH 通道格式无效。`);
  }

  const host = typeof value.host === "string" ? value.host.trim() : "";
  const username = typeof value.username === "string" ? value.username.trim() : "";
  const port = typeof value.port === "number" && Number.isInteger(value.port) ? value.port : 0;
  const authMethod = value.authMethod === "privateKey" ? "privateKey" : "password";
  const privateKeyPath = typeof value.privateKeyPath === "string" ? value.privateKeyPath.trim() : "";

  if (!host || !username || port <= 0 || port > 65535 || (authMethod === "privateKey" && !privateKeyPath)) {
    throw new Error(`第 ${index + 1} 条 SSH 通道格式无效。`);
  }

  return {
    host,
    port,
    username,
    authMethod,
    privateKeyPath,
  };
}

function normalizeConnectionEntry(value: unknown, index: number): ConnectionExportEntry {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条连接格式无效。`);
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  const username = typeof value.username === "string" ? value.username.trim() : "";
  const auth = normalizeAuthConfig(value.auth);
  const tls = normalizeTlsConfig(value.tls, value.insecureTls === true);
  const secret = typeof value.secret === "string" ? value.secret : "";

  if (!name || !baseUrl || !secret || (auth.type === "basic" && !username)) {
    throw new Error(`第 ${index + 1} 条连接格式无效。`);
  }

  return {
    name,
    baseUrl,
    username,
    auth,
    tls,
    environment: normalizeEnvironment(value.environment),
    readonly: value.readonly === true,
    insecureTls: tls.mode === "insecure" || value.insecureTls === true,
    sshProfileId: typeof value.sshProfileId === "string" && value.sshProfileId.trim() ? value.sshProfileId.trim() : null,
    secret,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    lastUsedAt: typeof value.lastUsedAt === "string" ? value.lastUsedAt : new Date().toISOString(),
  };
}

function normalizeSshProfileEntry(value: unknown, index: number): SshProfileExportEntry {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 条 SSH 通道格式无效。`);
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const tunnel = normalizeSshTunnel(value.tunnel, index);

  if (!id || !name) {
    throw new Error(`第 ${index + 1} 条 SSH 通道格式无效。`);
  }

  return {
    id,
    name,
    tunnel,
    hostKeyPolicy: normalizeHostKeyPolicy(value.hostKeyPolicy),
    trustedHostKeySha256:
      typeof value.trustedHostKeySha256 === "string" && value.trustedHostKeySha256.trim()
        ? value.trustedHostKeySha256.trim()
        : null,
    secret: typeof value.secret === "string" && value.secret ? value.secret : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    lastVerifiedAt: typeof value.lastVerifiedAt === "string" ? value.lastVerifiedAt : new Date().toISOString(),
  };
}

export async function buildConnectionExportPayload(input: {
  connections: ConnectionProfile[];
  sshProfiles: SshProfile[];
  getConnectionSecret: (connection: ConnectionProfile) => Promise<string | null>;
  getSshSecret: (profile: SshProfile) => Promise<string | null>;
  exportedAt?: string;
}): Promise<ConnectionExportPayload> {
  const sshProfileIds = new Set(input.connections.map((connection) => connection.sshProfileId).filter(Boolean));
  const exportedSshProfiles = input.sshProfiles.filter((profile) => sshProfileIds.has(profile.id));

  const connections = await Promise.all(
    input.connections.map(async (connection) => {
      const normalized = normalizeConnectionProfileSecurity(connection);
      const secret = await input.getConnectionSecret(normalized);
      if (!secret) {
        throw new Error(`连接“${connection.name}”未找到已保存凭据，请编辑连接后重新保存。`);
      }
      return {
        name: normalized.name,
        baseUrl: normalized.baseUrl,
        username: normalized.username,
        auth: normalized.auth,
        tls: normalized.tls,
        environment: normalized.environment,
        readonly: normalized.readonly,
        insecureTls: normalized.insecureTls,
        sshProfileId: normalized.sshProfileId,
        secret,
        createdAt: normalized.createdAt,
        updatedAt: normalized.updatedAt,
        lastUsedAt: normalized.lastUsedAt,
      } satisfies ConnectionExportEntry;
    }),
  );

  const sshProfiles = await Promise.all(
    exportedSshProfiles.map(async (profile) => ({
      id: profile.id,
      name: profile.name,
      tunnel: profile.tunnel,
      hostKeyPolicy: profile.hostKeyPolicy,
      trustedHostKeySha256: profile.trustedHostKeySha256,
      secret: await input.getSshSecret(profile),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      lastVerifiedAt: profile.lastVerifiedAt,
    } satisfies SshProfileExportEntry)),
  );

  return {
    version: CONNECTION_EXPORT_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    connections,
    sshProfiles,
  };
}

export function parseConnectionImportPayload(json: unknown): ConnectionExportPayload {
  if (!isRecord(json)) {
    throw new Error("导入文件不是有效的 JSON 对象。");
  }

  if (json.version !== CONNECTION_EXPORT_VERSION) {
    throw new Error("不支持的连接导入文件。");
  }

  if (!Array.isArray(json.connections) || !Array.isArray(json.sshProfiles)) {
    throw new Error("不支持的连接导入文件。");
  }

  return {
    version: CONNECTION_EXPORT_VERSION,
    exportedAt: typeof json.exportedAt === "string" ? json.exportedAt : new Date().toISOString(),
    connections: json.connections.map((entry, index) => normalizeConnectionEntry(entry, index)),
    sshProfiles: json.sshProfiles.map((entry, index) => normalizeSshProfileEntry(entry, index)),
  };
}

export function isEncryptedConnectionExportFile(value: unknown): value is EncryptedConnectionExportFile {
  return isEncryptedJsonFile(value, "connections");
}

export async function encryptConnectionExportPayload(
  payload: ConnectionExportPayload,
  password: string,
): Promise<EncryptedConnectionExportFile> {
  return encryptJsonPayload({
    kind: "connections",
    password,
    payload,
    exportedAt: payload.exportedAt,
  }) as Promise<EncryptedConnectionExportFile>;
}

export async function decryptConnectionExportFile(
  file: EncryptedConnectionExportFile,
  password: string,
): Promise<ConnectionExportPayload> {
  const decrypted = await decryptJsonPayload<unknown>({
    file,
    kind: "connections",
    password,
    invalidKindMessage: "不支持的连接导入文件。",
  });
  return parseConnectionImportPayload(decrypted);
}

export function serializeEncryptedConnectionExportFile(file: EncryptedConnectionExportFile) {
  return serializeEncryptedJsonFile(file);
}

export function buildConnectionImportPlan(
  payload: ConnectionExportPayload,
  options: {
    now?: () => string;
    randomId?: () => string;
  } = {},
): ConnectionImportPlan {
  const now = options.now ?? (() => new Date().toISOString());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const timestamp = now();
  const sshIdMap = new Map<string, string>();

  const sshProfiles = payload.sshProfiles.map((profile) => {
    const nextId = randomId();
    sshIdMap.set(profile.id, nextId);
    return {
      id: nextId,
      name: profile.name,
      tunnel: profile.tunnel,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastVerifiedAt: timestamp,
      hostKeyPolicy: profile.hostKeyPolicy,
      trustedHostKeySha256: profile.trustedHostKeySha256,
    } satisfies SshProfile;
  });

  const connections = payload.connections.map((connection) => {
    const nextId = randomId();
    return {
      id: nextId,
      name: connection.name,
      baseUrl: connection.baseUrl,
      username: connection.username,
      auth: connection.auth,
      tls: connection.tls,
      environment: connection.environment,
      readonly: connection.readonly,
      insecureTls: connection.insecureTls,
      sshProfileId: connection.sshProfileId ? sshIdMap.get(connection.sshProfileId) ?? null : null,
      sshTunnel: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
    } satisfies ConnectionProfile;
  });

  return {
    connections,
    sshProfiles,
    connectionSecrets: connections.map((connection, index) => ({
      connectionId: connection.id,
      auth: connection.auth,
      username: connection.username,
      secret: payload.connections[index]?.secret ?? "",
    })),
    sshSecrets: sshProfiles.flatMap((profile, index) => {
      const secret = payload.sshProfiles[index]?.secret;
      return secret ? [{ profileId: profile.id, secret }] : [];
    }),
  };
}

export function buildConnectionExportFilename(exportedAt = new Date()) {
  const stamp = exportedAt.toISOString().slice(0, 10);
  return `esx-connections-${stamp}.encrypted.json`;
}
```

- [ ] **Step 4: Run the connection import/export tests**

Run:

```bash
pnpm test src/lib/__tests__/connection-import-export.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/lib/connection-import-export.ts src/lib/__tests__/connection-import-export.test.ts
git commit -m "添加连接导入导出逻辑"
```

---

### Task 3: App state 导出导入入口

**Files:**
- Modify: `src/providers/app-state.tsx`
- Test: `src/lib/__tests__/connection-import-export.test.ts`

- [ ] **Step 1: Extend imports in `src/providers/app-state.tsx`**

Add these imports near existing import groups:

```ts
import {
  buildConnectionExportPayload,
  buildConnectionImportPlan,
  type ConnectionExportPayload,
} from "../lib/connection-import-export";
```

- [ ] **Step 2: Extend `AppStateContextValue`**

Add these signatures after `getSshProfileForConnection`:

```ts
  exportConnections: () => Promise<ConnectionExportPayload>;
  importConnections: (payload: ConnectionExportPayload) => Promise<{
    connectionsImported: number;
    sshProfilesImported: number;
  }>;
```

- [ ] **Step 3: Add implementation to provider value**

Inside the `value` object returned by `useMemo`, add these methods after `getSshProfileForConnection(connection)`:

```ts
      async exportConnections() {
        return buildConnectionExportPayload({
          connections: state.connections,
          sshProfiles: state.sshProfiles,
          getConnectionSecret: async (connection) =>
            getConnectionSecret(connection.id, getAuthSecretKey(connection.auth, connection.username)),
          getSshSecret: async (profile) => getConnectionSshSecret(profile.id),
        });
      },
      async importConnections(payload) {
        const importPlan = buildConnectionImportPlan(payload);

        await Promise.all([
          ...importPlan.connectionSecrets.map((secretPlan) =>
            saveConnectionSecret(
              secretPlan.connectionId,
              getAuthSecretKey(secretPlan.auth, secretPlan.username),
              secretPlan.secret,
            ),
          ),
          ...importPlan.sshSecrets.map((secretPlan) =>
            saveConnectionSshSecret(secretPlan.profileId, secretPlan.secret),
          ),
        ]);

        setState((current) =>
          normalizeState({
            ...current,
            connections: [...importPlan.connections, ...current.connections],
            sshProfiles: [...importPlan.sshProfiles, ...current.sshProfiles],
            currentConnectionId: importPlan.connections[0]?.id ?? current.currentConnectionId,
          }),
        );

        return {
          connectionsImported: importPlan.connections.length,
          sshProfilesImported: importPlan.sshProfiles.length,
        };
      },
```

- [ ] **Step 4: Run TypeScript check**

Run:

```bash
pnpm build
```

Expected: `tsc && vite build` completes successfully.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/providers/app-state.tsx
git commit -m "接入连接导入导出状态入口"
```

---

### Task 4: 连接页导出弹窗

**Files:**
- Create: `src/components/connections/connection-export-dialog.tsx`
- Modify: `src/pages/connections-page-content.tsx`

> 注意：进行中状态如果需要保持主按钮视觉，不要把确认按钮设置为原生 `disabled`。当前 `Button` 的 `disabled:opacity-60` 会让“导出中...”变成禁用态样式。应拆分表单无效和提交中状态，用 `aria-disabled` 加点击处理 guard 防重复提交。

- [ ] **Step 1: Create `ConnectionExportDialog`**

Create `src/components/connections/connection-export-dialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";

export type ConnectionExportDialogProps = {
  open: boolean;
  connectionCount: number;
  sshProfileCount: number;
  exporting: boolean;
  onClose: () => void;
  onConfirm: (payload: { password: string }) => void;
};

export function ConnectionExportDialog({
  open,
  connectionCount,
  sshProfileCount,
  exporting,
  onClose,
  onConfirm,
}: ConnectionExportDialogProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setPassword("");
      setConfirmPassword("");
    }
  }, [open]);

  const passwordsMatch = password.trim() && password === confirmPassword;
  const canConfirm = connectionCount > 0 && Boolean(passwordsMatch) && !exporting;

  return (
    <Dialog
      open={open}
      title="导出连接"
      description={`将 ${connectionCount} 条连接和 ${sshProfileCount} 条关联 SSH 通道加密导出。`}
      onClose={onClose}
      panelClassName="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={exporting}>
            取消
          </Button>
          <Button onClick={() => onConfirm({ password: password.trim() })} disabled={!canConfirm}>
            {exporting ? "导出中..." : "导出"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 text-sm leading-6 text-slate-600">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          导出文件包含 Elasticsearch 凭据和 SSH 凭据，请使用强密码保存，并只分享给可信设备。
        </div>

        <label className="block">
          <span className="mb-2 block font-semibold text-slate-700">导出密码</span>
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label className="block">
          <span className="mb-2 block font-semibold text-slate-700">确认密码</span>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>

        {password && confirmPassword && password !== confirmPassword ? (
          <p className="text-sm text-rose-600">两次输入的密码不一致。</p>
        ) : null}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add page imports**

In `src/pages/connections-page-content.tsx`, extend lucide imports:

```ts
  Download,
  Upload,
```

Add component and helper imports:

```ts
import { ConnectionExportDialog } from "../components/connections/connection-export-dialog";
import {
  buildConnectionExportFilename,
  encryptConnectionExportPayload,
  serializeEncryptedConnectionExportFile,
} from "../lib/connection-import-export";
import { downloadExportContent } from "../lib/request-import-export";
```

- [ ] **Step 3: Read `exportConnections` from app state and add dialog state**

In the `useAppState()` destructuring, add:

```ts
    exportConnections,
```

Near existing `useState` declarations, add:

```ts
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
```

- [ ] **Step 4: Add export handler**

Add this function near other event handlers:

```ts
  async function handleConfirmExport(payload: { password: string }) {
    setExporting(true);
    try {
      const exportPayload = await exportConnections();
      const encrypted = await encryptConnectionExportPayload(exportPayload, payload.password);
      downloadExportContent(
        serializeEncryptedConnectionExportFile(encrypted),
        buildConnectionExportFilename(),
      );
      setExportDialogOpen(false);
      toast.success(`已导出 ${exportPayload.connections.length} 条连接。`);
    } catch (error) {
      toast.error(extractUnknownErrorMessage(error, "导出连接失败"));
    } finally {
      setExporting(false);
    }
  }
```

- [ ] **Step 5: Add export button to the connection toolbar**

In the connection card toolbar where “错误日志”和“新建连接” are rendered, add this button before “新建连接”:

```tsx
                <Button
                  variant="outline"
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() => setExportDialogOpen(true)}
                  disabled={sortedConnections.length === 0}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  导出
                </Button>
```

- [ ] **Step 6: Render export dialog**

Before the delete dialogs at the bottom of `ConnectionsPage`, render:

```tsx
      <ConnectionExportDialog
        open={exportDialogOpen}
        connectionCount={sortedConnections.length}
        sshProfileCount={
          new Set(sortedConnections.map((connection) => connection.sshProfileId).filter(Boolean)).size
        }
        exporting={exporting}
        onClose={() => {
          if (!exporting) {
            setExportDialogOpen(false);
          }
        }}
        onConfirm={handleConfirmExport}
      />
```

- [ ] **Step 7: Run build**

Run:

```bash
pnpm build
```

Expected: build completes successfully.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add src/components/connections/connection-export-dialog.tsx src/pages/connections-page-content.tsx
git commit -m "添加连接加密导出界面"
```

---

### Task 5: 连接页导入弹窗和导入流程

**Files:**
- Create: `src/components/connections/connection-import-dialog.tsx`
- Modify: `src/pages/connections-page-content.tsx`

- [ ] **Step 1: Create `ConnectionImportDialog`**

Create `src/components/connections/connection-import-dialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { ConnectionExportPayload } from "../../lib/connection-import-export";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";

export type ConnectionImportDialogProps = {
  open: boolean;
  fileName: string;
  payload: ConnectionExportPayload | null;
  errorMessage: string | null;
  parsing: boolean;
  importing: boolean;
  onClose: () => void;
  onParse: (password: string) => void;
  onConfirm: () => void;
};

export function ConnectionImportDialog({
  open,
  fileName,
  payload,
  errorMessage,
  parsing,
  importing,
  onClose,
  onParse,
  onConfirm,
}: ConnectionImportDialogProps) {
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (open) {
      setPassword("");
    }
  }, [open, fileName]);

  const busy = parsing || importing;
  const canParse = password.trim() && !busy;
  const canImport = payload && !busy;

  return (
    <Dialog
      open={open}
      title="导入连接"
      description={`文件：${fileName}`}
      onClose={onClose}
      panelClassName="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          {payload ? (
            <Button onClick={onConfirm} disabled={!canImport}>
              {importing ? "导入中..." : "开始导入"}
            </Button>
          ) : (
            <Button onClick={() => onParse(password)} disabled={!canParse}>
              {parsing ? "解析中..." : "解析文件"}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5 text-sm leading-6 text-slate-600">
        <label className="block">
          <span className="mb-2 block font-semibold text-slate-700">导出密码</span>
          <Input
            type="password"
            autoFocus
            placeholder="输入加密导出时设置的密码"
            value={password}
            disabled={Boolean(payload)}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {payload ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950">
            <p>
              连接数量：<span className="font-semibold">{payload.connections.length}</span>
            </p>
            <p className="mt-1">
              SSH 通道数量：<span className="font-semibold">{payload.sshProfiles.length}</span>
            </p>
            <p className="mt-1">
              导出时间：<span className="font-semibold">{payload.exportedAt}</span>
            </p>
          </div>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500">
            输入密码后先解析文件，预览数量无误后再写入本机连接。
          </p>
        )}

        {errorMessage ? <p className="text-sm text-rose-600">{errorMessage}</p> : null}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add imports to connections page**

In `src/pages/connections-page-content.tsx`, add:

```ts
import { useRef } from "react";
import { ConnectionImportDialog } from "../components/connections/connection-import-dialog";
import {
  decryptConnectionExportFile,
  isEncryptedConnectionExportFile,
  parseConnectionImportPayload,
  type ConnectionExportPayload,
} from "../lib/connection-import-export";
```

If the file already imports `useMemo` and `useState` from React, change it to:

```ts
import { useMemo, useRef, useState } from "react";
```

Then merge the connection import/export helper import so there is only one import from `../lib/connection-import-export`.

- [ ] **Step 3: Read `importConnections` from app state and add import state**

In the `useAppState()` destructuring, add:

```ts
    importConnections,
```

Near export dialog state, add:

```ts
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importParsing, setImportParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    rawJson: unknown;
    payload: ConnectionExportPayload | null;
  } | null>(null);
```

- [ ] **Step 4: Add file selection and parse handlers**

Add these handlers near `handleConfirmExport`:

```ts
  async function handleImportFileSelected(file: File) {
    try {
      const rawJson = JSON.parse(await file.text());
      if (!isEncryptedConnectionExportFile(rawJson)) {
        parseConnectionImportPayload(rawJson);
      }

      setPendingImport({
        fileName: file.name,
        rawJson,
        payload: isEncryptedConnectionExportFile(rawJson) ? null : parseConnectionImportPayload(rawJson),
      });
      setImportError(null);
      setImportDialogOpen(true);
    } catch (error) {
      toast.error(extractUnknownErrorMessage(error, "无法读取导入文件"));
    }
  }

  async function handleParseImportFile(password: string) {
    if (!pendingImport) {
      return;
    }

    setImportParsing(true);
    setImportError(null);
    try {
      const payload = isEncryptedConnectionExportFile(pendingImport.rawJson)
        ? await decryptConnectionExportFile(pendingImport.rawJson, password)
        : parseConnectionImportPayload(pendingImport.rawJson);
      setPendingImport((current) => (current ? { ...current, payload } : current));
    } catch (error) {
      setImportError(extractUnknownErrorMessage(error, "导入文件解析失败"));
    } finally {
      setImportParsing(false);
    }
  }

  async function handleConfirmImport() {
    if (!pendingImport?.payload) {
      return;
    }

    setImporting(true);
    setImportError(null);
    try {
      const result = await importConnections(pendingImport.payload);
      setImportDialogOpen(false);
      setPendingImport(null);
      toast.success(`已导入 ${result.connectionsImported} 条连接和 ${result.sshProfilesImported} 条 SSH 通道。`);
    } catch (error) {
      setImportError(extractUnknownErrorMessage(error, "导入连接失败"));
    } finally {
      setImporting(false);
    }
  }
```

- [ ] **Step 5: Add import button and hidden file input**

In the connection toolbar, add this button before “新建连接”:

```tsx
                <Button
                  variant="outline"
                  className="h-8 rounded-lg px-2.5 text-xs"
                  onClick={() => importInputRef.current?.click()}
                >
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  导入
                </Button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) {
                      void handleImportFileSelected(file);
                    }
                  }}
                />
```

- [ ] **Step 6: Render import dialog**

Render this next to `ConnectionExportDialog`:

```tsx
      <ConnectionImportDialog
        open={importDialogOpen}
        fileName={pendingImport?.fileName ?? ""}
        payload={pendingImport?.payload ?? null}
        errorMessage={importError}
        parsing={importParsing}
        importing={importing}
        onClose={() => {
          if (!importParsing && !importing) {
            setImportDialogOpen(false);
            setPendingImport(null);
            setImportError(null);
          }
        }}
        onParse={handleParseImportFile}
        onConfirm={handleConfirmImport}
      />
```

- [ ] **Step 7: Run build**

Run:

```bash
pnpm build
```

Expected: build completes successfully.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/components/connections/connection-import-dialog.tsx src/pages/connections-page-content.tsx
git commit -m "添加连接解密导入界面"
```

---

### Task 6: Final verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm test src/lib/__tests__/export-crypto.test.ts src/lib/__tests__/request-export-crypto.test.ts src/lib/__tests__/connection-import-export.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only files from this plan are changed after the last task commit, or clean working tree if every task has been committed.

- [ ] **Step 5: Commit verification fixes if any were needed**

If Step 1, Step 2, or Step 3 required a fix, run:

```bash
git add src
git commit -m "修正连接导入导出验证问题"
```

Expected: commit succeeds with only feature-related files staged.

---

## Self-Review

Spec coverage:

- 加密导出：Task 1, Task 2, Task 4。
- 解密导入：Task 1, Task 2, Task 5。
- 包含 ES 与 SSH 凭据：Task 2, Task 3。
- 追加导入并生成新 ID：Task 2, Task 3。
- 不自动测试连接：Task 3 和 Task 5 没有调用 `testConnection` 或 `validateSshTunnel`。
- UI 状态与错误反馈：Task 4, Task 5。
- 验证命令：Task 6。

Placeholder scan:

- 本计划不包含占位标记、延后实现说明或省略式步骤。

Type consistency:

- `ConnectionExportPayload`、`EncryptedConnectionExportFile`、`buildConnectionImportPlan` 在 Task 2 定义，并在 Task 3 和 Task 5 复用。
- 页面导入的 `downloadExportContent` 保持来自 `src/lib/request-import-export.ts`。
- App state 使用现有 `saveConnectionSecret` 和 `saveConnectionSshSecret`，不新增 Tauri 命令。
