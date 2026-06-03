import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecuteAiHttpRequest } = vi.hoisted(() => ({
  mockExecuteAiHttpRequest: vi.fn(),
}));

vi.mock("../tauri", () => ({
  executeAiHttpRequest: mockExecuteAiHttpRequest,
}));

import {
  buildGenerateUserPrompt,
  generateRequestContent,
  generateRequestContentWithAi,
  normalizeGeneratedRequestContent,
  stripMarkdownCodeFence,
} from "../ai-generate-client";

const settings = {
  enabled: true,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  providerId: "openai",
  apiKeyRequired: true,
  thinkingModeEnabled: false,
} as const;

describe("stripMarkdownCodeFence", () => {
  it("removes fenced code block wrapper", () => {
    expect(stripMarkdownCodeFence("```json\nPOST /idx/_search\n{}\n```")).toBe("POST /idx/_search\n{}");
  });

  it("returns trimmed plain text unchanged", () => {
    expect(stripMarkdownCodeFence("GET /_cluster/health")).toBe("GET /_cluster/health");
  });
});

describe("normalizeGeneratedRequestContent", () => {
  it("formats valid generated request", () => {
    expect(
      normalizeGeneratedRequestContent('POST /users/_search\n{"query":{"match_all":{}}}'),
    ).toBe('POST /users/_search\n{\n  "query": {\n    "match_all": {}\n  }\n}');
  });

  it("throws when content is empty", () => {
    expect(() => normalizeGeneratedRequestContent("   ")).toThrow("AI 未返回请求内容。");
  });

  it("throws when request format is invalid", () => {
    expect(() => normalizeGeneratedRequestContent("not a request")).toThrow("暂不支持该 HTTP Method。");
  });
});

describe("buildGenerateUserPrompt", () => {
  it("requires non-empty description", () => {
    expect(() => buildGenerateUserPrompt("  ")).toThrow("请输入请求描述。");
  });

  it("includes metadata hints when provided", () => {
    const prompt = buildGenerateUserPrompt("查询 users", {
      indexNames: ["users", "orders"],
      aliasNames: ["user-alias"],
    });

    expect(prompt).toContain("查询 users");
    expect(prompt).toContain("已知索引：users, orders");
    expect(prompt).toContain("已知 alias：user-alias");
  });
});

describe("generateRequestContentWithAi", () => {
  beforeEach(() => {
    mockExecuteAiHttpRequest.mockReset();
  });

  it("returns formatted request content from ai response", async () => {
    mockExecuteAiHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      bodyText: JSON.stringify({
        choices: [{ message: { content: 'POST /users/_search\n{"query":{"term":{"status":"active"}}}' } }],
      }),
    });

    const result = await generateRequestContentWithAi({
      settings,
      apiKey: "sk-test",
      description: "搜索 active 用户",
    });

    expect(result).toContain("POST /users/_search");
    expect(result).toContain('"status": "active"');
  });

  it("throws when ai service returns error", async () => {
    mockExecuteAiHttpRequest.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      bodyText: JSON.stringify({ error: { message: "invalid api key" } }),
    });

    await expect(
      generateRequestContentWithAi({
        settings,
        apiKey: "bad-key",
        description: "查询 users",
      }),
    ).rejects.toThrow("invalid api key");
  });
});

describe("generateRequestContent", () => {
  beforeEach(() => {
    mockExecuteAiHttpRequest.mockReset();
  });

  it("throws when ai is not configured", async () => {
    await expect(
      generateRequestContent({
        description: "查询 users",
        aiSettings: { ...settings, enabled: false },
        apiKey: "sk-test",
      }),
    ).rejects.toThrow("AI 未配置");
  });
});
