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

export type ServerStatusSnapshot = {
  cluster: ClusterStatus;
  indices: IndexStatus[];
  summary: ServerStatusSummary;
  fetchedAt: string;
  partialFailures: string[];
};

export type ServerStatusSortKey = "name" | "health" | "status" | "docs" | "store";

export type ServerStatusSort = {
  key: ServerStatusSortKey;
  direction: "asc" | "desc";
};
