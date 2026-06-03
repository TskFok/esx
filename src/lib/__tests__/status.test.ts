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

  it("summarizes node stats for operational metrics", () => {
    const status = buildServerStatus({
      clusterHealthText: JSON.stringify({ cluster_name: "ops", status: "green", number_of_nodes: 2 }),
      indicesText: JSON.stringify([]),
      nodesStatsText: JSON.stringify({
        nodes: {
          node_a: {
            name: "hot-1",
            os: { cpu: { percent: 68 } },
            jvm: {
              mem: {
                heap_used_percent: 72,
                heap_used_in_bytes: 720,
                heap_max_in_bytes: 1000,
              },
              gc: {
                collectors: {
                  young: { collection_count: 10, collection_time_in_millis: 500 },
                  old: { collection_count: 2, collection_time_in_millis: 300 },
                },
              },
            },
            fs: {
              total: {
                total_in_bytes: 1000,
                free_in_bytes: 40,
                available_in_bytes: 120,
              },
            },
            thread_pool: {
              search: { active: 3, queue: 4, rejected: 5, completed: 100 },
              write: { active: 2, queue: 1, rejected: 1, completed: 200 },
            },
            breakers: {
              request: {
                estimated_size_in_bytes: 300,
                limit_size_in_bytes: 600,
                tripped: 2,
              },
            },
            indices: {
              segments: { count: 30, memory_in_bytes: 3000 },
              merges: { current: 1, total: 8, total_time_in_millis: 1600 },
              refresh: { total: 50, total_time_in_millis: 250 },
              search: {
                query_total: 1000,
                query_time_in_millis: 2000,
                fetch_total: 400,
                fetch_time_in_millis: 800,
              },
              indexing: {
                index_total: 700,
                index_time_in_millis: 1400,
                delete_total: 20,
                delete_time_in_millis: 60,
              },
            },
          },
          node_b: {
            name: "hot-2",
            os: { cpu: { percent: 42 } },
            jvm: {
              mem: {
                heap_used_percent: 54,
                heap_used_in_bytes: 540,
                heap_max_in_bytes: 1000,
              },
            },
            fs: {
              total: {
                total_in_bytes: 2000,
                free_in_bytes: 600,
                available_in_bytes: 500,
              },
            },
            thread_pool: {
              search: { active: 1, queue: 2, rejected: 0, completed: 80 },
            },
            breakers: {
              fielddata: {
                estimated_size_in_bytes: 100,
                limit_size_in_bytes: 500,
                tripped: 0,
              },
            },
            indices: {
              segments: { count: 20, memory_in_bytes: 2000 },
              merges: { current: 0, total: 4, total_time_in_millis: 400 },
              refresh: { total: 25, total_time_in_millis: 125 },
              search: {
                query_total: 500,
                query_time_in_millis: 500,
                fetch_total: 100,
                fetch_time_in_millis: 100,
              },
              indexing: {
                index_total: 300,
                index_time_in_millis: 300,
                delete_total: 10,
                delete_time_in_millis: 20,
              },
            },
          },
        },
      }),
      fetchedAt: "2026-05-01T10:00:00.000Z",
    });

    expect(status.operations.nodeCount).toBe(2);
    expect(status.operations.maxCpuPercent).toBe(68);
    expect(status.operations.avgCpuPercent).toBe(55);
    expect(status.operations.maxHeapPercent).toBe(72);
    expect(status.operations.heapUsedBytes).toBe(1260);
    expect(status.operations.heapMaxBytes).toBe(2000);
    expect(status.operations.diskUsedPercent).toBe(78.67);
    expect(status.operations.diskAvailableBytes).toBe(620);
    expect(status.operations.diskWatermark).toBe("flood_stage");
    expect(status.operations.gc.collectionCount).toBe(12);
    expect(status.operations.gc.collectionTimeMs).toBe(800);
    expect(status.operations.threadPools.active).toBe(6);
    expect(status.operations.threadPools.queue).toBe(7);
    expect(status.operations.threadPools.rejected).toBe(6);
    expect(status.operations.breakers.estimatedBytes).toBe(400);
    expect(status.operations.breakers.limitBytes).toBe(1100);
    expect(status.operations.breakers.tripped).toBe(2);
    expect(status.operations.segments.count).toBe(50);
    expect(status.operations.merges.total).toBe(12);
    expect(status.operations.refresh.total).toBe(75);
    expect(status.operations.search.queryTotal).toBe(1500);
    expect(status.operations.search.queryAvgMs).toBe(1.67);
    expect(status.operations.indexing.indexTotal).toBe(1000);
    expect(status.operations.indexing.indexAvgMs).toBe(1.7);
    expect(status.operations.topThreadPools[0]).toMatchObject({
      name: "search",
      active: 4,
      queue: 6,
      rejected: 5,
      completed: 180,
    });
    expect(status.operations.nodes[0]).toMatchObject({
      id: "node_a",
      name: "hot-1",
      cpuPercent: 68,
      heapPercent: 72,
      diskUsedPercent: 96,
      diskWatermark: "flood_stage",
    });
  });

  it("builds risk findings from cluster, shard, node, and index signals", () => {
    const status = buildServerStatus({
      clusterHealthText: JSON.stringify({
        cluster_name: "prod",
        status: "red",
        number_of_nodes: 2,
        unassigned_shards: 3,
      }),
      indicesText: JSON.stringify([
        {
          health: "red",
          status: "open",
          index: "orders",
          "docs.count": "100",
          "docs.deleted": "80",
          "store.size": "1024",
        },
      ]),
      shardsText: JSON.stringify([
        { index: "orders", state: "UNASSIGNED" },
        { index: "orders", state: "UNASSIGNED" },
      ]),
      nodesStatsText: JSON.stringify({
        nodes: {
          node_a: {
            name: "hot-1",
            os: { cpu: { percent: 96 } },
            jvm: {
              mem: {
                heap_used_percent: 91,
                heap_used_in_bytes: 910,
                heap_max_in_bytes: 1000,
              },
              gc: {
                collectors: {
                  old: { collection_count: 5, collection_time_in_millis: 6000 },
                },
              },
            },
            fs: {
              total: {
                total_in_bytes: 1000,
                free_in_bytes: 30,
                available_in_bytes: 20,
              },
            },
            thread_pool: {
              search: { active: 4, queue: 12, rejected: 3, completed: 100 },
            },
            breakers: {
              request: {
                estimated_size_in_bytes: 900,
                limit_size_in_bytes: 1000,
                tripped: 2,
              },
            },
            indices: {},
          },
        },
      }),
    });

    expect(status.risks.map((risk) => risk.id)).toEqual([
      "cluster-red",
      "unassigned-shards",
      "disk-flood-stage",
      "heap-critical",
      "cpu-critical",
      "thread-pool-rejections",
      "breaker-tripped",
      "deleted-docs-ratio",
    ]);
    expect(status.risks[0]).toMatchObject({
      severity: "critical",
      title: "集群处于 red 状态",
    });
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
