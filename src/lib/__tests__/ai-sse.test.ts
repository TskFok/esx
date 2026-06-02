import { describe, expect, it } from "vitest";
import { parseOpenAiSseChunk } from "../ai-sse";

describe("parseOpenAiSseChunk", () => {
  it("extracts delta content from sse lines", () => {
    const parsed = parseOpenAiSseChunk(
      'data: {"choices":[{"delta":{"content":"{\\"valid\\":"}}]}\n\ndata: {"choices":[{"delta":{"content":"true}"}}]}\n\n',
    );

    expect(parsed.deltas).toEqual([
      { kind: "content", text: '{"valid":' },
      { kind: "content", text: "true}" },
    ]);
    expect(parsed.remainder).toBe("");
  });

  it("extracts reasoning and content deltas separately", () => {
    const parsed = parseOpenAiSseChunk(
      'data: {"choices":[{"delta":{"reasoning_content":"先检查第一行"}}]}\n\ndata: {"choices":[{"delta":{"content":"{\\"valid\\":true}"}}]}\n\n',
    );

    expect(parsed.deltas).toEqual([
      { kind: "reasoning", text: "先检查第一行" },
      { kind: "content", text: '{"valid":true}' },
    ]);
  });

  it("keeps incomplete line in remainder", () => {
    const parsed = parseOpenAiSseChunk('data: {"choices":[{"delta":{"content":"ok');
    expect(parsed.deltas).toEqual([]);
    expect(parsed.remainder).toBe('data: {"choices":[{"delta":{"content":"ok');
  });
});
