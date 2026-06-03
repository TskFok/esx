import type { ServerStatusSnapshot } from "../types/status";

export type DiagnosticAction = {
  id: string;
  title: string;
  path: string;
  reason: string;
};

export type StatusTrendSummary = {
  intervalSeconds: number;
  searchQueriesDelta: number;
  searchQueriesPerSecond: number;
  indexingDelta: number;
  indexingPerSecond: number;
  threadPoolRejectedDelta: number;
  breakerTrippedDelta: number;
};

export const MAX_STATUS_HISTORY_SNAPSHOTS = 200;

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function positiveDelta(current: number, previous: number) {
  return Math.max(0, current - previous);
}

export function buildDiagnosticActions(status: ServerStatusSnapshot): DiagnosticAction[] {
  const actions: DiagnosticAction[] = [];
  const add = (action: DiagnosticAction) => {
    if (!actions.some((item) => item.id === action.id)) {
      actions.push(action);
    }
  };

  if (status.cluster.health === "red" || status.cluster.health === "yellow" || status.summary.shardCounts.unassigned > 0) {
    add({
      id: "allocation-explain",
      title: "解释分片分配",
      path: "/_cluster/allocation/explain",
      reason: "集群非 green 或存在未分配分片，需要定位 allocation 决策。",
    });
    add({
      id: "recovery",
      title: "查看恢复进度",
      path: "/_cat/recovery?format=json&bytes=b",
      reason: "分片恢复或迁移可能正在进行。",
    });
  }

  if (
    status.cluster.health !== "green" ||
    status.operations.diskWatermark === "high" ||
    status.operations.diskWatermark === "flood_stage" ||
    status.operations.threadPools.rejected > 0 ||
    status.operations.breakers.tripped > 0
  ) {
    add({
      id: "pending-tasks",
      title: "查看等待任务",
      path: "/_cluster/pending_tasks",
      reason: "集群状态或节点压力异常时需要确认 master 任务是否堆积。",
    });
  }

  if (
    (status.operations.maxCpuPercent ?? 0) >= 75 ||
    (status.operations.maxHeapPercent ?? 0) >= 75 ||
    status.operations.threadPools.rejected > 0 ||
    status.operations.breakers.tripped > 0 ||
    status.operations.diskWatermark === "high" ||
    status.operations.diskWatermark === "flood_stage"
  ) {
    add({
      id: "hot-threads",
      title: "查看热点线程",
      path: "/_nodes/hot_threads",
      reason: "节点 CPU、heap、thread pool 或 breaker 异常时需要定位热点线程。",
    });
  }

  return actions;
}

export function appendStatusHistorySnapshot(history: ServerStatusSnapshot[], snapshot: ServerStatusSnapshot) {
  return [snapshot, ...history.filter((item) => item.fetchedAt !== snapshot.fetchedAt)].slice(0, MAX_STATUS_HISTORY_SNAPSHOTS);
}

export function buildStatusTrendSummary(history: ServerStatusSnapshot[]): StatusTrendSummary | null {
  const [current, previous] = history;
  if (!current || !previous) {
    return null;
  }

  const intervalSeconds = Math.max(
    1,
    Math.round((new Date(current.fetchedAt).getTime() - new Date(previous.fetchedAt).getTime()) / 1000),
  );
  const searchQueriesDelta = positiveDelta(current.operations.search.queryTotal, previous.operations.search.queryTotal);
  const indexingDelta = positiveDelta(current.operations.indexing.indexTotal, previous.operations.indexing.indexTotal);

  return {
    intervalSeconds,
    searchQueriesDelta,
    searchQueriesPerSecond: roundMetric(searchQueriesDelta / intervalSeconds),
    indexingDelta,
    indexingPerSecond: roundMetric(indexingDelta / intervalSeconds),
    threadPoolRejectedDelta: positiveDelta(current.operations.threadPools.rejected, previous.operations.threadPools.rejected),
    breakerTrippedDelta: positiveDelta(current.operations.breakers.tripped, previous.operations.breakers.tripped),
  };
}
