import { describe, expect, it, vi } from "vitest";
import { getCachedNdjsonCompletion } from "../ndjson-completion-cache";
import { analyzeBodyCompletion } from "../body-context";
import { parseConsoleRequestContext } from "../request-context";

function modelFor(initialContent: string) {
  let lines = initialContent.split(/\r?\n/);
  const changeListeners = new Set<(event: { changes: { range: { startLineNumber: number } }[] }) => void>();
  const disposeListeners = new Set<() => void>();
  return {
    getLineCount: () => lines.length,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? "",
    onDidChangeContent(listener: (event: { changes: { range: { startLineNumber: number } }[] }) => void) {
      changeListeners.add(listener);
      return { dispose: () => changeListeners.delete(listener) };
    },
    onWillDispose(listener: () => void) {
      disposeListeners.add(listener);
      return { dispose: () => disposeListeners.delete(listener) };
    },
    replaceLine(lineNumber: number, content: string) {
      lines[lineNumber - 1] = content;
      for (const listener of changeListeners) listener({ changes: [{ range: { startLineNumber: lineNumber } }] });
    },
    replaceContent(content: string, changedLines: number[]) {
      lines = content.split(/\r?\n/);
      for (const listener of changeListeners) {
        listener({ changes: changedLines.map((lineNumber) => ({ range: { startLineNumber: lineNumber } })) });
      }
    },
    dispose() {
      for (const listener of disposeListeners) listener();
    },
    listenerCounts: () => ({ change: changeListeners.size, dispose: disposeListeners.size }),
  };
}

