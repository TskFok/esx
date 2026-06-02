import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: mockFetch,
}));

import {
  fetchAiModels,
  isAiAnalysisConfigured,
  normalizeAiAnalysisResult,
  resolveChatCompletionOptions,
  resolveChatCompletionsUrl,
  resolveModelsUrl,
  testAiConnection,
} from "../ai-analysis-client";

const kimiSettings = {
  enabled: true,
  baseUrl: "https://api.moonshot.cn/v1",
  model: "kimi-k2.6",
  providerId: "kimi",
  apiKeyRequired: true,
  thinkingModeEnabled: false,
} as const;

describe("resolveChatCompletionOptions", () => {
  it("uses default temperature for non-kimi models", () => {
    expect(
      resolveChatCompletionOptions({
        enabled: true,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        providerId: "openai",
        apiKeyRequired: true,
        thinkingModeEnabled: false,
      }),
    ).toEqual({
      temperature: 0.2,
      thinking: undefined,
    });
  });

  it("uses disabled thinking and temperature 0.6 for kimi k2 models", () => {
    expect(resolveChatCompletionOptions(kimiSettings)).toEqual({
      temperature: 0.6,
      thinking: { type: "disabled" },
    });
  });

  it("uses enabled thinking and temperature 1.0 when thinking mode is on", () => {
    expect(
      resolveChatCompletionOptions({
        ...kimiSettings,
        thinkingModeEnabled: true,
      }),
    ).toEqual({
      temperature: 1.0,
      thinking: { type: "enabled" },
    });
  });
});

describe("resolveChatCompletionsUrl", () => {
  it("appends chat completions path to base url", () => {
    expect(resolveChatCompletionsUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("keeps url when chat completions path already exists", () => {
    expect(resolveChatCompletionsUrl("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
  });

  it("rejects invalid protocol", () => {
    expect(() => resolveChatCompletionsUrl("api.openai.com/v1")).toThrow("http://");
  });
});

describe("isAiAnalysisConfigured", () => {
  it("returns true when ai settings and api key are complete", () => {
    expect(
      isAiAnalysisConfigured(
        {
          enabled: true,
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          providerId: "openai",
          apiKeyRequired: true,
          thinkingModeEnabled: false,
        },
        "sk-test",
      ),
    ).toBe(true);
  });

  it("returns true for ollama without api key", () => {
    expect(
      isAiAnalysisConfigured(
        {
          enabled: true,
          baseUrl: "http://localhost:11434/v1",
          model: "llama3.2",
          providerId: "ollama",
          apiKeyRequired: false,
          thinkingModeEnabled: false,
        },
        "",
      ),
    ).toBe(true);
  });

  it("returns false when disabled or missing api key", () => {
    expect(
      isAiAnalysisConfigured(
        {
          enabled: false,
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          providerId: "openai",
          apiKeyRequired: true,
          thinkingModeEnabled: false,
        },
        "sk-test",
      ),
    ).toBe(false);

    expect(
      isAiAnalysisConfigured(
        {
          enabled: true,
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          providerId: "openai",
          apiKeyRequired: true,
          thinkingModeEnabled: false,
        },
        "",
      ),
    ).toBe(false);
  });
});

describe("normalizeAiAnalysisResult", () => {
  it("parses valid ai json payload", () => {
    const result = normalizeAiAnalysisResult({
      valid: true,
      meaning: "这是一个健康检查请求",
      details: ["无请求体"],
      issues: [],
      suggestion: null,
    });

    expect(result?.valid).toBe(true);
    if (result?.valid) {
      expect(result.meaning).toContain("健康检查");
      expect(result.source).toBe("ai");
    }
  });
});

describe("resolveModelsUrl", () => {
  it("appends models path to base url", () => {
    expect(resolveModelsUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/models");
  });
});

describe("fetchAiModels", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("parses model ids from openai compatible payload", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }],
        }),
    });

    const models = await fetchAiModels({
      settings: {
        enabled: true,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        providerId: "openai",
        apiKeyRequired: true,
        thinkingModeEnabled: false,
      },
      apiKey: "sk-test",
    });

    expect(models).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });
});

describe("testAiConnection", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("calls chat completions endpoint and returns models", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [{ id: "gpt-4o-mini" }],
          }),
      });

    await expect(
      testAiConnection({
        settings: {
          enabled: true,
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          providerId: "openai",
          apiKeyRequired: true,
          thinkingModeEnabled: false,
        },
        apiKey: "sk-test",
      }),
    ).resolves.toEqual({ models: ["gpt-4o-mini"] });
  });

  it("sends kimi non-thinking options for disabled thinking mode", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [{ id: "kimi-k2.6" }],
          }),
      });

    await testAiConnection({
      settings: kimiSettings,
      apiKey: "sk-test",
    });

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.temperature).toBe(0.6);
    expect(requestBody.thinking).toEqual({ type: "disabled" });
    expect(requestBody.model).toBe("kimi-k2.6");
  });

  it("sends kimi thinking options when thinking mode is enabled", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: "OK" } }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [{ id: "kimi-k2.6" }],
          }),
      });

    await testAiConnection({
      settings: {
        ...kimiSettings,
        thinkingModeEnabled: true,
      },
      apiKey: "sk-test",
    });

    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body));
    expect(requestBody.temperature).toBe(1.0);
    expect(requestBody.thinking).toEqual({ type: "enabled" });
  });
});
