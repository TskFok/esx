import { describe, expect, it } from "vitest";
import { analyzeBodyCompletion } from "../body-context";
import { parseConsoleRequestContext } from "../request-context";

describe("analyzeBodyCompletion", () => {
  it.each([
    ["POST /_bulk\n", "bulk-action"],
    ['POST /_bulk\n{"index":{"_index":"orders"}}\n', "bulk-source"],
    ['POST /_bulk\n{"update":{"_index":"orders","_id":"1"}}\n', "bulk-update"],
    ['POST /_bulk\n{"delete":{"_index":"orders","_id":"1"}}\n', "bulk-action"],
    ["POST /_msearch\n", "msearch-header"],
    ['POST /_msearch\n{"index":"orders"}\n', "msearch-body"],
  ] as const)("分析 NDJSON 状态 %s", (content, kind) => {
    expect(analyzeBodyCompletion(content, parseConsoleRequestContext(content)).kind).toBe(kind);
  });

  it.each([
    "POST /_bulk\nnot-json\n",
    "POST /_msearch\nnot-json\n",
  ])("无效 NDJSON 使用 unknown 保守状态", (content) => {
    expect(analyzeBodyCompletion(content, parseConsoleRequestContext(content)).kind).toBe("unknown");
  });

  it.each([
    "POST /_msearch\n42\n",
    "POST /_msearch\nnull\n",
    "POST /_msearch\n[]\n",
  ])("MSearch 非对象行使用 unknown 保守状态", (content) => {
    expect(analyzeBodyCompletion(content, parseConsoleRequestContext(content)).kind).toBe("unknown");
  });

  it.each([
    'POST /_bulk\n{"index":null}\n',
    'POST /_bulk\n{"index":[]}\n',
  ])("Bulk 动作 metadata 非对象时使用 unknown 保守状态", (content) => {
    expect(analyzeBodyCompletion(content, parseConsoleRequestContext(content)).kind).toBe("unknown");
  });

  it("Bulk 动作行包含多个顶层 key 时使用 unknown 保守状态", () => {
    const content = 'POST /_bulk\n{"delete":{},"index":{}}\n';

    expect(analyzeBodyCompletion(content, parseConsoleRequestContext(content)).kind).toBe("unknown");
  });
});
