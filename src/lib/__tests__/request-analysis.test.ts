import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: mockFetch,
}));

import { analyzeRequestContent, analyzeRequestContentLocally } from "../request-analysis";

describe("analyzeRequestContent", () => {
  beforeEach(() => {
    mockFetch.mockReset();
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
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls back to local analysis when ai request fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "invalid key" } }),
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
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"{\\"valid\\":true,"}}]}\n\n'),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"\\"meaning\\":\\"测试\\",\\"details\\":[],\\"issues\\":[],\\"suggestion\\":null}"}}]}\n\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      text: async () => "",
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
