import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecuteAiHttpRequest, mockOpenAiHttpStream } = vi.hoisted(() => ({
  mockExecuteAiHttpRequest: vi.fn(),
  mockOpenAiHttpStream: vi.fn(),
}));

vi.mock("../tauri", () => ({
  executeAiHttpRequest: mockExecuteAiHttpRequest,
  openAiHttpStream: mockOpenAiHttpStream,
}));

import { analyzeRequestContent, analyzeRequestContentLocally } from "../request-analysis";

describe("analyzeRequestContent", () => {
  beforeEach(() => {
    mockExecuteAiHttpRequest.mockReset();
    mockOpenAiHttpStream.mockReset();
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
    mockOpenAiHttpStream.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":' + JSON.stringify(JSON.stringify({ valid: true, meaning: "测试", details: [], issues: [], suggestion: null })) + '}}]}\n\n'
        + "data: [DONE]\n\n",
    ));

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
    expect(mockExecuteAiHttpRequest).not.toHaveBeenCalled();
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


it("does not fall back to local analysis after stream cancellation", async () => {
  const error = new DOMException("cancelled", "AbortError");
  mockOpenAiHttpStream.mockRejectedValue(error);
  const signal = new AbortController().signal;
  await expect(analyzeRequestContent({
    content: "GET /", apiKey: "fixture", signal, onStreamDelta: vi.fn(),
    aiSettings: { enabled: true, baseUrl: "http://localhost/v1", model: "fixture", providerId: "openai", apiKeyRequired: true, thinkingModeEnabled: false },
  })).rejects.toBe(error);
  expect(mockOpenAiHttpStream).toHaveBeenCalledWith(expect.any(Object), signal);
});
