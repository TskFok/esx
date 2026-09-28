/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../types/connections";
import type { ConnectionSearchMetadata } from "../../types/requests";
const { readStorage, fetchTargets, fetchMetadata, loadVault } = vi.hoisted(() => ({
  readStorage: vi.fn(), fetchTargets: vi.fn(), fetchMetadata: vi.fn(), loadVault: vi.fn(),
}));
vi.mock("../../lib/storage", async (original) => ({ ...await original<typeof import("../../lib/storage")>(), readAppStorage: readStorage, writeAppStorage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/http-client", async (original) => ({ ...await original<typeof import("../../lib/http-client")>(), fetchTargetMappingFields: fetchTargets, fetchConnectionSearchMetadata: fetchMetadata }));
vi.mock("../../lib/tauri", () => ({
  loadSecretsVault: loadVault, getConnectionPassword: vi.fn().mockResolvedValue("placeholder"),
  getConnectionSecret: vi.fn().mockResolvedValue("user:placeholder"), getConnectionSshSecret: vi.fn().mockResolvedValue(null),
}));
import { AppStateProvider, useAppState } from "../app-state";
import { createEmptyStorage } from "../../lib/storage";
import { normalizeClusterMetadata } from "../../lib/console-autocomplete/capabilities";

const connection: ConnectionProfile = {
  id: "a", name: "测试", baseUrl: "https://example.invalid", username: "user", auth: { type: "basic" }, tls: { mode: "default" },
  environment: "dev", readonly: false, insecureTls: false, sshProfileId: null, createdAt: "2026-01-01", updatedAt: "2026-01-02", lastUsedAt: "2026-01-01",
};
function metadata(): ConnectionSearchMetadata {
  return { connectionId: "a", connectionUpdatedAt: connection.updatedAt, indices: ["one", "two"], aliases: ["alias"], aliasToIndices: { alias: ["one", "two"] },
    fields: [], fieldsByIndex: {}, cluster: normalizeClusterMetadata(null), fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString() };
}
function seed(cache = metadata()) {
  const state = createEmptyStorage(); state.connections = [connection]; state.currentConnectionId = "a"; state.searchMetadata = { a: cache };
  readStorage.mockResolvedValue(state);
}
async function openState() {
  const hook = renderHook(() => useAppState(), { wrapper: AppStateProvider });
  await waitFor(() => expect(hook.result.current.ready).toBe(true)); return hook;
}
beforeEach(() => {
  vi.clearAllMocks(); seed(); loadVault.mockResolvedValue({ aiApiKeyConfigured: false, migratedLegacyEntries: 0 });
  fetchTargets.mockResolvedValue({ requestedNames: ["alias"], fieldsByIndex: { one: ["price"], two: ["buyer"] } });
  fetchMetadata.mockResolvedValue(metadata());
});

describe("target field provider cache", () => {
  it("shares equivalent in-flight target sets and merges alias fields", async () => {
    let resolve!: (value: { requestedNames: string[]; fieldsByIndex: Record<string, string[]> }) => void;
    fetchTargets.mockReturnValue(new Promise((done) => { resolve = done; }));
    const hook = await openState();
    let first!: Promise<string[] | null>; let second!: Promise<string[] | null>;
    act(() => {
      first = hook.result.current.ensureTargetFields(connection, ["alias", "two"]);
      second = hook.result.current.ensureTargetFields(connection, ["two", "alias", "alias"]);
    });
    await waitFor(() => expect(fetchTargets).toHaveBeenCalledTimes(1));
    await act(async () => { resolve({ requestedNames: ["alias", "two"], fieldsByIndex: { one: ["price"], two: ["buyer"] } }); await Promise.all([first, second]); });
    expect(await first).toEqual(["buyer", "price"]);
    expect(hook.result.current.searchMetadataByConnection.a.fields).toEqual(["buyer", "price"]);
    await act(async () => { expect(await hook.result.current.ensureIndexFields(connection, "alias")).toEqual(["buyer", "price"]); });
    expect(fetchTargets).toHaveBeenCalledTimes(1);
  });

  it.each(["expired", "connection-version"])("refetches %s cached fields", async (reason) => {
    seed({ ...metadata(), connectionUpdatedAt: reason === "connection-version" ? "old" : connection.updatedAt,
      fields: ["stale"], fieldsByIndex: { one: ["stale"] }, fieldsFetchedAtByIndex: { one: reason === "expired" ? "2000-01-01T00:00:00.000Z" : new Date().toISOString() } });
    const hook = await openState();
    await act(async () => { await hook.result.current.ensureTargetFields(connection, ["one"]); });
    expect(fetchTargets).toHaveBeenCalledTimes(1);
    expect(hook.result.current.searchMetadataByConnection.a.fields).not.toContain("stale");
  });

  it("retries empty and forbidden results without losing name metadata", async () => {
    fetchTargets.mockResolvedValueOnce({ requestedNames: ["one"], fieldsByIndex: {} }).mockRejectedValueOnce(new Error("Forbidden"));
    const hook = await openState();
    await act(async () => { await hook.result.current.ensureTargetFields(connection, ["one"]); });
    await act(async () => { expect(await hook.result.current.ensureTargetFields(connection, ["one"])).toBeNull(); });
    expect(hook.result.current.searchMetadataByConnection.a.indices).toEqual(["one", "two"]);
    await act(async () => { await hook.result.current.ensureTargetFields(connection, ["one"]); });
    expect(fetchTargets).toHaveBeenCalledTimes(3);
  });

  it("does not let a mapping started before a name refresh repopulate stale fields", async () => {
    let resolve!: (value: { requestedNames: string[]; fieldsByIndex: Record<string, string[]> }) => void;
    fetchTargets.mockReturnValue(new Promise((done) => { resolve = done; }));
    const hook = await openState();
    let pending!: Promise<string[] | null>;
    act(() => { pending = hook.result.current.ensureTargetFields(connection, ["one"]); });
    await waitFor(() => expect(fetchTargets).toHaveBeenCalledOnce());
    await act(async () => { await hook.result.current.refreshSearchMetadata(connection, { force: true }); });
    await act(async () => { resolve({ requestedNames: ["one"], fieldsByIndex: { one: ["stale-field"] } }); await pending; });
    expect(hook.result.current.searchMetadataByConnection.a.fields).toEqual([]);
  });

  it.each(["empty", "forbidden"])("clears previously cached fields after %s mapping", async (outcome) => {
    seed({ ...metadata(), fields: ["removed"], fieldsByIndex: { one: ["removed"] }, fieldsFetchedAtByIndex: { one: new Date().toISOString() } });
    if (outcome === "empty") fetchTargets.mockResolvedValue({ requestedNames: ["one"], fieldsByIndex: { one: [] } });
    else fetchTargets.mockRejectedValue(new Error("Forbidden"));
    const hook = await openState();
    await act(async () => { await hook.result.current.ensureTargetFields(connection, ["one"], { force: true }); });
    expect(hook.result.current.searchMetadataByConnection.a.fields).toEqual([]);
    expect(hook.result.current.searchMetadataByConnection.a.fieldsByIndex.one).toBeUndefined();
  });

  it("isolates mappings started during a name refresh from requests after its completion", async () => {
    let finishNames!: (value: ConnectionSearchMetadata) => void;
    let finishOldFields!: (value: { requestedNames: string[]; fieldsByIndex: Record<string, string[]> }) => void;
    fetchMetadata.mockReturnValue(new Promise((done) => { finishNames = done; }));
    fetchTargets.mockImplementationOnce(() => new Promise((done) => { finishOldFields = done; }))
      .mockResolvedValueOnce({ requestedNames: ["one"], fieldsByIndex: { one: ["new-field"] } });
    const hook = await openState();
    let names!: Promise<ConnectionSearchMetadata>; let oldFields!: Promise<string[] | null>;
    act(() => { names = hook.result.current.refreshSearchMetadata(connection, { force: true }); });
    await waitFor(() => expect(fetchMetadata).toHaveBeenCalledOnce());
    act(() => { oldFields = hook.result.current.ensureTargetFields(connection, ["one"]); });
    await waitFor(() => expect(fetchTargets).toHaveBeenCalledOnce());
    await act(async () => { finishNames(metadata()); await names; });
    let newFields!: Promise<string[] | null>;
    act(() => { newFields = hook.result.current.ensureTargetFields(connection, ["one"]); });
    await waitFor(() => expect(fetchTargets).toHaveBeenCalledTimes(2));
    await act(async () => { await newFields; finishOldFields({ requestedNames: ["one"], fieldsByIndex: { one: ["stale-field"] } }); await oldFields; });
    expect(hook.result.current.searchMetadataByConnection.a.fields).toEqual(["new-field"]);
  });

  it("preserves stored truncation metadata and invalidates fields on name refresh", async () => {
    seed({ ...metadata(), fields: ["limited"], fieldsByIndex: { one: ["limited"] }, fieldsFetchedAtByIndex: { one: new Date().toISOString() }, fieldsTruncatedByIndex: { one: true } });
    const hook = await openState();
    expect(hook.result.current.searchMetadataByConnection.a.fieldsTruncatedByIndex?.one).toBe(true);
    await act(async () => { await hook.result.current.refreshSearchMetadata(connection, { force: true }); });
    expect(hook.result.current.searchMetadataByConnection.a.fieldsByIndex).toEqual({});
    await act(async () => { await hook.result.current.ensureTargetFields(connection, ["one"]); });
    expect(fetchTargets).toHaveBeenCalledTimes(1);
  });
});
