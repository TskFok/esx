export type ServerHealth = "green" | "yellow" | "red" | "unknown";

export type ShardStateSummary = {
  started: number;
  relocating: number;
  initializing: number;
  unassigned: number;
  other: number;
};

export type ClusterStatus = {
  name: string;
  health: ServerHealth;
  nodes: number | null;
  activePrimaryShards: number | null;
  activeShards: number | null;
  relocatingShards: number | null;
  initializingShards: number | null;
  unassignedShards: number | null;
};

export type IndexStatus = {
  name: string;
  health: ServerHealth;
  status: string;
  primaryShards: number | null;
  replicaShards: number | null;
  docsCount: number | null;
  docsDeleted: number | null;
  storeBytes: number | null;
  primaryStoreBytes: number | null;
  shardSummary: ShardStateSummary;
};

export type ServerStatusSummary = {
  totalIndices: number;
  systemIndices: number;
  visibleStoreBytes: number;
  visibleDocsCount: number;
  healthCounts: Record<ServerHealth, number>;
  shardCounts: ShardStateSummary;
};

export type DiskWatermark = "normal" | "low" | "high" | "flood_stage" | "unknown";

export type NodeOperationStatus = {
  id: string;
  name: string;
  cpuPercent: number | null;
  heapPercent: number | null;
  heapUsedBytes: number | null;
  heapMaxBytes: number | null;
  diskUsedPercent: number | null;
  diskAvailableBytes: number | null;
  diskWatermark: DiskWatermark;
};

export type ThreadPoolOperationStatus = {
  name: string;
  active: number;
  queue: number;
  rejected: number;
  completed: number;
};

export type ServerOperationStatus = {
  nodeCount: number;
  avgCpuPercent: number | null;
  maxCpuPercent: number | null;
  avgHeapPercent: number | null;
  maxHeapPercent: number | null;
  heapUsedBytes: number;
  heapMaxBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  diskAvailableBytes: number;
  diskUsedPercent: number | null;
  diskWatermark: DiskWatermark;
  gc: {
    collectionCount: number;
    collectionTimeMs: number;
  };
  threadPools: {
    active: number;
    queue: number;
    rejected: number;
    completed: number;
  };
  topThreadPools: ThreadPoolOperationStatus[];
  breakers: {
    estimatedBytes: number;
    limitBytes: number;
    tripped: number;
  };
  segments: {
    count: number;
    memoryBytes: number;
  };
  merges: {
    current: number;
    total: number;
    totalTimeMs: number;
  };
  refresh: {
    total: number;
    totalTimeMs: number;
    avgMs: number | null;
  };
  search: {
    queryTotal: number;
    queryTimeMs: number;
    queryAvgMs: number | null;
    fetchTotal: number;
    fetchTimeMs: number;
    fetchAvgMs: number | null;
  };
  indexing: {
    indexTotal: number;
    indexTimeMs: number;
    indexAvgMs: number | null;
    deleteTotal: number;
    deleteTimeMs: number;
    deleteAvgMs: number | null;
  };
  nodes: NodeOperationStatus[];
};

export type ServerStatusSnapshot = {
  cluster: ClusterStatus;
  indices: IndexStatus[];
  summary: ServerStatusSummary;
  operations: ServerOperationStatus;
  fetchedAt: string;
  partialFailures: string[];
};

export type ServerStatusSortKey = "name" | "health" | "status" | "docs" | "store";

export type ServerStatusSort = {
  key: ServerStatusSortKey;
  direction: "asc" | "desc";
};
