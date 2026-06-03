import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecuteAiHttpRequest } = vi.hoisted(() => ({
  mockExecuteAiHttpRequest: vi.fn(),
}));

vi.mock("../tauri", () => ({
  executeAiHttpRequest: mockExecuteAiHttpRequest,
}));

import { analyzeRequestContent, analyzeRequestContentLocally } from "../request-analysis";

describe("analyzeRequestContent", () => {
  beforeEach(() => {
    mockExecuteAiHttpRequest.mockReset();
  });

  it("uses local analysis when ai is disabled", async () => {
    const result = await analyzeRequestContent({
      content: "GET /_cluster/health",
      aiSettings: {
        enabled: false,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        providerId: "openai",
        apiKeyRequired: true,
        thinkingModeEnabled: false,
      },
      apiKey: "sk-test",
    });

    expect(result.valid).toBe(true);
    expect(result.source).toBe("local");
    expect(mockExecuteAiHttpRequest).not.toHaveBeenCalled();
  });

  it("falls back to local analysis when ai request fails", async () => {
    mockExecuteAiHttpRequest.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      bodyText: JSON.stringify({ error: { message: "invalid key" } }),
    });

    const result = await analyzeRequestContent({
      content: "GET /_cluster/health",
      aiSettings: {
        enabled: true,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        providerId: "openai",
        apiKeyRequired: true,
        thinkingModeEnabled: false,
      },
      apiKey: "sk-test",
    });

    expect(result.source).toBe("local");
    expect(result.valid).toBe(true);
  });

  it("streams ai deltas when callback is provided", async () => {
    mockExecuteAiHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      bodyText:
        'data: {"choices":[{"delta":{"content":"{\\"valid\\":true,"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"\\"meaning\\":\\"测试\\",\\"details\\":[],\\"issues\\":[],\\"suggestion\\":null}"}}]}\n\n' +
        "data: [DONE]\n\n",
    });

    const deltas: Array<{ kind: "reasoning" | "content"; text: string }> = [];
    const result = await analyzeRequestContent({
      content: "GET /_cluster/health",
      aiSettings: {
        enabled: true,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        providerId: "openai",
        apiKeyRequired: true,
        thinkingModeEnabled: false,
      },
      apiKey: "sk-test",
      onStreamDelta: (delta) => deltas.push(delta),
    });

    expect(deltas.some((delta) => delta.kind === "content")).toBe(true);
    expect(result.source).toBe("ai");
    expect(result.valid).toBe(true);
  });
});

describe("analyzeRequestContentLocally", () => {
  it("re-exports local analyzer", () => {
    const result = analyzeRequestContentLocally("GET /_cluster/health");
    expect(result.valid).toBe(true);
    expect(result.source).toBe("local");
  });
});
