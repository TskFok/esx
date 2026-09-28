import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { summarizeStartupBundle } from "../lib/startup-bundle.mjs";

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`无法读取构建产物 ${file}：${error.message}`);
  }
}

function gzipBytes(directory, file) {
  try {
    return gzipSync(readFileSync(join(directory, file))).byteLength;
  } catch (error) {
    throw new Error(`无法读取 JS chunk ${file}：${error.message}`);
  }
}

function findDynamicEditorFiles(chunks, initialFiles) {
  const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
  const initial = new Set(initialFiles);
  const pending = initialFiles.flatMap((file) => byFile.get(file).dynamicImports);
  const dynamicReachable = new Set();

  while (pending.length > 0) {
    const file = pending.pop();
    if (initial.has(file) || dynamicReachable.has(file)) continue;
    const chunk = byFile.get(file);
    if (!chunk) throw new Error(`构建报告缺少 JS chunk：${file}`);
    dynamicReachable.add(file);
    pending.push(...chunk.imports, ...chunk.dynamicImports);
  }

  return [...dynamicReachable].filter((file) =>
    byFile.get(file).modules.some((moduleId) =>
      /(?:^|\/)(?:console-editor|monaco-runtime|monaco-editor)(?:[/.@-]|$)/.test(moduleId.replaceAll("\\", "/"))))
    .sort();
}

try {
  const directory = resolve(process.argv[2] ?? "dist");
  const chunks = readJson(join(directory, "performance-chunks.json"));
  const manifest = readJson(join(directory, ".vite", "manifest.json"));
  const entryFile = manifest["index.html"]?.file;
  if (!entryFile) throw new Error("构建 manifest 缺少 index.html 入口 JS");

  const summary = summarizeStartupBundle(chunks, [entryFile]);
  const dynamicEditorFiles = findDynamicEditorFiles(chunks, summary.initialFiles);
  const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
  const report = {
    entryFile,
    initial: {
      files: summary.initialFiles,
      rawBytes: summary.initialBytes,
      gzipBytes: summary.initialFiles.reduce((total, file) => total + gzipBytes(directory, file), 0),
      containsMonaco: summary.containsMonaco,
      budgetBytes: 1_000_000,
      overBudget: summary.initialBytes >= 1_000_000,
    },
    dynamicEditorFiles: dynamicEditorFiles.map((file) => ({
      file,
      bytes: byFile.get(file).bytes,
      gzipBytes: gzipBytes(directory, file),
    })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (summary.containsMonaco) {
    console.error("连接页首屏静态闭包含 Monaco，请检查依赖图。");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
