/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiGenerateDialog } from "../ai-generate-dialog";

function renderDialog(overrides: Partial<Parameters<typeof AiGenerateDialog>[0]> = {}) {
  const props = {
    open: true,
    isGenerating: false,
    streamingReasoningText: "",
    streamingContentText: "",
    generatedContent: null,
    generateError: null,
    aiEnabled: true,
    aiConfigured: true,
    onClose: vi.fn(),
    onOpenSettings: vi.fn(),
    onGenerate: vi.fn(),
    onApply: vi.fn(),
    ...overrides,
  };

  render(<AiGenerateDialog {...props} />);
  return props;
}

describe("AiGenerateDialog", () => {
  it("calls onGenerate with trimmed description", () => {
    const props = renderDialog();

    fireEvent.change(screen.getByLabelText("请求描述"), {
      target: { value: "  查询 users 索引  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成请求" }));

    expect(props.onGenerate).toHaveBeenCalledWith("查询 users 索引");
  });

  it("disables generate button while generating", () => {
    renderDialog({ isGenerating: true });

    expect(screen.getByRole("button", { name: /生成中/ })).toBeDisabled();
  });

  it("shows generated content and apply button", () => {
    const props = renderDialog({
      generatedContent: 'POST /users/_search\n{"query":{"match_all":{}}}',
    });

    expect(screen.getByText("生成的请求内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用到编辑器" }));
    expect(props.onApply).toHaveBeenCalledOnce();
  });

  it("shows configure ai hint when not configured", () => {
    const props = renderDialog({ aiConfigured: false });

    expect(screen.getByText(/AI 服务尚未配置完成/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "配置 AI" }));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });
});
