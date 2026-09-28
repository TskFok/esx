/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readStorage, writeStorage, loadVault, onCloseRequested, destroy } = vi.hoisted(() => ({
  readStorage: vi.fn(), writeStorage: vi.fn(), loadVault: vi.fn(), onCloseRequested: vi.fn(), destroy: vi.fn(),
}));
vi.mock("../../lib/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/storage")>(),
  readAppStorage: readStorage, writeAppStorage: writeStorage,
}));
vi.mock("../../lib/tauri", () => ({ loadSecretsVault: loadVault }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested, destroy }) }));

import { createEmptyStorage } from "../../lib/storage";
import { AppStateProvider, useAppState } from "../app-state";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  readStorage.mockResolvedValue(createEmptyStorage());
  writeStorage.mockResolvedValue(undefined);
  loadVault.mockResolvedValue({ aiApiKeyConfigured: false, migratedLegacyEntries: 0 });
  onCloseRequested.mockResolvedValue(() => undefined);
  destroy.mockResolvedValue(undefined);
});

async function openState() {
  const hook = renderHook(() => useAppState(), { wrapper: AppStateProvider });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await waitFor(() => expect(onCloseRequested).toHaveBeenCalledOnce());
  await act(async () => { await hook.result.current.flushAppState(); });
  writeStorage.mockClear();
  return hook;
}

function closeEvent() {
  const preventDefault = vi.fn();
  const handler = onCloseRequested.mock.calls[0][0] as (event: { preventDefault: () => void }) => Promise<void>;
  return { preventDefault, run: () => handler({ preventDefault }) };
}

describe("应用状态持久化", () => {
  it("关闭时提交尚未到期的正文和请求名本地缓冲", async () => {
    const hook = await openState();
    let pendingContent = "GET /last-character";
    let pendingName = "最终名字";
    act(() => hook.result.current.registerPendingDraftFlush(() => {
      hook.result.current.updateDraft("conn-1", (draft) => ({ ...draft, content: pendingContent, name: pendingName }));
    }));
    const event = closeEvent();
    await act(async () => { await event.run(); });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(writeStorage).toHaveBeenLastCalledWith(expect.objectContaining({
      drafts: expect.objectContaining({ "conn-1": expect.objectContaining({ content: pendingContent, name: pendingName }) }),
    }), expect.any(Set));
    expect(destroy).toHaveBeenCalledOnce();
    pendingContent = "";
    pendingName = "";
  });

  it("保存失败时保留窗口，下一次关闭重试未保存数据", async () => {
    const hook = await openState();
    writeStorage.mockRejectedValueOnce(new Error("disk unavailable"));
    act(() => hook.result.current.updateDraft("conn-1", (draft) => ({ ...draft, content: "GET /retry" })));
    const event = closeEvent();
    await act(async () => { await event.run(); });
    expect(destroy).not.toHaveBeenCalled();
    await act(async () => { await event.run(); });
    expect(writeStorage).toHaveBeenLastCalledWith(expect.objectContaining({
      drafts: expect.objectContaining({ "conn-1": expect.objectContaining({ content: "GET /retry" }) }),
    }), expect.any(Set));
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("写入进行时连续关闭只保存和销毁一次", async () => {
    const hook = await openState();
    const pending = deferred();
    writeStorage.mockImplementationOnce(() => pending.promise);
    act(() => hook.result.current.updateDraft("conn-1", (draft) => ({ ...draft, name: "只保存一次" })));
    const event = closeEvent();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = event.run(); second = event.run(); });
    await waitFor(() => expect(writeStorage).toHaveBeenCalledOnce());
    expect(destroy).not.toHaveBeenCalled();
    pending.resolve();
    await act(async () => { await Promise.all([first, second]); });
    expect(writeStorage).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("显式保存紧跟状态修改时写入最新草稿", async () => {
    const hook = await openState();
    await act(async () => {
      await hook.result.current.flushAppState(() => {
        hook.result.current.updateDraft("conn-1", (draft) => ({ ...draft, content: "GET /explicit" }));
      });
    });
    expect(writeStorage).toHaveBeenLastCalledWith(expect.objectContaining({
      drafts: expect.objectContaining({ "conn-1": expect.objectContaining({ content: "GET /explicit" }) }),
    }), expect.any(Set));
  });

  it("读取失败后不会把空白状态写回磁盘", async () => {
    readStorage.mockRejectedValueOnce(new Error("read failure"));
    const hook = renderHook(() => useAppState(), { wrapper: AppStateProvider });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(async () => { await hook.result.current.flushAppState(); });
    expect(writeStorage).not.toHaveBeenCalled();
    hook.unmount();
  });
});
