import { describe, expect, it } from "vitest";
import {
  formatReleaseNotes,
  generateReleaseNotes,
  getCommitsInRange,
  groupCommitsByType,
  isReleaseCommit,
  parseChangelogArgs,
  parseConventionalCommit,
  parseGitLogOutput,
  resolveTagRange,
} from "./changelog.mjs";

describe("parseConventionalCommit", () => {
  it("解析标准 conventional commit", () => {
    expect(parseConventionalCommit("feat: 添加连接导出")).toEqual({
      type: "feat",
      description: "添加连接导出",
    });
    expect(parseConventionalCommit("fix(console): 修复请求解析")).toEqual({
      type: "fix",
      description: "修复请求解析",
    });
  });

  it("忽略不符合规范的提交", () => {
    expect(parseConventionalCommit("添加连接导出")).toBeNull();
    expect(parseConventionalCommit("发布 v0.1.0")).toBeNull();
  });
});

describe("isReleaseCommit", () => {
  it("识别发布 commit", () => {
    expect(isReleaseCommit("chore: 发布 v0.2.0")).toBe(true);
    expect(isReleaseCommit("发布 v0.2.0")).toBe(true);
    expect(isReleaseCommit("chore: 更新依赖")).toBe(false);
  });
});

describe("groupCommitsByType", () => {
  it("按 type 分组并跳过发布 commit", () => {
    const groups = groupCommitsByType([
      { hash: "abc1234", subject: "feat: 添加导出" },
      { hash: "def5678", subject: "fix: 修复导入" },
      { hash: "ghi9012", subject: "chore: 发布 v0.2.0" },
      { hash: "jkl3456", subject: "style: 调整样式" },
    ]);

    expect(groups).toEqual([
      { type: "feat", section: "新功能", items: ["添加导出"] },
      { type: "fix", section: "修 bug", items: ["修复导入"] },
    ]);
  });
});

describe("formatReleaseNotes", () => {
  it("输出按 type 分组的 Markdown", () => {
    const notes = formatReleaseNotes([
      { type: "feat", section: "新功能", items: ["添加导出", "添加导入"] },
      { type: "fix", section: "修 bug", items: ["修复崩溃"] },
    ]);

    expect(notes).toBe(
      [
        "### 新功能",
        "",
        "- 添加导出",
        "- 添加导入",
        "",
        "### 修 bug",
        "",
        "- 修复崩溃",
      ].join("\n"),
    );
  });

  it("无 commit 时返回默认提示", () => {
    expect(formatReleaseNotes([])).toBe("本版本无符合规范的 commit。");
  });
});

describe("parseGitLogOutput", () => {
  it("解析 git log 输出", () => {
    expect(parseGitLogOutput("abc1234|feat: 新功能\ndef5678|fix: 修 bug")).toEqual([
      { hash: "abc1234", subject: "feat: 新功能" },
      { hash: "def5678", subject: "fix: 修 bug" },
    ]);
  });
});

describe("resolveTagRange", () => {
  it("返回当前 tag 与上一个 tag", () => {
    const runGit = () => "v0.1.0\nv0.1.1\nv0.2.0";

    expect(resolveTagRange("v0.2.0", runGit)).toEqual({
      from: "v0.1.1",
      to: "v0.2.0",
    });
  });

  it("首个 tag 时 from 为 null", () => {
    const runGit = () => "v0.1.0";

    expect(resolveTagRange("v0.1.0", runGit)).toEqual({
      from: null,
      to: "v0.1.0",
    });
  });
});

describe("getCommitsInRange", () => {
  it("使用 tag 区间读取 commit", () => {
    const runGit = (command, args) => {
      expect(command).toBe("git");
      expect(args).toEqual(["log", "v0.1.0..v0.1.1", "--pretty=format:%h|%s"]);
      return "abc1234|feat: 新功能";
    };

    expect(getCommitsInRange({ from: "v0.1.0", to: "v0.1.1" }, runGit)).toEqual([
      { hash: "abc1234", subject: "feat: 新功能" },
    ]);
  });
});

describe("parseChangelogArgs", () => {
  it("解析 CLI 参数", () => {
    expect(parseChangelogArgs(["--tag", "v0.1.1"])).toEqual({ tag: "v0.1.1" });
    expect(parseChangelogArgs(["--from", "v0.1.0", "--to", "v0.1.1"])).toEqual({
      from: "v0.1.0",
      to: "v0.1.1",
    });
  });

  it("拒绝冲突参数", () => {
    expect(() => parseChangelogArgs(["--tag", "v0.1.1", "--from", "v0.1.0"])).toThrow(/不能/);
    expect(() => parseChangelogArgs(["--from", "v0.1.0"])).toThrow(/成对/);
  });
});

describe("generateReleaseNotes", () => {
  it("根据 tag 生成 release notes", () => {
    const runGit = (command, args) => {
      if (args[0] === "tag") {
        return "v0.1.0\nv0.1.1";
      }

      expect(args).toEqual(["log", "v0.1.0..v0.1.1", "--pretty=format:%h|%s"]);
      return "abc1234|feat: 添加导出\ndef5678|fix: 修复导入";
    };

    expect(generateReleaseNotes({ tag: "v0.1.1" }, runGit)).toBe(
      ["### 新功能", "", "- 添加导出", "", "### 修 bug", "", "- 修复导入"].join("\n"),
    );
  });
});
