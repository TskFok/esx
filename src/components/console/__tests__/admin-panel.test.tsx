/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPanel } from "../admin-panel";
import type { ConnectionProfile } from "../../../types/connections";
import type { AdminExecutionResult } from "../../../types/admin";

const updateDraftMock = vi.fn();
const recordAuditLogMock = vi.fn();
const recordErrorLogMock = vi.fn();
const { executeAdminOperationMock } = vi.hoisted(() => ({ executeAdminOperationMock: vi.fn() }));
vi.mock("../../../lib/http-client", () => ({ executeAdminOperation: executeAdminOperationMock }));

const connection = {
  id: "conn-1",
  name: "开发集群",
  baseUrl: "https://es.example.com",
  username: "elastic",
  auth: { type: "basic" },
  tls: { mode: "default" },
  environment: "dev",
  readonly: false,
  insecureTls: false,
  sshProfileId: null,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
  lastUsedAt: "2026-06-04T00:00:00.000Z",
} satisfies ConnectionProfile;
let activeConnection: ConnectionProfile = connection;
const anotherConnection = { ...connection, id: "conn-2", name: "另一个集群", baseUrl: "https://second.example.com", updatedAt: "2026-06-05T00:00:00.000Z" };

vi.mock("../../../providers/app-state", () => {
  const useAppState = () => ({
    currentConnection: activeConnection,
    updateDraft: updateDraftMock,
    getPassword: vi.fn(async () => "secret"),
    getSshSecret: vi.fn(async () => null),
    getSshProfileForConnection: vi.fn(() => null),
    recordErrorLog: recordErrorLogMock,
    recordAuditLog: recordAuditLogMock,
  });
  return { useAppState, useAppStateField: (key: keyof ReturnType<typeof useAppState>) => useAppState()[key], useAppActions: useAppState };
});

function renderAdminPanel(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const panel = <QueryClientProvider client={queryClient}><AdminPanel onClose={onClose} /></QueryClientProvider>;
  const rendered = render(panel);
  return {
    onClose,
    queryClient,
    ...rendered,
    rerenderPanel: () => rendered.rerender(<QueryClientProvider client={queryClient}><AdminPanel onClose={onClose} /></QueryClientProvider>),
  };
}

