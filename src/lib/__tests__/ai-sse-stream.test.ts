import { describe, expect, it } from "vitest";
import { readOpenAiSseStream } from "../ai-sse";

describe("readOpenAiSseStream", () => {
  it("accumulates only content deltas for final parsing", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}\n\ndata: {"choices":[{"delta":{"content":"{\\"valid\\":true}"}}]}\n\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const deltas: Array<{ kind: "reasoning" | "content"; text: string }> = [];
    const accumulated = await readOpenAiSseStream(stream, (delta) => deltas.push(delta));

    expect(deltas).toEqual([
      { kind: "reasoning", text: "思考中" },
      { kind: "content", text: '{"valid":true}' },
    ]);
    expect(accumulated).toBe('{"valid":true}');
  });
});

it("reassembles UTF-8 codepoints split across byte chunks", async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"中文😀"}}]}\n\n');
  const onDelta = (delta: { text: string }) => seen.push(delta.text);
  const seen: string[] = [];
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  expect(await readOpenAiSseStream(stream, onDelta)).toBe("中文😀");
  expect(seen).toEqual(["中文😀"]);
});
