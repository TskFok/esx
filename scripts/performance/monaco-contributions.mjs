import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "dist");
const chunks = JSON.parse(readFileSync(join(directory, "performance-chunks.json"), "utf8"));
const editorChunk = chunks.find((chunk) => chunk.modules.includes("src/lib/monaco-runtime.ts"));
if (!editorChunk) throw new Error("构建报告中缺少 Monaco runtime");

const required = [
  "contrib/contextmenu/browser/contextmenu.js",
  "contrib/clipboard/browser/clipboard.js",
];
const missing = required.filter((suffix) => !editorChunk.modules.some((moduleId) =>
  moduleId.endsWith(`/monaco-editor/esm/vs/editor/${suffix}`)));

if (missing.length > 0) {
  throw new Error(`Monaco 编辑器构建块缺少贡献模块：${missing.join("、")}`);
}
console.log(`Monaco 编辑器构建块 ${editorChunk.file} 包含右键菜单与剪贴板贡献模块`);
