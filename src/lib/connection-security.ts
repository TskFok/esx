import type {
  ConnectionAuthConfig,
  ConnectionAuthType,
  ConnectionEnvironment,
  ConnectionProfile,
  ConnectionTlsConfig,
  SshHostKeyPolicy,
  SshProfile,
} from "../types/connections";
import { toBase64 } from "./utils";

export const AUTH_SECRET_KEYS = {
  basic: (username: string) => `auth-basic:${username.trim()}`,
  apiKey: () => "auth-api-key",
  bearer: () => "auth-bearer-token",
} as const;

type ConnectionSecurityValidationOptions = {
  allowInsecureProductionTls?: boolean;
};

type SshHostKeyValidationResult = {
  ok: boolean;
  trustedHostKeySha256: string | null;
  changed: boolean;
  errorMessage?: string;
};

export function getAuthSecretKey(auth: ConnectionAuthConfig, username: string) {
  if (auth.type === "apiKey") {
    return AUTH_SECRET_KEYS.apiKey();
  }
  if (auth.type === "bearer") {
    return AUTH_SECRET_KEYS.bearer();
  }
  return AUTH_SECRET_KEYS.basic(username);
}

export function buildAuthorizationHeader(auth: ConnectionAuthConfig, secret: string) {
  const trimmedSecret = secret.trim();
  if (auth.type === "apiKey") {
    return `ApiKey ${trimmedSecret}`;
  }
  if (auth.type === "bearer") {
    return `Bearer ${trimmedSecret}`;
  }
  return `Basic ${toBase64(trimmedSecret)}`;
}

export function normalizeAuthConfig(value: unknown): ConnectionAuthConfig {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const type = (value as Record<string, unknown>).type;
    if (type === "basic" || type === "apiKey" || type === "bearer") {
      return { type };
    }
  }
  return { type: "basic" };
}

export function normalizeTlsConfig(value: unknown, legacyInsecureTls?: boolean): ConnectionTlsConfig {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const mode = record.mode;
    if (mode === "default" || mode === "insecure" || mode === "caCertificate" || mode === "certificateFingerprint") {
      return {
        mode,
        caPath: typeof record.caPath === "string" && record.caPath.trim() ? record.caPath.trim() : undefined,
        fingerprint: typeof record.fingerprint === "string" && record.fingerprint.trim() ? record.fingerprint.trim() : undefined,
      };
    }
  }
  return { mode: legacyInsecureTls ? "insecure" : "default" };
}

function normalizeEnvironment(value: unknown): ConnectionEnvironment {
  return value === "dev" || value === "test" || value === "staging" || value === "prod" ? value : "dev";
}

export function normalizeConnectionProfileSecurity(connection: ConnectionProfile): ConnectionProfile {
  const tls = normalizeTlsConfig(connection.tls, connection.insecureTls);
  return {
    ...connection,
    auth: normalizeAuthConfig(connection.auth),
    tls,
    environment: normalizeEnvironment(connection.environment),
    readonly: typeof connection.readonly === "boolean" ? connection.readonly : false,
    insecureTls: tls.mode === "insecure",
  };
}

export function validateConnectionSecurity(
  connection: ConnectionProfile,
  options: ConnectionSecurityValidationOptions = {},
) {
  const warnings: string[] = [];
  if (connection.environment === "prod" && connection.tls.mode === "insecure" && !options.allowInsecureProductionTls) {
    warnings.push("生产连接不允许使用跳过 TLS 校验。");
  }
  if (connection.tls.mode === "caCertificate" && !connection.tls.caPath?.trim()) {
    warnings.push("CA 证书模式需要填写 CA 证书路径。");
  }
  if (connection.tls.mode === "certificateFingerprint" && !connection.tls.fingerprint?.trim()) {
    warnings.push("证书指纹模式需要填写 SHA256 指纹。");
  }
  return {
    ok: warnings.length === 0,
    warnings,
  };
}

function normalizeSshHostKeyPolicy(value: unknown): SshHostKeyPolicy {
  return value === "strict" || value === "trustOnFirstUse" ? value : "trustOnFirstUse";
}

export function normalizeSshProfileSecurity(profile: SshProfile): SshProfile {
  return {
    ...profile,
    hostKeyPolicy: normalizeSshHostKeyPolicy(profile.hostKeyPolicy),
    trustedHostKeySha256:
      typeof profile.trustedHostKeySha256 === "string" && profile.trustedHostKeySha256.trim()
        ? profile.trustedHostKeySha256.trim()
        : null,
  };
}

export function validateSshHostKey(profile: SshProfile, currentHostKeySha256: string | null): SshHostKeyValidationResult {
  const current = currentHostKeySha256?.trim() || null;
  const trusted = profile.trustedHostKeySha256?.trim() || null;
  if (!current) {
    return {
      ok: false,
      trustedHostKeySha256: trusted,
      changed: false,
      errorMessage: "SSH 服务端未返回可校验的主机指纹。",
    };
  }
  if (!trusted && profile.hostKeyPolicy === "trustOnFirstUse") {
    return {
      ok: true,
      trustedHostKeySha256: current,
      changed: false,
    };
  }
  if (!trusted) {
    return {
      ok: false,
      trustedHostKeySha256: null,
      changed: false,
      errorMessage: "严格 SSH 指纹校验需要先保存可信指纹。",
    };
  }
  if (trusted !== current) {
    return {
      ok: false,
      trustedHostKeySha256: trusted,
      changed: true,
      errorMessage: "SSH 主机指纹发生变化，请确认跳板机身份后重新信任。",
    };
  }
  return {
    ok: true,
    trustedHostKeySha256: trusted,
    changed: false,
  };
}

export function getAuthSecretFromForm(input: {
  authType: ConnectionAuthType;
  username: string;
  password: string;
  apiKey: string;
  bearerToken: string;
}) {
  if (input.authType === "apiKey") {
    return input.apiKey.trim();
  }
  if (input.authType === "bearer") {
    return input.bearerToken.trim();
  }
  return input.username.trim() && input.password ? `${input.username.trim()}:${input.password}` : "";
}
