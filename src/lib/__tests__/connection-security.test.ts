import { describe, expect, it } from "vitest";
import {
  AUTH_SECRET_KEYS,
  buildAuthorizationHeader,
  normalizeConnectionProfileSecurity,
  normalizeSshProfileSecurity,
  validateConnectionSecurity,
  validateSshHostKey,
} from "../connection-security";
import type { ConnectionProfile, SshProfile } from "../../types/connections";

const timestamp = "2026-06-03T00:00:00.000Z";

function legacyConnection(overrides: Partial<ConnectionProfile> = {}) {
  return {
    id: "conn-1",
    name: "生产集群",
    baseUrl: "https://es.example.com:9200",
    username: "elastic",
    insecureTls: false,
    sshProfileId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: timestamp,
    ...overrides,
  } as ConnectionProfile;
}

function legacySshProfile(overrides: Partial<SshProfile> = {}) {
  return {
    id: "ssh-1",
    name: "跳板机",
    tunnel: {
      host: "jump.example.com",
      port: 22,
      username: "ops",
      authMethod: "password",
      privateKeyPath: "",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastVerifiedAt: timestamp,
    ...overrides,
  } as SshProfile;
}

describe("connection security helpers", () => {
  it("migrates legacy basic connections into schema v2 security fields", () => {
    const normalized = normalizeConnectionProfileSecurity(legacyConnection({ insecureTls: true }));

    expect(normalized.auth).toEqual({ type: "basic" });
    expect(normalized.tls).toEqual({ mode: "insecure" });
    expect(normalized.environment).toBe("dev");
    expect(normalized.readonly).toBe(false);
  });

  it("builds authorization headers for supported auth types", () => {
    expect(buildAuthorizationHeader({ type: "basic" }, "elastic:secret")).toBe("Basic ZWxhc3RpYzpzZWNyZXQ=");
    expect(buildAuthorizationHeader({ type: "apiKey" }, "encoded-key")).toBe("ApiKey encoded-key");
    expect(buildAuthorizationHeader({ type: "bearer" }, "token")).toBe("Bearer token");
  });

  it("uses stable secret keys for each auth type", () => {
    expect(AUTH_SECRET_KEYS.basic("elastic")).toBe("auth-basic:elastic");
    expect(AUTH_SECRET_KEYS.apiKey()).toBe("auth-api-key");
    expect(AUTH_SECRET_KEYS.bearer()).toBe("auth-bearer-token");
  });

  it("blocks insecure TLS on production unless explicitly allowed", () => {
    const connection = normalizeConnectionProfileSecurity(legacyConnection({
      environment: "prod",
      tls: { mode: "insecure" },
    }));

    expect(validateConnectionSecurity(connection)).toEqual({
      ok: false,
      warnings: ["生产连接不允许使用跳过 TLS 校验。"],
    });
    expect(validateConnectionSecurity(connection, { allowInsecureProductionTls: true }).ok).toBe(true);
  });

  it("normalizes SSH host key policy and validates pinned fingerprints", () => {
    const profile = normalizeSshProfileSecurity(legacySshProfile());
    expect(profile.hostKeyPolicy).toBe("trustOnFirstUse");
    expect(profile.trustedHostKeySha256).toBeNull();

    expect(validateSshHostKey(profile, "SHA256:abc")).toEqual({
      ok: true,
      trustedHostKeySha256: "SHA256:abc",
      changed: false,
    });

    const pinned = normalizeSshProfileSecurity(legacySshProfile({ trustedHostKeySha256: "SHA256:abc" }));
    expect(validateSshHostKey(pinned, "SHA256:def")).toEqual({
      ok: false,
      trustedHostKeySha256: "SHA256:abc",
      changed: true,
      errorMessage: "SSH 主机指纹发生变化，请确认跳板机身份后重新信任。",
    });
  });
});
