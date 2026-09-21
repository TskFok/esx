import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../types/connections";

const backingStore = vi.hoisted(() => ({ value: undefined as unknown, saved: undefined as unknown, failSave: false }));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get() { return structuredClone(backingStore.value); }
    async set(_key: string, value: unknown) { backingStore.value = structuredClone(value); }
    async save() {
      if (backingStore.failSave) throw new Error("simulated-storage-failure");
      backingStore.saved = structuredClone(backingStore.value);
    }
  },
}));

import { createEmptyStorage, readAppStorage, writeAppStorage } from "../storage";

function connection(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: "connection-1", name: "Development", baseUrl: "https://cluster.example/prefix/", username: "explicit-user",
    auth: { type: "basic" }, tls: { mode: "default" }, environment: "dev", readonly: false,
    insecureTls: false, sshProfileId: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", lastUsedAt: "2026-01-01",
    ...overrides,
  };
}

describe("app storage sensitive-data migration", () => {
  beforeEach(() => {
    backingStore.value = undefined;
    backingStore.saved = undefined;
    backingStore.failSave = false;
    vi.restoreAllMocks();
  });

  it("returns migrated user data even when persisting the migration fails", async () => {
    const state = createEmptyStorage();
    state.connections = [connection({ baseUrl: "https://old-user:old-pass@cluster.example/" })];
    backingStore.value = state;
    backingStore.failSave = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const migrated = await readAppStorage();

    expect(migrated.connections).toHaveLength(1);
    expect(migrated.connections[0]).toMatchObject({ id: "connection-1", baseUrl: "https://cluster.example/" });
    expect(backingStore.saved).toBeUndefined();
  });

  it("cleans historical URL credentials and nested logs on read and persists the migration", async () => {
    const state = createEmptyStorage();
    state.connections = [connection({
      name: "https://old-user:old-pass@cluster.example/",
      baseUrl: "https://old-user:old-pass@cluster.example/prefix/?%61pi_key=old-key&pretty=true",
    })];
    state.aiSettings.baseUrl = "https://ai-user:ai-pass@ai.example/v1?token=old-token";
    state.errorLogs = [{
      id: "log-1", createdAt: "2026-01-01", scope: "request-execution",
      title: "https://old-user:old-pass@cluster.example/", summary: "Failed", diagnostics: [],
      request: { path: "/_search?api_key=log-key", content: 'POST /_search\n{"password":"body-secret","size":1}' },
      rawResponse: '{"result":{"accessToken":"response-secret","count":2}}',
    }];
    backingStore.value = state;

    const migrated = await readAppStorage();

    expect(migrated.connections[0]).toMatchObject({
      name: "https://cluster.example/", baseUrl: "https://cluster.example/prefix/?pretty=true", username: "explicit-user",
    });
    expect(migrated.aiSettings.baseUrl).toBe("https://ai.example/v1");
    expect(migrated.errorLogs[0].request?.path).toBe("/_search?api_key=[REDACTED]");
    expect(JSON.stringify(backingStore.saved)).not.toMatch(/old-pass|old-user|old-key|old-token|ai-pass|ai-user|log-key|body-secret|response-secret/);
    expect(backingStore.saved).toEqual(migrated);
  });

  it("sanitizes every write without mutating live state or normal request content", async () => {
    const state = createEmptyStorage();
    state.connections = [connection({ baseUrl: "https://old-user:old-pass@cluster.example/prefix/" })];
    state.drafts["connection-1"] = {
      connectionId: "connection-1", name: "draft", activeSavedRequestId: null, response: null,
      content: 'POST /documents/_doc\n{"password":"intentional-document-value","name":"visible"}',
    };
    const before = structuredClone(state);

    await writeAppStorage(state);

    expect(backingStore.saved).toMatchObject({
      connections: [{ baseUrl: "https://cluster.example/prefix/", username: "explicit-user" }],
      drafts: { "connection-1": { content: 'POST /documents/_doc\n{"password":"intentional-document-value","name":"visible"}' } },
    });
    expect(state).toEqual(before);
  });

  it("keeps safe URL spellings and avoids rewriting unchanged storage", async () => {
    const state = createEmptyStorage();
    state.connections = [connection()];
    backingStore.value = state;

    expect(await readAppStorage()).toEqual(state);
    expect(backingStore.saved).toBeUndefined();
  });
});
