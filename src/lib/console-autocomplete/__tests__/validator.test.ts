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
});
