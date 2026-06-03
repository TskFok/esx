import { describe, expect, it } from "vitest";
import {
  appendStatusHistorySnapshot,
  buildDiagnosticActions,
  buildStatusTrendSummary,
} from "../status-diagnostics";
import type { ServerStatusSnapshot } from "../../types/status";

function createStatus(overrides: Partial<ServerStatusSnapshot>): ServerStatusSnapshot {
  return {
    cluster: {
      name: "prod",
      health: "green",
      nodes: 3,
      activePrimaryShards: 3,
      activeShards: 6,
      relocatingShards: 0,
      initializingShards: 0,
      unassignedShards: 0,
    },
    indices: [],
    summary: {
      totalIndices: 0,
      systemIndices: 0,
      visibleStoreBytes: 0,
      visibleDocsCount: 0,
      healthCounts: { green: 0, yellow: 0, red: 0, unknown: 0 },
      shardCounts: { started: 6, relocating: 0, initializing: 0, unassigned: 0, other: 0 },
    },
    operations: {
      nodeCount: 3,
      avgCpuPercent: 20,
      maxCpuPercent: 30,
      avgHeapPercent: 40,
      maxHeapPercent: 50,
      heapUsedBytes: 100,
      heapMaxBytes: 200,
      diskTotalBytes: 1000,
      diskFreeBytes: 400,
      diskAvailableBytes: 350,
      diskUsedPercent: 60,
      diskWatermark: "normal",
      gc: { collectionCount: 0, collectionTimeMs: 0 },
      threadPools: { active: 0, queue: 0, rejected: 0, completed: 100 },
      topThreadPools: [],
      breakers: { estimatedBytes: 0, limitBytes: 0, tripped: 0 },
      segments: { count: 0, memoryBytes: 0 },
      merges: { current: 0, total: 0, totalTimeMs: 0 },
      refresh: { total: 0, totalTimeMs: 0, avgMs: null },
      search: { queryTotal: 100, queryTimeMs: 500, queryAvgMs: 5, fetchTotal: 50, fetchTimeMs: 100, fetchAvgMs: 2 },
      indexing: { indexTotal: 20, indexTimeMs: 200, indexAvgMs: 10, deleteTotal: 0, deleteTimeMs: 0, deleteAvgMs: null },
      nodes: [],
    },
    risks: [],
    fetchedAt: "2026-06-03T00:00:00.000Z",
    partialFailures: [],
    ...overrides,
  };
}

describe("status diagnostics", () => {
  it("suggests diagnostic actions for unhealthy clusters and node pressure", () => {
    const status = createStatus({
      cluster: {
        ...createStatus({}).cluster,
        health: "red",
        unassignedShards: 2,
      },
      summary: {
        ...createStatus({}).summary,
        shardCounts: { started: 4, relocating: 0, initializing: 0, unassigned: 2, other: 0 },
      },
      operations: {
        ...createStatus({}).operations,
        diskWatermark: "high",
        threadPools: { active: 0, queue: 2, rejected: 3, completed: 100 },
        breakers: { estimatedBytes: 10, limitBytes: 100, tripped: 1 },
      },
    });

    expect(buildDiagnosticActions(status).map((item) => item.path)).toEqual([
      "/_cluster/allocation/explain",
      "/_cat/recovery?format=json&bytes=b",
      "/_cluster/pending_tasks",
      "/_nodes/hot_threads",
    ]);
  });

  it("keeps the most recent 200 status history snapshots", () => {
    const history = Array.from({ length: 200 }, (_, index) =>
      createStatus({ fetchedAt: new Date(index).toISOString() }),
    );
    const next = appendStatusHistorySnapshot(history, createStatus({ fetchedAt: "2026-06-03T00:00:00.000Z" }));

    expect(next).toHaveLength(200);
    expect(next[0]?.fetchedAt).toBe("2026-06-03T00:00:00.000Z");
  });

  it("computes deltas between adjacent status snapshots", () => {
    const previous = createStatus({ fetchedAt: "2026-06-03T00:00:00.000Z" });
    const current = createStatus({
      fetchedAt: "2026-06-03T00:01:00.000Z",
      operations: {
        ...previous.operations,
        search: { ...previous.operations.search, queryTotal: 220 },
        indexing: { ...previous.operations.indexing, indexTotal: 50 },
        threadPools: { ...previous.operations.threadPools, rejected: 4 },
        breakers: { ...previous.operations.breakers, tripped: 2 },
      },
    });

    expect(buildStatusTrendSummary([current, previous])).toEqual({
      intervalSeconds: 60,
      searchQueriesDelta: 120,
      searchQueriesPerSecond: 2,
      indexingDelta: 30,
      indexingPerSecond: 0.5,
      threadPoolRejectedDelta: 4,
      breakerTrippedDelta: 2,
    });
  });
});
