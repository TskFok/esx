/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSOLE_ADMIN_PATH,
  CONSOLE_ERROR_LOGS_PATH,
  CONSOLE_STATUS_PATH,
  CONSOLE_STATUS_VISIBLE_STORAGE_KEY,
  CONSOLE_WORKSPACE_PATH,
} from "../../lib/console-error-logs-panel";
import { createDefaultDraft } from "../../lib/storage";
import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../../types/ai-settings";
import type { ConnectionProfile } from "../../types/connections";
import type { ConnectionSearchMetadata, SavedRequest } from "../../types/requests";

const { staticBuildSpy, editorContextRefs, requestListRenderSpy, editorModuleLoaded, aiSettingsGate, aiSettingsMounts } = vi.hoisted(() => ({
  staticBuildSpy: vi.fn(),
  editorContextRefs: [] as unknown[],
  requestListRenderSpy: vi.fn(),
  editorModuleLoaded: vi.fn(),
  aiSettingsMounts: vi.fn(),
  aiSettingsGate: (() => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  })(),
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

const savedRequest = {
  id: "req-1",
  connectionId: connection.id,
  name: "健康检查",
  method: "GET",
  path: "/_cluster/health",
  body: "",
  tags: [],
  sortOrder: 0,
  lastResponse: null,
  lastStatus: null,
  lastDurationMs: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
} satisfies SavedRequest;

vi.mock("../../providers/app-state", () => ({
  useAppState: vi.fn(),
}));

vi.mock("../../lib/console-autocomplete", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/console-autocomplete")>();
  return {
    ...actual,
    buildConsoleAutocompleteStaticContext: (...args: Parameters<typeof actual.buildConsoleAutocompleteStaticContext>) => {
      staticBuildSpy();
      return actual.buildConsoleAutocompleteStaticContext(...args);
    },
  };
});

vi.mock("../../components/console/console-request-list", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/console/console-request-list")>();
  return {
    ...actual,
    ConsoleRequestList: (props: Parameters<typeof actual.ConsoleRequestList>[0]) => {
      requestListRenderSpy();
      return <actual.ConsoleRequestList {...props} />;
    },
  };
});

vi.mock("../../components/console/status-panel", () => ({
  StatusPanel: () => <div>服务器状态</div>,
}));

vi.mock("../../components/console/admin-panel", () => ({
  AdminPanel: () => <div>治理工作台</div>,
}));

vi.mock("../../components/console/error-logs-panel", () => ({
  ErrorLogsPanel: () => <div>错误日志面板</div>,
}));

vi.mock("../../components/console/console-editor", () => {
  editorModuleLoaded();
  return {
    ConsoleEditor: ({ value, onChange, autocompleteContext, readOnly }: {
      value: string;
      onChange: (value: string) => void;
      autocompleteContext: unknown;
      readOnly?: boolean;
    }) => {
      if (!readOnly) editorContextRefs.push(autocompleteContext);
      return (
        <textarea
          aria-label={readOnly ? "测试响应内容" : "测试请求内容"}
          readOnly={readOnly}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    },
  };
});

vi.mock("../../components/console/ai-settings-dialog", async () => {
  await aiSettingsGate.promise;
  const { useEffect } = await import("react");
  return {
    AiSettingsDialog: ({ open }: { open: boolean }) => {
      useEffect(() => { aiSettingsMounts(); }, []);
      return open ? <div role="dialog">AI 设置已加载</div> : null;
    },
  };
});
vi.mock("../../components/console/ai-analysis-dialog", () => {
  return { AiAnalysisDialog: () => null };
});
vi.mock("../../components/console/ai-generate-dialog", () => {
  return { AiGenerateDialog: () => null };
});

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

  const page = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/console" element={<ConsolePage />} />
          <Route path="/connections" element={<div>connections-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(page());
  return { ...result, rerenderPage: () => result.rerender(page()) };
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
  staticBuildSpy.mockClear();
  requestListRenderSpy.mockClear();
  editorContextRefs.length = 0;
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
    requestsForCurrentConnection: [savedRequest],
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

it("状态面板不额外加载编辑器，切换工作区后保留草稿", async () => {
  const loadCount = editorModuleLoaded.mock.calls.length;
  renderConsolePage(CONSOLE_STATUS_PATH);
  expect(await screen.findByText("服务器状态")).toBeInTheDocument();
  expect(editorModuleLoaded).toHaveBeenCalledTimes(loadCount);

  fireEvent.click(screen.getByRole("button", { name: "控制台" }));
  const input = await screen.findByRole("textbox", { name: "测试请求内容" });
  const loadedCount = editorModuleLoaded.mock.calls.length;
  expect(loadedCount).toBeGreaterThan(0);
  fireEvent.change(input, { target: { value: "GET /draft-check" } });
  fireEvent.click(screen.getByRole("button", { name: "状态" }));
  expect(await screen.findByText("服务器状态")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "控制台" }));
  expect(await screen.findByRole("textbox", { name: "测试请求内容" })).toHaveValue("GET /draft-check");
  expect(editorModuleLoaded).toHaveBeenCalledTimes(loadedCount);
});

