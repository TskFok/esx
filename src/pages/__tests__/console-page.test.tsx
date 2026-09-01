/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSOLE_STATUS_PATH,
  CONSOLE_STATUS_VISIBLE_STORAGE_KEY,
  CONSOLE_WORKSPACE_PATH,
} from "../../lib/console-error-logs-panel";
import { createDefaultDraft } from "../../lib/storage";
import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../../types/ai-settings";
import type { ConnectionProfile } from "../../types/connections";

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

vi.mock("../../providers/app-state", () => ({
  useAppState: vi.fn(),
}));

vi.mock("../../components/console/status-panel", () => ({
  StatusPanel: () => <div>服务器状态</div>,
}));

vi.mock("../../components/console/admin-panel", () => ({
  AdminPanel: () => <div>治理工作台</div>,
}));

vi.mock("../../components/console/error-logs-panel", () => ({
  ErrorLogsPanel: () => <div>错误日志</div>,
}));

vi.mock("../../components/console/console-editor", () => ({
  ConsoleEditor: () => <div data-testid="console-editor" />,
}));

import { useAppState } from "../../providers/app-state";
import { ConsolePage } from "../console-page";

const useAppStateMock = vi.mocked(useAppState);

function renderConsolePage(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/console" element={<ConsolePage />} />
          <Route path="/connections" element={<div>connections-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createLocalStorageMock(),
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("1024px"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });

  useAppStateMock.mockReturnValue({
    currentConnection: connection,
    currentDraft: createDefaultDraft(connection.id),
    connections: [connection],
    requestsForCurrentConnection: [],
    searchMetadataByConnection: {},
    responsePreviewBytes: 256 * 1024,
    updateDraft: vi.fn(),
    setResponsePreviewBytes: vi.fn(),
    selectSavedRequest: vi.fn(),
    saveRequestFromDraft: vi.fn(),
    updateRequest: vi.fn(),
    bulkUpdateRequestTags: vi.fn(),
    deleteRequest: vi.fn(),
    duplicateRequest: vi.fn(),
    reorderConnectionRequests: vi.fn(),
    importConnectionRequests: vi.fn(),
    refreshSearchMetadata: vi.fn().mockResolvedValue(undefined),
    ensureIndexFields: vi.fn().mockResolvedValue(undefined),
    getPassword: vi.fn().mockResolvedValue(null),
    getSshSecret: vi.fn().mockResolvedValue(null),
    getSshProfileForConnection: vi.fn(() => null),
    recordErrorLog: vi.fn(),
    recordAuditLog: vi.fn(),
    aiSettings: { ...DEFAULT_AI_ANALYSIS_SETTINGS },
    aiApiKeyConfigured: false,
    aiAnalysisHistory: [],
    saveAiSettings: vi.fn(),
    getAiApiKey: vi.fn().mockResolvedValue(null),
    recordAiAnalysisHistory: vi.fn(),
    clearAiAnalysisHistory: vi.fn(),
  } as unknown as ReturnType<typeof useAppState>);
});

describe("ConsolePage right pane", () => {
  it("带 workspace=1 进入时即使已持久化状态面板也展示请求工作区", async () => {
    window.localStorage.setItem(CONSOLE_STATUS_VISIBLE_STORAGE_KEY, "true");

    renderConsolePage(CONSOLE_WORKSPACE_PATH);

    await waitFor(() => {
      expect(screen.getByText("格式化 JSON")).toBeInTheDocument();
    });
    expect(screen.queryByText("服务器状态")).not.toBeInTheDocument();
    expect(screen.queryByText("治理工作台")).not.toBeInTheDocument();
  });

  it("无面板参数进入时恢复已持久化的状态面板", async () => {
    window.localStorage.setItem(CONSOLE_STATUS_VISIBLE_STORAGE_KEY, "true");

    renderConsolePage("/console");

    await waitFor(() => {
      expect(screen.getByText("服务器状态")).toBeInTheDocument();
    });
    expect(screen.queryByText("格式化 JSON")).not.toBeInTheDocument();
  });

  it("带 status=1 进入时打开状态面板", async () => {
    renderConsolePage(CONSOLE_STATUS_PATH);

    await waitFor(() => {
      expect(screen.getByText("服务器状态")).toBeInTheDocument();
    });
    expect(screen.queryByText("格式化 JSON")).not.toBeInTheDocument();
  });

  it("点击控制台按钮从状态面板切回请求工作区", async () => {
    renderConsolePage(CONSOLE_STATUS_PATH);

    await waitFor(() => {
      expect(screen.getByText("服务器状态")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "控制台" }));

    await waitFor(() => {
      expect(screen.getByText("格式化 JSON")).toBeInTheDocument();
    });
    expect(screen.getByText("请求内容")).toBeInTheDocument();
    expect(screen.getByText("返回内容")).toBeInTheDocument();
    expect(screen.queryByText("服务器状态")).not.toBeInTheDocument();
  });

  it("点击连接页按钮进入连接管理页", async () => {
    renderConsolePage("/console");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "连接页" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "连接页" }));

    expect(screen.getByText("connections-page")).toBeInTheDocument();
  });
});
