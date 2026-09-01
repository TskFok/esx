/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConsoleMobileDrawer } from "../console-mobile-drawer";

describe("ConsoleMobileDrawer", () => {
  it("右侧抽屉从屏幕右侧滑出", () => {
    const onClose = vi.fn();
    render(
      <ConsoleMobileDrawer open onClose={onClose} closeLabel="关闭错误日志" side="right">
        <p>日志内容</p>
      </ConsoleMobileDrawer>,
    );

    expect(screen.getByText("日志内容")).toBeInTheDocument();
    const aside = screen.getByText("日志内容").closest("aside");
    expect(aside).toHaveClass("right-0");
    expect(aside).not.toHaveClass("left-0");

    fireEvent.click(screen.getByRole("button", { name: "关闭错误日志" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
