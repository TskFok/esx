import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../types/connections";

const { executeEsHttpRequestMock } = vi.hoisted(() => ({
  executeEsHttpRequestMock: vi.fn(),
}));

vi.mock("../tauri", () => ({
  executeEsHttpRequest: executeEsHttpRequestMock,
  executeSshHttpRequest: vi.fn(),
}));

import { fetchClusterOverview, fetchIndicesStatus, fetchOperationsStatus } from "../http-client";

const connection = {
  id: "conn-1",
  name: "开发集群",
  baseUrl: "https://es.example.com:9200",
  username: "elastic",
  auth: { type: "basic" },
  tls: { mode: "default" },
  environment: "dev",
  readonly: false,
  insecureTls: false,
  sshProfileId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastUsedAt: "2026-09-01T00:00:00.000Z",
} satisfies ConnectionProfile;

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    bodyText: JSON.stringify(body),
  };
}

describe("server status probes", () => {
  beforeEach(() => {
    executeEsHttpRequestMock.mockReset();
    executeEsHttpRequestMock.mockImplementation(async (payload: { url: string }) => {
      if (payload.url.includes("/_cluster/health")) {
        return okResponse({
          cluster_name: "logs",
          status: "green",
          number_of_nodes: 1,
          active_shards: 2,
          relocating_shards: 0,
          initializing_shards: 0,
          unassigned_shards: 0,
          indices: {
            orders: {
              status: "green",
              active_shards: 2,
              relocating_shards: 0,
              initializing_shards: 0,
              unassigned_shards: 0,
            },
          },
        });
      }

      if (payload.url.includes("/_cat/indices")) {
        return okResponse([
          {
            health: "green",
            status: "open",
            index: "orders",
            pri: "1",
            rep: "1",
            "docs.count": "10",
            "docs.deleted": "0",
            "store.size": "100",
            "pri.store.size": "50",
          },
        ]);
      }

      if (payload.url.includes("/_nodes/stats")) {
        return okResponse({ nodes: {} });
      }

      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        bodyText: "unexpected probe",
      };
    });
  });

  it("fetchClusterOverview only probes cluster health", async () => {
    const status = await fetchClusterOverview(connection, { password: "secret" });
    const requestedUrls = executeEsHttpRequestMock.mock.calls.map(
      ([payload]) => (payload as { url: string }).url,
    );

    expect(requestedUrls).toEqual(["https://es.example.com:9200/_cluster/health?level=indices"]);
    expect(status.cluster.name).toBe("logs");
    expect(status.summary.shardCounts.started).toBe(2);
  });

  it("fetchIndicesStatus only probes cat indices", async () => {
    const status = await fetchIndicesStatus(connection, { password: "secret" });
    const requestedUrls = executeEsHttpRequestMock.mock.calls.map(
      ([payload]) => (payload as { url: string }).url,
    );

    expect(requestedUrls).toEqual([
      "https://es.example.com:9200/_cat/indices?format=json&bytes=b&expand_wildcards=all&h=health,status,index,pri,rep,docs.count,docs.deleted,store.size,pri.store.size",
    ]);
    expect(status.indices[0]?.name).toBe("orders");
  });

  it("fetchOperationsStatus only probes nodes stats", async () => {
    const status = await fetchOperationsStatus(connection, { password: "secret" });
    const requestedUrls = executeEsHttpRequestMock.mock.calls.map(
      ([payload]) => (payload as { url: string }).url,
    );

    expect(requestedUrls).toEqual([
      "https://es.example.com:9200/_nodes/stats/os,jvm,fs,thread_pool,breaker,indices/indexing,search,merge,refresh,segments",
    ]);
    expect(status.operations.nodeCount).toBe(0);
  });

  it("does not call the other probes when cluster health fails", async () => {
    executeEsHttpRequestMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      bodyText: "nope",
    });

    await expect(fetchClusterOverview(connection, { password: "secret" })).rejects.toThrow(/权限/);
    expect(executeEsHttpRequestMock).toHaveBeenCalledOnce();
  });

  it("throws when the indices probe fails", async () => {
    executeEsHttpRequestMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      bodyText: "nope",
    });

    await expect(fetchIndicesStatus(connection, { password: "secret" })).rejects.toThrow(/权限/);
    expect(executeEsHttpRequestMock).toHaveBeenCalledOnce();
  });

  it("returns a partial failure when the operations probe fails", async () => {
    executeEsHttpRequestMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      bodyText: "nope",
    });

    const status = await fetchOperationsStatus(connection, { password: "secret" });

    expect(executeEsHttpRequestMock).toHaveBeenCalledOnce();
    expect(status.operations.nodeCount).toBe(0);
    expect(status.partialFailures).toEqual([
      expect.stringContaining("探测 节点运维指标 /_nodes/stats/"),
      expect.stringContaining("错误摘要：nope"),
    ]);
  });
});
