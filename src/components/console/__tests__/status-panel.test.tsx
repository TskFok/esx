/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../../types/connections";
import type { ServerStatusSnapshot } from "../../../types/status";

const { fetchServerStatusMock } = vi.hoisted(() => ({
  fetchServerStatusMock: vi.fn(),
}));

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

const snapshot = {
  cluster: {
    name: "esx-cluster",
    health: "green",
    nodes: 1,
    activePrimaryShards: 1,
    activeShards: 1,
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
    shardCounts: { started: 0, relocating: 0, initializing: 0, unassigned: 0, other: 0 },
  },
  operations: {
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
    gc: { collectionCount: 0, collectionTimeMs: 0 },
    threadPools: { active: 0, queue: 0, rejected: 0, completed: 0 },
    topThreadPools: [],
    breakers: { estimatedBytes: 0, limitBytes: 0, tripped: 0 },
    segments: { count: 0, memoryBytes: 0 },
    merges: { current: 0, total: 0, totalTimeMs: 0 },
    refresh: { total: 0, totalTimeMs: 0, avgMs: null },
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
  },
  risks: [],
  fetchedAt: "2026-09-01T08:00:00.000Z",
  partialFailures: [],
} satisfies ServerStatusSnapshot;

vi.mock("../../../providers/app-state", () => ({
  useAppState: vi.fn(),
}));

vi.mock("../../../lib/http-client", () => ({
  fetchServerStatus: fetchServerStatusMock,
}));

import { useAppState } from "../../../providers/app-state";
import { StatusPanel } from "../status-panel";

const useAppStateMock = vi.mocked(useAppState);

function renderPanel(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <StatusPanel onClose={onClose} />
      </QueryClientProvider>,
    ),
  };
}

describe("StatusPanel", () => {
  it("展示状态标题并支持关闭", async () => {
    fetchServerStatusMock.mockResolvedValue(snapshot);
    useAppStateMock.mockReturnValue({
      currentConnection: connection,
      getPassword: vi.fn(async () => "secret"),
      getSshSecret: vi.fn(async () => null),
      getSshProfileForConnection: vi.fn(() => null),
      recordErrorLog: vi.fn(),
      recordStatusSnapshot: vi.fn(),
      statusHistoryByConnection: {},
    } as unknown as ReturnType<typeof useAppState>);

    const { onClose } = renderPanel();

    expect(screen.getByText("服务器状态")).toBeInTheDocument();
    expect(screen.getByText(/开发集群/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭状态" }));
    expect(onClose).toHaveBeenCalledOnce();

    await waitFor(() => {
      expect(screen.getByText("esx-cluster")).toBeInTheDocument();
    });
  });
});
