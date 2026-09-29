/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleSidebarPanel, type ConsoleSidebarPanelProps } from "../console-sidebar-panel";
import type { SavedRequest } from "../../../types/requests";

const SIDEBAR_NAV_GHOST_CLASSES = ["text-[#b8c5e8]", "hover:bg-[#465282]/50", "hover:text-white"];

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("data-testid") === "console-request-scroll" ? 480 : 88;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const height = this.getAttribute("data-testid") === "console-request-scroll" ? 480 : 88;
    return { x: 0, y: 0, top: 0, left: 0, bottom: height, right: 300, width: 300, height, toJSON: () => ({}) };
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) {
      this.callback([{ target: element, contentRect: element.getBoundingClientRect() } as ResizeObserverEntry], this as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
  it("连接页在品牌块下方，四个面板按钮按顺序位于竖向导航", () => {
    renderSidebar();

    const connectionsButton = screen.getByRole("button", { name: "连接页" });
    const consoleButton = screen.getByRole("button", { name: "控制台" });
    const statusButton = screen.getByRole("button", { name: "状态" });

    expect(connectionsButton.compareDocumentPosition(consoleButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(consoleButton.compareDocumentPosition(statusButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "工作区导航" })).toHaveClass("grid");
    expect(connectionsButton).not.toHaveClass("bg-secondary");
    expect(connectionsButton).toHaveClass("text-[#b8c5e8]", "hover:text-white");
    expect(consoleButton).toHaveClass("bg-[#465282]/60", "hover:text-white");
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

function createRequests(count: number): SavedRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `request-${index}`,
    connectionId: "local",
    name: `请求 ${index}`,
    method: "GET",
    path: `/items/${index}`,
    body: "",
    tags: index % 2 === 0 ? ["偶数"] : [],
    sortOrder: index * 1000,
    lastResponse: null,
    lastStatus: null,
    lastDurationMs: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}

describe("ConsoleSidebarPanel large request list", () => {
  it("10,000 条请求只挂载视口附近的行", () => {
    renderSidebar({ requests: createRequests(10_000) });

    expect(screen.getAllByRole("button", { name: /请求 \d+/ }).length).toBeLessThan(80);
    expect(screen.getByRole("button", { name: "请求 0" })).toBeInTheDocument();
  });

  it("全选当前包含所有过滤结果，包括未挂载的行", () => {
    const { props } = renderSidebar({ requests: createRequests(1_000), selectionMode: true });

    fireEvent.change(screen.getByPlaceholderText("搜索请求名称、路径或标签"), { target: { value: "偶数" } });
    fireEvent.click(screen.getByRole("button", { name: "全选当前" }));

    expect(props.onSelectAllVisible).toHaveBeenCalledWith(
      Array.from({ length: 500 }, (_, index) => `request-${index * 2}`),
    );
  });

  it("搜索与标签切换后将列表滚动位置归零并显示新结果", () => {
    renderSidebar({ requests: createRequests(1_000) });
    const scroller = screen.getByTestId("console-request-scroll");
    scroller.scrollTop = 88_000 - 480;
    fireEvent.scroll(scroller);

    fireEvent.change(screen.getByPlaceholderText("搜索请求名称、路径或标签"), { target: { value: "请求 2" } });
    expect(screen.getByTestId("console-request-scroll")).toHaveProperty("scrollTop", 0);
    expect(screen.getByRole("button", { name: "请求 2" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("搜索请求名称、路径或标签"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "偶数" }));
    expect(screen.getByTestId("console-request-scroll")).toHaveProperty("scrollTop", 0);
    expect(screen.getByRole("button", { name: "请求 0" })).toBeInTheDocument();
  });
});
