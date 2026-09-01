import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../types/connections";

const { executeEsHttpRequestMock } = vi.hoisted(() => ({
  executeEsHttpRequestMock: vi.fn(),
}));

vi.mock("../tauri", () => ({
  executeEsHttpRequest: executeEsHttpRequestMock,
  executeSshHttpRequest: vi.fn(),
}));

import { fetchServerStatus } from "../http-client";

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

describe("fetchServerStatus probes", () => {
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

  it("loads shard counts from cluster health and skips _cat/shards", async () => {
    const status = await fetchServerStatus(connection, { password: "secret" });
    const requestedUrls = executeEsHttpRequestMock.mock.calls.map(
      ([payload]) => (payload as { url: string }).url,
    );

    expect(requestedUrls).toEqual([
      "https://es.example.com:9200/_cluster/health?level=indices",
      "https://es.example.com:9200/_cat/indices?format=json&bytes=b&expand_wildcards=all&h=health,status,index,pri,rep,docs.count,docs.deleted,store.size,pri.store.size",
      "https://es.example.com:9200/_nodes/stats/os,jvm,fs,thread_pool,breaker,indices/indexing,search,merge,refresh,segments",
    ]);
    expect(requestedUrls.some((url) => url.includes("/_cat/shards"))).toBe(false);
    expect(status.indices[0]?.shardSummary).toMatchObject({
      started: 2,
      relocating: 0,
      initializing: 0,
      unassigned: 0,
    });
  });
});
