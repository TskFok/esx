import type {
  ClusterStatus,
  DiskWatermark,
  IndexStatus,
  NodeOperationStatus,
  ServerOperationStatus,
  ServerHealth,
  ServerRiskFinding,
  ServerStatusSnapshot,
  ServerStatusSort,
  ThreadPoolOperationStatus,
  ShardStateSummary,
} from "../types/status";

type ServerStatusInput = {
  clusterHealthText: string;
  indicesText: string;
  shardsText?: string | null;
  nodesStatsText?: string | null;
  shardDiagnostics?: string[];
  nodesStatsDiagnostics?: string[];
  fetchedAt?: string;
};

type FilterOptions = {
  query: string;
  showSystemIndices: boolean;
};

const healthOrder: Record<ServerHealth, number> = {
  unknown: -1,
  green: 0,
  yellow: 1,
  red: 2,
};

function emptyShardSummary(): ShardStateSummary {
  return {
    started: 0,
    relocating: 0,
    initializing: 0,
    unassigned: 0,
    other: 0,
  };
}

function parseJsonValue(text: string) {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function parseServerHealth(value: unknown): ServerHealth {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "green" || normalized === "yellow" || normalized === "red") {
    return normalized;
  }

  return "unknown";
}

function parseNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/,/g, "");
  if (!normalized || normalized === "-") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRecord(record: Record<string, unknown>, key: string) {
  return toRecord(record[key]);
}

function readNumber(record: Record<string, unknown> | null, key: string) {
  return record ? parseNumberValue(record[key]) : null;
}

function addKnown(total: number, value: number | null) {
  return total + (value ?? 0);
}

function averageKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) {
    return null;
  }

  return roundMetric(known.reduce((total, value) => total + value, 0) / known.length);
}

function maxKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? Math.max(...known) : null;
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function averageDuration(totalTimeMs: number, totalCount: number) {
  return totalCount > 0 ? roundMetric(totalTimeMs / totalCount) : null;
}

function classifyDiskWatermark(usedPercent: number | null): DiskWatermark {
  if (usedPercent === null) {
    return "unknown";
  }
  if (usedPercent >= 95) {
    return "flood_stage";
  }
  if (usedPercent >= 90) {
    return "high";
  }
  if (usedPercent >= 85) {
    return "low";
  }
  return "normal";
}

function worstDiskWatermark(left: DiskWatermark, right: DiskWatermark): DiskWatermark {
  const order: Record<DiskWatermark, number> = {
    unknown: -1,
    normal: 0,
    low: 1,
    high: 2,
    flood_stage: 3,
  };

  return order[right] > order[left] ? right : left;
}

function emptyOperations(): ServerOperationStatus {
  return {
    nodeCount: 0,
    avgCpuPercent: null,
    maxCpuPercent: null,
    avgHeapPercent: null,
    maxHeapPercent: null,
    heapUsedBytes: 0,
    heapMaxBytes: 0,
    diskTotalBytes: 0,
    diskFreeBytes: 0,
    diskAvailableBytes: 0,
    diskUsedPercent: null,
    diskWatermark: "unknown",
    gc: {
      collectionCount: 0,
      collectionTimeMs: 0,
    },
    threadPools: {
      active: 0,
      queue: 0,
      rejected: 0,
      completed: 0,
    },
    topThreadPools: [],
    breakers: {
      estimatedBytes: 0,
      limitBytes: 0,
      tripped: 0,
    },
    segments: {
      count: 0,
      memoryBytes: 0,
    },
    merges: {
      current: 0,
      total: 0,
      totalTimeMs: 0,
    },
    refresh: {
      total: 0,
      totalTimeMs: 0,
      avgMs: null,
    },
    search: {
      queryTotal: 0,
      queryTimeMs: 0,
      queryAvgMs: null,
      fetchTotal: 0,
      fetchTimeMs: 0,
      fetchAvgMs: null,
    },
    indexing: {
      indexTotal: 0,
      indexTimeMs: 0,
      indexAvgMs: null,
      deleteTotal: 0,
      deleteTimeMs: 0,
      deleteAvgMs: null,
    },
    nodes: [],
  };
}

