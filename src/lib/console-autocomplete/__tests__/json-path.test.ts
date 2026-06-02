import { describe, expect, it } from "vitest";
import { analyzeJsonCursor, isInsideString, getPreviousMeaningfulCharacter } from "../json-path";

const HEADER = "GET /_search\n";

describe("isInsideString", () => {
  it("checks quote parity", () => {
    expect(isInsideString('"foo')).toBe(true);
    expect(isInsideString('"foo"')).toBe(false);
    expect(isInsideString('"foo\\"bar')).toBe(true);
    expect(isInsideString('{}')).toBe(false);
  });
});

describe("getPreviousMeaningfulCharacter", () => {
  it("skips whitespace and quotes", () => {
    expect(getPreviousMeaningfulCharacter(':  "')).toBe(":");
    expect(getPreviousMeaningfulCharacter('[  ')).toBe("[");
    expect(getPreviousMeaningfulCharacter('abc')).toBe("c");
    expect(getPreviousMeaningfulCharacter('')).toBe("");
  });
});

describe("analyzeJsonCursor", () => {
  it("returns empty path for top-level body", () => {
    const info = analyzeJsonCursor(`${HEADER}{\n  `);
    expect(info.path).toEqual([]);
    expect(info.expectingKey).toBe(true);
    expect(info.expectingValue).toBe(false);
  });

  it("reports path under query bool must[0]", () => {
    const prefix = `${HEADER}{\n  "query": {\n    "bool": {\n      "must": [\n        {\n          `;
    const info = analyzeJsonCursor(prefix);
    expect(info.path).toEqual(["query", "bool", "must", 0]);
    expect(info.expectingKey).toBe(true);
  });

  it("reports path for value position after colon", () => {
    const prefix = `${HEADER}{\n  "query": `;
    const info = analyzeJsonCursor(prefix);
    expect(info.path).toEqual(["query"]);
    expect(info.expectingValue).toBe(true);
    expect(info.previousMeaningfulChar).toBe(":");
  });

  it("reports inside-string status", () => {
    const prefix = `${HEADER}{\n  "query": {\n    "match": {\n      "field": "abc`;
    const info = analyzeJsonCursor(prefix);
    expect(info.insideString).toBe(true);
    expect(info.insideStringAsKey).toBe(false);
  });

  it("detects when inside a string that is being used as an object key", () => {
    const prefix = `${HEADER}{\n  "query": {\n    "term": {\n      "pr`;
    const info = analyzeJsonCursor(prefix);
    expect(info.path).toEqual(["query", "term"]);
    expect(info.insideString).toBe(true);
    expect(info.insideStringAsKey).toBe(true);
  });

  it("stays in key position while the term placeholder is still the default field label", () => {
    const prefix = `${HEADER}{\n  "query": {\n    "term": {\n      "field`;
    const info = analyzeJsonCursor(prefix);
    expect(info.path).toEqual(["query", "term"]);
    expect(info.insideString).toBe(true);
    expect(info.insideStringAsKey).toBe(true);
  });

  it("detects key position for match snippet placeholder", () => {
    const prefix = `${HEADER}{\n  "query": {\n    "match": {\n      "field`;
    const info = analyzeJsonCursor(prefix);
    expect(info.path).toEqual(["query", "match"]);
    expect(info.insideStringAsKey).toBe(true);
  });

  it("tracks sibling entries after commas", () => {
    const prefix = `${HEADER}{\n  "size": 10,\n  "query": {\n    "match_all": {}\n  },\n  `;
    const info = analyzeJsonCursor(prefix);
    expect(info.path).toEqual([]);
    expect(info.expectingKey).toBe(true);
  });

  it("handles nested arrays with multiple items", () => {
    const prefix = `${HEADER}{\n  "query": {\n    "bool": {\n      "must": [\n        { "match_all": {} },\n        {\n          `;
    const info = analyzeJsonCursor(prefix);
    expect(info.path).toEqual(["query", "bool", "must", 1]);
  });
});
