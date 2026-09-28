/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { readStorage, writeStorage } = vi.hoisted(() => ({ readStorage: vi.fn(), writeStorage: vi.fn() }));
vi.mock("../../lib/storage", async (original) => ({ ...await original<typeof import("../../lib/storage")>(), readAppStorage: readStorage, writeAppStorage: writeStorage }));
vi.mock("../../lib/tauri", () => ({ loadSecretsVault: vi.fn().mockResolvedValue({ aiApiKeyConfigured: false, migratedLegacyEntries: 0 }) }));
import { createEmptyStorage } from "../../lib/storage";
import { AppStateProvider, useAppState } from "../app-state";

beforeEach(() => {
  vi.clearAllMocks(); writeStorage.mockResolvedValue(undefined);
  const state = createEmptyStorage();
  state.connections = [{ id: "c", name: "测试", baseUrl: "https://example.invalid", username: "user", auth: { type: "basic" }, tls: { mode: "default" }, environment: "dev", readonly: false, insecureTls: false, sshProfileId: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", lastUsedAt: "2026-01-01" }];
  readStorage.mockResolvedValue(state);
});
async function openState() {
  const hook = renderHook(() => useAppState(), { wrapper: AppStateProvider });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => { await hook.result.current.flushAppState(); });
  writeStorage.mockClear(); return hook;
}

describe("state persistence partitions", () => {
  it("persists draft changes to the hot partition only", async () => {
    const hook = await openState();
    act(() => hook.result.current.updateDraft("c", (draft) => ({ ...draft, content: "GET /changed" })));
    await act(async () => { await hook.result.current.flushAppState(); });
    expect(writeStorage).toHaveBeenCalledOnce();
    expect(writeStorage.mock.calls[0][1]).toEqual(new Set(["hot"]));
    expect(writeStorage.mock.calls[0][0].drafts.c.content).toBe("GET /changed");
  });

  it("persists audit changes to the cold partition only", async () => {
    const hook = await openState();
    act(() => hook.result.current.recordAuditLog({ scope: "request-audit", title: "测试", summary: "测试" }));
    await act(async () => { await hook.result.current.flushAppState(); });
    expect(writeStorage.mock.calls[0][1]).toEqual(new Set(["cold"]));
  });

  it("merges pending dirty partitions while preserving the newest snapshot", async () => {
    const hook = await openState();
    act(() => {
      hook.result.current.recordAuditLog({ scope: "request-audit", title: "测试", summary: "测试" });
      hook.result.current.updateDraft("c", (draft) => ({ ...draft, name: "合并后的名字" }));
    });
    await act(async () => { await hook.result.current.flushAppState(); });
    expect(writeStorage.mock.calls[0][1]).toEqual(new Set(["hot", "cold"]));
    expect(writeStorage.mock.calls[0][0].drafts.c.name).toBe("合并后的名字");
    expect(writeStorage.mock.calls[0][0].errorLogs).toHaveLength(1);
  });
});
