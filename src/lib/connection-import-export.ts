import {
  decryptJsonPayload,
  encryptJsonPayload,
  isEncryptedJsonFile,
  serializeEncryptedJsonFile,
  type EncryptedJsonExportFile,
} from "./export-crypto";
import {
  normalizeAuthConfig,
  normalizeConnectionProfileSecurity,
  normalizeTlsConfig,
} from "./connection-security";
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
    input.sshProfiles.map(async (profile) => ({
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
