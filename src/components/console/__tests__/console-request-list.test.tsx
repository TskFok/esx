/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleRequestList, type ConsoleRequestListProps } from "../console-request-list";
import type { SavedRequest } from "../../../types/requests";

function requests(count: number): SavedRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `r-${index}`, connectionId: "local", name: `请求 ${index}`, method: "GET",
    path: `/items/${index}`, body: "", tags: index % 2 === 0 ? ["偶数"] : [],
    sortOrder: index * 1000, lastResponse: null, lastStatus: null,
    lastDurationMs: null, updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}

function renderList(overrides: Partial<ConsoleRequestListProps> = {}) {
  const props: ConsoleRequestListProps = {
    requests: requests(1_000), activeSavedRequestId: null,
    selectionMode: false, selectedRequestIds: [], canReorder: true,
    onSelectSavedRequest: vi.fn(), onToggleRequestSelection: vi.fn(),
    onEditRequest: vi.fn(), onDuplicateRequest: vi.fn(), onDeleteRequest: vi.fn(),
    onReorderRequests: vi.fn(), ...overrides,
  };
  const view = render(<ConsoleRequestList {...props} />);
  return { props, ...view };
}

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

function scrollToEnd() {
  const scroller = screen.getByTestId("console-request-scroll");
  act(() => {
    scroller.scrollTop = 88_000 - 480;
    fireEvent.scroll(scroller);
  });
  return scroller;
}