describe("getCachedNdjsonCompletion", () => {
  it("连续补全千行 Bulk 的末行时不再解析已完成旧行", () => {
    const lines = Array.from({ length: 500 }, () => [
      '{"index":{"_index":"orders"}}',
      '{"name":"item"}',
    ]).flat();
    const content = `POST /_bulk\n${lines.join("\n")}\n`;
    const model = modelFor(content);
    const request = parseConsoleRequestContext(content);
    const position = { lineNumber: 1002, column: 1 };
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(getCachedNdjsonCompletion(model as never, position as never, request).kind).toBe("bulk-action");
      const parsedAtFirstPass = parse.mock.calls.length;
      expect(parsedAtFirstPass).toBe(1000);
      expect(getCachedNdjsonCompletion(model as never, position as never, request).kind).toBe("bulk-action");
      expect(getCachedNdjsonCompletion(model as never, position as never, request).kind).toBe("bulk-action");
      expect(parse.mock.calls.length).toBe(parsedAtFirstPass);
    } finally {
      parse.mockRestore();
    }
  });

  it.each([
    ["POST /_bulk\n{\"index\":{\"_index\":\"orders\"}}\n", "bulk-source", ["orders"]],
    ["POST /_bulk\n{\"delete\":{\"_index\":\"orders\"}}\n", "bulk-action", null],
    ["POST /_bulk\n{\"update\":{\"_index\":\"users\"}}\n", "bulk-update", ["users"]],
    ["POST /_bulk\n{\"index\":{\"_index\":\"orders-*\"}}\n", "bulk-source", []],
    ["POST /_bulk\n{\"index\":{\"_index\":\"orders\"}}\n\n", "bulk-source", ["orders"]],
    ["POST /_bulk\nnot-json\n", "unknown", null],
    ["POST /_bulk\r\n{\"index\":{\"_index\":\"orders\"}}\r\n", "bulk-source", ["orders"]],
    ["POST /_msearch\n{\"index\":[\"orders\",\"users\"]}\n", "msearch-body", ["orders", "users"]],
    ["POST /_msearch\n{\"index\":\"orders\"}\n{}\n", "msearch-header", null],
    ["POST /_msearch\n42\n", "unknown", null],
  ] as const)("缓存与全量分析保持 NDJSON 语义：%s", (content, kind, targetNames) => {
    const model = modelFor(content);
    const lines = content.split(/\r?\n/);
    const position = { lineNumber: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
    const request = parseConsoleRequestContext(content);
    const cached = getCachedNdjsonCompletion(model as never, position as never, request);
    expect(cached).toEqual(analyzeBodyCompletion(content, request));
    expect(cached).toMatchObject({ kind, targetNames });
  });

  it("多处变更从最早变更行重算后缀，保留此前解析结果和新目标", () => {
    const lines = Array.from({ length: 10 }, () => [
      '{"index":{"_index":"orders"}}',
      '{"name":"item"}',
    ]).flat();
    const content = `POST /_bulk\n${lines.join("\n")}\n`;
    const model = modelFor(content);
    const request = parseConsoleRequestContext(content);
    const parse = vi.spyOn(JSON, "parse");
    try {
      getCachedNdjsonCompletion(model as never, { lineNumber: 22, column: 1 } as never, request);
      expect(parse).toHaveBeenCalledTimes(20);
      const editedLines = [...lines];
      editedLines[8] = '{"index":{"_index":"users"}}';
      model.replaceContent(`POST /_bulk\n${editedLines.join("\n")}\n`, [15, 10]);
      expect(getCachedNdjsonCompletion(model as never, { lineNumber: 11, column: 1 } as never, request))
        .toMatchObject({ kind: "bulk-source", targetNames: ["users"] });
      expect(parse).toHaveBeenCalledTimes(21);
      getCachedNdjsonCompletion(model as never, { lineNumber: 22, column: 1 } as never, request);
      expect(parse).toHaveBeenCalledTimes(32);
    } finally {
      parse.mockRestore();
    }
  });

  it("中段 MSearch header 改写后，正文采用新目标且前缀不重算", () => {
    const lines = Array.from({ length: 10 }, () => [
      '{"index":"orders"}',
      '{"query":{}}',
    ]).flat();
    const content = `POST /_msearch\n${lines.join("\n")}\n`;
    const model = modelFor(content);
    const request = parseConsoleRequestContext(content);
    const parse = vi.spyOn(JSON, "parse");
    try {
      getCachedNdjsonCompletion(model as never, { lineNumber: 22, column: 1 } as never, request);
      expect(parse).toHaveBeenCalledTimes(20);
      model.replaceLine(10, '{"index":"users"}');
      expect(getCachedNdjsonCompletion(model as never, { lineNumber: 11, column: 1 } as never, request))
        .toMatchObject({ kind: "msearch-body", targetNames: ["users"] });
      expect(parse).toHaveBeenCalledTimes(21);
      getCachedNdjsonCompletion(model as never, { lineNumber: 22, column: 1 } as never, request);
      expect(parse).toHaveBeenCalledTimes(32);
    } finally {
      parse.mockRestore();
    }
  });

  it("Bulk 动作改写为 delete 后丢弃待补正文，插入行后按新行序推进", () => {
    let content = 'POST /_bulk\n{"index":{"_index":"orders"}}\n';
    const model = modelFor(content);
    const position = { lineNumber: 3, column: 1 };
    getCachedNdjsonCompletion(model as never, position as never, parseConsoleRequestContext(content));
    content = 'POST /_bulk\n{"delete":{"_index":"orders"}}\n';
    model.replaceLine(2, '{"delete":{"_index":"orders"}}');
    expect(getCachedNdjsonCompletion(model as never, position as never, parseConsoleRequestContext(content)))
      .toEqual(analyzeBodyCompletion(content, parseConsoleRequestContext(content)));
    content = 'POST /_bulk\n{"delete":{"_index":"orders"}}\n{"update":{"_index":"users"}}\n';
    model.replaceContent(content, [3]);
    expect(getCachedNdjsonCompletion(model as never, { lineNumber: 4, column: 1 } as never, parseConsoleRequestContext(content)))
      .toMatchObject({ kind: "bulk-update", targetNames: ["users"] });
  });

  it("首行从 Bulk 切到 MSearch 后重建状态，释放模型时注销监听", () => {
    let content = 'POST /_bulk\n{"index":{"_index":"orders"}}\n';
    const model = modelFor(content);
    expect(getCachedNdjsonCompletion(model as never, { lineNumber: 3, column: 1 } as never, parseConsoleRequestContext(content)))
      .toMatchObject({ kind: "bulk-source", targetNames: ["orders"] });
    content = 'POST /_msearch\n{"index":"users"}\n';
    model.replaceContent(content, [2, 1]);
    const request = parseConsoleRequestContext(content);
    const cached = getCachedNdjsonCompletion(model as never, { lineNumber: 3, column: 1 } as never, request);
    expect(cached).toEqual(analyzeBodyCompletion(content, request));
    expect(cached).toMatchObject({ kind: "msearch-body", targetNames: ["users"] });
    expect(model.listenerCounts()).toEqual({ change: 1, dispose: 1 });
    model.dispose();
    expect(model.listenerCounts()).toEqual({ change: 0, dispose: 0 });
  });
});
