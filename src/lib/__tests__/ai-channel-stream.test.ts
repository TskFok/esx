import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, channels } = vi.hoisted(() => ({ invokeMock: vi.fn(), channels: [] as Array<{ onmessage: (event: any) => void }> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class {
    onmessage = (_event: any) => {};
    constructor() { channels.push(this); }
  },
}));
import { executeAiHttpRequest, openAiHttpStream } from "../tauri";
import { readOpenAiSseStream } from "../ai-sse";

const payload = { url: "http://localhost/v1/chat/completions", method: "POST" };
let complete: () => void;
let rejectInvoke: (reason: Error) => void;
function event(kind: string, sequence: number, extra: object = {}) {
  const args = invokeMock.mock.calls.find(([command]) => command === "execute_ai_http_request_stream")![1];
  channels[0].onmessage({ requestId: args.requestId, kind, sequence, ...extra });
}
beforeEach(() => {
  channels.length = 0;
  invokeMock.mockReset().mockImplementation((command) => command === "execute_ai_http_request_stream"
    ? new Promise<void>((resolve, reject) => { complete = resolve; rejectInvoke = reject; }) : Promise.resolve());
});

describe("AI Channel transport", () => {
  it("delivers split SSE deltas before invoke completes, then drains on done", async () => {
    const responsePromise = openAiHttpStream(payload);
    event("headers", 0, { status: 200, statusText: "OK" });
    const response = await responsePromise;
    const onDelta = vi.fn();
    const result = readOpenAiSseStream(response.body!, onDelta);
    event("chunk", 1, { text: 'da' });
    event("chunk", 2, { text: 'ta: {"choices":[{"delta":{"content":"中文😀"}}]}\n\n' });
    await vi.waitFor(() => expect(onDelta).toHaveBeenCalledWith({ kind: "content", text: "中文😀" }));
    event("chunk", 3, { text: 'data: {"choices":[{"delta":{"content":"尾段"}}]}\n\n' });
    event("done", 4);
    complete();
    expect(await result).toBe("中文😀尾段");
  });

  it("ACKs exactly once only when a reader consumes each queued chunk", async () => {
    const promise = openAiHttpStream(payload);
    event("headers", 0, { status: 200, statusText: "OK" });
    const response = await promise;
    event("chunk", 1, { text: "abc" });
    await Promise.resolve();
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "ack_ai_stream_chunk")).toHaveLength(0);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("abc");
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "ack_ai_stream_chunk")).toEqual([
      ["ack_ai_stream_chunk", expect.objectContaining({ sequence: 1 })],
    ]);
    event("done", 2);
    complete();
    expect((await reader.read()).done).toBe(true);
  });

  it("aborts once, errors pending reads, and detaches late events", async () => {
    const controller = new AbortController();
    const promise = openAiHttpStream(payload, controller.signal);
    event("headers", 0, { status: 200, statusText: "OK" });
    const reader = (await promise).body!.getReader();
    const read = reader.read();
    const assertion = expect(read).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); controller.abort();
    await assertion;
    event("chunk", 1, { text: "late" });
    event("done", 2); complete();
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "cancel_ai_http_request")).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "ack_ai_stream_chunk")).toHaveLength(0);
  });

  it("cancels native work when a consumer cancels its reader", async () => {
    const promise = openAiHttpStream(payload);
    event("headers", 0, { status: 200, statusText: "OK" });
    await (await promise).body!.cancel();
    expect(invokeMock).toHaveBeenCalledWith("cancel_ai_http_request", expect.any(Object));
    complete();
  });

  it("preserves non-2xx headers and error body", async () => {
    const promise = openAiHttpStream(payload);
    event("headers", 0, { status: 401, statusText: "Unauthorized" });
    const response = await promise;
    const text = response.text();
    event("chunk", 1, { text: '{"error":"denied"}' });
    event("done", 2); complete();
    expect(response.ok).toBe(false);
    expect(await text).toBe('{"error":"denied"}');
  });

  it("rejects native failures before headers and while reading", async () => {
    const beforeHeaders = openAiHttpStream(payload);
    rejectInvoke(new Error("send failed"));
    await expect(beforeHeaders).rejects.toThrow("send failed");
    channels.length = 0; invokeMock.mockClear();
    const promise = openAiHttpStream(payload);
    event("headers", 0, { status: 200, statusText: "OK" });
    const read = (await promise).body!.getReader().read();
    rejectInvoke(new Error("read failed"));
    await expect(read).rejects.toThrow("read failed");
  });

  it("does not start already aborted requests; non-streaming stays on the old command", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(openAiHttpStream(payload, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(invokeMock).not.toHaveBeenCalled();
    await executeAiHttpRequest(payload);
    expect(invokeMock).toHaveBeenCalledWith("execute_ai_http_request", { payload });
  });
});

it("aborts while waiting for headers and ignores a late header", async () => {
  const controller = new AbortController();
  const promise = openAiHttpStream(payload, controller.signal);
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  event("headers", 0, { status: 200, statusText: "OK" });
  complete();
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "cancel_ai_http_request")).toHaveLength(1);
});

it("rejects excess queued chunks and cancels the native producer", async () => {
  const promise = openAiHttpStream(payload);
  event("headers", 0, { status: 200, statusText: "OK" });
  const response = await promise;
  for (let sequence = 1; sequence <= 9; sequence++) event("chunk", sequence, { text: "pending" });
  await expect(response.text()).rejects.toThrow("协议限制");
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "ack_ai_stream_chunk")).toHaveLength(0);
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "cancel_ai_http_request")).toHaveLength(1);
  complete();
});

it("waits for Channel terminal events when invoke resolves before queued IPC delivery", async () => {
  const promise = openAiHttpStream(payload);
  event("headers", 0, { status: 200, statusText: "OK" });
  const response = await promise;
  complete();
  await Promise.resolve();
  await Promise.resolve();
  event("chunk", 1, { text: "delayed IPC" });
  event("done", 2);
  expect(await response.text()).toBe("delayed IPC");
});