describe("ConsoleRequestList", () => {
  it("滚到末端后卸载首批行，并支持键盘激活新视口请求", () => {
    const { props } = renderList();
    expect(screen.getAllByRole("button", { name: /请求 \d+/ })).toHaveLength(12);

    scrollToEnd();

    expect(screen.queryByRole("button", { name: "请求 0" })).not.toBeInTheDocument();
    const last = screen.getByRole("button", { name: "请求 999" });
    fireEvent.keyDown(last, { key: "Enter" });
    fireEvent.keyDown(last, { key: " " });
    expect(props.onSelectSavedRequest).toHaveBeenNthCalledWith(1, "r-999");
    expect(props.onSelectSavedRequest).toHaveBeenNthCalledWith(2, "r-999");
  });

  it("视口外选中项保留状态，滚回时仍呈现已选中", () => {
    const data = requests(1_000);
    const props = {
      requests: data, selectionMode: true, selectedRequestIds: ["r-0"], canReorder: false,
    };
    const view = renderList(props);
    expect(screen.getByRole("button", { name: "请求 0" })).toHaveAttribute("aria-pressed", "true");
    scrollToEnd();
    expect(screen.queryByRole("button", { name: "请求 0" })).not.toBeInTheDocument();
    view.rerender(<ConsoleRequestList {...view.props} {...props} />);
    const scroller = screen.getByTestId("console-request-scroll");
    act(() => { scroller.scrollTop = 0; fireEvent.scroll(scroller); });
    expect(screen.getByRole("button", { name: "请求 0" })).toHaveAttribute("aria-pressed", "true");
  });

  it("跨视口拖放提交完整且唯一的请求顺序", () => {
    const { props } = renderList();
    fireEvent.dragStart(screen.getByRole("button", { name: "请求 0" }));
    scrollToEnd();
    fireEvent.drop(screen.getByRole("button", { name: "请求 999" }));

    const ordered = vi.mocked(props.onReorderRequests).mock.calls[0][0];
    expect(ordered).toHaveLength(1_000);
    expect(new Set(ordered).size).toBe(1_000);
    expect(ordered[998]).toBe("r-999");
    expect(ordered[999]).toBe("r-0");
  });

  it("经过一行后放到列表空白处不会沿用旧目标排序", () => {
    const { props } = renderList({ requests: requests(5) });
    fireEvent.dragStart(screen.getByRole("button", { name: "请求 0" }));
    fireEvent.dragOver(screen.getByRole("button", { name: "请求 3" }));
    fireEvent.drop(screen.getByTestId("console-request-scroll"));

    expect(props.onReorderRequests).not.toHaveBeenCalled();
  });

  it("请求内容更新时保留长列表的滚动位置", () => {
    const data = requests(1_000);
    const view = renderList({ requests: data });
    const scroller = screen.getByTestId("console-request-scroll");
    act(() => { scroller.scrollTop = 44_000; fireEvent.scroll(scroller); });
    expect(screen.getByRole("button", { name: "请求 500" })).toBeInTheDocument();

    const updated = data.map((request, index) => index === 500 ? { ...request, lastStatus: 200 } : request);
    view.rerender(<ConsoleRequestList {...view.props} requests={updated} />);

    expect(scroller.scrollTop).toBe(44_000);
    expect(screen.getByRole("button", { name: "请求 500" })).toBeInTheDocument();
  });

  it("少于 200 项但可滚动时，请求刷新仍保留滚动位置", () => {
    const data = requests(50);
    const view = renderList({ requests: data });
    const scroller = screen.getByTestId("console-request-scroll");
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 3_000 });
    scroller.scrollTop = 600;

    view.rerender(<ConsoleRequestList {...view.props} requests={data.map((request, index) =>
      index === 10 ? { ...request, lastStatus: 200 } : request,
    )} />);

    expect(scroller.scrollTop).toBe(600);
  });

  it("拖拽悬停在列表中间不安排自动滚动动画帧", () => {
    const frame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", frame);
    renderList();
    fireEvent.dragStart(screen.getByRole("button", { name: "请求 0" }));
    const initialFrames = frame.mock.calls.length;
    const dragOver = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, "clientY", { value: 240 });
    fireEvent(screen.getByTestId("console-request-scroll"), dragOver);

    expect(frame).toHaveBeenCalledTimes(initialFrames);
  });

  it("拖拽靠近边缘时滚动独立列表容器", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    renderList();
    const scroller = screen.getByTestId("console-request-scroll");
    fireEvent.dragStart(screen.getByRole("button", { name: "请求 0" }));
    const dragOver = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, "clientY", { value: 475 });
    fireEvent(scroller, dragOver);
    act(() => {
      for (let index = 0; index < 10 && scroller.scrollTop === 0; index++) frames.shift()?.(0);
    });
    expect(scroller.scrollTop).toBeGreaterThan(0);
    fireEvent.dragEnd(screen.getByRole("button", { name: "请求 0" }));
  });

  it("拖拽源滚出视口后仍挂载，外部释放会清除拖拽状态", () => {
    renderList();
    fireEvent.dragStart(screen.getByRole("button", { name: "请求 0" }));
    scrollToEnd();
    const source = screen.getByRole("button", { name: "请求 0" });
    expect(source).toHaveClass("opacity-50");

    fireEvent.drop(document.body);
    expect(screen.queryByRole("button", { name: "请求 0" })).not.toBeInTheDocument();
    const scroller = screen.getByTestId("console-request-scroll");
    act(() => { scroller.scrollTop = 0; fireEvent.scroll(scroller); });
    expect(screen.getByRole("button", { name: "请求 0" })).not.toHaveClass("opacity-50");
  });

  it("拖出列表后停止边缘自动滚动，Esc 取消拖拽", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    renderList();
    const scroller = screen.getByTestId("console-request-scroll");
    const source = screen.getByRole("button", { name: "请求 0" });
    fireEvent.dragStart(source);
    const dragOver = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, "clientY", { value: 475 });
    fireEvent(scroller, dragOver);
    const atLeave = scroller.scrollTop;
    fireEvent.dragLeave(scroller, { relatedTarget: document.body });
    act(() => frames.shift()?.(0));
    expect(scroller.scrollTop).toBe(atLeave);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(source).not.toHaveClass("opacity-50");
  });

  it("拖拽期间请求集合缩短不会渲染越界行", () => {
    const data = requests(1_000);
    const view = renderList({ requests: data });
    scrollToEnd();
    fireEvent.dragStart(screen.getByRole("button", { name: "请求 999" }));

    view.rerender(<ConsoleRequestList {...view.props} requests={data.slice(0, 500)} />);
    fireEvent.scroll(screen.getByTestId("console-request-scroll"));

    expect(screen.getByRole("button", { name: "请求 499" })).toBeInTheDocument();
  });

  it("少于 200 项保留直接渲染", () => {
    renderList({ requests: requests(199) });
    expect(screen.getAllByRole("button", { name: /请求 \d+/ })).toHaveLength(199);
  });
});