function parseClusterStatus(clusterHealthText: string): ClusterStatus {
  const record = toRecord(parseJsonValue(clusterHealthText));

  return {
    name: record ? readString(record, "cluster_name") ?? "未知集群" : "未知集群",
    health: record ? parseServerHealth(record.status) : "unknown",
    nodes: record ? parseNumberValue(record.number_of_nodes) : null,
    activePrimaryShards: record ? parseNumberValue(record.active_primary_shards) : null,
    activeShards: record ? parseNumberValue(record.active_shards) : null,
    relocatingShards: record ? parseNumberValue(record.relocating_shards) : null,
    initializingShards: record ? parseNumberValue(record.initializing_shards) : null,
    unassignedShards: record ? parseNumberValue(record.unassigned_shards) : null,
  };
}

function summarizeGc(jvm: Record<string, unknown> | null) {
  const collectors = getRecord(getRecord(jvm ?? {}, "gc") ?? {}, "collectors");
  const summary = { collectionCount: 0, collectionTimeMs: 0 };
  if (!collectors) {
    return summary;
  }

  Object.values(collectors).forEach((entry) => {
    const collector = toRecord(entry);
    summary.collectionCount = addKnown(summary.collectionCount, readNumber(collector, "collection_count"));
    summary.collectionTimeMs = addKnown(summary.collectionTimeMs, readNumber(collector, "collection_time_in_millis"));
  });

  return summary;
}

function summarizeThreadPools(threadPool: Record<string, unknown> | null) {
  const totals = {
    active: 0,
    queue: 0,
    rejected: 0,
    completed: 0,
  };
  const byPool: Record<string, ThreadPoolOperationStatus> = {};
  if (!threadPool) {
    return { totals, byPool };
  }

  Object.entries(threadPool).forEach(([name, value]) => {
    const pool = toRecord(value);
    if (!pool) {
      return;
    }

    const current = byPool[name] ??= {
      name,
      active: 0,
      queue: 0,
      rejected: 0,
      completed: 0,
    };
    current.active += readNumber(pool, "active") ?? 0;
    current.queue += readNumber(pool, "queue") ?? 0;
    current.rejected += readNumber(pool, "rejected") ?? 0;
    current.completed += readNumber(pool, "completed") ?? 0;
    totals.active += current.active;
    totals.queue += current.queue;
    totals.rejected += current.rejected;
    totals.completed += current.completed;
  });

  return { totals, byPool };
}

function summarizeBreakers(breakers: Record<string, unknown> | null) {
  const summary = { estimatedBytes: 0, limitBytes: 0, tripped: 0 };
  if (!breakers) {
    return summary;
  }

  Object.values(breakers).forEach((entry) => {
    const breaker = toRecord(entry);
    summary.estimatedBytes = addKnown(summary.estimatedBytes, readNumber(breaker, "estimated_size_in_bytes"));
    summary.limitBytes = addKnown(summary.limitBytes, readNumber(breaker, "limit_size_in_bytes"));
    summary.tripped = addKnown(summary.tripped, readNumber(breaker, "tripped"));
  });

  return summary;
}

function summarizeNodeDisk(fs: Record<string, unknown> | null) {
  const total = getRecord(fs ?? {}, "total");
  const totalBytes = readNumber(total, "total_in_bytes");
  const freeBytes = readNumber(total, "free_in_bytes");
  const availableBytes = readNumber(total, "available_in_bytes");
  const usedPercent = totalBytes !== null && totalBytes > 0 && freeBytes !== null
    ? roundMetric(((totalBytes - freeBytes) / totalBytes) * 100)
    : null;

  return {
    totalBytes,
    freeBytes,
    availableBytes,
    usedPercent,
    watermark: classifyDiskWatermark(usedPercent),
  };
}

