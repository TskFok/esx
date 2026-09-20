// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function splitCspSources(value) {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(splitCspSources);
  }

  return String(value).trim().split(/\s+/).filter(Boolean);
}

export function hasSchemeWildcard(sources) {
  return sources.some(
    (source) => source === "*" || source === "https:" || source === "http:" || source === "ws:" || source === "wss:",
  );
}

export function hasRemoteHost(sources) {
  return sources.some((source) =>
    /^(https?|wss?):\/\/(?!ipc\.localhost(?:[:/]|$)|localhost(?::\d+)?(?:\/|$)|127\.0\.0\.1(?::\d+)?(?:\/|$))/i.test(
      source,
    ),
  );
}

function loadTauriSecurity() {
  const config = JSON.parse(readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
  return config.app?.security ?? {};
}

function expectContains(sources, required) {
  for (const source of required) {
    expect(sources).toContain(source);
  }
}

describe("splitCspSources", () => {
  it("拆分数组和空格分隔的来源", () => {
    expect(splitCspSources(["'self' blob:", "ipc:"])).toEqual(["'self'", "blob:", "ipc:"]);
    expect(splitCspSources(null)).toEqual([]);
  });
});

describe("CSP 来源检查", () => {
  it("识别协议通配但不把 ipc.localhost 当成通配", () => {
    expect(hasSchemeWildcard(["ipc:", "http://ipc.localhost", "https://ipc.localhost"])).toBe(false);
    expect(hasSchemeWildcard(["https:"])).toBe(true);
    expect(hasSchemeWildcard(["*"])).toBe(true);
  });

  it("识别远程主机但不把 ipc 与本地开发地址当成远程", () => {
    expect(hasRemoteHost(["https://cdn.example.com"])).toBe(true);
    expect(hasRemoteHost(["https://ipc.localhost", "http://localhost:1420", "ws://127.0.0.1:1421"])).toBe(false);
  });
});

describe("Tauri CSP", () => {
  const security = loadTauriSecurity();
  const production = security.csp;
  const development = security.devCsp;
  const productionConnect = splitCspSources(production?.["connect-src"]);
  const developmentConnect = splitCspSources(development?.["connect-src"]);
  const productionScript = splitCspSources(production?.["script-src"]);
  const developmentScript = splitCspSources(development?.["script-src"]);

  it("生产与开发策略都已启用", () => {
    expect(production).toBeTruthy();
    expect(development).toBeTruthy();
    expect(typeof production).toBe("object");
    expect(typeof development).toBe("object");
  });

  it("生产 connect-src 仅允许 IPC，不含协议通配或远程主机", () => {
    expectContains(productionConnect, ["ipc:", "http://ipc.localhost", "https://ipc.localhost"]);
    expect(hasSchemeWildcard(productionConnect)).toBe(false);
    expect(hasRemoteHost(productionConnect)).toBe(false);
    expect(productionConnect.join(" ")).not.toMatch(/localhost:142[01]/);
    expect(productionConnect.join(" ")).not.toMatch(/127\.0\.0\.1:142[01]/);
  });

  it("script-src 不含远程 CDN，并保留 Monaco 所需来源", () => {
    expectContains(productionScript, ["'self'", "'unsafe-eval'", "blob:"]);
    expect(hasRemoteHost(productionScript)).toBe(false);
    expectContains(developmentScript, ["'self'", "'unsafe-eval'", "'unsafe-inline'", "blob:"]);
    expect(hasRemoteHost(developmentScript)).toBe(false);
  });

  it("object-src 为 none，样式与 worker 指令满足本地资源需求", () => {
    expect(splitCspSources(production?.["object-src"])).toEqual(["'none'"]);
    expect(splitCspSources(development?.["object-src"])).toEqual(["'none'"]);
    expectContains(splitCspSources(production?.["style-src"]), ["'self'", "'unsafe-inline'"]);
    expectContains(splitCspSources(production?.["worker-src"]), ["'self'", "blob:"]);
    expectContains(splitCspSources(production?.["child-src"]), ["'self'", "blob:"]);
    expectContains(splitCspSources(production?.["img-src"]), ["'self'", "data:", "blob:"]);
    expectContains(splitCspSources(production?.["font-src"]), ["'self'", "data:"]);
    expectContains(splitCspSources(production?.["default-src"]), ["'self'"]);
    expectContains(splitCspSources(production?.["base-uri"]), ["'self'"]);
    expectContains(splitCspSources(production?.["form-action"]), ["'self'"]);
  });

  it("只关闭 style-src 的自动 nonce 注入", () => {
    expect(security.dangerousDisableAssetCspModification).toEqual(["style-src"]);
  });

  it("devCsp.connect-src 包含 Vite 开发源，生产不含这些源", () => {
    expectContains(developmentConnect, [
      "ipc:",
      "http://ipc.localhost",
      "https://ipc.localhost",
      "http://localhost:1420",
      "http://127.0.0.1:1420",
      "ws://localhost:1420",
      "ws://localhost:1421",
      "ws://127.0.0.1:1420",
      "ws://127.0.0.1:1421",
    ]);
    expect(hasSchemeWildcard(developmentConnect)).toBe(false);
    expect(hasRemoteHost(developmentConnect)).toBe(false);
  });
});
