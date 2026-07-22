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

  it.each([
    ['POST /_bulk\n{"index":{"_index":"orders"}}\n', "bulk-source", ["orders"]],
    ['POST /_bulk\n{"update":{"_index":"orders, users","_id":"1"}}\n', "bulk-update", ["orders", "users"]],
    ['POST /_msearch\n{"index":"orders"}\n', "msearch-body", ["orders"]],
    ['POST /_msearch\n{"index":["orders","users"]}\n', "msearch-body", ["orders", "users"]],
  ] as const)("保留当前 NDJSON 正文的目标：%s", (content, kind, targetNames) => {
    expect(analyzeBodyCompletion(content, parseConsoleRequestContext(content))).toMatchObject({
      kind,
      targetNames,
    });
  });

  it.each([
    ['POST /_bulk\n{"index":{}}\n', "bulk-source"],
    ['POST /_msearch\n{}\n', "msearch-body"],
  ] as const)("未提供 NDJSON 目标时保留空缺以便回退 URL：%s", (content, kind) => {
    expect(analyzeBodyCompletion(content, parseConsoleRequestContext(content))).toMatchObject({
      kind,
      targetNames: null,
    });
  });

  it.each([
    'POST /_bulk\n{"index":{"_index":"orders-*"}}\n',
    'POST /_msearch\n{"index":"unknown*"}\n',
  ])("显式 wildcard NDJSON 目标保守为空：%s", (content) => {
    expect(analyzeBodyCompletion(content, parseConsoleRequestContext(content)).targetNames).toEqual([]);
  });
});
