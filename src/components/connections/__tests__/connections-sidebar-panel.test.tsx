/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../../types/connections";
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

  it("单击连接行进入 Console，编辑按钮不冒泡", () => {
    const { props } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /开发集群/ }));
    expect(props.onOpenConnection).toHaveBeenCalledWith("conn-1");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(props.onEditConnection).toHaveBeenCalledWith(connection);
    expect(props.onOpenConnection).toHaveBeenCalledTimes(1);
  });

  it("无连接时展示空列表提示", () => {
    renderSidebar({ connections: [] });
    expect(screen.getByText("还没有任何连接")).toBeInTheDocument();
  });
});
