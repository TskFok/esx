import { describe, expect, it } from "vitest";
import { validateConsoleBody, validateConsoleContent } from "../validator";

describe("validateConsoleBody", () => {
  it("returns no diagnostics for valid JSON", () => {
    const diagnostics = validateConsoleBody('{\n  "query": { "match_all": {} }\n}');
    expect(diagnostics).toEqual([]);
  });

  it("reports trailing comma", () => {
    const diagnostics = validateConsoleBody('{\n  "size": 10,\n}');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toContain("尾随逗号");
  });

  it("reports unclosed object", () => {
    const diagnostics = validateConsoleBody('{\n  "size": 10');
    expect(diagnostics.some((item) => item.message.includes("未闭合"))).toBe(true);
  });

  it("reports extra closing bracket", () => {
    const diagnostics = validateConsoleBody('{\n  "size": 10\n}}');
    expect(diagnostics.some((item) => item.message.includes("多余"))).toBe(true);
  });
});

describe("validateConsoleContent", () => {
  it("skips header line and validates body", () => {
    const diagnostics = validateConsoleContent('GET /_search\n{\n  "size": 10,\n}');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.startLineNumber).toBe(3);
  });

  it("returns no diagnostics when body empty", () => {
    expect(validateConsoleContent("GET /_search")).toEqual([]);
    expect(validateConsoleContent("GET /_search\n  \n")).toEqual([]);
  });

  it("keeps exact positions for 200 unclosed arrays across CRLF lines", () => {
    const content = `GET /_search\r\n${Array.from({ length: 200 }, (_, index) => `  [${index}`).join("\r\n")}`;
    const diagnostics = validateConsoleContent(content);
    expect(diagnostics).toHaveLength(200);
    expect(diagnostics[0]).toMatchObject({
      message: "未闭合的 [ 数组",
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 4,
    });
    expect(diagnostics[199]).toMatchObject({
      message: "未闭合的 [ 数组",
      startLineNumber: 201,
      startColumn: 3,
      endLineNumber: 201,
      endColumn: 4,
    });
  });

  it("keeps trailing comma position and message", () => {
    expect(validateConsoleContent('POST /_search\n{\n  "size": 10,\n}')[0]).toMatchObject({
      message: "JSON 不允许尾随逗号",
      startLineNumber: 3,
      startColumn: 13,
      endLineNumber: 3,
      endColumn: 14,
    });
  });

  it("marks an unclosed string before the next line", () => {
    expect(validateConsoleContent('POST /_search\n{\n  "name": "abc\n}')[0]).toMatchObject({
      message: "字符串未闭合",
      startLineNumber: 3,
      startColumn: 11,
      endLineNumber: 3,
      endColumn: 15,
    });
  });

  it("marks an extra closing bracket at its own column", () => {
    expect(validateConsoleContent('POST /_search\n{}\r\n  ]')[0]).toMatchObject({
      message: "多余的 ]",
      startLineNumber: 3,
      startColumn: 3,
      endLineNumber: 3,
      endColumn: 4,
    });
  });
});
