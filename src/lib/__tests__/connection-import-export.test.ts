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

  it("exports unused ssh profiles for full connection management backup", async () => {
    const payload = await buildConnectionExportPayload({
      connections: [createConnection({ sshProfileId: null })],
      sshProfiles: [
        createSshProfile(),
        createSshProfile({ id: "ssh-unused", name: "备用跳板机" }),
      ],
      getConnectionSecret: async () => "elastic:secret",
      getSshSecret: async (profile) => `${profile.id}-secret`,
      exportedAt: timestamp,
    });

    expect(payload.sshProfiles.map((profile) => profile.id)).toEqual(["ssh-1", "ssh-unused"]);
    expect(payload.sshProfiles.map((profile) => profile.secret)).toEqual(["ssh-1-secret", "ssh-unused-secret"]);
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
