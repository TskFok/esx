#!/usr/bin/env node

/**
 * ESX 发布脚本
 *
 * 用法：
 *   pnpm release              默认 patch 升版，测试通过后 push master 并创建 tag
 *   pnpm release --minor      minor 升版
 *   pnpm release --major      major 升版
 *   pnpm release --dry-run    仅打印步骤，不修改文件、不 push
 *   pnpm release --current    重发当前版本：删除远程 tag 后重建 tag 触发 CI
 *
 * `--current` 不会修改版本号或产生新 commit，适用于打包失败或产物损坏时重新触发
 * `.github/workflows/release.yml`。仅依赖 git，无需 gh CLI。
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseReleaseArgs } from "./lib/release-args.mjs";
import {
  bumpVersion,
  formatTag,
  readVersion,
  syncVersionFiles,
} from "./lib/release-version.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

/** @typedef {import("./lib/release-args.mjs").ReleaseOptions} ReleaseOptions */

/**
 * @param {string} message
 */
function log(message) {
  console.log(message);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ dryRun?: boolean; allowFailure?: boolean }} [options]
 * @returns {number | null}
 */
function run(command, args, options = {}) {
  const printable = [command, ...args].join(" ");
  if (options.dryRun) {
    log(`[dry-run] ${printable}`);
    return 0;
  }

  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    if (options.allowFailure) {
      return result.status;
    }
    process.exit(result.status);
  }

  return result.status;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
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
 * @param {{ dryRun?: boolean }} [options]
 */
function assertReleasePreflight(options = {}) {
  const branch = runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "master") {
    throw new Error(`当前分支为 ${branch}，请在 master 分支执行 release`);
  }

  const porcelain = runCapture("git", ["status", "--porcelain"]);
  if (porcelain.length > 0) {
    throw new Error("工作区不干净，请先提交或暂存本地改动");
  }

  const remotes = runCapture("git", ["remote"]);
  if (!remotes.split("\n").includes("origin")) {
    throw new Error("未找到 origin 远程仓库");
  }

  if (options.dryRun) {
    log("[dry-run] 前置检查通过");
  }
}

/**
 * @param {string} tag
 * @param {{ dryRun?: boolean }} [options]
 */
function assertTagDoesNotExist(tag, options = {}) {
  const status = run("git", ["rev-parse", "--verify", `refs/tags/${tag}`], {
    dryRun: false,
    allowFailure: true,
  });

  if (status === 0) {
    throw new Error(`tag ${tag} 已存在，请改用 pnpm release --current 重发`);
  }

  if (options.dryRun) {
    log(`[dry-run] tag ${tag} 尚不存在，可创建`);
  }
}

/**
 * @param {string} tag
 * @param {{ dryRun?: boolean }} [options]
 */
function retagCurrentVersion(tag, options = {}) {
  log(`重发当前版本：${tag}`);

  run("git", ["push", "origin", `:refs/tags/${tag}`], {
    dryRun: options.dryRun,
    allowFailure: true,
  });
  run("git", ["tag", "-d", tag], {
    dryRun: options.dryRun,
    allowFailure: true,
  });
  run("git", ["tag", tag], { dryRun: options.dryRun });
  run("git", ["push", "origin", tag], { dryRun: options.dryRun });
}

/**
 * @param {ReleaseOptions} options
 */
export function runRelease(options) {
  assertReleasePreflight({ dryRun: options.dryRun });

  const currentVersion = readVersion(rootDir);
  const nextVersion = options.current
    ? currentVersion
    : bumpVersion(currentVersion, options.bumpLevel);
  const tag = formatTag(nextVersion);
  const commitMessage = `发布 ${tag}`;

  if (options.current) {
    retagCurrentVersion(tag, { dryRun: options.dryRun });
    log(options.dryRun ? `[dry-run] 将重发 ${tag}` : `已重发 ${tag}，GitHub Actions 将重新打包发布`);
    return;
  }

  assertTagDoesNotExist(tag, { dryRun: options.dryRun });

  log(`当前版本：${currentVersion}`);
  log(`下一版本：${nextVersion}`);
  log(`tag：${tag}`);

  run("pnpm", ["test"], { dryRun: options.dryRun });

  if (options.dryRun) {
    log(`[dry-run] 同步版本到 package.json / tauri.conf.json / Cargo.toml -> ${nextVersion}`);
  } else {
    syncVersionFiles(rootDir, nextVersion);
  }

  run("git", ["add", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"], {
    dryRun: options.dryRun,
  });
  run("git", ["commit", "-m", commitMessage], { dryRun: options.dryRun });
  run("git", ["push", "origin", "master"], { dryRun: options.dryRun });
  run("git", ["tag", tag], { dryRun: options.dryRun });
  run("git", ["push", "origin", tag], { dryRun: options.dryRun });

  log(options.dryRun ? `[dry-run] 将发布 ${tag}` : `已发布 ${tag}，GitHub Actions 将自动打包并创建 Release`);
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  try {
    const options = parseReleaseArgs(process.argv.slice(2));
    runRelease(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`release 失败：${message}`);
    process.exit(1);
  }
}
