/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiSettingsDialog } from "../ai-settings-dialog";
import { fetchAiModels, testAiConnection } from "../../../lib/ai-analysis-client";
import { getAiApiKey } from "../../../lib/tauri";
import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../../../types/ai-settings";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function renderSettings() {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <AiSettingsDialog
      open
      settings={{ ...DEFAULT_AI_ANALYSIS_SETTINGS, enabled: true }}
      apiKeyConfigured
      onClose={() => {}}
      onSave={onSave}
      onTestConnection={testAiConnection}
      onFetchModels={fetchAiModels}
      onLoadStoredApiKey={() => getAiApiKey(DEFAULT_AI_ANALYSIS_SETTINGS.baseUrl)}
    />,
  );
  return { onSave };
}

function apiKeyInput() {
  return screen.getByLabelText(/^API Key/) as HTMLInputElement;
}

function sentRequests() {
  return invoke.mock.calls
    .filter(([command]) => command === "execute_ai_http_request")
    .map(([, args]) => ({ url: args.payload.url as string, apiKey: args.payload.apiKey as string }));
}

describe("AI settings credential isolation", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      if (command === "get_ai_api_key") return "demo-openai-key";
      if (command === "execute_ai_http_request") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          bodyText: JSON.stringify({ data: [{ id: "demo-model" }], choices: [{ message: { content: "OK" } }] }),
          diagnostics: [],
        };
      }
      throw new Error(`Unexpected IPC command: ${command}`);
    });
  });

  it("requires a new key when switching from OpenAI to DeepSeek", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /^DeepSeek/ }));

    expect(screen.getByRole("button", { name: "刷新模型" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled();

    fireEvent.change(apiKeyInput(), { target: { value: "demo-deepseek-key" } });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => expect(sentRequests()).toHaveLength(2));
    expect(sentRequests()).toEqual([
      { url: "https://api.deepseek.com/v1/chat/completions", apiKey: "demo-deepseek-key" },
      { url: "https://api.deepseek.com/v1/models", apiKey: "demo-deepseek-key" },
    ]);
  });

  it("requires a new key for a custom origin", () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText(/AI 服务地址/), { target: { value: "https://ai.example.invalid/v1" } });

    expect(screen.getByRole("button", { name: "刷新模型" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled();
    expect(sentRequests()).toEqual([]);
  });

  it("sends no previous key to Ollama and clears the old key when saving", async () => {
    const { onSave } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /^Ollama/ }));
    fireEvent.click(screen.getByRole("button", { name: "刷新模型" }));

    await waitFor(() => expect(sentRequests()).toHaveLength(1));
    expect(sentRequests()[0]).toMatchObject({ url: "http://localhost:11434/v1/models", apiKey: "" });

    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ apiKey: null, clearApiKey: true })));
  });

  it.each(["preset", "custom"])("clears an unsaved key when changing the %s origin", (change) => {
    renderSettings();
    fireEvent.change(apiKeyInput(), { target: { value: "demo-unsaved-openai-key" } });
    if (change === "preset") {
      fireEvent.click(screen.getByRole("button", { name: /^DeepSeek/ }));
    } else {
      fireEvent.change(screen.getByLabelText(/AI 服务地址/), { target: { value: "https://ai.example.invalid/v1" } });
    }

    expect(apiKeyInput()).toHaveValue("");
    expect(screen.getByRole("button", { name: "刷新模型" })).toBeDisabled();
  });

  it("keeps the stored key when changing only the service path on the same origin", async () => {
    const { onSave } = renderSettings();
    fireEvent.change(screen.getByLabelText(/AI 服务地址/), { target: { value: "https://api.openai.com:443/v2" } });
    fireEvent.click(screen.getByRole("button", { name: "刷新模型" }));

    await waitFor(() => expect(sentRequests()).toHaveLength(1));
    expect(sentRequests()[0]).toMatchObject({ url: "https://api.openai.com:443/v2/models", apiKey: "demo-openai-key" });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ apiKey: null, clearApiKey: false })));
  });

  it("keeps an unsaved key when selecting custom settings for the same origin", async () => {
    renderSettings();
    fireEvent.change(apiKeyInput(), { target: { value: "demo-unsaved-openai-key" } });
    fireEvent.click(screen.getByRole("button", { name: /^自定义/ }));
    fireEvent.click(screen.getByRole("button", { name: "刷新模型" }));

    await waitFor(() => expect(sentRequests()).toHaveLength(1));
    expect(sentRequests()[0]).toMatchObject({ url: "https://api.openai.com/v1/models", apiKey: "demo-unsaved-openai-key" });
  });
});
