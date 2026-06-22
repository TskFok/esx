import { describe, expect, it } from "vitest";
import { parseReleaseArgs } from "./lib/release-args.mjs";

describe("parseReleaseArgs", () => {
  it("默认 patch 升版", () => {
    expect(parseReleaseArgs([])).toEqual({
      current: false,
      dryRun: false,
      bumpLevel: "patch",
    });
  });

  it("解析 --current / --dry-run / 升版级别", () => {
    expect(parseReleaseArgs(["--current", "--dry-run"])).toEqual({
      current: true,
      dryRun: true,
      bumpLevel: "patch",
    });
    expect(parseReleaseArgs(["--minor"])).toEqual({
      current: false,
      dryRun: false,
      bumpLevel: "minor",
    });
    expect(parseReleaseArgs(["--major", "--dry-run"])).toEqual({
      current: false,
      dryRun: true,
      bumpLevel: "major",
    });
  });

  it("拒绝未知参数与冲突组合", () => {
    expect(() => parseReleaseArgs(["--foo"])).toThrow(/未知参数/);
    expect(() => parseReleaseArgs(["--current", "--minor"])).toThrow(/不能/);
  });
});