function parseNodesStats(nodesStatsText?: string | null): ServerOperationStatus {
  const root = toRecord(nodesStatsText ? parseJsonValue(nodesStatsText) : null);
  const nodes = root ? toRecord(root.nodes) : null;
  if (!nodes) {
    return emptyOperations();
  }

  const operations = emptyOperations();
  const cpuPercents: Array<number | null> = [];
  const heapPercents: Array<number | null> = [];
  const threadPoolsByName: Record<string, ThreadPoolOperationStatus> = {};

  Object.entries(nodes).forEach(([id, value]) => {
    const node = toRecord(value);
    if (!node) {
      return;
    }

    const os = getRecord(node, "os");
    const cpu = getRecord(os ?? {}, "cpu");
    const jvm = getRecord(node, "jvm");
    const mem = getRecord(jvm ?? {}, "mem");
    const fs = getRecord(node, "fs");
    const indices = getRecord(node, "indices");
    const segments = getRecord(indices ?? {}, "segments");
    const merges = getRecord(indices ?? {}, "merges");
    const refresh = getRecord(indices ?? {}, "refresh");
    const search = getRecord(indices ?? {}, "search");
    const indexing = getRecord(indices ?? {}, "indexing");
    const disk = summarizeNodeDisk(fs);
    const cpuPercent = readNumber(cpu, "percent");
    const heapPercent = readNumber(mem, "heap_used_percent");
    const heapUsedBytes = readNumber(mem, "heap_used_in_bytes");
    const heapMaxBytes = readNumber(mem, "heap_max_in_bytes");
    const gc = summarizeGc(jvm);
    const threadPools = summarizeThreadPools(getRecord(node, "thread_pool"));
    const breakers = summarizeBreakers(getRecord(node, "breakers"));

    cpuPercents.push(cpuPercent);
    heapPercents.push(heapPercent);
    operations.heapUsedBytes = addKnown(operations.heapUsedBytes, heapUsedBytes);
    operations.heapMaxBytes = addKnown(operations.heapMaxBytes, heapMaxBytes);
    operations.diskTotalBytes = addKnown(operations.diskTotalBytes, disk.totalBytes);
    operations.diskFreeBytes = addKnown(operations.diskFreeBytes, disk.freeBytes);
    operations.diskAvailableBytes = addKnown(operations.diskAvailableBytes, disk.availableBytes);
    operations.diskWatermark = worstDiskWatermark(operations.diskWatermark, disk.watermark);
    operations.gc.collectionCount += gc.collectionCount;
    operations.gc.collectionTimeMs += gc.collectionTimeMs;
    operations.threadPools.active += threadPools.totals.active;
    operations.threadPools.queue += threadPools.totals.queue;
    operations.threadPools.rejected += threadPools.totals.rejected;
    operations.threadPools.completed += threadPools.totals.completed;
    operations.breakers.estimatedBytes += breakers.estimatedBytes;
    operations.breakers.limitBytes += breakers.limitBytes;
    operations.breakers.tripped += breakers.tripped;
    operations.segments.count = addKnown(operations.segments.count, readNumber(segments, "count"));
    operations.segments.memoryBytes = addKnown(operations.segments.memoryBytes, readNumber(segments, "memory_in_bytes"));
    operations.merges.current = addKnown(operations.merges.current, readNumber(merges, "current"));
    operations.merges.total = addKnown(operations.merges.total, readNumber(merges, "total"));
    operations.merges.totalTimeMs = addKnown(operations.merges.totalTimeMs, readNumber(merges, "total_time_in_millis"));
    operations.refresh.total = addKnown(operations.refresh.total, readNumber(refresh, "total"));
    operations.refresh.totalTimeMs = addKnown(operations.refresh.totalTimeMs, readNumber(refresh, "total_time_in_millis"));
    operations.search.queryTotal = addKnown(operations.search.queryTotal, readNumber(search, "query_total"));
    operations.search.queryTimeMs = addKnown(operations.search.queryTimeMs, readNumber(search, "query_time_in_millis"));
    operations.search.fetchTotal = addKnown(operations.search.fetchTotal, readNumber(search, "fetch_total"));
    operations.search.fetchTimeMs = addKnown(operations.search.fetchTimeMs, readNumber(search, "fetch_time_in_millis"));
    operations.indexing.indexTotal = addKnown(operations.indexing.indexTotal, readNumber(indexing, "index_total"));
    operations.indexing.indexTimeMs = addKnown(operations.indexing.indexTimeMs, readNumber(indexing, "index_time_in_millis"));
    operations.indexing.deleteTotal = addKnown(operations.indexing.deleteTotal, readNumber(indexing, "delete_total"));
    operations.indexing.deleteTimeMs = addKnown(operations.indexing.deleteTimeMs, readNumber(indexing, "delete_time_in_millis"));

    Object.values(threadPools.byPool).forEach((pool) => {
      const current = threadPoolsByName[pool.name] ??= { name: pool.name, active: 0, queue: 0, rejected: 0, completed: 0 };
      current.active += pool.active;
      current.queue += pool.queue;
      current.rejected += pool.rejected;
      current.completed += pool.completed;
    });

    operations.nodes.push({
      id,
      name: readString(node, "name") ?? id,
      cpuPercent,
      heapPercent,
      heapUsedBytes,
      heapMaxBytes,
      diskUsedPercent: disk.usedPercent,
      diskAvailableBytes: disk.availableBytes,
      diskWatermark: disk.watermark,
    } satisfies NodeOperationStatus);
  });

  operations.nodeCount = operations.nodes.length;
  operations.avgCpuPercent = averageKnown(cpuPercents);
  operations.maxCpuPercent = maxKnown(cpuPercents);
  operations.avgHeapPercent = averageKnown(heapPercents);
  operations.maxHeapPercent = maxKnown(heapPercents);
  operations.diskUsedPercent = operations.diskTotalBytes > 0
    ? roundMetric(((operations.diskTotalBytes - operations.diskFreeBytes) / operations.diskTotalBytes) * 100)
    : null;
  operations.refresh.avgMs = averageDuration(operations.refresh.totalTimeMs, operations.refresh.total);
  operations.search.queryAvgMs = averageDuration(operations.search.queryTimeMs, operations.search.queryTotal);
  operations.search.fetchAvgMs = averageDuration(operations.search.fetchTimeMs, operations.search.fetchTotal);
  operations.indexing.indexAvgMs = averageDuration(operations.indexing.indexTimeMs, operations.indexing.indexTotal);
  operations.indexing.deleteAvgMs = averageDuration(operations.indexing.deleteTimeMs, operations.indexing.deleteTotal);
  operations.topThreadPools = Object.values(threadPoolsByName)
    .sort((left, right) =>
      (right.rejected - left.rejected) ||
      (right.queue - left.queue) ||
      (right.active - left.active) ||
      left.name.localeCompare(right.name, "zh-CN"),
    )
    .slice(0, 6);
  operations.nodes.sort((left, right) =>
    compareNullableNumbers(right.diskUsedPercent, left.diskUsedPercent) || left.name.localeCompare(right.name, "zh-CN"),
  );

  return operations;
}

