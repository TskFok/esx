import { describe, expect, it } from "vitest";
import {
  buildClusterOverview,
  buildIndicesStatus,
  buildOperationsStatus,
  filterStatusIndices,
  sortStatusIndices,
} from "../status";

const clusterHealthText = JSON.stringify({
  cluster_name: "logs-prod",
  status: "yellow",
  number_of_nodes: 3,
  active_primary_shards: 18,
  active_shards: 32,
  relocating_shards: 1,
  initializing_shards: 2,
  unassigned_shards: 4,
  indices: {
    "orders-2026": {
      status: "green",
      active_shards: 1,
      relocating_shards: 1,
      initializing_shards: 0,
      unassigned_shards: 0,
    },
    users: {
      status: "yellow",
      active_shards: 0,
      relocating_shards: 0,
      initializing_shards: 1,
      unassigned_shards: 1,
    },
    ".security": {
      status: "green",
      active_shards: 1,
      relocating_shards: 0,
      initializing_shards: 0,
      unassigned_shards: 0,
    },
  },
});

describe("buildClusterOverview", () => {
  it("parses cluster health into overview snapshot without index docs or store", () => {
    const status = buildClusterOverview({
      clusterHealthText,
      fetchedAt: "2026-05-01T10:00:00.000Z",
    });

    expect(status.cluster.name).toBe("logs-prod");
    expect(status.cluster.health).toBe("yellow");
    expect(status.cluster.nodes).toBe(3);
    expect(status.summary.totalIndices).toBe(3);
    expect(status.summary.systemIndices).toBe(1);
    expect(status.summary.healthCounts).toEqual({ green: 2, yellow: 1, red: 0, unknown: 0 });
    expect(status.summary.shardCounts).toMatchObject({
      started: 2,
      relocating: 1,
      initializing: 1,
      unassigned: 1,
    });
    expect(status.fetchedAt).toBe("2026-05-01T10:00:00.000Z");
    expect(status.risks.map((risk) => risk.id)).toEqual(["cluster-yellow", "unassigned-shards"]);
  });

  it("falls back to cluster-level shard counts when indices are missing", () => {
    const status = buildClusterOverview({
      clusterHealthText: JSON.stringify({
        cluster_name: "broken",
        status: "red",
        number_of_nodes: "2",
        active_shards: "7",
        unassigned_shards: 3,
      }),
    });

    expect(status.cluster.health).toBe("red");
    expect(status.summary.totalIndices).toBe(0);
    expect(status.summary.shardCounts).toMatchObject({
      started: 7,
      relocating: 0,
      initializing: 0,
      unassigned: 3,
    });
    expect(status.risks.map((risk) => risk.id)).toEqual(["cluster-red", "unassigned-shards"]);
  });
});

describe("buildIndicesStatus", () => {
  it("parses cat indices without cluster health shard summaries", () => {
    const status = buildIndicesStatus({
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
      fetchedAt: "2026-05-01T10:00:00.000Z",
    });

    expect(status.summary).toEqual({
      totalIndices: 2,
      systemIndices: 0,
      visibleStoreBytes: 2560,
      visibleDocsCount: 1500,
    });
    expect(status.indices[0]).toMatchObject({
      name: "orders-2026",
      health: "green",
      docsCount: 1200,
      storeBytes: 2048,
      shardSummary: { started: 0, relocating: 0, initializing: 0, unassigned: 0, other: 0 },
    });
  });

  it("flags high deleted-docs ratio", () => {
    const status = buildIndicesStatus({
      indicesText: JSON.stringify([
        { health: "red", status: "open", index: "orders", "docs.count": "100", "docs.deleted": "80", "store.size": "1024" },
      ]),
    });

    expect(status.risks.map((risk) => risk.id)).toEqual(["deleted-docs-ratio"]);
  });
});

describe("buildOperationsStatus", () => {
  it("summarizes node stats and operations risks", () => {
    const status = buildOperationsStatus({
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
                  young: { collection_count: 10, collection_time_in_millis: 500 },
                  old: { collection_count: 2, collection_time_in_millis: 300 },
                },
              },
            },
            fs: {
              total: { total_in_bytes: 1000, free_in_bytes: 40, available_in_bytes: 120 },
            },
            thread_pool: {
              search: { active: 3, queue: 4, rejected: 5, completed: 100 },
              write: { active: 2, queue: 1, rejected: 1, completed: 200 },
            },
            breakers: {
              request: { estimated_size_in_bytes: 300, limit_size_in_bytes: 600, tripped: 2 },
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
        },
      }),
      fetchedAt: "2026-05-01T10:00:00.000Z",
    });

    expect(status.operations.nodeCount).toBe(1);
    expect(status.operations.maxCpuPercent).toBe(96);
    expect(status.operations.maxHeapPercent).toBe(91);
    expect(status.operations.diskWatermark).toBe("flood_stage");
    expect(status.risks.map((risk) => risk.id)).toEqual([
      "disk-flood-stage",
      "heap-critical",
      "cpu-critical",
      "thread-pool-rejections",
      "breaker-tripped",
    ]);
  });

  it("keeps partialFailures when node stats text is missing", () => {
    const status = buildOperationsStatus({
      nodesStatsText: null,
      nodesStatsDiagnostics: ["节点运维指标接口返回 403"],
    });

    expect(status.operations.nodeCount).toBe(0);
    expect(status.partialFailures).toEqual(["节点运维指标接口返回 403"]);
    expect(status.risks).toEqual([]);
  });
});

describe("server status index list helpers", () => {
  const indices = buildIndicesStatus({
    indicesText: JSON.stringify([
      { health: "green", status: "open", index: "orders", "docs.count": "200", "store.size": "2048" },
      { health: "red", status: "open", index: "payments", "docs.count": "50", "store.size": "4096" },
      { health: "yellow", status: "open", index: ".security", "docs.count": "1000", "store.size": "512" },
    ]),
  }).indices;

  it("hides system indices by default and filters by name", () => {
    expect(filterStatusIndices(indices, { query: "", showSystemIndices: false }).map((item) => item.name))
      .toEqual(["orders", "payments"]);
    expect(filterStatusIndices(indices, { query: "pay", showSystemIndices: true }).map((item) => item.name))
      .toEqual(["payments"]);
  });

  it("sorts indices by health, document count, and store size", () => {
    expect(sortStatusIndices(indices, { key: "health", direction: "desc" }).map((item) => item.name))
      .toEqual(["payments", ".security", "orders"]);
    expect(sortStatusIndices(indices, { key: "docs", direction: "desc" }).map((item) => item.name))
      .toEqual([".security", "orders", "payments"]);
    expect(sortStatusIndices(indices, { key: "store", direction: "asc" }).map((item) => item.name))
      .toEqual([".security", "orders", "payments"]);
  });
});
