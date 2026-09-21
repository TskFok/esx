/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readStorage, writeStorage, loadVault, readKey, deleteKey, saveKey } = vi.hoisted(() => ({
  readStorage: vi.fn(), writeStorage: vi.fn(), loadVault: vi.fn(), readKey: vi.fn(), deleteKey: vi.fn(), saveKey: vi.fn(),
}));
vi.mock("../../lib/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/storage")>(),
  readAppStorage: readStorage, writeAppStorage: writeStorage,
}));
vi.mock("../../lib/tauri", () => ({
  loadSecretsVault: loadVault, getAiApiKey: readKey, deleteAiApiKey: deleteKey, saveAiApiKey: saveKey,
}));

import { createEmptyStorage } from "../../lib/storage";
import { AppStateProvider, useAppState } from "../app-state";
import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../../types/ai-settings";

beforeEach(() => {
  vi.clearAllMocks();
  readStorage.mockResolvedValue(createEmptyStorage());
  writeStorage.mockResolvedValue(undefined);
  loadVault.mockResolvedValue({ aiApiKeyConfigured: true, migratedLegacyEntries: 0 });
  readKey.mockResolvedValue("old-test-key");
  deleteKey.mockResolvedValue(undefined);
  saveKey.mockResolvedValue(undefined);
});

async function openState() {
  const hook = renderHook(() => useAppState(), { wrapper: AppStateProvider });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

describe("application credential boundaries", () => {
  it("preserves loaded connection data when keyring initialization fails", async () => {
    const stored = createEmptyStorage();
    stored.connections = [{
      id: "existing", name: "保留的连接", baseUrl: "https://cluster.example.invalid", username: "user",
      auth: { type: "basic" }, tls: { mode: "default" }, environment: "dev", readonly: false,
      insecureTls: false, sshProfileId: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", lastUsedAt: "2026-01-01",
    }];
    readStorage.mockResolvedValue(stored);
    loadVault.mockRejectedValue(new Error("keyring temporarily unavailable"));
    const hook = await openState();
    expect(hook.result.current.connections).toHaveLength(1);
    expect(hook.result.current.connections[0]?.id).toBe("existing");
    expect(hook.result.current.aiApiKeyConfigured).toBe(false);
    expect(await hook.result.current.getAiApiKey()).toBeNull();
    expect(writeStorage.mock.calls.every(([state]) => state.connections.length === 1)).toBe(true);
  });

  it("redacts all audit log fields before exposing or persisting them", async () => {
    const hook = await openState();
    act(() => hook.result.current.recordAuditLog({
      scope: "request-audit", title: "token=test-title-token", summary: "GET /?token=test-query-token",
      connection: { baseUrl: "https://user:test-url-password@cluster.example.invalid", sshTunnelEnabled: false },
      request: { method: "GET", path: "/?token=test-query-token", content: "GET /?token=test-query-token" },
    }));
    const log = hook.result.current.errorLogs[0];
    expect(JSON.stringify(log)).not.toMatch(/test-title-token|test-query-token|test-url-password/);
    await waitFor(() => expect(writeStorage).toHaveBeenLastCalledWith(expect.objectContaining({ errorLogs: [log] })));
  });

  it("clears the previous AI key when changing origin without a replacement", async () => {
    const hook = await openState();
    await act(async () => hook.result.current.saveAiSettings({
      settings: { ...DEFAULT_AI_ANALYSIS_SETTINGS, baseUrl: "https://new.example.invalid/v1" },
      apiKey: null, clearApiKey: false,
    }));
    expect(deleteKey).toHaveBeenCalledOnce();
    expect(hook.result.current.aiApiKeyConfigured).toBe(false);
    expect(await hook.result.current.getAiApiKey()).toBeNull();
    expect(readKey).not.toHaveBeenCalled();
  });

  it("does not let a stale settings callback load the new provider key", async () => {
    const hook = await openState();
    const readForOldSettings = hook.result.current.getAiApiKey;
    await act(async () => hook.result.current.saveAiSettings({
      settings: { ...DEFAULT_AI_ANALYSIS_SETTINGS, baseUrl: "https://new.example.invalid/v1" },
      apiKey: "replacement-test-key", clearApiKey: false,
    }));
    readKey.mockResolvedValue("replacement-test-key");
    expect(await readForOldSettings()).toBeNull();
    expect(readKey).not.toHaveBeenCalled();
    expect(saveKey).toHaveBeenCalledWith("replacement-test-key", "https://new.example.invalid");
  });

  it("keeps the key for model changes on the same origin", async () => {
    const hook = await openState();
    await act(async () => hook.result.current.saveAiSettings({
      settings: { ...DEFAULT_AI_ANALYSIS_SETTINGS, model: "another-model" }, apiKey: null, clearApiKey: false,
    }));
    expect(deleteKey).not.toHaveBeenCalled();
    expect(await hook.result.current.getAiApiKey()).toBe("old-test-key");
    expect(readKey).toHaveBeenCalledWith("https://api.openai.com");
    expect(loadVault).toHaveBeenCalledWith(expect.objectContaining({ aiBaseUrl: "https://api.openai.com/v1" }));
  });
});
