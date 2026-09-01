/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../../types/connections";
import type {
  ClusterOverviewSnapshot,
  IndicesStatusSnapshot,
  OperationsStatusSnapshot,
} from "../../../types/status";

const { fetchClusterOverviewMock, fetchOperationsStatusMock, fetchIndicesStatusMock, toastErrorMock } = vi.hoisted(() => ({
  fetchClusterOverviewMock: vi.fn(),
  fetchOperationsStatusMock: vi.fn(),
  fetchIndicesStatusMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("../../../lib/http-client", () => ({
  fetchClusterOverview: fetchClusterOverviewMock,
  fetchOperationsStatus: fetchOperationsStatusMock,
  fetchIndicesStatus: fetchIndicesStatusMock,
}));

vi.mock("../../../providers/app-state", () => ({
  useAppState: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

import { useAppState } from "../../../providers/app-state";
import { StatusPanel } from "../status-panel";

const useAppStateMock = vi.mocked(useAppState);

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

const overviewSnapshot = {
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
  summary: {
    totalIndices: 1,
    systemIndices: 0,
    healthCounts: { green: 1, yellow: 0, red: 0, unknown: 0 },
    shardCounts: { started: 1, relocating: 0, initializing: 0, unassigned: 0, other: 0 },
  },
  risks: [],
  fetchedAt: "2026-09-01T08:00:00.000Z",
} satisfies ClusterOverviewSnapshot;

const operationsSnapshot = {
  operations: {
    nodeCount: 1,
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
    search: { queryTotal: 0, queryTimeMs: 0, queryAvgMs: null, fetchTotal: 0, fetchTimeMs: 0, fetchAvgMs: null },
    indexing: { indexTotal: 0, indexTimeMs: 0, indexAvgMs: null, deleteTotal: 0, deleteTimeMs: 0, deleteAvgMs: null },
    nodes: [],
  },
  risks: [],
  fetchedAt: "2026-09-01T08:00:00.000Z",
  partialFailures: [],
} satisfies OperationsStatusSnapshot;

const indicesSnapshot = {
  indices: [
    {
      name: "orders",
      health: "green",
      status: "open",
      primaryShards: 1,
      replicaShards: 1,
      docsCount: 10,
      docsDeleted: 0,
      storeBytes: 1024,
      primaryStoreBytes: 512,
      shardSummary: { started: 1, relocating: 0, initializing: 0, unassigned: 0, other: 0 },
    },
  ],
  summary: { totalIndices: 1, systemIndices: 0, visibleStoreBytes: 1024, visibleDocsCount: 10 },
  risks: [],
  fetchedAt: "2026-09-01T08:00:00.000Z",
} satisfies IndicesStatusSnapshot;

function renderPanel(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
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
  const recordErrorLog = vi.fn();
  const recordStatusSnapshot = vi.fn();

  beforeEach(() => {
    fetchClusterOverviewMock.mockReset().mockResolvedValue(overviewSnapshot);
    fetchOperationsStatusMock.mockReset().mockResolvedValue(operationsSnapshot);
    fetchIndicesStatusMock.mockReset().mockResolvedValue(indicesSnapshot);
    toastErrorMock.mockReset();
    recordErrorLog.mockReset();
    recordStatusSnapshot.mockReset();
    useAppStateMock.mockReturnValue({
      currentConnection: connection,
      getPassword: vi.fn(async () => "secret"),
      getSshSecret: vi.fn(async () => null),
      getSshProfileForConnection: vi.fn(() => null),
      recordErrorLog,
      recordStatusSnapshot,
      statusHistoryByConnection: {},
    } as unknown as ReturnType<typeof useAppState>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("挂载后只请求概览标签", async () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "概览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运维" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "索引" })).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchClusterOverviewMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchOperationsStatusMock).not.toHaveBeenCalled();
    expect(fetchIndicesStatusMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText("esx-cluster")).toBeInTheDocument();
    });
  });

  it("切到运维标签才请求运维探测，切回概览不重复请求", async () => {
    renderPanel();

    await waitFor(() => {
      expect(fetchClusterOverviewMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "运维" }));

    await waitFor(() => {
      expect(fetchOperationsStatusMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(recordStatusSnapshot).toHaveBeenCalledWith(connection.id, operationsSnapshot);
    });

    fireEvent.click(screen.getByRole("button", { name: "概览" }));

    expect(fetchClusterOverviewMock).toHaveBeenCalledTimes(1);
  });

  it("点击刷新状态只重新请求当前标签", async () => {
    renderPanel();

    await waitFor(() => {
      expect(fetchClusterOverviewMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /刷新状态/ }));

    await waitFor(() => {
      expect(fetchClusterOverviewMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchOperationsStatusMock).not.toHaveBeenCalled();
  });

  it("仅在当前标签产生新错误时通知并记录", async () => {
    fetchClusterOverviewMock.mockRejectedValue(new Error("概览读取失败"));
    renderPanel();

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect(recordErrorLog).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "运维" }));
    await waitFor(() => {
      expect(fetchOperationsStatusMock).toHaveBeenCalledTimes(1);
    });

    const requestCountBeforeReturn = fetchClusterOverviewMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "概览" }));
    await waitFor(() => {
      expect(fetchClusterOverviewMock).toHaveBeenCalledTimes(requestCountBeforeReturn + 1);
    });
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(recordErrorLog).toHaveBeenCalledTimes(1);

    const requestCountBeforeRefresh = fetchClusterOverviewMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /刷新状态/ }));
    await waitFor(() => {
      expect(fetchClusterOverviewMock).toHaveBeenCalledTimes(requestCountBeforeRefresh + 1);
      expect(toastErrorMock).toHaveBeenCalledTimes(2);
      expect(recordErrorLog).toHaveBeenCalledTimes(2);
    });
  });

  it("切到索引标签展示索引数据且不含 Shards 列", async () => {
    renderPanel();

    await waitFor(() => {
      expect(fetchClusterOverviewMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "索引" }));

    await waitFor(() => {
      expect(fetchIndicesStatusMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText("orders")).toBeInTheDocument();
    });

    expect(screen.queryByText("Shards")).not.toBeInTheDocument();
  });

  it("缓存过期后切回已访问标签会重新请求", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T08:00:00.000Z"));

    renderPanel();

    await waitFor(() => {
      expect(fetchClusterOverviewMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "运维" }));
    await waitFor(() => {
      expect(fetchOperationsStatusMock).toHaveBeenCalledTimes(1);
    });

    vi.setSystemTime(new Date("2026-09-01T08:00:30.001Z"));

    fireEvent.click(screen.getByRole("button", { name: "概览" }));

    await waitFor(() => {
      expect(fetchClusterOverviewMock).toHaveBeenCalledTimes(2);
    });
  });

  it("关闭按钮仍调用 onClose", async () => {
    const { onClose } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "关闭状态" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
