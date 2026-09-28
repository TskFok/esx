import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../types/connections";

const disk = vi.hoisted(() => ({
  files: new Map<string, Record<string, unknown>>(),
  memory: new Map<string, Record<string, unknown>>(),
  failSave: new Set<string>(),
  failOnAttempt: new Map<string, number>(),
  saves: [] as string[],
  options: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    constructor(private filename: string, options: Record<string, unknown>) { disk.options.set(filename, options); }
    async get(key: string) {
      return structuredClone((disk.memory.get(this.filename) ?? disk.files.get(this.filename))?.[key]);
    }
    async set(key: string, value: unknown) {
      const current = disk.memory.get(this.filename) ?? disk.files.get(this.filename) ?? {};
      disk.memory.set(this.filename, { ...current, [key]: structuredClone(value) });
    }
    async save() {
      disk.saves.push(this.filename);
      if (disk.failSave.has(this.filename) ||
        disk.failOnAttempt.get(this.filename) === disk.saves.filter((file) => file === this.filename).length) {
        throw new Error(`save failed: ${this.filename}`);
      }
      disk.files.set(this.filename, structuredClone(disk.memory.get(this.filename) ?? {}));
    }
  },
}));

import { createEmptyStorage, readAppStorage, writeAppStorage } from "../storage";

const coldFile = "esx-store.json";
const hotFile = "esx-hot.json";
const stored = (file: string, key: string) => disk.files.get(file)?.[key];
const restart = () => disk.memory.clear();

function connection(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: "connection-1", name: "Development", baseUrl: "https://cluster.example/prefix/", username: "explicit-user",
    auth: { type: "basic" }, tls: { mode: "default" }, environment: "dev", readonly: false,
    insecureTls: false, sshProfileId: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", lastUsedAt: "2026-01-01",
    ...overrides,
  };
}

function legacyState() {
  const state = createEmptyStorage();
  state.connections = [connection()];
  state.drafts["connection-1"] = {
    connectionId: "connection-1", name: "未提交草稿", content: "GET /_cat/indices",
    activeSavedRequestId: null, response: null,
  };
  state.currentConnectionId = "connection-1";
  return state;
}

