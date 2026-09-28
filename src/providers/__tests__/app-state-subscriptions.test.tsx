/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../types/connections";

const { readStorage, writeStorage, loadVault } = vi.hoisted(() => ({ readStorage: vi.fn(), writeStorage: vi.fn(), loadVault: vi.fn() }));
vi.mock("../../lib/storage", async (original) => ({ ...await original<typeof import("../../lib/storage")>(), readAppStorage: readStorage, writeAppStorage: writeStorage }));
vi.mock("../../lib/tauri", () => ({ loadSecretsVault: loadVault }));
import { AppStateProvider, useAppActions, useAppStateField } from "../app-state";
import { createDefaultDraft, createEmptyStorage } from "../../lib/storage";
import { buildOperationsStatus } from "../../lib/status";

const connection = (id: string): ConnectionProfile => ({
  id, name: id, baseUrl: "https://example.invalid", username: "", auth: { type: "basic" },
  tls: { mode: "default" }, environment: "dev", readonly: false, insecureTls: false,
  sshProfileId: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", lastUsedAt: "2026-01-01",
});

beforeEach(() => {
  vi.clearAllMocks();
  const stored = createEmptyStorage();
  stored.connections = [connection("a"), connection("b")];
  stored.currentConnectionId = "a";
  stored.drafts = { a: { ...createDefaultDraft("a"), content: "GET /a" }, b: { ...createDefaultDraft("b"), content: "GET /b" } };
  readStorage.mockResolvedValue(stored);
  writeStorage.mockResolvedValue(undefined);
  loadVault.mockResolvedValue({ aiApiKeyConfigured: false, migratedLegacyEntries: 0 });
});

describe("application field subscriptions", () => {
  it("publishes only changed fields and keeps actions stable", async () => {
    const renders = { logs: 0, history: 0, draft: 0, ready: 0, actions: 0 };
    let actions!: ReturnType<typeof useAppActions>;
    function Logs() { renders.logs += 1; return <span>{useAppStateField("errorLogs").length} logs</span>; }
    function History() { renders.history += 1; return <span>{useAppStateField("statusHistoryByConnection").a?.length ?? 0} snapshots</span>; }
    function Draft() { renders.draft += 1; return <span>{useAppStateField("currentDraft")?.content}</span>; }
    function Ready() { renders.ready += 1; return <span>{useAppStateField("ready") ? "ready" : "loading"}</span>; }
    function Actions() { renders.actions += 1; actions = useAppActions(); return null; }
    render(<AppStateProvider><Logs /><History /><Draft /><Ready /><Actions /></AppStateProvider>);
    await screen.findByText("ready");
    const before = { ...renders };
    const stableActions = actions;
    act(() => actions.recordStatusSnapshot("a", buildOperationsStatus({ nodesStatsText: '{"nodes":{}}', fetchedAt: "2026-09-28T00:00:00.000Z" })));
    expect(screen.getByText("1 snapshots")).toBeVisible();
    expect(renders.history).toBeGreaterThan(before.history);
    expect(renders.logs).toBe(before.logs);
    expect(renders.draft).toBe(before.draft);
    expect(renders.ready).toBe(before.ready);
    expect(renders.actions).toBe(before.actions);
    act(() => actions.recordAuditLog({ scope: "request-audit", title: "测试", summary: "记录" }));
    expect(screen.getByText("1 logs")).toBeVisible();
    expect(actions).toBe(stableActions);
    expect(screen.getByText("GET /a")).toBeVisible();
  });

  it("switches draft subscriptions with the connection and updates the new draft through stable actions", async () => {
    let actions!: ReturnType<typeof useAppActions>;
    function Draft() {
      actions = useAppActions();
      const ready = useAppStateField("ready");
      const current = useAppStateField("currentDraft");
      return <span>{ready ? current?.content : "loading"}</span>;
    }
    render(<AppStateProvider><Draft /></AppStateProvider>);
    await screen.findByText("GET /a");
    const originalActions = actions;
    act(() => actions.setCurrentConnection("b"));
    expect(screen.getByText("GET /b")).toBeVisible();
    act(() => originalActions.updateDraft("b", (draft) => ({ ...draft, content: "GET /b/_search" })));
    await waitFor(() => expect(screen.getByText("GET /b/_search")).toBeVisible());
    expect(screen.queryByText("GET /a")).toBeNull();
  });
});
