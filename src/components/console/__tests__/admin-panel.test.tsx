/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { AdminPanel } from "../admin-panel";
import type { ConnectionProfile } from "../../../types/connections";

const updateDraftMock = vi.fn();

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

vi.mock("../../../providers/app-state", () => ({
  useAppState: () => ({
    currentConnection: connection,
    updateDraft: updateDraftMock,
    getPassword: vi.fn(async () => "secret"),
    getSshSecret: vi.fn(async () => null),
    getSshProfileForConnection: vi.fn(() => null),
    recordErrorLog: vi.fn(),
    recordAuditLog: vi.fn(),
  }),
}));

function renderAdminPanel(onClose = vi.fn()) {
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
        <AdminPanel onClose={onClose} />
      </QueryClientProvider>,
    ),
  };
}

describe("AdminPanel", () => {
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