describe("ConsolePage 补全上下文", () => {
  it("正文输入不会重新渲染请求列表", async () => {
    renderConsolePage(CONSOLE_WORKSPACE_PATH);
    const input = await screen.findByRole("textbox", { name: "测试请求内容" });
    const initialRenders = requestListRenderSpy.mock.calls.length;
    expect(initialRenders).toBeGreaterThan(0);
    for (let index = 0; index < 20; index++) {
      fireEvent.change(input, { target: { value: `POST /items/_search\n{"size":${index}}` } });
    }

    expect(requestListRenderSpy).toHaveBeenCalledTimes(initialRenders);
  });

  it("正文连续编辑不重建静态元数据，连接与 metadata 更新时重建", async () => {
    const initialMetadata: ConnectionSearchMetadata = {
      connectionId: connection.id,
      indices: ["orders"],
      aliases: [],
      fields: ["price"],
      fieldsByIndex: { orders: ["price"] },
      aliasToIndices: {},
      cluster: {
        product: "unknown",
        version: { number: null, major: null, minor: null },
        distribution: null,
        buildFlavor: null,
        license: { type: null, status: null, source: "unknown" },
      },
      fetchedAt: "2026-09-28T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const initialState = useAppStateMock();
    useAppStateMock.mockReturnValue({
      ...initialState,
      searchMetadataByConnection: { [connection.id]: initialMetadata },
    } as ReturnType<typeof useAppState>);
    const view = renderConsolePage(CONSOLE_WORKSPACE_PATH);
    const input = await screen.findByRole("textbox", { name: "测试请求内容" });

    expect(staticBuildSpy).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "POST /orders/_search\n{}" } });
    const firstContext = editorContextRefs[editorContextRefs.length - 1];
    for (let i = 0; i < 100; i += 1) {
      fireEvent.change(input, { target: { value: `POST /orders/_search\n${"x".repeat(i + 1)}` } });
    }
    expect(staticBuildSpy).toHaveBeenCalledTimes(1);
    expect(editorContextRefs[editorContextRefs.length - 1]).toBe(firstContext);

    const otherConnection = { ...connection, id: "conn-2", name: "另一集群" };
    useAppStateMock.mockReturnValue({
      ...initialState,
      currentConnection: otherConnection,
      currentDraft: createDefaultDraft(otherConnection.id),
      connections: [connection, otherConnection],
      requestsForCurrentConnection: [],
      searchMetadataByConnection: { [connection.id]: initialMetadata },
    } as ReturnType<typeof useAppState>);
    view.rerenderPage();
    expect(staticBuildSpy).toHaveBeenCalledTimes(2);

    const replacementMetadata = { ...initialMetadata, connectionId: otherConnection.id, fields: ["new.field"] };
    useAppStateMock.mockReturnValue({
      ...initialState,
      currentConnection: otherConnection,
      currentDraft: createDefaultDraft(otherConnection.id),
      connections: [connection, otherConnection],
      requestsForCurrentConnection: [],
      searchMetadataByConnection: { [otherConnection.id]: replacementMetadata },
    } as ReturnType<typeof useAppState>);
    view.rerenderPage();
    expect(staticBuildSpy).toHaveBeenCalledTimes(3);
  });
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

  it.each([
    ["状态", CONSOLE_STATUS_PATH, "服务器状态"],
    ["治理", CONSOLE_ADMIN_PATH, "治理工作台"],
    ["错误日志", CONSOLE_ERROR_LOGS_PATH, "错误日志面板"],
  ] as const)("在%s页点击已保存请求时切回控制台", async (_label, path, panelText) => {
    const selectSavedRequest = vi.fn();
    useAppStateMock.mockReturnValue({
      ...useAppStateMock(),
      selectSavedRequest,
    } as unknown as ReturnType<typeof useAppState>);

    renderConsolePage(path);

    await waitFor(() => {
      expect(screen.getByText(panelText)).toBeInTheDocument();
    });
    expect(screen.queryByText("格式化 JSON")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("健康检查"));

    await waitFor(() => {
      expect(screen.getByText("格式化 JSON")).toBeInTheDocument();
    });
    expect(screen.getByText("请求内容")).toBeInTheDocument();
    expect(screen.queryByText(panelText)).not.toBeInTheDocument();
    expect(selectSavedRequest).toHaveBeenCalledWith(savedRequest.id);
  });

  it("在状态页点击新建时切回控制台", async () => {
    const createdRequest = {
      ...savedRequest,
      id: "req-new",
      name: "未命名请求",
    } satisfies SavedRequest;
    const selectSavedRequest = vi.fn();
    const saveRequestFromDraft = vi.fn().mockReturnValue(createdRequest);
    useAppStateMock.mockReturnValue({
      ...useAppStateMock(),
      selectSavedRequest,
      saveRequestFromDraft,
    } as unknown as ReturnType<typeof useAppState>);

    renderConsolePage(CONSOLE_STATUS_PATH);

    await waitFor(() => {
      expect(screen.getByText("服务器状态")).toBeInTheDocument();
    });
    expect(screen.queryByText("格式化 JSON")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新建" }));

    await waitFor(() => {
      expect(screen.getByText("格式化 JSON")).toBeInTheDocument();
    });
    expect(screen.getByText("请求内容")).toBeInTheDocument();
    expect(screen.queryByText("服务器状态")).not.toBeInTheDocument();
    expect(saveRequestFromDraft).toHaveBeenCalledOnce();
    expect(selectSavedRequest).toHaveBeenCalledWith(createdRequest.id);
  });

  it("在状态页点击复制请求时切回控制台", async () => {
    const duplicatedRequest = {
      ...savedRequest,
      id: "req-copy",
      name: "健康检查 副本",
    } satisfies SavedRequest;
    const selectSavedRequest = vi.fn();
    const duplicateRequest = vi.fn().mockReturnValue(duplicatedRequest);
    useAppStateMock.mockReturnValue({
      ...useAppStateMock(),
      selectSavedRequest,
      duplicateRequest,
    } as unknown as ReturnType<typeof useAppState>);

    renderConsolePage(CONSOLE_STATUS_PATH);

    await waitFor(() => {
      expect(screen.getByText("服务器状态")).toBeInTheDocument();
    });
    expect(screen.queryByText("格式化 JSON")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制请求" }));

    await waitFor(() => {
      expect(screen.getByText("格式化 JSON")).toBeInTheDocument();
    });
    expect(screen.getByText("请求内容")).toBeInTheDocument();
    expect(screen.queryByText("服务器状态")).not.toBeInTheDocument();
    expect(duplicateRequest).toHaveBeenCalledWith(savedRequest.id, "健康检查 副本");
    expect(selectSavedRequest).toHaveBeenCalledWith(duplicatedRequest.id);
  });

  it("AI 设置加载期间点击或按 Escape 均可关闭，重新打开不重新挂载", async () => {
    renderConsolePage(CONSOLE_WORKSPACE_PATH);
    fireEvent.click(screen.getByRole("button", { name: "AI 分析设置" }));
    expect(screen.getByRole("status", { name: "正在加载 AI 设置" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消加载" }));
    expect(screen.queryByRole("status", { name: "正在加载 AI 设置" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI 分析设置" }));
    expect(screen.getByRole("status", { name: "正在加载 AI 设置" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("status", { name: "正在加载 AI 设置" }), { key: "Escape" });
    expect(screen.queryByRole("status", { name: "正在加载 AI 设置" })).not.toBeInTheDocument();

    await act(async () => { aiSettingsGate.resolve(); await aiSettingsGate.promise; });
    expect(screen.queryByText("AI 设置已加载")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AI 分析设置" }));
    expect(await screen.findByText("AI 设置已加载")).toBeInTheDocument();
    expect(aiSettingsMounts).toHaveBeenCalledTimes(1);
  });
});
