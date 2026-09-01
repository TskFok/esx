/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsPage } from "../connections-page";
import type { ConnectionProfile, SshProfile } from "../../types/connections";

const {
  navigateMock,
  setCurrentConnectionMock,
  upsertSshProfileMock,
  deleteConnectionMock,
  validateSshTunnelMock,
  sshProfiles,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  setCurrentConnectionMock: vi.fn(),
  upsertSshProfileMock: vi.fn(),
  deleteConnectionMock: vi.fn(),
  validateSshTunnelMock: vi.fn(),
  sshProfiles: [] as SshProfile[],
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

const savedSshProfile = {
  id: "ssh-1",
  name: "跳板机",
  tunnel: {
    host: "bastion.example.com",
    port: 22,
    username: "ubuntu",
    authMethod: "password" as const,
    privateKeyPath: "",
  },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastVerifiedAt: "2026-09-01T00:00:00.000Z",
  hostKeyPolicy: "trustOnFirstUse" as const,
  trustedHostKeySha256: null,
} satisfies SshProfile;

vi.mock("react-router-dom", () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  useNavigate: () => navigateMock,
}));

vi.mock("../../lib/tauri", () => ({
  validateSshTunnel: validateSshTunnelMock,
}));

vi.mock("../../providers/app-state", () => ({
  useAppState: () => ({
    connections: [connection],
    sshProfiles: [...sshProfiles],
    currentConnection: connection,
    upsertConnection: vi.fn(),
    upsertSshProfile: upsertSshProfileMock,
    deleteConnection: deleteConnectionMock,
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
  sshProfiles.splice(0, sshProfiles.length);
  upsertSshProfileMock.mockReset();
  deleteConnectionMock.mockReset();
  validateSshTunnelMock.mockReset();
  deleteConnectionMock.mockResolvedValue(undefined);
  upsertSshProfileMock.mockImplementation(async () => {
    sshProfiles.push(savedSshProfile);
    return savedSshProfile;
  });
  validateSshTunnelMock.mockResolvedValue({
    ok: true,
    hostKeySha256: "SHA256:test-host-key",
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
});

describe("ConnectionsPage", () => {
  it("默认展示空状态，且没有独立 SSH 通道卡片标题", () => {
    renderConnectionsPage();

    expect(screen.getByText("选择左侧连接进入 Console，或新建一条连接。")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "已保存 SSH 通道" })).not.toBeInTheDocument();
  });

  it("侧栏不展示连接页、状态、治理和错误日志按钮", () => {
    renderConnectionsPage();

    expect(screen.queryByRole("button", { name: "连接页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "状态" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "治理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "错误日志" })).not.toBeInTheDocument();
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

  it("编辑中新建 SSH 通道保存成功后选中该通道", async () => {
    renderConnectionsPage();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await screen.findByPlaceholderText("例如 生产 ES / 预发日志集群");
    fireEvent.click(screen.getByRole("button", { name: "新建 SSH 通道" }));

    expect(screen.getByRole("heading", { name: "新增 SSH 通道" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("例如 生产跳板机 / 测试堡垒机"), {
      target: { value: "跳板机" },
    });
    fireEvent.change(screen.getByPlaceholderText("bastion.example.com"), {
      target: { value: "bastion.example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("ubuntu / root / deploy"), {
      target: { value: "ubuntu" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入 SSH 密码"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "验证并保存 SSH 通道" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "新增 SSH 通道" })).not.toBeInTheDocument();
    });
    expect(upsertSshProfileMock).toHaveBeenCalled();
    expect(screen.getByText("跳板机")).toBeInTheDocument();
    expect(screen.getByText("已选中")).toBeInTheDocument();
  });

  it("删除正在编辑的连接后回到 idle 空状态", async () => {
    renderConnectionsPage();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await screen.findByPlaceholderText("例如 生产 ES / 预发日志集群");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const confirmDialog = screen.getByRole("heading", { name: "确认删除" }).closest(".glass-panel");
    expect(confirmDialog).toBeTruthy();
    fireEvent.click(within(confirmDialog as HTMLElement).getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(deleteConnectionMock).toHaveBeenCalledWith("conn-1");
    });
    expect(await screen.findByText("选择左侧连接进入 Console，或新建一条连接。")).toBeInTheDocument();
  });
});
