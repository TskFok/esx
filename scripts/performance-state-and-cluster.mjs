// 受控微基准：只使用本地源码和内存 Fake LazyStore，不调用 Tauri/网络。
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// esbuild 是 Vite 的已安装传递依赖，pnpm 严格布局下不能从脚本直接 import。
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");

const root = resolve(import.meta.dirname, "..");
const baseline = "0f840bd644552c16a3c6aac48be51889953c6cb6";
const warmups = 3;
const repeats = 12;
const componentPath = join(root, "src/components/console/status-indices-tab.tsx");
const storagePath = join(root, "src/lib/storage.ts");
const queuePath = join(root, "src/lib/persist-queue.ts");
const fakeStoreSource = `
  export class LazyStore {
    constructor(filename) { this.filename = filename; }
    async get(key) { return globalThis.__esxPerfStores.get(this.filename)?.get(key); }
    async set(key, value) {
      globalThis.__esxPerfEvents.push({ type: "set", file: this.filename, bytes: Buffer.byteLength(JSON.stringify(value), "utf8") });
      let entries = globalThis.__esxPerfStores.get(this.filename);
      if (!entries) { entries = new Map(); globalThis.__esxPerfStores.set(this.filename, entries); }
      entries.set(key, value);
    }
    async save() { globalThis.__esxPerfEvents.push({ type: "save", file: this.filename }); }
  }
`;

function baselineSource(path) {
  const relative = path.slice(root.length + 1);
  return execFileSync("git", ["show", `${baseline}:${relative}`], { cwd: root, encoding: "utf8" });
}

