import { describe, expect, it } from "vitest";
import {
  buildExportFilename,
  buildImportedRequests,
  buildRequestExportPayload,
  parseRequestImportPayload,
  serializeRequestExportPayload,
} from "../request-import-export";
import type { SavedRequest } from "../../types/requests";

function createRequest(id: string, connectionId: string, name: string): SavedRequest {
  return {
    id,
    connectionId,
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

describe("request import export", () => {
  it("builds and parses export payload", () => {
    const payload = buildRequestExportPayload("生产集群", [createRequest("request-1", "conn-1", "健康检查")]);
    const serialized = serializeRequestExportPayload(payload);
    const parsed = parseRequestImportPayload(JSON.parse(serialized));

    expect(parsed.connectionName).toBe("生产集群");
    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0]?.name).toBe("健康检查");
  });

  it("merges imported requests with new ids and sort orders", () => {
    const existing = [createRequest("request-1", "conn-1", "已有请求")];
    const next = buildImportedRequests(
      "conn-1",
      [
        {
          name: "导入请求",
          method: "POST",
          path: "/logs/_search",
          body: "{}",
          tags: ["排障"],
          sortOrder: 0,
        },
      ],
      existing,
      "merge",
      "2026-05-27T01:00:00.000Z",
    );

    expect(next).toHaveLength(2);
    expect(next.some((item) => item.name === "导入请求" && item.id !== "request-1")).toBe(true);
  });

  it("replaces existing connection requests on replace mode", () => {
    const existing = [createRequest("request-1", "conn-1", "已有请求"), createRequest("request-2", "conn-2", "其他")];
    const next = buildImportedRequests(
      "conn-1",
      [
        {
          name: "新请求",
          method: "GET",
          path: "/",
          body: "",
          tags: [],
          sortOrder: 0,
        },
      ],
      existing,
      "replace",
    );

    expect(next.filter((item) => item.connectionId === "conn-1")).toHaveLength(1);
    expect(next.find((item) => item.connectionId === "conn-2")?.name).toBe("其他");
  });

  it("builds safe export filename", () => {
    expect(buildExportFilename("生产 集群", new Date("2026-05-27T08:00:00.000Z"))).toBe(
      "esx-requests-生产-集群-2026-05-27.json",
    );
  });
});
