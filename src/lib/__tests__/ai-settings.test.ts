import { describe, expect, it } from "vitest";
import {
  applyAiProviderPreset,
  DEFAULT_AI_ANALYSIS_SETTINGS,
  findAiProviderPreset,
  supportsKimiThinkingMode,
} from "../../types/ai-settings";
import {
  buildAiAnalysisRequestPreview,
  createAiAnalysisHistoryEntry,
  filterAiAnalysisHistory,
  prependAiAnalysisHistory,
  resolveHistoryCompareEntries,
  toggleHistoryCompareSelection,
  truncateAiAnalysisHistoryContent,
} from "../../types/ai-analysis-history";

describe("ai provider presets", () => {
  it("applies openai preset values", () => {
    const next = applyAiProviderPreset(DEFAULT_AI_ANALYSIS_SETTINGS, findAiProviderPreset("openai")!);
    expect(next.baseUrl).toBe("https://api.openai.com/v1");
    expect(next.model).toBe("gpt-4o-mini");
    expect(next.apiKeyRequired).toBe(true);
  });

  it("applies ollama preset without required api key", () => {
    const next = applyAiProviderPreset(DEFAULT_AI_ANALYSIS_SETTINGS, findAiProviderPreset("ollama")!);
    expect(next.baseUrl).toBe("http://localhost:11434/v1");
    expect(next.apiKeyRequired).toBe(false);
  });

  it("applies kimi preset values", () => {
    const next = applyAiProviderPreset(DEFAULT_AI_ANALYSIS_SETTINGS, findAiProviderPreset("kimi")!);
    expect(next.baseUrl).toBe("https://api.moonshot.cn/v1");
    expect(next.model).toBe("kimi-k2.6");
    expect(next.apiKeyRequired).toBe(true);
    expect(next.providerId).toBe("kimi");
  });
});

describe("supportsKimiThinkingMode", () => {
  it("matches kimi k2.5 and k2.6 models", () => {
    expect(supportsKimiThinkingMode("kimi-k2.6")).toBe(true);
    expect(supportsKimiThinkingMode("kimi-k2.5")).toBe(true);
  });

  it("does not match other models", () => {
    expect(supportsKimiThinkingMode("gpt-4o-mini")).toBe(false);
    expect(supportsKimiThinkingMode("moonshot-v1-8k")).toBe(false);
  });
});

describe("ai analysis history helpers", () => {
  const sampleEntry = createAiAnalysisHistoryEntry({
    connectionId: "c1",
    connectionName: "本地 ES",
    requestContent: "GET /orders/_search",
    result: { valid: true, meaning: "ok", details: [], source: "ai" },
    model: "gpt-4o-mini",
    providerId: "openai",
    id: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  it("builds preview from first line", () => {
    expect(buildAiAnalysisRequestPreview("GET /orders/_search\n{\n  \"size\": 1\n}")).toBe("GET /orders/_search");
  });

  it("truncates long history content", () => {
    const truncated = truncateAiAnalysisHistoryContent("a".repeat(9000));
    expect(truncated.length).toBeLessThan(9000);
    expect(truncated).toContain("[内容已截断]");
  });

  it("prepends history entries with max limit", () => {
    const second = createAiAnalysisHistoryEntry({
      connectionId: "c1",
      connectionName: "本地 ES",
      requestContent: "GET /_cat/indices",
      result: { valid: true, meaning: "ok", details: [], source: "ai" },
      model: "gpt-4o-mini",
      providerId: "openai",
      id: "2",
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const merged = prependAiAnalysisHistory([sampleEntry], second, 1);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("2");
  });

  it("filters history by current connection", () => {
    const other = createAiAnalysisHistoryEntry({
      connectionId: "c2",
      connectionName: "测试 ES",
      requestContent: "GET /_cluster/health",
      result: { valid: true, meaning: "ok", details: [], source: "ai" },
      model: "gpt-4o-mini",
      providerId: "openai",
      id: "3",
      createdAt: "2026-01-03T00:00:00.000Z",
    });

    const filtered = filterAiAnalysisHistory([sampleEntry, other], {
      connectionId: "c1",
      onlyCurrentConnection: true,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.connectionId).toBe("c1");
  });

  it("resolves compare entries and toggles selection", () => {
    const second = createAiAnalysisHistoryEntry({
      connectionId: "c1",
      connectionName: "本地 ES",
      requestContent: "GET /_cat/indices",
      result: { valid: true, meaning: "ok", details: [], source: "ai" },
      model: "gpt-4o-mini",
      providerId: "openai",
      id: "2",
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    const firstPick = toggleHistoryCompareSelection([null, null], "1");
    const secondPick = toggleHistoryCompareSelection(firstPick, "2");
    const resolved = resolveHistoryCompareEntries([sampleEntry, second], secondPick);

    expect(resolved.left?.id).toBe("1");
    expect(resolved.right?.id).toBe("2");
  });
});
