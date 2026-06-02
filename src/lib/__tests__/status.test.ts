import { describe, expect, it } from "vitest";
import {
  buildServerStatus,
  filterStatusIndices,
  sortStatusIndices,
} from "../status";

describe("server status parsing", () => {
  it("parses cluster health and index statistics into a status snapshot", () => {
    const status = buildServerStatus({
      clusterHealthText: JSON.stringify({
        cluster_name: "logs-prod",
        status: "yellow",
        number_of_nodes: 3,
        active_primary_shards: 18,
        active_shards: 32,
        relocating_shards: 1,
        initializing_shards: 2,
        unassigned_shards: 4,
      }),
      indicesText: JSON.stringify([
        {
          health: "green",
          status: "open",
          index: "orders-2026",
          pri: "3",
          rep: "1",
          "docs.count": "1200",
          "docs.deleted": "12",
          "store.size": "2048",
          "pri.store.size": "1024",
        },
        {
          health: "yellow",
          status: "open",
          index: "users",
          pri: "1",
          rep: "1",
          "docs.count": "300",
          "docs.deleted": "0",
          "store.size": "512",
          "pri.store.size": "256",
        },
      ]),
      shardsText: JSON.stringify([
        { index: "orders-2026", state: "STARTED" },
        { index: "orders-2026", state: "RELOCATING" },
        { index: "users", state: "UNASSIGNED" },
        { index: "users", state: "INITIALIZING" },
      ]),
      fetchedAt: "2026-05-01T10:00:00.000Z",
    });

    expect(status.cluster.name).toBe("logs-prod");
    expect(status.cluster.health).toBe("yellow");
    expect(status.cluster.nodes).toBe(3);
    expect(status.summary.totalIndices).toBe(2);
    expect(status.summary.visibleStoreBytes).toBe(2560);
    expect(status.summary.visibleDocsCount).toBe(1500);
    expect(status.summary.healthCounts).toEqual({ green: 1, yellow: 1, red: 0, unknown: 0 });
    expect(status.summary.shardCounts).toMatchObject({
      started: 1,
      relocating: 1,
      initializing: 1,
      unassigned: 1,
    });
    expect(status.indices[0]).toMatchObject({
      name: "orders-2026",
      health: "green",
      status: "open",
      primaryShards: 3,
      replicaShards: 1,
      docsCount: 1200,
      storeBytes: 2048,
      primaryStoreBytes: 1024,
      shardSummary: {
        started: 1,
        relocating: 1,
        initializing: 0,
        unassigned: 0,
      },
    });
  });

  it("handles red health, closed indices, missing numbers, and partial shard failures", () => {
    const status = buildServerStatus({
      clusterHealthText: JSON.stringify({
        cluster_name: "broken",
        status: "red",
        number_of_nodes: "2",
        active_shards: "7",
      }),
      indicesText: JSON.stringify([
        {
          health: "red",
          status: "close",
          index: "archive",
          pri: "1",
          rep: "0",
          "docs.count": "-",
          "docs.deleted": "",
          "store.size": null,
          "pri.store.size": undefined,
        },
      ]),
      shardsText: null,
      shardDiagnostics: ["分片接口返回 403"],
      fetchedAt: "2026-05-01T10:00:00.000Z",
    });

    expect(status.cluster.health).toBe("red");
    expect(status.cluster.nodes).toBe(2);
    expect(status.indices[0]).toMatchObject({
      name: "archive",
      health: "red",
      status: "close",
      docsCount: null,
      docsDeleted: null,
      storeBytes: null,
      primaryStoreBytes: null,
    });
    expect(status.partialFailures).toEqual(["分片接口返回 403"]);
  });
});

describe("server status index list helpers", () => {
  const status = buildServerStatus({
    clusterHealthText: JSON.stringify({ cluster_name: "demo", status: "green" }),
    indicesText: JSON.stringify([
      { health: "green", status: "open", index: "orders", "docs.count": "200", "store.size": "2048" },
      { health: "red", status: "open", index: "payments", "docs.count": "50", "store.size": "4096" },
      { health: "yellow", status: "open", index: ".security", "docs.count": "1000", "store.size": "512" },
    ]),
    fetchedAt: "2026-05-01T10:00:00.000Z",
  });

  it("hides system indices by default and filters by name", () => {
    expect(filterStatusIndices(status.indices, { query: "", showSystemIndices: false }).map((item) => item.name))
      .toEqual(["orders", "payments"]);
    expect(filterStatusIndices(status.indices, { query: "pay", showSystemIndices: true }).map((item) => item.name))
      .toEqual(["payments"]);
  });

  it("sorts indices by health, document count, and store size", () => {
    expect(sortStatusIndices(status.indices, { key: "health", direction: "desc" }).map((item) => item.name))
      .toEqual(["payments", ".security", "orders"]);
    expect(sortStatusIndices(status.indices, { key: "docs", direction: "desc" }).map((item) => item.name))
      .toEqual([".security", "orders", "payments"]);
    expect(sortStatusIndices(status.indices, { key: "store", direction: "asc" }).map((item) => item.name))
      .toEqual([".security", "orders", "payments"]);
  });
});
