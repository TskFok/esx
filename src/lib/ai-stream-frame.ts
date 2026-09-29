import type { AiStreamDelta } from "./ai-sse";

/** 合并同一动画帧的增量；取消后丢弃尚未展示的输出。 */
export function createAiStreamFrame(
  signal: AbortSignal,
  appendReasoning: (text: string) => void,
  appendContent: (text: string) => void,
) {
  let frame: number | null = null;
  let finished = false;
  let reasoning = "";
  let content = "";
  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    reasoning = "";
    content = "";
  };
  const flush = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (!signal.aborted) {
      if (reasoning) appendReasoning(reasoning);
      if (content) appendContent(content);
    }
    reasoning = "";
    content = "";
  };
  signal.addEventListener("abort", cancel, { once: true });
  return {
    push(delta: AiStreamDelta) {
      if (finished || signal.aborted) return;
      if (delta.kind === "reasoning") reasoning += delta.text;
      else content += delta.text;
      if (frame === null) frame = requestAnimationFrame(flush);
    },
    finish() {
      if (finished) return;
      finished = true;
      flush();
      signal.removeEventListener("abort", cancel);
    },
  };
}