describe("app storage V2 partitioning", () => {
  beforeEach(() => {
    disk.files.clear(); disk.memory.clear(); disk.failSave.clear(); disk.failOnAttempt.clear(); disk.saves.length = 0;
    vi.restoreAllMocks();
  });

  it("migrates V1 drafts into hot storage and reads them after restart", async () => {
    const state = legacyState();
    disk.files.set(coldFile, { "app-state": state });

    expect((await readAppStorage()).drafts["connection-1"].content).toBe("GET /_cat/indices");
    expect(stored(hotFile, "app-state-hot-v2")).toMatchObject({ drafts: state.drafts, currentConnectionId: "connection-1" });
    expect(stored(coldFile, "app-state-v2")).toMatchObject({ version: 2, connections: state.connections });
    expect(stored(coldFile, "app-state")).toEqual(state);
    restart();
    expect((await readAppStorage()).drafts["connection-1"].name).toBe("未提交草稿");
  });

  it("applies the persisted preview budget while migrating V1 responses", async () => {
    const state = legacyState();
    state.requests = [{
      id: "request-1", connectionId: "connection-1", name: "saved", method: "POST", path: "/_search",
      body: '{"query":"keep"}', tags: ["saved"], sortOrder: 0,
      lastResponse: {
        ok: true, status: 200, statusText: "OK", durationMs: 1, sizeBytes: 2_000_000,
        executedAt: "2026-01-01", bodyPreview: "中".repeat(350_000),
        previewBytes: 1_050_000, truncated: true, isJson: false, diagnostics: [],
      },
      lastStatus: 200, lastDurationMs: 1, updatedAt: "2026-01-01",
    }];
    disk.files.set(coldFile, { "app-state": state });

    const migrated = await readAppStorage();

    expect(migrated.requests[0]).toMatchObject({ body: '{"query":"keep"}', tags: ["saved"] });
    expect(migrated.requests[0].lastResponse?.previewEvicted).toBe(true);
    expect((stored(coldFile, "app-state-v2") as { requests: typeof state.requests }).requests[0].lastResponse?.bodyPreview).toBe("");
    expect((stored(coldFile, "app-state") as typeof state).requests[0].lastResponse?.bodyPreview).toHaveLength(350_000);
  });

  it.each([hotFile, coldFile])("leaves V1 intact when %s migration save fails", async (failedFile) => {
    const state = legacyState();
    disk.files.set(coldFile, { "app-state": state });
    disk.failSave.add(failedFile);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await readAppStorage()).drafts["connection-1"].name).toBe("未提交草稿");
    expect(stored(coldFile, "app-state")).toEqual(state);
    expect(stored(coldFile, "app-state-v2")).toBeUndefined();
    restart();
    disk.failSave.clear();
    expect((await readAppStorage()).drafts["connection-1"].name).toBe("未提交草稿");
  });

  it("rejects missing hot data after V2 commit instead of falling back to stale V1", async () => {
    disk.files.set(coldFile, { "app-state": legacyState(), "app-state-v2": { version: 2, ...createEmptyStorage(), requests: [] } });
    await expect(readAppStorage()).rejects.toThrow(/hot|热数据|恢复/);
  });

  it("saves only the hot file when a draft changes", async () => {
    const state = legacyState();
    await writeAppStorage(state);
    disk.saves.length = 0;
    for (const content of ["GET /_nodes", "GET /_cluster/health", "GET /_nodes/stats"]) {
      state.drafts["connection-1"] = { ...state.drafts["connection-1"], content };
      await writeAppStorage(state, new Set(["hot"]));
    }

    expect(disk.saves).toEqual([hotFile, hotFile, hotFile]);
    expect(disk.options.get(hotFile)?.autoSave).toBe(false);
    expect(disk.options.get(coldFile)?.autoSave).toBe(false);
    restart();
    expect((await readAppStorage()).drafts["connection-1"].content).toBe("GET /_nodes/stats");
  });

  it("persists cold preview eviction when only a hot draft was marked dirty", async () => {
    const state = legacyState();
    const response = (executedAt: string) => ({
      ok: true, status: 200, statusText: "OK", durationMs: 1, sizeBytes: 1024 * 1024,
      executedAt, bodyPreview: "x".repeat(1024 * 1024), previewBytes: 1024 * 1024,
      truncated: false, isJson: false, diagnostics: [],
    });
    state.requests = Array.from({ length: 32 }, (_, index) => ({
      id: `request-${index}`, connectionId: "connection-1", name: "request", method: "GET", path: "/",
      body: "", tags: [], sortOrder: index, lastResponse: response(`2026-01-${String(index + 1).padStart(2, "0")}`),
      lastStatus: 200, lastDurationMs: 1, updatedAt: "2026-01-01",
    }));
    await writeAppStorage(state);
    disk.saves.length = 0;
    state.drafts["connection-1"] = { ...state.drafts["connection-1"], response: response("2026-02-01") };

    disk.failSave.add(coldFile);
    await expect(writeAppStorage(state, new Set(["hot"]))).rejects.toThrow();
    expect((stored(coldFile, "app-state-v2") as { requests: typeof state.requests }).requests[0].lastResponse?.previewEvicted).toBeUndefined();
    disk.failSave.clear();
    await writeAppStorage(state, new Set(["hot"]));

    expect(disk.saves).toEqual([coldFile, coldFile, hotFile]);
    restart();
    const recovered = await readAppStorage();
    expect(recovered.requests[0].lastResponse?.previewEvicted).toBe(true);
    expect(recovered.drafts["connection-1"].response?.bodyPreview).toHaveLength(1024 * 1024);
  });

  it("persists hot preview eviction when only a cold request was marked dirty", async () => {
    const state = legacyState();
    const response = (executedAt: string) => ({
      ok: true, status: 200, statusText: "OK", durationMs: 1, sizeBytes: 1024 * 1024,
      executedAt, bodyPreview: "x".repeat(1024 * 1024), previewBytes: 1024 * 1024,
      truncated: false, isJson: false, diagnostics: [],
    });
    for (let index = 0; index < 32; index += 1) {
      const id = `connection-${index + 1}`;
      if (index > 0) state.connections.push(connection({ id }));
      state.drafts[id] = {
        connectionId: id, name: "", content: "GET /", activeSavedRequestId: null,
        response: response(`2026-01-${String(index + 1).padStart(2, "0")}`),
      };
    }
    await writeAppStorage(state);
    disk.saves.length = 0;
    state.requests = [{
      id: "new-request", connectionId: "connection-1", name: "new", method: "GET", path: "/",
      body: "", tags: [], sortOrder: 0, lastResponse: response("2026-02-01"), lastStatus: 200,
      lastDurationMs: 1, updatedAt: "2026-02-01",
    }];

    disk.failSave.add(hotFile);
    await expect(writeAppStorage(state, new Set(["cold"]))).rejects.toThrow();
    expect((stored(hotFile, "app-state-hot-v2") as { drafts: typeof state.drafts }).drafts["connection-1"].response?.previewEvicted).toBeUndefined();
    disk.failSave.clear();
    await writeAppStorage(state, new Set(["cold"]));

    expect(disk.saves).toEqual([coldFile, hotFile, coldFile, hotFile]);
    restart();
    const recovered = await readAppStorage();
    expect(recovered.drafts["connection-1"].response?.previewEvicted).toBe(true);
    expect(recovered.requests[0].lastResponse?.bodyPreview).toHaveLength(1024 * 1024);
  });

  it("keeps newer cold requests and removes stale hot drafts after interrupted cross-partition write", async () => {
    const old = legacyState();
    old.drafts["connection-1"].activeSavedRequestId = "old-request";
    old.requests = [{
      id: "old-request", connectionId: "connection-1", name: "old", method: "GET", path: "/old",
      body: "", tags: [], sortOrder: 0, lastResponse: null, lastStatus: null,
      lastDurationMs: null, updatedAt: "2026-01-01",
    }];
    await writeAppStorage(old);
    const next = {
      ...old,
      drafts: { "connection-1": { ...old.drafts["connection-1"], activeSavedRequestId: "new-request" } },
      requests: [{ ...old.requests[0], id: "new-request", path: "/new" }],
    };
    disk.failSave.add(hotFile);

    await expect(writeAppStorage(next, new Set(["cold", "hot"]))).rejects.toThrow();
    expect(disk.saves.slice(-2)).toEqual([coldFile, hotFile]);
    restart();
    disk.failSave.clear();
    const recovered = await readAppStorage();
    expect(recovered.requests.map((request) => request.id)).toEqual(["new-request"]);
    expect(recovered.drafts["connection-1"].activeSavedRequestId).toBeNull();
    expect(recovered.drafts["connection-1"].content).toBe("GET /_cat/indices");
  });

  it("clears a hot draft's cross-connection saved-request reference after recovery", async () => {
    const state = legacyState();
    state.connections.push(connection({ id: "connection-2" }));
    state.requests = [{
      id: "other-request", connectionId: "connection-2", name: "other", method: "GET", path: "/",
      body: "", tags: [], sortOrder: 0, lastResponse: null, lastStatus: null,
      lastDurationMs: null, updatedAt: "2026-01-01",
    }];
    state.drafts["connection-1"] = {
      ...state.drafts["connection-1"], connectionId: "connection-2", activeSavedRequestId: "other-request",
    };
    await writeAppStorage(state);
    restart();

    const recovered = await readAppStorage();
    expect(recovered.drafts["connection-1"]).toMatchObject({ connectionId: "connection-1", activeSavedRequestId: null });
  });
});

