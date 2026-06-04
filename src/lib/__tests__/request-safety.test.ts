import { describe, expect, it } from "vitest";
import { parseConsoleRequest } from "../console-parser";
import { classifyRequestSafety } from "../request-safety";
import type { ConnectionProfile } from "../../types/connections";

const baseConnection = {
  id: "conn-1",
  name: "生产",
  baseUrl: "https://es.example.com",
  username: "elastic",
  auth: { type: "basic" },
  tls: { mode: "default" },
  environment: "prod",
  readonly: false,
  insecureTls: false,
  sshProfileId: null,
  createdAt: "2026-06-03T00:00:00.000Z",
  updatedAt: "2026-06-03T00:00:00.000Z",
  lastUsedAt: "2026-06-03T00:00:00.000Z",
} satisfies ConnectionProfile;

function classify(content: string, connection: ConnectionProfile = baseConnection) {
  return classifyRequestSafety(parseConsoleRequest(content), connection);
}

describe("classifyRequestSafety", () => {
  it("treats read requests as safe", () => {
    expect(classify("GET /_cluster/health")).toMatchObject({
      level: "safe",
      blocked: false,
      requiresConfirmation: false,
      auditOnSuccess: false,
    });
  });

  it("allows read-only connections to execute POST search requests", () => {
    const result = classify("POST /orders/_search\n{\"query\":{\"match_all\":{}}}", {
      ...baseConnection,
      readonly: true,
    });

    expect(result.level).toBe("safe");
    expect(result.blocked).toBe(false);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.auditOnSuccess).toBe(false);
  });

  it("requires confirmation for production destructive wildcard deletes", () => {
    const result = classify("DELETE /*");

    expect(result.level).toBe("destructive");
    expect(result.requiresConfirmation).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.auditOnSuccess).toBe(true);
    expect(result.reasons).toContain("DELETE 通配符或 _all 会删除大量索引。");
  });

  it("requires confirmation and audit for production bulk writes", () => {
    const result = classify("POST /orders/_bulk\n{\"index\":{}}\n{\"id\":1}");

    expect(result.level).toBe("write");
    expect(result.requiresConfirmation).toBe(true);
    expect(result.auditOnSuccess).toBe(true);
    expect(result.reasons).toContain("生产环境写入请求需要确认。");
  });

  it("blocks writes on readonly connections", () => {
    const result = classify("POST /orders/_bulk\n{\"index\":{}}\n{\"id\":1}", {
      ...baseConnection,
      readonly: true,
    });

    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("当前连接为只读模式，禁止执行写入或管理类请求。");
  });

  it("classifies cluster settings changes as cluster admin", () => {
    const result = classify(`PUT /_cluster/settings
{
  "persistent": {
    "indices.recovery.max_bytes_per_sec": "80mb"
  }
}`);

    expect(result.level).toBe("clusterAdmin");
    expect(result.requiresConfirmation).toBe(true);
    expect(result.auditOnSuccess).toBe(true);
  });
});
