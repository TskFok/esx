import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function modulePath(id) {
  const virtualPrefix = id.startsWith("\0") ? "\0" : "";
  const path = id.slice(virtualPrefix.length);
  const normalized = isAbsolute(path) ? relative(projectRoot, path) : path;
  return virtualPrefix + normalized.replaceAll("\\", "/");
}

export function startupBundlePlugin() {
  return {
    name: "startup-bundle-report",
    enforce: "post",
    generateBundle: {
      // Vite 的动态导入处理会在 generateBundle 中改写 chunk.code，统计必须最后执行。
      order: "post",
      handler(_options, bundle) {
        const chunks = Object.values(bundle)
          .filter((output) => output.type === "chunk")
          .map((chunk) => ({
            file: chunk.fileName,
            bytes: new TextEncoder().encode(chunk.code).byteLength,
            imports: chunk.imports,
            dynamicImports: chunk.dynamicImports,
            modules: Object.keys(chunk.modules).map(modulePath).sort(),
          }))
          .sort((left, right) => left.file.localeCompare(right.file));
        this.emitFile({
          type: "asset",
          fileName: "performance-chunks.json",
          source: JSON.stringify(chunks, null, 2),
        });
      },
    },
  };
}

function isMonacoModule(moduleId) {
  return /(?:^|\/)@?monaco-editor(?:@|\/|$)/.test(moduleId.replaceAll("\\", "/"));
}

export function summarizeStartupBundle(chunks, entryFiles) {
  const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
  const visited = new Set();
  const pending = [...entryFiles].reverse();
  let initialBytes = 0;
  let containsMonaco = false;

  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;

    const chunk = byFile.get(file);
    if (!chunk) throw new Error(`构建报告缺少 JS chunk：${file}`);

    visited.add(file);
    initialBytes += chunk.bytes;
    containsMonaco ||= chunk.modules.some(isMonacoModule);
    pending.push(...chunk.imports.toReversed());
  }

  return { initialFiles: [...visited], initialBytes, containsMonaco };
}
