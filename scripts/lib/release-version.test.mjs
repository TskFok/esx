import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bumpVersion,
  formatTag,
  formatVersion,
  parseVersion,
  readVersion,
  syncVersionFiles,
} from "./release-version.mjs";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createFixture(version) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "esx-release-"));
  tempDirs.push(rootDir);
  mkdirSync(path.join(rootDir, "src-tauri"), { recursive: true });

  writeFileSync(
    path.join(rootDir, "package.json"),
    `${JSON.stringify({ name: "esx", version }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(rootDir, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify({ productName: "ESX", version }, null, 2)}\n`,
    "utf8",
  );

  const cargoToml = `[package]
name = "esx"
version = "${version}"
description = "test"

[build-dependencies]
tauri-build = { version = "2", features = [] }
`;
  writeFileSync(path.join(rootDir, "src-tauri", "Cargo.toml"), cargoToml, "utf8");

  return rootDir;
}

describe("parseVersion", () => {
  it("解析合法 semver", () => {
    expect(parseVersion("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(parseVersion("12.34.56")).toEqual({ major: 12, minor: 34, patch: 56 });
  });

  it("拒绝非法版本号", () => {
    expect(() => parseVersion("1.0")).toThrow(/无效的 semver/);
    expect(() => parseVersion("v1.0.0")).toThrow(/无效的 semver/);
    expect(() => parseVersion("1.0.0-beta")).toThrow(/无效的 semver/);
  });
});

describe("bumpVersion", () => {
  it("按 patch / minor / major 升版", () => {
    expect(bumpVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.0", "major")).toBe("1.0.0");
  });
});

describe("formatTag", () => {
  it("输出 v 前缀 tag", () => {
    expect(formatTag("0.1.0")).toBe("v0.1.0");
    expect(formatTag("1.2.3")).toBe("v1.2.3");
  });
});

describe("formatVersion", () => {
  it("拼接 semver 字符串", () => {
    expect(formatVersion({ major: 1, minor: 2, patch: 3 })).toBe("1.2.3");
  });
});

describe("readVersion", () => {
  it("从 package.json 读取版本", () => {
    const rootDir = createFixture("0.3.4");
    expect(readVersion(rootDir)).toBe("0.3.4");
  });
});

describe("syncVersionFiles", () => {
  it("同步写入三个版本文件", () => {
    const rootDir = createFixture("0.1.0");
    syncVersionFiles(rootDir, "0.2.0");

    const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
    const tauriConfig = JSON.parse(
      readFileSync(path.join(rootDir, "src-tauri", "tauri.conf.json"), "utf8"),
    );
    const cargoToml = readFileSync(path.join(rootDir, "src-tauri", "Cargo.toml"), "utf8");

    expect(packageJson.version).toBe("0.2.0");
    expect(tauriConfig.version).toBe("0.2.0");
    expect(cargoToml).toMatch(/^version = "0\.2\.0"$/m);
    expect(cargoToml).toMatch(/tauri-build = \{ version = "2"/);
  });
});
