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
});
