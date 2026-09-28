import { createRequire } from "node:module";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRequire = createRequire(import.meta.url);
const viteRequire = createRequire(realpathSync(repoRequire.resolve("vite/package.json")));
const esbuild = viteRequire("esbuild");
const repo = fileURLToPath(new URL("../..", import.meta.url));
const bundle = esbuild.buildSync({
  entryPoints: {
    context: join(repo, "src/lib/console-autocomplete/context.ts"),
    validator: join(repo, "src/lib/console-autocomplete/validator.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outdir: join(repo, ".console-bench"),
  write: false,
  logLevel: "silent",
});

function loadBundledModule(name) {
  const output = bundle.outputFiles.find((file) => file.path.endsWith(`/${name}.js`));
  if (!output) throw new Error(`缺少 ${name} 打包结果`);
  const module = { exports: {} };
  new Function("require", "module", "exports", output.text)(repoRequire, module, module.exports);
  return module.exports;
}

const {
  buildConsoleAutocompleteContext,
  buildConsoleAutocompleteContextForRequest,
  buildConsoleAutocompleteStaticContext,
} = loadBundledModule("context");
const { validateConsoleContent } = loadBundledModule("validator");

let checksum = 0;
function measure(label, run, warmups = 5, samples = 30) {
  for (let i = 0; i < warmups; i += 1) checksum += run();
  const durations = [];
  for (let i = 0; i < samples; i += 1) {
    const started = performance.now();
    checksum += run();
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  const middle = Math.floor(durations.length / 2);
  const median = durations.length % 2
    ? durations[middle]
    : (durations[middle - 1] + durations[middle]) / 2;
  const p95 = durations[Math.ceil(samples * 0.95) - 1];
  return {
    label,
    samples,
    medianMs: Number(median.toFixed(3)),
    p95Ms: Number(p95.toFixed(3)),
  };
}

function makeContextData(count, fieldsPerIndex) {
  const indices = Array.from({ length: count }, (_, index) => `index-${index}`);
  const fieldsByIndex = Object.fromEntries(indices.map((indexName, index) => [
    indexName,
    Array.from({ length: fieldsPerIndex }, (_, field) => `field-${index}-${field}`),
  ]));
  const requests = indices.map((indexName, index) => ({
    id: `request-${index}`,
    connectionId: "connection-1",
    name: `Request ${index}`,
    method: "POST",
    path: `/${indexName}/_search`,
    body: "{}",
    tags: [],
    sortOrder: index * 1000,
    lastResponse: null,
    lastStatus: null,
    lastDurationMs: null,
    updatedAt: "2026-09-28T00:00:00.000Z",
  }));
  const metadata = {
    indices,
    aliases: [],
    fields: [],
    fieldsByIndex,
    aliasToIndices: {},
    cluster: {
      product: "unknown",
      version: { number: null, major: null, minor: null },
      distribution: null,
      buildFlavor: null,
      license: { type: null, status: null, source: "unknown" },
    },
  };
  return { requests, metadata };
}

const results = [];
for (const [count, fieldsPerIndex] of [[100, 50], [1000, 50], [1000, 200]]) {
  const { requests, metadata } = makeContextData(count, fieldsPerIndex);
  const content = 'POST /index-0/_search\n{"query":{"match_all":{}}}';
  const stable = buildConsoleAutocompleteStaticContext(requests, metadata);
  const suffix = `${count} requests, ${count} indices, ${fieldsPerIndex} fields/index`;
  results.push(measure(`context compatibility: ${suffix}`,
    () => buildConsoleAutocompleteContext(requests, content, metadata).fieldNames.length));
  results.push(measure(`context static build: ${suffix}`,
    () => buildConsoleAutocompleteStaticContext(requests, metadata).fieldNamesByTarget["index-0"].length));
  results.push(measure(`context request line: ${suffix}`,
    () => buildConsoleAutocompleteContextForRequest(stable, "POST /index-0/_search").fieldNames.length));
}

function validContent(kib) {
  const prefix = 'POST /index-0/_search\n{"payload":"';
  const suffix = '"}';
  return prefix + "a".repeat(kib * 1024 - prefix.length - suffix.length) + suffix;
}

for (const kib of [10, 100, 500]) {
  const content = validContent(kib);
  results.push(measure(`validate valid JSON: ${kib} KiB`,
    () => validateConsoleContent(content).length));
}

function unclosedContent(kib, depth) {
  const prefix = 'POST /index-0/_search\n{"payload":"';
  const payload = "a".repeat(kib * 1024 - prefix.length - depth - 2);
  return prefix + payload + '"}' + "[".repeat(depth);
}

for (const [kib, depth] of [[10, 100], [100, 200], [100, 1000]]) {
  const content = unclosedContent(kib, depth);
  results.push(measure(`validate unclosed JSON: ${kib} KiB, depth ${depth}`,
    () => validateConsoleContent(content).length, 3, 20));
}

console.log(JSON.stringify({
  environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  policy: "串行；上下文和有效 JSON 预热 5 次、采样 30 次，异常 JSON 预热 3 次、采样 20 次；构造和打包不计时",
  checksum,
  results,
}, null, 2));
