import type {
  ClusterStatus,
  IndexStatus,
  ServerHealth,
  ServerStatusSnapshot,
  ServerStatusSort,
  ShardStateSummary,
} from "../types/status";

type ServerStatusInput = {
  clusterHealthText: string;
  indicesText: string;
  shardsText?: string | null;
  shardDiagnostics?: string[];
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

export function buildServerStatus(input: ServerStatusInput): ServerStatusSnapshot {
  const shardSummaries = buildShardSummaries(input.shardsText);
  const indices = parseIndices(input.indicesText, shardSummaries);
  const healthCounts = indices.reduce<Record<ServerHealth, number>>(
    (counts, index) => ({
      ...counts,
      [index.health]: counts[index.health] + 1,
    }),
    { green: 0, yellow: 0, red: 0, unknown: 0 },
  );

  return {
    cluster: parseClusterStatus(input.clusterHealthText),
    indices,
    summary: {
      totalIndices: indices.length,
      systemIndices: indices.filter((index) => index.name.startsWith(".")).length,
      visibleStoreBytes: sumKnownNumbers(indices, (index) => index.storeBytes),
      visibleDocsCount: sumKnownNumbers(indices, (index) => index.docsCount),
      healthCounts,
      shardCounts: summarizeShardCounts(indices),
    },
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    partialFailures: input.shardDiagnostics ?? [],
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
