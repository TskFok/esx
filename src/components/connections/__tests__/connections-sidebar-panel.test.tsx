/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile, SshProfile } from "../../../types/connections";
import { ConnectionsSidebarPanel } from "../connections-sidebar-panel";

const SIDEBAR_NAV_GHOST_CLASSES = ["text-slate-200", "hover:bg-white/10", "hover:text-white"];

const connection: ConnectionProfile = {
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
};

const otherConnection: ConnectionProfile = {
  ...connection,
  id: "conn-2",
  name: "生产集群",
  baseUrl: "https://prod.example.com:9200",
  environment: "prod",
};

const sshProfile: SshProfile = {
  id: "ssh-1",
  name: "跳板机",
  tunnel: {
    host: "ssh.example.com",
    port: 22,
    username: "operator",
    authMethod: "privateKey",
    privateKeyPath: "~/.ssh/id_ed25519",
  },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastVerifiedAt: "2026-09-01T00:00:00.000Z",
  hostKeyPolicy: "strict",
  trustedHostKeySha256: null,
};

function renderSidebar(overrides: Partial<Parameters<typeof ConnectionsSidebarPanel>[0]> = {}) {
  const props = {
    connections: [connection],
    currentConnectionId: "conn-1",
    testingConnectionId: null,
    getSshProfileForConnection: () => null,
    onNavigateStatus: vi.fn(),
    onNavigateAdmin: vi.fn(),
    onNavigateLogs: vi.fn(),
    onCreateConnection: vi.fn(),
    onExportClick: vi.fn(),
    onImportFileSelected: vi.fn(),
    onOpenConnection: vi.fn(),
    onTestConnection: vi.fn(),
    onEditConnection: vi.fn(),
    onDeleteConnection: vi.fn(),
    ...overrides,
  };
  const view = render(<ConnectionsSidebarPanel {...props} />);
  return { props, ...view };
}

describe("ConnectionsSidebarPanel", () => {
  it("导航按钮使用深色栏 ghost 样式，连接页不用 secondary", () => {
    renderSidebar();
    const connectionsButton = screen.getByRole("button", { name: "连接页" });
    expect(connectionsButton).not.toHaveClass("bg-secondary");
    expect(connectionsButton).toHaveClass(...SIDEBAR_NAV_GHOST_CLASSES);
    expect(screen.getByRole("button", { name: "状态" })).toHaveClass(...SIDEBAR_NAV_GHOST_CLASSES);
  });

  it("调用状态、治理和错误日志导航回调", () => {
    const { props } = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "状态" }));
    fireEvent.click(screen.getByRole("button", { name: "治理" }));
    fireEvent.click(screen.getByRole("button", { name: "错误日志" }));

    expect(props.onNavigateStatus).toHaveBeenCalledOnce();
    expect(props.onNavigateAdmin).toHaveBeenCalledOnce();
    expect(props.onNavigateLogs).toHaveBeenCalledOnce();
  });

  it("单击新建连接调用回调", () => {
    const { props } = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "新建连接" }));

    expect(props.onCreateConnection).toHaveBeenCalledOnce();
  });

  it("无连接时禁用导出，有连接时启用并调用回调", () => {
    const emptyView = renderSidebar({ connections: [] });
    expect(screen.getByRole("button", { name: "导出" })).toBeDisabled();
    emptyView.unmount();

    const { props } = renderSidebar();
    const exportButton = screen.getByRole("button", { name: "导出" });
    expect(exportButton).toBeEnabled();

    fireEvent.click(exportButton);
    expect(props.onExportClick).toHaveBeenCalledOnce();
  });

  it("通过隐藏的 JSON 文件输入导入所选文件", () => {
    const { container, props } = renderSidebar();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['{"connections":[]}'], "connections.json", {
      type: "application/json",
    });

    expect(input).not.toBeNull();
    expect(input).toHaveClass("hidden");
    expect(input).toHaveAttribute("accept", "application/json,.json");

    fireEvent.change(input!, { target: { files: [file] } });
    expect(props.onImportFileSelected).toHaveBeenCalledOnce();
    expect(props.onImportFileSelected).toHaveBeenCalledWith(file);
  });

  it("单击连接行进入 Console，编辑按钮不冒泡", () => {
    const { props } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /开发集群/ }));
    expect(props.onOpenConnection).toHaveBeenCalledWith("conn-1");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(props.onEditConnection).toHaveBeenCalledWith(connection);
    expect(props.onOpenConnection).toHaveBeenCalledTimes(1);
  });

  it("连接行的 Enter 和 Space 各打开一次连接", () => {
    const { props } = renderSidebar();
    const row = screen.getByRole("button", { name: "开发集群，打开 Console" });

    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    fireEvent.keyDown(row, { key: "Escape" });

    expect(props.onOpenConnection).toHaveBeenCalledTimes(2);
    expect(props.onOpenConnection).toHaveBeenNthCalledWith(1, "conn-1");
    expect(props.onOpenConnection).toHaveBeenNthCalledWith(2, "conn-1");
  });

  it("测试和删除按钮不触发连接行打开", () => {
    const { props } = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "测试" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(props.onTestConnection).toHaveBeenCalledWith(connection);
    expect(props.onDeleteConnection).toHaveBeenCalledWith(connection);
    expect(props.onOpenConnection).not.toHaveBeenCalled();
  });

  it("测试中的连接禁用测试按钮并显示加载文案", () => {
    renderSidebar({ testingConnectionId: "conn-1" });
    const testButton = screen.getByRole("button", { name: "测试" });

    expect(testButton).toBeDisabled();
    expect(testButton).toHaveTextContent("测试中");
  });

  it("提供 onClose 时使用 closeTitle 展示关闭按钮", () => {
    const onClose = vi.fn();
    renderSidebar({ onClose, closeTitle: "收起连接侧栏" });

    fireEvent.click(screen.getByRole("button", { name: "收起连接侧栏" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("按连接配置展示自签名 TLS 和 SSH 通道标记", () => {
    renderSidebar({
      connections: [{ ...connection, insecureTls: true, sshProfileId: "ssh-1" }],
      getSshProfileForConnection: () => sshProfile,
    });

    expect(screen.getByText("自签名 TLS")).toBeInTheDocument();
    expect(screen.getByText("SSH 通道")).toBeInTheDocument();
  });

  it("当前连接保持视觉强调，连接行仍可通过可访问名称区分", () => {
    renderSidebar({ connections: [connection, otherConnection] });
    const currentRow = screen.getByRole("button", { name: "开发集群，打开 Console" });
    const otherRow = screen.getByRole("button", { name: "生产集群，打开 Console" });

    expect(currentRow).toHaveClass("border-white/30", "bg-white", "text-slate-950");
    expect(otherRow).toHaveClass("border-white/10", "bg-white/5", "text-slate-100");
    expect(currentRow).toHaveAttribute("tabindex", "0");
    expect(otherRow).toHaveAttribute("tabindex", "0");
  });

  it("无连接时展示空列表提示", () => {
    renderSidebar({ connections: [] });
    expect(screen.getByText("还没有任何连接")).toBeInTheDocument();
  });
});
