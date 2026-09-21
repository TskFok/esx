import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../types/connections";
import { parseConsoleRequest } from "../console-parser";

const { sendEs, sendSsh } = vi.hoisted(() => ({ sendEs: vi.fn(), sendSsh: vi.fn() }));
vi.mock("../tauri", () => ({ executeEsHttpRequest: sendEs, executeSshHttpRequest: sendSsh }));

import { executeConsoleRequest } from "../http-client";

const connection: ConnectionProfile = {
  id: "review", name: "测试", baseUrl: "https://cluster.example.invalid:9200/prefix", username: "test",
  auth: { type: "apiKey" }, tls: { mode: "default" }, environment: "prod", readonly: true,
  insecureTls: false, sshProfileId: null, createdAt: "", updatedAt: "", lastUsedAt: "",
};
const credentials = { password: "", authSecret: "test-only-key" };

beforeEach(() => {
  sendEs.mockReset().mockResolvedValue({ ok: true, status: 200, statusText: "OK", bodyText: "{}" });
  sendSsh.mockReset().mockResolvedValue({ ok: true, status: 200, statusText: "OK", bodyText: "{}" });
});

describe("Elasticsearch credential destination", () => {
  it.each([
    "https://other.example.invalid/collect",
    "http://cluster.example.invalid:9200/collect",
    "https://cluster.example.invalid:9201/collect",
    "https://test:password@cluster.example.invalid:9200/collect",
    "//other.example.invalid/collect",
    "\\\\other.example.invalid/collect",
  ])("does not send credentials to an untrusted target: %s", async (target) => {
    const result = await executeConsoleRequest(connection, credentials, parseConsoleRequest(`GET ${target}`));
    expect(result.ok).toBe(false);
    expect(sendEs).not.toHaveBeenCalled();
    expect(sendSsh).not.toHaveBeenCalled();
  });

  it("preserves a base path and forwards the trusted base URL", async () => {
    const result = await executeConsoleRequest(connection, credentials, parseConsoleRequest("GET /_cluster/health"));
    expect(result.ok).toBe(true);
    expect(sendEs).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "https://cluster.example.invalid:9200/prefix",
      url: "https://cluster.example.invalid:9200/prefix/_cluster/health",
    }));
  });

  it("allows an absolute URL on the selected connection origin", async () => {
    const result = await executeConsoleRequest(connection, credentials,
      parseConsoleRequest("GET https://cluster.example.invalid:9200/_cluster/health"));
    expect(result.ok).toBe(true);
    expect(sendEs).toHaveBeenCalledOnce();
  });

  it("rejects embedded base URL credentials before invoking native HTTP", async () => {
    const result = await executeConsoleRequest({ ...connection, baseUrl: "https://test:fake-password@cluster.example.invalid" },
      credentials, parseConsoleRequest("GET /_cluster/health"));
    expect(result.ok).toBe(false);
    expect(sendEs).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("fake-password");
  });

  it("forwards SSH host identity and TLS policy to native transport", async () => {
    const tunnel = { host: "jump.example.invalid", port: 22, username: "test", authMethod: "password" as const,
      privateKeyPath: "", hostKeyPolicy: "strict" as const, trustedHostKeySha256: "SHA256:test-pin" };
    await executeConsoleRequest({ ...connection, tls: { mode: "certificateFingerprint", fingerprint: "SHA256:tls-pin" } },
      credentials, parseConsoleRequest("GET /_cluster/health"), tunnel);
    expect(sendSsh).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: connection.baseUrl, sshTunnel: tunnel,
      tls: { mode: "certificateFingerprint", fingerprint: "SHA256:tls-pin" },
    }));
  });
});