describe("app storage sensitive-data migration", () => {
  beforeEach(() => {
    disk.files.clear(); disk.memory.clear(); disk.failSave.clear(); disk.failOnAttempt.clear(); disk.saves.length = 0;
    vi.restoreAllMocks();
  });

  it("returns sanitized user data even when persisting the migration fails", async () => {
    const state = legacyState();
    state.connections = [connection({ baseUrl: "https://old-user:old-pass@cluster.example/" })];
    disk.files.set(coldFile, { "app-state": state });
    disk.failSave.add(hotFile);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const migrated = await readAppStorage();
    expect(migrated.connections[0]).toMatchObject({ id: "connection-1", baseUrl: "https://cluster.example/" });
    expect(stored(coldFile, "app-state-v2")).toBeUndefined();
  });

  it("sanitizes the retained V1 record after V2 commit without dropping its structure", async () => {
    const state = legacyState();
    state.connections = [connection({ baseUrl: "https://old-user:old-pass@cluster.example/" })];
    state.aiSettings.baseUrl = "https://ai-user:ai-pass@ai.example/v1?token=old-token";
    state.errorLogs = [{
      id: "log-1", createdAt: "2026-01-01", scope: "request-execution", title: "failure", summary: "failure",
      diagnostics: [], request: { path: "/_search?api_key=log-key", content: 'POST /_search\n{"password":"body-secret"}' },
    }];
    disk.files.set(coldFile, { "app-state": state });

    await readAppStorage();

    const legacy = stored(coldFile, "app-state") as typeof state;
    expect(legacy.drafts["connection-1"].content).toBe("GET /_cat/indices");
    expect(legacy.connections[0].baseUrl).toBe("https://cluster.example/");
    expect(JSON.stringify(disk.files.get(coldFile))).not.toMatch(/old-user|old-pass|ai-user|ai-pass|old-token|log-key|body-secret/);
  });

  it("retries V1 sanitization after its post-commit save fails", async () => {
    const state = legacyState();
    state.connections = [connection({ baseUrl: "https://old-user:old-pass@cluster.example/" })];
    disk.files.set(coldFile, { "app-state": state });
    disk.failOnAttempt.set(coldFile, 2);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await readAppStorage();
    expect(stored(coldFile, "app-state-v2")).toBeDefined();
    expect((stored(coldFile, "app-state") as typeof state).connections[0].baseUrl).toContain("old-pass");
    disk.failOnAttempt.clear();
    await readAppStorage();
    expect((stored(coldFile, "app-state") as typeof state).connections[0].baseUrl).toBe("https://cluster.example/");
  });

  it("sanitizes writes without mutating live state or normal request content", async () => {
    const state = legacyState();
    state.connections = [connection({ baseUrl: "https://old-user:old-pass@cluster.example/prefix/" })];
    state.drafts["connection-1"].content = 'POST /documents/_doc\n{"password":"intentional-document-value"}';
    const before = structuredClone(state);

    await writeAppStorage(state);

    expect(stored(coldFile, "app-state-v2")).toMatchObject({ connections: [{ baseUrl: "https://cluster.example/prefix/" }] });
    expect(stored(hotFile, "app-state-hot-v2")).toMatchObject({ drafts: { "connection-1": { content: state.drafts["connection-1"].content } } });
    expect(state).toEqual(before);
  });
});
