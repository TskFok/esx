import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiStreamFrame } from "../ai-stream-frame";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  let pending: FrameRequestCallback | undefined;
  const requestFrame = vi.fn((callback: FrameRequestCallback) => { pending = callback; return 7; });
  const cancelFrame = vi.fn();
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  const controller = new AbortController();
  const reasoning = vi.fn();
  const content = vi.fn();
  const stream = createAiStreamFrame(controller.signal, reasoning, content);
  return { stream, controller, reasoning, content, requestFrame, cancelFrame, tick: () => pending?.(0) };
}

describe("AI 输出帧合并", () => {
  it("连续20个delta只调用一次各自的状态更新", () => {
    const test = setup();
    for (let index = 0; index < 20; index++) {
      test.stream.push({ kind: "reasoning", text: "r" });
      test.stream.push({ kind: "content", text: "c" });
    }
    expect(test.requestFrame).toHaveBeenCalledOnce();
    expect(test.reasoning).not.toHaveBeenCalled();
    expect(test.content).not.toHaveBeenCalled();
    test.tick();
    expect(test.reasoning).toHaveBeenCalledExactlyOnceWith("r".repeat(20));
    expect(test.content).toHaveBeenCalledExactlyOnceWith("c".repeat(20));
  });

  it("结束时同步flush并清除帧，之后不接收迟到delta", () => {
    const test = setup();
    test.stream.push({ kind: "content", text: "end" });
    test.stream.finish();
    test.stream.finish();
    test.stream.push({ kind: "content", text: "late" });
    test.tick();
    expect(test.content).toHaveBeenCalledExactlyOnceWith("end");
    expect(test.cancelFrame).toHaveBeenCalledExactlyOnceWith(7);
    expect(test.requestFrame).toHaveBeenCalledOnce();
  });

  it("abort清除帧和缓冲，完成与迟到回调都不更新状态", () => {
    const test = setup();
    test.stream.push({ kind: "content", text: "pending" });
    test.controller.abort();
    test.stream.finish();
    test.tick();
    test.stream.push({ kind: "content", text: "late" });
    expect(test.cancelFrame).toHaveBeenCalledExactlyOnceWith(7);
    expect(test.content).not.toHaveBeenCalled();
    expect(test.requestFrame).toHaveBeenCalledOnce();
  });
});
