import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

/** @typedef {{ hash: string; subject: string }} GitCommit */
/** @typedef {{ type: string; section: string; items: string[] }} CommitGroup */

/** @type {Record<string, string>} */
export const COMMIT_TYPE_SECTIONS = {
  feat: "新功能",
  fix: "修 bug",
  refactor: "重构",
  chore: "日常维护",
  ci: "GitHub Actions / 部署配置",
  build: "依赖 / 构建变更",
  docs: "文档",
  test: "测试",
};

export const CONVENTIONAL_COMMIT_RE = /^(\w+)(?:\([^)]+\))?!?:\s*(.+)$/;

/**
 * @param {string} subject
 * @returns {{ type: string; description: string } | null}
 */
export function parseConventionalCommit(subject) {
  const match = subject.trim().match(CONVENTIONAL_COMMIT_RE);
  if (!match) {
    return null;
  }

  return {
    type: match[1],
    description: match[2].trim(),
  };
}

/**
 * @param {string} subject
 * @returns {boolean}
 */
export function isReleaseCommit(subject) {
  const trimmed = subject.trim();
  return /^chore:\s*发布\s+v?\d+\.\d+\.\d+/i.test(trimmed) || /^发布\s+v/i.test(trimmed);
}

/**
 * @param {string} output
 * @returns {GitCommit[]}
 */
export function parseGitLogOutput(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf("|");
      if (separatorIndex === -1) {
        return { hash: "", subject: line };
      }

      return {
        hash: line.slice(0, separatorIndex),
        subject: line.slice(separatorIndex + 1),
      };
    });
}

/**
 * @param {GitCommit[]} commits
 * @returns {CommitGroup[]}
 */
export function groupCommitsByType(commits) {
  /** @type {Map<string, string[]>} */
  const grouped = new Map();

  for (const commit of commits) {
    if (isReleaseCommit(commit.subject)) {
      continue;
    }

    const parsed = parseConventionalCommit(commit.subject);
    if (!parsed || !(parsed.type in COMMIT_TYPE_SECTIONS)) {
      continue;
    }

    const items = grouped.get(parsed.type) ?? [];
    items.push(parsed.description);
    grouped.set(parsed.type, items);
  }

  return Object.keys(COMMIT_TYPE_SECTIONS)
    .filter((type) => grouped.has(type))
    .map((type) => ({
      type,
      section: COMMIT_TYPE_SECTIONS[type],
      items: grouped.get(type) ?? [],
    }));
}

/**
 * @param {CommitGroup[]} groups
 * @param {{ emptyMessage?: string }} [options]
 * @returns {string}
 */
export function formatReleaseNotes(groups, options = {}) {
  if (groups.length === 0) {
    return options.emptyMessage ?? "本版本无符合规范的 commit。";
  }

  const lines = [];

  for (const group of groups) {
    lines.push(`### ${group.section}`, "");
    for (const item of group.items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {string}
 */
function runCapture(command, args, cwd = rootDir) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`命令失败：${[command, ...args].join(" ")}\n${result.stderr ?? ""}`);
  }

  return (result.stdout ?? "").trim();
}

/**
 * @param {string} tag
 * @returns {string}
 */
export function normalizeTag(tag) {
  return tag.startsWith("v") ? tag : `v${tag}`;
}

/**
 * @param {string} tag
 * @param {(command: string, args: string[]) => string} [runGit]
 * @returns {{ from: string | null; to: string }}
 */
export function resolveTagRange(tag, runGit = (command, args) => runCapture(command, args)) {
  const normalizedTag = normalizeTag(tag);
  const tags = runGit("git", ["tag", "--sort=v:refname"])
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const index = tags.indexOf(normalizedTag);

  if (index === -1) {
    throw new Error(`未找到 tag：${normalizedTag}`);
  }

  return {
    from: index > 0 ? tags[index - 1] : null,
    to: normalizedTag,
  };
}

/**
 * @param {{ from: string | null; to: string }} range
 * @param {(command: string, args: string[]) => string} [runGit]
 * @returns {GitCommit[]}
 */
export function getCommitsInRange(range, runGit = (command, args) => runCapture(command, args)) {
  const revisionRange = range.from ? `${range.from}..${range.to}` : range.to;
  const output = runGit("git", ["log", revisionRange, "--pretty=format:%h|%s"]);
  return parseGitLogOutput(output);
}

/**
 * @param {string} tag
 * @param {(command: string, args: string[]) => string} [runGit]
 * @returns {string}
 */
export function generateReleaseNotesForTag(tag, runGit) {
  const range = resolveTagRange(tag, runGit);
  const commits = getCommitsInRange(range, runGit);
  const groups = groupCommitsByType(commits);
  return formatReleaseNotes(groups);
}

/**
 * @param {string[]} argv
 * @returns {{ tag?: string; from?: string; to?: string }}
 */
export function parseChangelogArgs(argv) {
  /** @type {{ tag?: string; from?: string; to?: string }} */
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--tag") {
      options.tag = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--from") {
      options.from = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--to") {
      options.to = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`未知参数：${arg}`);
  }

  if (options.tag && (options.from || options.to)) {
    throw new Error("--tag 不能与 --from / --to 同时使用");
  }

  if ((options.from && !options.to) || (!options.from && options.to)) {
    throw new Error("--from 与 --to 必须成对使用");
  }

  if (!options.tag && !options.to) {
    throw new Error("请指定 --tag，或 --from 与 --to");
  }

  return options;
}

/**
 * @param {{ tag?: string; from?: string; to?: string }} options
 * @param {(command: string, args: string[]) => string} [runGit]
 * @returns {string}
 */
export function generateReleaseNotes(options, runGit) {
  if (options.tag) {
    return generateReleaseNotesForTag(options.tag, runGit);
  }

  const range = {
    from: options.from ? normalizeTag(options.from) : null,
    to: normalizeTag(options.to),
  };
  const commits = getCommitsInRange(range, runGit);
  return formatReleaseNotes(groupCommitsByType(commits));
}