describe("AdminPanel", () => {
  beforeEach(() => {
    activeConnection = connection;
    recordAuditLogMock.mockReset();
    recordErrorLogMock.mockReset();
    executeAdminOperationMock.mockReset().mockImplementation(async (_connection, _credentials, operation) => ({
      operation, ok: true, status: 200, statusText: "OK", durationMs: 1, executedAt: new Date().toISOString(),
      bodyText: operation.id === "resources-indices" ? "[]" : operation.id === "resources-aliases" ? "[]" :
        operation.id === "resources-index-templates" ? '{"index_templates":[]}' :
        operation.id === "resources-component-templates" ? '{"component_templates":[]}' : "{}",
      diagnostics: [],
    }));
  });

  it.each([
    { ok: true, expectedLog: recordAuditLogMock },
    { ok: false, expectedLog: recordErrorLogMock },
  ])("连接切换后仍将请求结果与缓存归属到发起连接（ok=$ok）", async ({ ok, expectedLog }) => {
    let finishWrite!: (result: AdminExecutionResult) => void;
    const initialImplementation = executeAdminOperationMock.getMockImplementation();
    executeAdminOperationMock.mockImplementation((...args) => args[2].id === "index-create"
      ? new Promise<AdminExecutionResult>((resolve) => { finishWrite = resolve; })
      : initialImplementation?.(...args));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { queryClient, rerenderPanel } = renderAdminPanel();
    await waitFor(() => expect(executeAdminOperationMock.mock.calls.filter((call) => call[2].id === "resources-indices")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "生成创建索引请求" }));
    fireEvent.click(screen.getByRole("button", { name: "直接执行" }));
    await waitFor(() => expect(executeAdminOperationMock.mock.calls.some((call) => call[2].id === "index-create")).toBe(true));
    expect(executeAdminOperationMock.mock.calls.find((call) => call[2].id === "index-create")?.[0].id).toBe(connection.id);

    activeConnection = anotherConnection;
    rerenderPanel();
    await waitFor(() => expect(executeAdminOperationMock.mock.calls.filter((call) => call[2].id === "resources-indices")).toHaveLength(2));
    const operation = executeAdminOperationMock.mock.calls.find((call) => call[2].id === "index-create")?.[2];
    finishWrite({ operation, ok, status: ok ? 200 : 403, statusText: ok ? "OK" : "Forbidden", durationMs: 1,
      executedAt: new Date().toISOString(), bodyText: ok ? "{}" : '{"error":"forbidden"}', diagnostics: [] });
    await waitFor(() => expect(expectedLog).toHaveBeenCalledOnce());
    expect(expectedLog.mock.calls[0][0].connection.name).toBe(connection.name);
    expect(expectedLog.mock.calls[0][0].connection.baseUrl).toBe(connection.baseUrl);
    expect(queryClient.getQueryState(["admin-resources", anotherConnection.id, anotherConnection.updatedAt, "indices"])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["admin-resources", connection.id, connection.updatedAt, "indices"])?.isInvalidated).toBe(ok);
    confirmSpy.mockRestore();
  });

  it("Alias 增加新目标后会刷新同名 Alias 已有目标的详情", async () => {
    const initialImplementation = executeAdminOperationMock.getMockImplementation();
    executeAdminOperationMock.mockImplementation(async (...args) => {
      const operation = args[2];
      if (operation.id === "resources-aliases") return { operation, ok: true, status: 200, statusText: "OK", durationMs: 1,
        executedAt: new Date().toISOString(), bodyText: '[{"alias":"logs","index":"existing-index"}]', diagnostics: [] };
      return initialImplementation?.(...args);
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAdminPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: /logs Alias/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /logs Alias/ }));
    await waitFor(() => expect(executeAdminOperationMock.mock.calls.filter((call) => call[2].id === "resource-detail")).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Alias 名称"), { target: { value: "logs" } });
    fireEvent.change(screen.getByLabelText("移除 Index（逗号或换行）"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("新增 Index（逗号或换行）"), { target: { value: "new-index" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Alias 切换请求" }));
    fireEvent.click(screen.getByRole("button", { name: "直接执行" }));
    await waitFor(() => expect(executeAdminOperationMock.mock.calls.filter((call) => call[2].id === "resource-detail")).toHaveLength(2));
    confirmSpy.mockRestore();
  });

  it("只读取当前功能区，刷新不触发其他区，选中后才请求详情", async () => {
    executeAdminOperationMock.mockImplementation(async (_connection, _credentials, operation) => ({
      operation, ok: true, status: 200, statusText: "OK", durationMs: 1, executedAt: new Date().toISOString(), diagnostics: [],
      bodyText: operation.id === "resources-indices" ? '[{"index":"orders","health":"green","status":"open"}]' :
        operation.id === "resources-aliases" ? "[]" :
        operation.id === "resources-index-templates" ? '{"index_templates":[{"name":"orders-template","index_template":{"index_patterns":["orders-*"]}}]}' :
        operation.id === "resources-component-templates" ? '{"component_templates":[]}' : "{}",
    }));
    renderAdminPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: /orders Index/ })).toBeInTheDocument());
    const ids = () => executeAdminOperationMock.mock.calls.map((call) => call[2].id);
    expect(ids()).toEqual(expect.arrayContaining(["resources-indices", "resources-aliases"]));
    expect(ids()).not.toContain("resources-index-templates");
    expect(ids()).not.toContain("resources-pipelines");
    expect(ids()).not.toContain("resource-detail");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(ids().filter((id) => id === "resources-indices")).toHaveLength(2));
    expect(ids()).not.toContain("resources-index-templates");
    fireEvent.click(screen.getByRole("button", { name: "模板/管道" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /orders-template Index Template/ })).toBeInTheDocument());
    expect(ids()).toEqual(expect.arrayContaining(["resources-index-templates", "resources-component-templates", "resources-pipelines"]));
    fireEvent.click(screen.getByRole("button", { name: /orders-template Index Template/ }));
    await waitFor(() => expect(ids()).toContain("resource-detail"));
    expect(executeAdminOperationMock.mock.calls.find((call) => call[2].id === "resource-detail")?.[2].path)
      .toBe("/_index_template/orders-template");
    expect(executeAdminOperationMock.mock.calls.find((call) => call[2].id === "resources-index-templates")?.[2].path)
      .toContain("filter_path=");
  });

  it("部分列表无权限时保留可读取的资源并提示失败", async () => {
    executeAdminOperationMock.mockImplementation(async (_connection, _credentials, operation) => ({
      operation, ok: operation.id !== "resources-aliases", status: operation.id === "resources-aliases" ? 403 : 200,
      statusText: operation.id === "resources-aliases" ? "Forbidden" : "OK", durationMs: 1,
      executedAt: new Date().toISOString(), diagnostics: [],
      bodyText: operation.id === "resources-indices" ? '[{"index":"orders","health":"green","status":"open"}]' : '{"error":"forbidden"}',
    }));
    renderAdminPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: /orders Index/ })).toBeInTheDocument());
    expect(screen.getByText(/Alias 列表.*403|Alias 列表.*Forbidden/)).toBeInTheDocument();
  });

  it("写入成功后仅重新读取关联功能区，失败响应不触发失效", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAdminPanel();
    await waitFor(() => expect(executeAdminOperationMock.mock.calls.filter((call) => call[2].id === "resources-indices")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "模板/管道" }));
    await waitFor(() => expect(executeAdminOperationMock.mock.calls.filter((call) => call[2].id === "resources-index-templates")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "索引治理" }));
    fireEvent.click(screen.getByRole("button", { name: "生成创建索引请求" }));
    fireEvent.click(screen.getByRole("button", { name: "直接执行" }));
    await waitFor(() => expect(executeAdminOperationMock.mock.calls.filter((call) => call[2].id === "resources-indices")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "模板/管道" }));
    expect(executeAdminOperationMock.mock.calls.filter((call) => call[2].id === "resources-index-templates")).toHaveLength(1);
    const originalImplementation = executeAdminOperationMock.getMockImplementation();
    executeAdminOperationMock.mockImplementation(async (...args) => args[2].id === "index-create" ? {
      operation: args[2], ok: false, status: 403, statusText: "Forbidden", durationMs: 1,
      executedAt: new Date().toISOString(), bodyText: '{"error":"forbidden"}', diagnostics: [],
    } : originalImplementation?.(...args));
    fireEvent.click(screen.getByRole("button", { name: "索引治理" }));
    fireEvent.click(screen.getByRole("button", { name: "生成创建索引请求" }));
    fireEvent.click(screen.getByRole("button", { name: "直接执行" }));
    await waitFor(() => expect(executeAdminOperationMock.mock.calls.filter((call) => call[2].id === "index-create")).toHaveLength(2));
    expect(executeAdminOperationMock.mock.calls.filter((call) => call[2].id === "resources-indices")).toHaveLength(2);
    confirmSpy.mockRestore();
  });

  it("Mapping 差异表仅渲染当前页，汇总保留全部字段", async () => {
    const properties = Object.fromEntries(Array.from({ length: 230 }, (_, index) => [`field_${String(index).padStart(3, "0")}`, { type: "keyword" }]));
    executeAdminOperationMock.mockImplementation(async (_connection, _credentials, operation) => ({
      operation, ok: true, status: 200, statusText: "OK", durationMs: 1, executedAt: new Date().toISOString(), diagnostics: [],
      bodyText: operation.id === "index-mapping-get" ? JSON.stringify({ [operation.path.split("/")[1]]: { mappings: { properties } } }) :
        operation.id === "resources-indices" || operation.id === "resources-aliases" ? "[]" : "{}",
    }));
    renderAdminPanel();
    fireEvent.click(screen.getByRole("button", { name: "拉取并对比 Mapping" }));
    await waitFor(() => expect(screen.getByText("未变 230")).toBeInTheDocument());
    expect(screen.getByText("field_000")).toBeInTheDocument();
    expect(screen.queryByText("field_100")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页差异" }));
    expect(screen.getByText("field_100")).toBeInTheDocument();
    expect(screen.queryByText("field_000")).not.toBeInTheDocument();
  });

  it("千条资源只渲染当前页的 100 项", async () => {
    executeAdminOperationMock.mockImplementation(async (_connection, _credentials, operation) => ({
      operation, ok: true, status: 200, statusText: "OK", durationMs: 1, executedAt: new Date().toISOString(), diagnostics: [],
      bodyText: operation.id === "resources-indices" ? JSON.stringify(Array.from({ length: 1000 }, (_, index) => ({ index: `index-${String(index).padStart(4, "0")}` }))) : "[]",
    }));
    renderAdminPanel();
    await waitFor(() => expect(screen.getByText("index-0000")).toBeInTheDocument());
    expect(screen.getAllByTestId("admin-resource-row")).toHaveLength(100);
    fireEvent.click(screen.getByRole("button", { name: "下一页资源" }));
    expect(screen.getAllByTestId("admin-resource-row")).toHaveLength(100);
    expect(screen.getByText("index-0100")).toBeInTheDocument();
    expect(screen.queryByText("index-0000")).not.toBeInTheDocument();
  });
  it("renders workbench sections and supports close", () => {
    const { onClose } = renderAdminPanel();

    expect(screen.getByRole("heading", { name: "治理工作台" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "索引治理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "模板/管道" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分析工具" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭治理" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("generates create index preview and can send it to Console", () => {
    const { onClose } = renderAdminPanel();

    fireEvent.change(screen.getByLabelText("索引名称"), { target: { value: "orders" } });
    fireEvent.click(screen.getByRole("button", { name: "生成创建索引请求" }));

    expect(screen.getByText(/PUT \/orders/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "发送到 Console" }));

    expect(updateDraftMock).toHaveBeenCalledWith("conn-1", expect.any(Function));
    const lastCall = updateDraftMock.mock.calls[updateDraftMock.mock.calls.length - 1];
    const updater = lastCall?.[1] as (draft: unknown) => unknown;
    expect(updater({ connectionId: "conn-1", name: "", content: "", activeSavedRequestId: null, response: null }))
      .toMatchObject({
        name: "创建索引",
        content: expect.stringContaining("PUT /orders"),
        activeSavedRequestId: null,
        response: null,
      });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("switches to analyze tool section", () => {
    renderAdminPanel();

    fireEvent.click(screen.getByRole("button", { name: "分析工具" }));

    const panel = screen.getByTestId("admin-tools-panel");
    expect(within(panel).getByRole("heading", { name: "Analyzer / Tokenizer 测试" })).toBeInTheDocument();
  });
});
