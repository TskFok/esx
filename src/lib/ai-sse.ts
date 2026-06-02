export type AiStreamDelta = {
  kind: "reasoning" | "content";
  text: string;
};

function extractDeltaTexts(delta: Record<string, unknown>) {
  const deltas: AiStreamDelta[] = [];

  const reasoningContent = delta.reasoning_content;
  if (typeof reasoningContent === "string" && reasoningContent.length > 0) {
    deltas.push({ kind: "reasoning", text: reasoningContent });
  }

  const content = delta.content;
  if (typeof content === "string" && content.length > 0) {
    deltas.push({ kind: "content", text: content });
  }

  return deltas;
}

function extractMessageTexts(message: Record<string, unknown>) {
  const deltas: AiStreamDelta[] = [];

  const reasoningContent = message.reasoning_content;
  if (typeof reasoningContent === "string" && reasoningContent.length > 0) {
    deltas.push({ kind: "reasoning", text: reasoningContent });
  }

  const content = message.content;
  if (typeof content === "string" && content.length > 0) {
    deltas.push({ kind: "content", text: content });
  }

  return deltas;
}

export function parseOpenAiSseChunk(buffer: string) {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  const deltas: AiStreamDelta[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      return;
    }

    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const choices = parsed.choices;
      if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
        return;
      }

      const choice = choices[0] as Record<string, unknown>;
      const delta = choice.delta;
      if (delta && typeof delta === "object" && !Array.isArray(delta)) {
        deltas.push(...extractDeltaTexts(delta as Record<string, unknown>));
        return;
      }

      const message = choice.message;
      if (message && typeof message === "object" && !Array.isArray(message)) {
        deltas.push(...extractMessageTexts(message as Record<string, unknown>));
      }
    } catch {
      // ignore malformed chunks in stream
    }
  });

  return { deltas, remainder };
}

export async function readOpenAiSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: AiStreamDelta) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedContent = "";

  function consumeDeltas(deltas: AiStreamDelta[]) {
    deltas.forEach((delta) => {
      if (delta.kind === "content") {
        accumulatedContent += delta.text;
      }
      onDelta(delta);
    });
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseOpenAiSseChunk(buffer);
    buffer = parsed.remainder;
    consumeDeltas(parsed.deltas);
  }

  if (buffer.trim()) {
    const parsed = parseOpenAiSseChunk(`${buffer}\n`);
    consumeDeltas(parsed.deltas);
  }

  return accumulatedContent;
}
