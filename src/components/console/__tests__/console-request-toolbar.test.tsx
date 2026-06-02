/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConsoleRequestToolbar } from "../console-request-toolbar";
import {
  CONSOLE_REQUEST_NAME_INPUT_CLASS,
  CONSOLE_REQUEST_TOOLBAR_CLASS,
  CONSOLE_TOOLBAR_ACTIONS_CLASS,
  CONSOLE_TOOLBAR_BUTTON_CLASS,
} from "../../../lib/console-toolbar";

function renderToolbar(overrides: Partial<Parameters<typeof ConsoleRequestToolbar>[0]> = {}) {
  const props = {
    requestName: "search users",
    isAnalyzing: false,
    isGenerating: false,
    onRequestNameChange: vi.fn(),
    onRunAndSave: vi.fn(),
    onFormatJson: vi.fn(),
    onAnalyze: vi.fn(),
    onGenerate: vi.fn(),
    onOpenTemplates: vi.fn(),
    onOpenAiSettings: vi.fn(),
    onOpenShortcuts: vi.fn(),
    ...overrides,
  };

  render(<ConsoleRequestToolbar {...props} />);
  return props;
}

function getToolbar() {
  return screen.getByTestId("console-request-toolbar");
}

describe("ConsoleRequestToolbar", () => {
  it("renders toolbar layout classes on container and action group", () => {
    renderToolbar();

    expect(getToolbar()).toHaveClass(...CONSOLE_REQUEST_TOOLBAR_CLASS.split(" "));
    expect(within(getToolbar()).getByTestId("console-toolbar-actions")).toHaveClass(
      ...CONSOLE_TOOLBAR_ACTIONS_CLASS.split(" "),
    );
  });

  it("applies nowrap shrink protection to all action buttons", () => {
    renderToolbar();
    const toolbar = within(getToolbar());

    for (const label of ["格式化 JSON", "AI 生成", "AI 分析", "模板", "AI 分析设置", "快捷键帮助"]) {
      expect(toolbar.getByRole("button", { name: label })).toHaveClass(
        ...CONSOLE_TOOLBAR_BUTTON_CLASS.split(" "),
      );
    }
  });

  it("applies responsive input layout classes", () => {
    renderToolbar();

    expect(within(getToolbar()).getByPlaceholderText(/请求名称/)).toHaveClass(
      ...CONSOLE_REQUEST_NAME_INPUT_CLASS.split(" "),
    );
  });

  it("disables AI generate button while generating", () => {
    renderToolbar({ isGenerating: true });

    expect(within(getToolbar()).getByRole("button", { name: "AI 生成" })).toBeDisabled();
  });

  it("disables AI analyze button while analyzing", () => {
    renderToolbar({ isAnalyzing: true });

    expect(within(getToolbar()).getByRole("button", { name: "AI 分析" })).toBeDisabled();
  });

  it("calls action handlers from toolbar buttons", () => {
    const props = renderToolbar();
    const toolbar = within(getToolbar());

    fireEvent.click(toolbar.getByRole("button", { name: "格式化 JSON" }));
    fireEvent.click(toolbar.getByRole("button", { name: "AI 生成" }));
    fireEvent.click(toolbar.getByRole("button", { name: "AI 分析" }));
    fireEvent.click(toolbar.getByRole("button", { name: "模板" }));
    fireEvent.click(toolbar.getByRole("button", { name: "AI 分析设置" }));
    fireEvent.click(toolbar.getByRole("button", { name: "快捷键帮助" }));

    expect(props.onFormatJson).toHaveBeenCalledOnce();
    expect(props.onGenerate).toHaveBeenCalledOnce();
    expect(props.onAnalyze).toHaveBeenCalledOnce();
    expect(props.onOpenTemplates).toHaveBeenCalledOnce();
    expect(props.onOpenAiSettings).toHaveBeenCalledOnce();
    expect(props.onOpenShortcuts).toHaveBeenCalledOnce();
  });

  it("runs save shortcut on Command+Enter in request name input", () => {
    const props = renderToolbar();

    fireEvent.keyDown(within(getToolbar()).getByPlaceholderText(/请求名称/), {
      key: "Enter",
      metaKey: true,
    });

    expect(props.onRunAndSave).toHaveBeenCalledOnce();
  });

  it("matches toolbar markup snapshot", () => {
    const { container } = render(
      <ConsoleRequestToolbar
        requestName="search users"
        isAnalyzing={false}
        isGenerating={false}
        onRequestNameChange={vi.fn()}
        onRunAndSave={vi.fn()}
        onFormatJson={vi.fn()}
        onAnalyze={vi.fn()}
        onGenerate={vi.fn()}
        onOpenTemplates={vi.fn()}
        onOpenAiSettings={vi.fn()}
        onOpenShortcuts={vi.fn()}
      />,
    );

    expect(container.firstChild).toMatchSnapshot();
  });
});
