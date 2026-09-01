/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsPage } from "../connections-page";
import type { ConnectionProfile } from "../../types/connections";

const navigateMock = vi.fn();
const setCurrentConnectionMock = vi.fn();

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

vi.mock("react-router-dom", () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  useNavigate: () => navigateMock,
}));

vi.mock("../../providers/app-state", () => ({
  useAppState: () => ({
    connections: [connection],
    sshProfiles: [],
    currentConnection: connection,
    upsertConnection: vi.fn(),
    upsertSshProfile: vi.fn(),
    deleteConnection: vi.fn(),
    deleteSshProfile: vi.fn(),
    setCurrentConnection: setCurrentConnectionMock,
    exportConnections: vi.fn(),
    importConnections: vi.fn(),
    getPassword: vi.fn(async () => "secret"),
    getSshSecret: vi.fn(async () => null),
    getSshProfileForConnection: vi.fn(() => null),
    recordErrorLog: vi.fn(),
  }),
}));

function renderConnectionsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectionsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigateMock.mockClear();
  setCurrentConnectionMock.mockClear();
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
});

describe("ConnectionsPage", () => {
  it("默认展示空状态，且没有独立 SSH 通道卡片标题", () => {
    renderConnectionsPage();

    expect(screen.getByText("选择左侧连接进入 Console，或新建一条连接。")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "已保存 SSH 通道" })).not.toBeInTheDocument();
  });

  it("点击连接名称会选中并进入 Console", () => {
    renderConnectionsPage();

    fireEvent.click(screen.getByRole("button", { name: /开发集群/ }));

    expect(setCurrentConnectionMock).toHaveBeenCalledWith("conn-1");
    expect(navigateMock).toHaveBeenCalledWith("/console");
  });

  it("点击编辑后在右侧表单出现连接名称输入，而不是 Dialog 的 h3 标题", async () => {
    renderConnectionsPage();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("例如 生产 ES / 预发日志集群")).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { level: 3, name: "编辑连接" })).not.toBeInTheDocument();
  });

  it("点击新建连接出现空白表单", () => {
    renderConnectionsPage();

    fireEvent.click(screen.getAllByRole("button", { name: "新建连接" })[0]);

    expect(screen.getByPlaceholderText("例如 生产 ES / 预发日志集群")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例如 生产 ES / 预发日志集群")).toHaveValue("");
  });

  it("脏表单点取消会确认放弃，且取消不会触发进入 Console", async () => {
    renderConnectionsPage();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const nameInput = await screen.findByPlaceholderText("例如 生产 ES / 预发日志集群");
    fireEvent.change(nameInput, { target: { value: "改名后的集群" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByRole("heading", { name: "放弃未保存的更改？" })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("右侧表单脏时单击左侧连接仍进入 Console，不出现放弃确认", async () => {
    renderConnectionsPage();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const nameInput = await screen.findByPlaceholderText("例如 生产 ES / 预发日志集群");
    fireEvent.change(nameInput, { target: { value: "改名后的集群" } });
    fireEvent.click(screen.getByRole("button", { name: /开发集群/ }));

    expect(setCurrentConnectionMock).toHaveBeenCalledWith("conn-1");
    expect(navigateMock).toHaveBeenCalledWith("/console");
    expect(screen.queryByRole("heading", { name: "放弃未保存的更改？" })).not.toBeInTheDocument();
  });
});