function buildShardSummaries(shardsText?: string | null) {
  const summaries: Record<string, ShardStateSummary> = {};
  const value = shardsText ? parseJsonValue(shardsText) : null;
  if (!Array.isArray(value)) {
    return summaries;
  }

  value.forEach((entry) => {
    const record = toRecord(entry);
    if (!record) {
      return;
    }

    const indexName = readString(record, "index")?.trim();
    if (!indexName) {
      return;
    }

    const summary = summaries[indexName] ??= emptyShardSummary();
    const state = readString(record, "state")?.trim().toUpperCase();
    if (state === "STARTED") {
      summary.started += 1;
    } else if (state === "RELOCATING") {
      summary.relocating += 1;
    } else if (state === "INITIALIZING") {
      summary.initializing += 1;
    } else if (state === "UNASSIGNED") {
      summary.unassigned += 1;
    } else {
      summary.other += 1;
    }
  });

  return summaries;
}

function parseIndices(indicesText: string, shardSummaries: Record<string, ShardStateSummary>) {
  const value = parseJsonValue(indicesText);
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): IndexStatus[] => {
    const record = toRecord(entry);
    const name = record ? readString(record, "index")?.trim() : null;
    if (!record || !name) {
      return [];
    }

    return [{
      name,
      health: parseServerHealth(record.health),
      status: readString(record, "status")?.trim() || "unknown",
      primaryShards: parseNumberValue(record.pri),
      replicaShards: parseNumberValue(record.rep),
      docsCount: parseNumberValue(record["docs.count"]),
      docsDeleted: parseNumberValue(record["docs.deleted"]),
      storeBytes: parseNumberValue(record["store.size"]),
      primaryStoreBytes: parseNumberValue(record["pri.store.size"]),
      shardSummary: shardSummaries[name] ?? emptyShardSummary(),
    }];
  }).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

function sumKnownNumbers(indices: IndexStatus[], pick: (index: IndexStatus) => number | null) {
  return indices.reduce((total, index) => total + (pick(index) ?? 0), 0);
}

function summarizeShardCounts(indices: IndexStatus[]) {
  return indices.reduce((summary, index) => ({
    started: summary.started + index.shardSummary.started,
    relocating: summary.relocating + index.shardSummary.relocating,
    initializing: summary.initializing + index.shardSummary.initializing,
    unassigned: summary.unassigned + index.shardSummary.unassigned,
    other: summary.other + index.shardSummary.other,
  }), emptyShardSummary());
}

