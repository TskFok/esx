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
