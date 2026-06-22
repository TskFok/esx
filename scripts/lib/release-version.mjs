import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** @typedef {"patch" | "minor" | "major"} BumpLevel */

/**
 * @param {string} version
 * @returns {{ major: number; minor: number; patch: number }}
 */
export function parseVersion(version) {
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) {
    throw new Error(`无效的 semver 版本号：${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * @param {{ major: number; minor: number; patch: number }} parts
 * @returns {string}
 */
export function formatVersion(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

/**
 * @param {string} version
 * @param {BumpLevel} level
 * @returns {string}
 */
export function bumpVersion(version, level) {
  const parts = parseVersion(version);

  switch (level) {
    case "patch":
      parts.patch += 1;
      break;
    case "minor":
      parts.minor += 1;
      parts.patch = 0;
      break;
    case "major":
      parts.major += 1;
      parts.minor = 0;
      parts.patch = 0;
      break;
    default:
      throw new Error(`未知的升版级别：${level}`);
  }

  return formatVersion(parts);
}

/**
 * @param {string} version
 * @returns {string}
 */
export function formatTag(version) {
  parseVersion(version);
  return `v${version}`;
}

/**
 * @param {string} rootDir
 * @returns {string}
 */
export function readVersion(rootDir) {
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  if (typeof packageJson.version !== "string") {
    throw new Error("package.json 缺少 version 字段");
  }

  parseVersion(packageJson.version);
  return packageJson.version;
}

/**
 * @param {string} rootDir
 * @param {string} nextVersion
 */
export function syncVersionFiles(rootDir, nextVersion) {
  parseVersion(nextVersion);

  const packageJsonPath = path.join(rootDir, "package.json");
  const tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
  const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  packageJson.version = nextVersion;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  tauriConfig.version = nextVersion;
  writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, "utf8");

  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const updatedCargoToml = cargoToml.replace(
    /^version = "[^"]+"$/m,
    `version = "${nextVersion}"`,
  );

  if (updatedCargoToml === cargoToml) {
    throw new Error("未能更新 src-tauri/Cargo.toml 中的 package version");
  }

  writeFileSync(cargoTomlPath, updatedCargoToml, "utf8");
}