function buildRiskFindings({
  cluster,
  indices,
  summary,
  operations,
}: {
  cluster: ClusterStatus;
  indices: IndexStatus[];
  summary: ServerStatusSnapshot["summary"];
  operations: ServerOperationStatus;
}) {
  const risks: ServerRiskFinding[] = [];
  const pushRisk = (risk: ServerRiskFinding) => {
    risks.push(risk);
  };

  if (cluster.health === "red") {
    pushRisk({
      id: "cluster-red",
      severity: "critical",
      title: "集群处于 red 状态",
      detail: "至少有主分片不可用，查询或写入可能已经受影响。",
      recommendation: "优先查看未分配分片和节点状态，必要时使用 `_cluster/allocation/explain` 定位分配失败原因。",
    });
  } else if (cluster.health === "yellow") {
    pushRisk({
      id: "cluster-yellow",
      severity: "warning",
      title: "集群处于 yellow 状态",
      detail: "主分片可用，但至少有副本分片未分配，容灾能力下降。",
      recommendation: "检查副本数、节点数量、磁盘水位和 allocation 规则，确认副本能否恢复分配。",
    });
  }

  if (summary.shardCounts.unassigned > 0 || (cluster.unassignedShards ?? 0) > 0) {
    pushRisk({
      id: "unassigned-shards",
      severity: cluster.health === "red" ? "critical" : "warning",
      title: "存在未分配分片",
      detail: `当前检测到 ${summary.shardCounts.unassigned || cluster.unassignedShards || 0} 个未分配分片。`,
      recommendation: "查看具体 index 的 shard 状态，并执行 allocation explain 判断是磁盘、节点、过滤规则还是副本数导致。",
    });
  }

  if (operations.diskWatermark === "flood_stage") {
    pushRisk({
      id: "disk-flood-stage",
      severity: "critical",
      title: "磁盘达到 flood stage 风险",
      detail: `集群聚合磁盘使用率 ${operations.diskUsedPercent === null ? "未知" : `${operations.diskUsedPercent}%`}，至少一个节点可能接近 95%。`,
      recommendation: "尽快释放磁盘、扩容节点或迁移分片，并检查索引是否被自动设置为 read_only_allow_delete。",
    });
  } else if (operations.diskWatermark === "high") {
    pushRisk({
      id: "disk-high-watermark",
      severity: "warning",
      title: "磁盘超过 high watermark",
      detail: "至少一个节点磁盘使用率接近或超过 90%，分片分配可能受限。",
      recommendation: "清理过期索引、增加容量或调整分片布局，避免进一步进入 flood stage。",
    });
  } else if (operations.diskWatermark === "low") {
    pushRisk({
      id: "disk-low-watermark",
      severity: "info",
      title: "磁盘超过 low watermark",
      detail: "至少一个节点磁盘使用率接近或超过 85%，后续分片分配空间开始收紧。",
      recommendation: "关注索引增长速度，提前规划清理、扩容或冷热分层策略。",
    });
  }

  if ((operations.maxHeapPercent ?? 0) >= 90) {
    pushRisk({
      id: "heap-critical",
      severity: "critical",
      title: "JVM Heap 使用率过高",
      detail: `最高 heap 使用率 ${operations.maxHeapPercent}%，存在频繁 GC 或 OOM 风险。`,
      recommendation: "检查大查询、高基数字段聚合、fielddata、segment 内存和老年代 GC，必要时降低查询压力或扩容。",
    });
  } else if ((operations.maxHeapPercent ?? 0) >= 75) {
    pushRisk({
      id: "heap-warning",
      severity: "warning",
      title: "JVM Heap 使用率偏高",
      detail: `最高 heap 使用率 ${operations.maxHeapPercent}%，需要持续观察 GC 和 breaker。`,
      recommendation: "关注查询聚合、批量写入和缓存压力，避免 heap 继续攀升。",
    });
  }

  if ((operations.maxCpuPercent ?? 0) >= 90) {
    pushRisk({
      id: "cpu-critical",
      severity: "critical",
      title: "节点 CPU 压力过高",
      detail: `最高 CPU 使用率 ${operations.maxCpuPercent}%，可能影响查询和写入延迟。`,
      recommendation: "检查 hot threads、慢查询、批量写入和 merge 压力，确认是否存在热点节点。",
    });
  } else if ((operations.maxCpuPercent ?? 0) >= 75) {
    pushRisk({
      id: "cpu-warning",
      severity: "warning",
      title: "节点 CPU 压力偏高",
      detail: `最高 CPU 使用率 ${operations.maxCpuPercent}%，建议观察是否持续升高。`,
      recommendation: "结合查询量、写入量和 merge 指标判断是否需要限流或扩容。",
    });
  }

  if (operations.threadPools.rejected > 0) {
    pushRisk({
      id: "thread-pool-rejections",
      severity: "warning",
      title: "Thread Pool 出现拒绝",
      detail: `累计 rejected ${operations.threadPools.rejected} 次，部分请求可能已被拒绝。`,
      recommendation: "查看热点线程池类型，降低并发、优化批量大小，或扩容对应角色节点。",
    });
  }

  if (operations.breakers.tripped > 0) {
    pushRisk({
      id: "breaker-tripped",
      severity: "warning",
      title: "Circuit Breaker 被触发",
      detail: `累计 tripped ${operations.breakers.tripped} 次，说明请求内存压力曾超过保护阈值。`,
      recommendation: "检查大聚合、返回字段、fielddata 和批量请求，优先降低单次请求内存占用。",
    });
  }

  const highDeletedRatioIndex = indices.find((index) => {
    const docs = index.docsCount ?? 0;
    const deleted = index.docsDeleted ?? 0;
    return docs >= 100 && deleted / Math.max(docs, 1) >= 0.5;
  });
  if (highDeletedRatioIndex) {
    pushRisk({
      id: "deleted-docs-ratio",
      severity: "info",
      title: "索引删除文档比例偏高",
      detail: `${highDeletedRatioIndex.name} 的 deleted docs 接近或超过当前文档数的 50%。`,
      recommendation: "确认是否需要通过 rollover、forcemerge 或重建索引降低段膨胀和查询成本。",
    });
  }

  const severityOrder: Record<ServerRiskFinding["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return risks.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
}

export function buildServerStatus(input: ServerStatusInput): ServerStatusSnapshot {
  const shardSummaries = buildShardSummaries(input.shardsText);
  const indices = parseIndices(input.indicesText, shardSummaries);
  const cluster = parseClusterStatus(input.clusterHealthText);
  const healthCounts = indices.reduce<Record<ServerHealth, number>>(
    (counts, index) => ({
      ...counts,
      [index.health]: counts[index.health] + 1,
    }),
    { green: 0, yellow: 0, red: 0, unknown: 0 },
  );
  const summary = {
    totalIndices: indices.length,
    systemIndices: indices.filter((index) => index.name.startsWith(".")).length,
    visibleStoreBytes: sumKnownNumbers(indices, (index) => index.storeBytes),
    visibleDocsCount: sumKnownNumbers(indices, (index) => index.docsCount),
    healthCounts,
    shardCounts: summarizeShardCounts(indices),
  };
  const operations = parseNodesStats(input.nodesStatsText);

  return {
    cluster,
    indices,
    summary,
    operations,
    risks: buildRiskFindings({ cluster, indices, summary, operations }),
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    partialFailures: [...(input.shardDiagnostics ?? []), ...(input.nodesStatsDiagnostics ?? [])],
  };
}

export function filterStatusIndices(indices: IndexStatus[], options: FilterOptions) {
  const query = options.query.trim().toLowerCase();
  return indices.filter((index) => {
    if (!options.showSystemIndices && index.name.startsWith(".")) {
      return false;
    }

    return !query || index.name.toLowerCase().includes(query);
  });
}

function compareNullableNumbers(left: number | null, right: number | null) {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return -1;
  }
  if (right === null) {
    return 1;
  }
  return left - right;
}

export function sortStatusIndices(indices: IndexStatus[], sort: ServerStatusSort) {
  const directionMultiplier = sort.direction === "asc" ? 1 : -1;

  return [...indices].sort((left, right) => {
    let result = 0;
    if (sort.key === "name") {
      result = left.name.localeCompare(right.name, "zh-CN");
    } else if (sort.key === "status") {
      result = left.status.localeCompare(right.status, "zh-CN") || left.name.localeCompare(right.name, "zh-CN");
    } else if (sort.key === "health") {
      result = healthOrder[left.health] - healthOrder[right.health] || left.name.localeCompare(right.name, "zh-CN");
    } else if (sort.key === "docs") {
      result = compareNullableNumbers(left.docsCount, right.docsCount) || left.name.localeCompare(right.name, "zh-CN");
    } else {
      result = compareNullableNumbers(left.storeBytes, right.storeBytes) || left.name.localeCompare(right.name, "zh-CN");
    }

    return result * directionMultiplier;
  });
}
