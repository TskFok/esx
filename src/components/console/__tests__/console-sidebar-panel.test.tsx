/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConsoleSidebarPanel, type ConsoleSidebarPanelProps } from "../console-sidebar-panel";

const SIDEBAR_NAV_GHOST_CLASSES = ["text-slate-200", "hover:bg-white/10", "hover:text-white"];

function renderSidebar(overrides: Partial<ConsoleSidebarPanelProps> = {}) {
  const props: ConsoleSidebarPanelProps = {
    connectionName: "local",
    requests: [],
    activeSavedRequestId: null,
    onClose: vi.fn(),
    onNavigateConnections: vi.fn(),
    onNavigateConsole: vi.fn(),
    onNavigateStatus: vi.fn(),
    onNavigateAdmin: vi.fn(),
    onNavigateLogs: vi.fn(),
    onCreateRequest: vi.fn(),
    onExportClick: vi.fn(),
    onImportFileSelected: vi.fn(),
    onSelectSavedRequest: vi.fn(),
    onEditRequest: vi.fn(),
    onDuplicateRequest: vi.fn(),
    onDeleteRequest: vi.fn(),
    onReorderRequests: vi.fn(),
    selectionMode: false,
    selectedRequestIds: [],
    onToggleSelectionMode: vi.fn(),
    onToggleRequestSelection: vi.fn(),
    onSelectAllVisible: vi.fn(),
    onClearSelection: vi.fn(),
    onOpenBulkTags: vi.fn(),
    ...overrides,
  };
  const view = render(<ConsoleSidebarPanel {...props} />);
  return { props, ...view };
}

describe("ConsoleSidebarPanel navigation", () => {
  it("连接页在标题行，控制台与其它面板按钮在导航行", () => {
    renderSidebar();

    const connectionsButton = screen.getByRole("button", { name: "连接页" });
    const consoleButton = screen.getByRole("button", { name: "控制台" });
    const statusButton = screen.getByRole("button", { name: "状态" });

    expect(connectionsButton.compareDocumentPosition(consoleButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(consoleButton.compareDocumentPosition(statusButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(connectionsButton).not.toHaveClass("bg-secondary");
    expect(connectionsButton).toHaveClass(...SIDEBAR_NAV_GHOST_CLASSES);
    expect(consoleButton).toHaveClass("hover:bg-white/10", "hover:text-white");
    expect(statusButton).toHaveClass(...SIDEBAR_NAV_GHOST_CLASSES);
  });

  it("默认展示控制台按下态", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: "控制台" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "状态" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "治理" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "错误日志" })).toHaveAttribute("aria-pressed", "false");
  });

  it("点击控制台调用切回控制台回调", () => {
    const { props } = renderSidebar({ statusPanelOpen: true });

    fireEvent.click(screen.getByRole("button", { name: "控制台" }));

    expect(props.onNavigateConsole).toHaveBeenCalledOnce();
    expect(props.onNavigateConnections).not.toHaveBeenCalled();
  });

  it("点击连接页调用连接页导航回调", () => {
    const { props } = renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "连接页" }));

    expect(props.onNavigateConnections).toHaveBeenCalledOnce();
    expect(props.onNavigateConsole).not.toHaveBeenCalled();
  });

  it("错误日志打开时按钮为按下态", () => {
    renderSidebar({ logsPanelOpen: true });

    expect(screen.getByRole("button", { name: "错误日志" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "控制台" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "状态" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "治理" })).toHaveAttribute("aria-pressed", "false");
  });

  it("状态打开时按钮为按下态", () => {
    renderSidebar({ statusPanelOpen: true });

    expect(screen.getByRole("button", { name: "状态" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "控制台" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "错误日志" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "治理" })).toHaveAttribute("aria-pressed", "false");
  });

  it("治理打开时按钮为按下态", () => {
    renderSidebar({ adminPanelOpen: true });

    expect(screen.getByRole("button", { name: "治理" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "控制台" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "状态" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "错误日志" })).toHaveAttribute("aria-pressed", "false");
  });
});
