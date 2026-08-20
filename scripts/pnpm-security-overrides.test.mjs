// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parsePnpmOverrides(yaml) {
  const marker = "\noverrides:";
  const overridesIndex = yaml.includes("overrides:")
    ? yaml.startsWith("overrides:")
      ? 0
      : yaml.indexOf(marker)
    : -1;
  if (overridesIndex < 0) {
    throw new Error("pnpm-workspace.yaml 缺少 overrides");
  }
  const blockStart =
    overridesIndex === 0 ? "overrides:".length : overridesIndex + marker.length;
  const block = yaml.slice(blockStart);
  const nextTop = block.search(/\n[A-Za-z]/);
  const overridesBlock = nextTop >= 0 ? block.slice(0, nextTop) : block;
  const map = {};
  for (const line of overridesBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    map[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return map;
}

function findOverride(overrides, prefix) {
  return Object.entries(overrides).find(([key]) => key.startsWith(prefix));
}

describe("parsePnpmOverrides", () => {
  it("跳过注释并去掉引号", () => {
    expect(
      parsePnpmOverrides(`packages:
  - .

overrides:
  nanoid@<3.3.18: '>=3.3.18 <4'
  # keep undici on 7.x
  undici@>=7.0.0 <7.29.0: '>=7.29.0 <8'
`),
    ).toEqual({
      "nanoid@<3.3.18": ">=3.3.18 <4",
      "undici@>=7.0.0 <7.29.0": ">=7.29.0 <8",
    });
  });
});

describe("pnpm 安全 override", () => {
  const yaml = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
  const lockfile = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  const overrides = parsePnpmOverrides(yaml);

  it("nanoid 锁定在 3.x 补丁", () => {
    const entry = findOverride(overrides, "nanoid");
    expect(entry?.[1]).toBe(">=3.3.18 <4");
    expect(lockfile).toMatch(/^ {2}nanoid@3\.3\.18:/m);
    expect(lockfile).not.toMatch(/^ {2}nanoid@[456]\./m);
  });

  it("react-router 锁定在 7.18.2 补丁", () => {
    const entry = findOverride(overrides, "react-router@");
    expect(entry?.[1]).toBe(">=7.18.2 <8");
    expect(lockfile).toMatch(/^ {2}react-router@7\.18\.2:/m);
    expect(lockfile).not.toMatch(/^ {2}react-router@[89]\./m);
  });

  it("undici 锁定在 7.29.x 且不超过 8", () => {
    const entry = findOverride(overrides, "undici@");
    expect(entry?.[1]).toBe(">=7.29.0 <8");
    expect(lockfile).toMatch(/^ {2}undici@7\.29\.\d+:/m);
    expect(lockfile).not.toMatch(/^ {2}undici@[89]\./m);
  });

  it("不再忽略已修补的 React Router GHSA", () => {
    expect(yaml).not.toMatch(/GHSA-qwww-vcr4-c8h2/);
  });
});
