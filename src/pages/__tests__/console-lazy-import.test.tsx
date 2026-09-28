/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest";

const { editorModuleLoaded, aiModuleLoaded } = vi.hoisted(() => ({
  editorModuleLoaded: vi.fn(),
  aiModuleLoaded: vi.fn(),
}));

vi.mock("../../components/console/console-editor", () => {
  editorModuleLoaded();
  return { ConsoleEditor: () => null };
});
vi.mock("../../components/console/ai-settings-dialog", () => {
  aiModuleLoaded();
  return { AiSettingsDialog: () => null };
});
vi.mock("../../components/console/ai-analysis-dialog", () => {
  aiModuleLoaded();
  return { AiAnalysisDialog: () => null };
});
vi.mock("../../components/console/ai-generate-dialog", () => {
  aiModuleLoaded();
  return { AiGenerateDialog: () => null };
});

it("仅导入控制台页面不会加载编辑器或 AI 弹窗模块", async () => {
  await import("../console-page");
  expect(editorModuleLoaded).not.toHaveBeenCalled();
  expect(aiModuleLoaded).not.toHaveBeenCalled();
});
