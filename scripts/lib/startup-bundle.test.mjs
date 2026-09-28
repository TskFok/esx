import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeStartupBundle } from "./startup-bundle.mjs";
import viteConfig from "../../vite.config.ts";

const chunks = [
  {
    file: "assets/index.js",
    bytes: 100,
    imports: ["assets/shared.js"],
    dynamicImports: ["assets/editor.js"],
    modules: ["src/main.tsx"],
  },
  {
    file: "assets/shared.js",
    bytes: 200,
    imports: ["assets/index.js"],
    dynamicImports: [],
    modules: ["src/providers/app-state.tsx"],
  },
  {
    file: "assets/editor.js",
    bytes: 900,
    imports: ["assets/route.js"],
    dynamicImports: [],
    modules: ["node_modules/monaco-editor/esm/vs/editor/editor.api.js"],
  },
  {
    file: "assets/route.js",
    bytes: 50,
    imports: [],
    dynamicImports: [],
    modules: ["src/pages/console-page.tsx"],
  },
];

describe("summarizeStartupBundle", () => {
  it("静态循环中的共享块只计一次，动态编辑器不计首屏", () => {
    expect(summarizeStartupBundle(chunks, ["assets/index.js", "assets/shared.js"])).toEqual({
      initialFiles: ["assets/index.js", "assets/shared.js"],
      initialBytes: 300,
      containsMonaco: false,
    });
  });

  it("检测进入静态共享块的 Monaco", () => {
    const leaked = chunks.map((chunk) => chunk.file === "assets/shared.js"
      ? { ...chunk, modules: [...chunk.modules, "node_modules/monaco-editor/esm/vs/editor/editor.api.js"] }
      : chunk);
    expect(summarizeStartupBundle(leaked, ["assets/index.js"]).containsMonaco).toBe(true);
  });

  it("缺少入口或静态依赖块时明确报错", () => {
    expect(() => summarizeStartupBundle(chunks, ["assets/missing.js"])).toThrow(/assets\/missing\.js/);
    const broken = chunks.map((chunk) => chunk.file === "assets/index.js"
      ? { ...chunk, imports: ["assets/gone.js"] }
      : chunk);
    expect(() => summarizeStartupBundle(broken, ["assets/index.js"])).toThrow(/assets\/gone\.js/);
  });
});

function runCli(directory) {
  return spawnSync(process.execPath, [fileURLToPath(new URL("../performance/startup-bundle.mjs", import.meta.url)), directory], {
    encoding: "utf8",
  });
}

describe("startup-bundle CLI", () => {
  it("缺失构建报告时退出非零并指出文件", () => {
    const directory = mkdtempSync(join(tmpdir(), "esx-bundle-"));
    try {
      const result = runCli(directory);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/performance-chunks\.json/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("报告静态闭包与动态编辑器，并拒绝首屏 Monaco 泄漏", () => {
    const directory = mkdtempSync(join(tmpdir(), "esx-bundle-"));
    try {
      mkdirSync(join(directory, ".vite"));
      mkdirSync(join(directory, "assets"));
      writeFileSync(join(directory, ".vite", "manifest.json"), JSON.stringify({
        "index.html": { file: "assets/index.js", isEntry: true },
      }));
      for (const chunk of chunks) writeFileSync(join(directory, chunk.file), "x".repeat(chunk.bytes));
      writeFileSync(join(directory, "performance-chunks.json"), JSON.stringify(chunks));

      const result = runCli(directory);
      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.initial.rawBytes).toBe(300);
      expect(report.initial.files).toEqual(["assets/index.js", "assets/shared.js"]);
      expect(report.initial.gzipBytes).toBeGreaterThan(0);
      expect(report.dynamicEditorFiles.map(({ file }) => file)).toEqual(["assets/editor.js"]);

      const leaked = chunks.map((chunk) => chunk.file === "assets/shared.js"
        ? { ...chunk, modules: [...chunk.modules, "node_modules/monaco-editor/esm/vs/editor/editor.api.js"] }
        : chunk);
      writeFileSync(join(directory, "performance-chunks.json"), JSON.stringify(leaked));
      const leakResult = runCli(directory);
      expect(leakResult.status).toBe(1);
      expect(leakResult.stderr).toMatch(/Monaco/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Vite 构建报告", () => {
  it("输出最终代码字节数和不含机器绝对路径的模块标识", () => {
    const config = viteConfig({ command: "build", mode: "production" });
    expect(config.build.manifest).toBe(true);
    const plugin = config.plugins.find((item) => item.name === "startup-bundle-report");
    expect(plugin.generateBundle.order).toBe("post");
    const emitFile = vi.fn();
    plugin.generateBundle.handler.call({ emitFile }, {}, {
      "assets/index.js": {
        type: "chunk",
        fileName: "assets/index.js",
        code: "é",
        imports: ["assets/shared.js"],
        dynamicImports: ["assets/editor.js"],
        modules: { [join(process.cwd(), "src/main.tsx")]: {} },
      },
    });
    expect(emitFile).toHaveBeenCalledWith({
      type: "asset",
      fileName: "performance-chunks.json",
      source: JSON.stringify([{
        file: "assets/index.js",
        bytes: 2,
        imports: ["assets/shared.js"],
        dynamicImports: ["assets/editor.js"],
        modules: ["src/main.tsx"],
      }], null, 2),
    });
  });
});
