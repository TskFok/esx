import { describe, expect, it } from "vitest";
import {
  buildEncryptedExportFilename,
  decryptRequestExportFile,
  encryptRequestExportPayload,
  isEncryptedRequestExportFile,
} from "../request-export-crypto";
import { buildRequestExportPayload } from "../request-import-export";
import type { SavedRequest } from "../../types/requests";

function createRequest(name: string): SavedRequest {
  return {
    id: "request-1",
    connectionId: "conn-1",
    name,
    method: "GET",
    path: "/_cluster/health",
    body: "",
    tags: ["巡检"],
    sortOrder: 0,
    updatedAt: "2026-05-27T00:00:00.000Z",
    lastStatus: null,
    lastDurationMs: null,
    lastResponse: null,
  };
}

describe("request export crypto", () => {
  it("encrypts and decrypts export payload", async () => {
    const payload = buildRequestExportPayload("生产集群", [createRequest("健康检查")]);
    const encrypted = await encryptRequestExportPayload(payload, "test-password");
    expect(isEncryptedRequestExportFile(encrypted)).toBe(true);

    const decrypted = await decryptRequestExportFile(encrypted, "test-password");
    expect(decrypted.connectionName).toBe("生产集群");
    expect(decrypted.requests[0]?.name).toBe("健康检查");
  });

  it("rejects wrong password", async () => {
    const payload = buildRequestExportPayload("生产集群", [createRequest("健康检查")]);
    const encrypted = await encryptRequestExportPayload(payload, "right-password");

    await expect(decryptRequestExportFile(encrypted, "wrong-password")).rejects.toThrow("密码错误或文件已损坏。");
  });

  it("builds encrypted export filename", () => {
    expect(buildEncryptedExportFilename("生产集群", new Date("2026-05-27T08:00:00.000Z"))).toBe(
      "esx-requests-生产集群-2026-05-27.encrypted.json",
    );
  });
});