async function bundle(entry, outfile, useBaseline, mockStore = false) {
  const plugins = [{
    name: "controlled-source",
    setup(api) {
      if (useBaseline) api.onLoad({ filter: /(?:status-indices-tab\.tsx|storage\.ts)$/ }, (args) => {
        if (args.path !== entry) return undefined;
        return { contents: baselineSource(args.path), loader: args.path.endsWith(".tsx") ? "tsx" : "ts" };
      });
      if (mockStore) {
        api.onResolve({ filter: /^@tauri-apps\/plugin-store$/ }, () => ({ path: "fake-store", namespace: "perf" }));
        api.onLoad({ filter: /.*/, namespace: "perf" }, () => ({ contents: fakeStoreSource, loader: "js" }));
      }
    },
  }];
  await build({ entryPoints: [entry], outfile, bundle: true, platform: "node", format: "esm", packages: "external", plugins, logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

function cpuMs(start) {
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.ceil(sorted.length * p) - 1];
  return { p50: percentile(0.5), p95: percentile(0.95), raw: samples };
}

function snapshot(count) {
  return {
    indices: Array.from({ length: count }, (_, i) => ({
      name: `index-${String(i).padStart(5, "0")}`, health: "green", status: "open",
      primaryShards: 1, replicaShards: 1, docsCount: i + 1,
      docsDeleted: 0, storeBytes: (i + 1) * 1024, primaryStoreBytes: (i + 1) * 1024,
      shardSummary: { active: 2, initializing: 0, relocating: 0, unassigned: 0 },
    })),
    summary: { totalIndices: count, systemIndices: 0, visibleStoreBytes: 0, visibleDocsCount: 0 },
    risks: [], fetchedAt: "2026-09-28T00:00:00.000Z",
  };
}

function renderCase(component, data) {
  const start = process.cpuUsage();
  const html = renderToStaticMarkup(createElement(component, { snapshot: data }));
  const cpu = cpuMs(start);
  const tbody = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  if (!tbody) throw new Error("未找到 tbody");
  return { cpu, rows: (tbody.match(/<tr\b/g) ?? []).length };
}

function resetFakeStores() {
  globalThis.__esxPerfStores = new Map();
  globalThis.__esxPerfEvents = [];
}

function draftStates(storage) {
  const initial = storage.createEmptyStorage();
  initial.requests = Array.from({ length: 200 }, (_, i) => ({
    id: `req-${i}`, connectionId: "conn-1", name: `请求 ${i}`,
    method: "GET", path: "/_cluster/health", body: "", headers: {},
    tags: [], sortOrder: i, lastResponse: null, lastStatus: null,
    lastDurationMs: null, updatedAt: "2026-09-28T00:00:00.000Z",
  }));
  return Array.from({ length: 20 }, (_, i) => ({
    ...initial,
    drafts: { "conn-1": { connectionId: "conn-1", name: "", content: `GET /_search\n${"x".repeat(128)}${i}`, activeSavedRequestId: null, response: null } },
  }));
}

async function storeCase(storage, queueFactory, states) {
  resetFakeStores();
  await storage.writeAppStorage(states[0]); // 创建初始 V1/V2 存储；不计入 20 次更新。
  globalThis.__esxPerfEvents = [];
  const start = process.cpuUsage();
  if (queueFactory) {
    const queue = queueFactory({
      write: ({ state, dirty }) => storage.writeAppStorage(state, dirty),
      merge: (pending, newer) => ({ state: newer.state, dirty: new Set([...pending.dirty, ...newer.dirty]) }),
    });
    for (const state of states) queue.schedule({ state, dirty: new Set(["hot"]) });
    await queue.flush();
  } else {
    await Promise.all(states.map((state) => storage.writeAppStorage(state)));
  }
  const cpu = cpuMs(start);
  const events = globalThis.__esxPerfEvents;
  return {
    cpu,
    set: events.filter((event) => event.type === "set").length,
    save: events.filter((event) => event.type === "save").length,
    serializedBytes: events.reduce((sum, event) => sum + (event.bytes ?? 0), 0),
    files: [...new Set(events.map((event) => event.file))],
  };
}

// bundle 需要从项目 node_modules 解析 react 等 external package。
const temp = await mkdtemp(join(root, "node_modules", ".esx-perf-"));
try {
  const [beforeComponent, afterComponent, beforeStorage, afterStorage, queueModule] = await Promise.all([
    bundle(componentPath, join(temp, "before-component.mjs"), true),
    bundle(componentPath, join(temp, "after-component.mjs"), false),
    bundle(storagePath, join(temp, "before-storage.mjs"), true, true),
    bundle(storagePath, join(temp, "after-storage.mjs"), false, true),
    bundle(queuePath, join(temp, "queue.mjs"), false),
  ]);

  const render = {};
  for (const count of [1000, 10000]) {
    const data = snapshot(count);
    render[count] = {};
    for (const [label, module] of [["baseline", beforeComponent], ["current", afterComponent]]) {
      for (let i = 0; i < warmups; i++) renderCase(module.StatusIndicesTab, data);
      const samples = Array.from({ length: repeats }, () => renderCase(module.StatusIndicesTab, data));
      const rows = [...new Set(samples.map((sample) => sample.rows))];
      if (rows.length !== 1) throw new Error("SSR 行数不稳定");
      render[count][label] = { tbodyRows: rows[0], cpuMs: stats(samples.map((sample) => sample.cpu)) };
    }
  }

  const persistence = {};
  for (const [label, storage, queueFactory] of [
    ["baseline", beforeStorage, null], ["current", afterStorage, queueModule.createPersistQueue],
  ]) {
    const states = draftStates(storage);
    for (let i = 0; i < warmups; i++) await storeCase(storage, queueFactory, states);
    const samples = [];
    for (let i = 0; i < repeats; i++) samples.push(await storeCase(storage, queueFactory, states));
    persistence[label] = {
      set: [...new Set(samples.map((sample) => sample.set))],
      save: [...new Set(samples.map((sample) => sample.save))],
      serializedBytes: [...new Set(samples.map((sample) => sample.serializedBytes))],
      files: [...new Set(samples.flatMap((sample) => sample.files))],
      cpuMs: stats(samples.map((sample) => sample.cpu)),
    };
  }

  console.log(JSON.stringify({
    baseline, currentHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? null },
    warmups, repeats, render, persistence,
    caveat: "SSR 为 Node 服务端静态渲染 CPU 时间；Store 为隔离内存模拟，set/save 是调用次数、serializedBytes 是 set(value) 的 JSON UTF-8 长度。",
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
