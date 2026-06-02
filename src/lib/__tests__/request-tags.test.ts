import { describe, expect, it } from "vitest";
import {
  collectConnectionTags,
  formatTagsInput,
  mergeTagChanges,
  matchesTagFilter,
  normalizeRequestTags,
  parseTagsInput,
} from "../request-tags";

describe("normalizeRequestTags", () => {
  it("trims, deduplicates and sorts tags", () => {
    expect(normalizeRequestTags([" 巡检 ", "排障", "巡检"])).toEqual(["排障", "巡检"]);
  });
});

describe("parseTagsInput", () => {
  it("splits comma-separated tags", () => {
    expect(parseTagsInput("巡检，排障,日志")).toEqual(["排障", "日志", "巡检"]);
  });
});

describe("formatTagsInput", () => {
  it("joins tags with Chinese comma", () => {
    expect(formatTagsInput(["巡检", "排障"])).toBe("巡检，排障");
  });
});

describe("collectConnectionTags", () => {
  it("collects unique tags from requests", () => {
    expect(
      collectConnectionTags([
        { tags: ["巡检", "排障"] },
        { tags: ["巡检"] },
      ]),
    ).toEqual(["排障", "巡检"]);
  });
});

describe("matchesTagFilter", () => {
  it("matches untagged requests", () => {
    expect(matchesTagFilter({ tags: [] }, "untagged")).toBe(true);
    expect(matchesTagFilter({ tags: ["巡检"] }, "untagged")).toBe(false);
  });
});

describe("mergeTagChanges", () => {
  it("adds and removes tags in one operation", () => {
    expect(mergeTagChanges(["巡检", "日志"], ["排障"], ["日志"])).toEqual(["排障", "巡检"]);
  });
});
