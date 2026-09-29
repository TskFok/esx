import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../types/connections";
import { parseConsoleRequest } from "../console-parser";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, Channel: class {} }));
import { executeConsoleRequest, executeAdminOperation, fetchConnectionSearchMetadata, fetchClusterOverview, testConnection } from "../http-client";
import { executeSshHttpRequest } from "../tauri";
import { buildResponseSnapshot } from "../response-snapshot";

const connection: ConnectionProfile = {
  id: "transport", name: "测试", baseUrl: "http://localhost:9200", username: "test",
  auth: { type: "basic" }, tls: { mode: "default" }, environment: "dev", readonly: false,
  insecureTls: false, sshProfileId: null, createdAt: "", updatedAt: "", lastUsedAt: "",
};
const tunnel = { host: "localhost", port: 22, username: "test", authMethod: "password" as const,
  privateKeyPath: "", hostKeyPolicy: "strict" as const, trustedHostKeySha256: "fixture" };
const credentials = { password: "fixture" };
const response = { ok: true, status: 200, statusText: "OK", bodyText: "{}" };
beforeEach(() => { invokeMock.mockReset().mockResolvedValue(response); });

describe("native response modes", () => {
  it("sends Console preview limits and preserves native size and truncation", async () => {
    invokeMock.mockResolvedValue({ ...response, totalBytes: 100000, truncated: true });
    const snapshot = await executeConsoleRequest(connection, credentials, parseConsoleRequest("GET /"), null, { responsePreviewBytes: 32768 });
    expect(invokeMock).toHaveBeenCalledWith("execute_es_http_request", { payload: expect.objectContaining({ readMode: "preview", previewBytes: 32768 }) });
    expect(snapshot).toMatchObject({ sizeBytes: 100000, truncated: true, bodyPreview: "{}", isJson: false, prettyPreview: undefined });
  });

  it("defaults the Console preview limit and keeps legacy snapshot compatibility", async () => {
    const snapshot = await executeConsoleRequest(connection, credentials, parseConsoleRequest("GET /"));
    expect(invokeMock.mock.calls[0][1].payload).toMatchObject({ readMode: "preview", previewBytes: 256 * 1024 });
    expect(snapshot).toMatchObject({ sizeBytes: 2, truncated: false, isJson: true });
    const native = buildResponseSnapshot({ ...response, durationMs: 0, executedAt: "", totalBytes: 10 });
    expect(native).toMatchObject({ sizeBytes: 10, truncated: true, prettyPreview: undefined });
  });

  it("keeps metadata, status, administration and connection probes in full mode", async () => {
    invokeMock.mockImplementation(async (_command, { payload }) => ({ ...response, bodyText: payload.url.endsWith("/_cat/indices?format=json") ? "[]" : '{"cluster_name":"fixture","version":{"number":"8.0.0"}}' }));
    await fetchConnectionSearchMetadata(connection, credentials);
    await fetchClusterOverview(connection, credentials);
    await executeAdminOperation(connection, credentials, { method: "GET", path: "/", bodyText: "" } as any);
    await testConnection(connection, credentials.password);
    expect(invokeMock.mock.calls.length).toBeGreaterThan(4);
    for (const [, args] of invokeMock.mock.calls) expect(args.payload.readMode).toBe("full");
  });

  it("propagates SSH abort once and rejects without a failed/success snapshot", async () => {
    invokeMock.mockImplementation((command) => command === "execute_ssh_http_request" ? new Promise(() => {}) : Promise.resolve());
    const controller = new AbortController();
    const pending = executeConsoleRequest(connection, credentials, parseConsoleRequest("GET /"), tunnel, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); controller.abort();
    await assertion;
    expect(invokeMock.mock.calls.filter(([command]) => command === "cancel_ssh_http_request")).toEqual([
      ["cancel_ssh_http_request", { requestId: invokeMock.mock.calls[0][1].payload.requestId }],
    ]);
  });

  it("does not invoke an already aborted SSH request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(executeSshHttpRequest({} as any, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

it("uses native byte counts even when charset decoding expands the text", () => {
  const snapshot = buildResponseSnapshot({ ...response, bodyText: "é", durationMs: 0, executedAt: "", totalBytes: 1, truncated: false });
  expect(snapshot.sizeBytes).toBe(1);
  expect(snapshot.truncated).toBe(false);
});
