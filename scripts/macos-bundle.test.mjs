// @vitest-environment node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const appPath = process.env.ESX_MACOS_APP_PATH;

// 构建后检查实际产物，避免把开发机上的 Homebrew 动态库带入发布依赖。
it.runIf(process.platform === "darwin" && Boolean(appPath))(
  "macOS 应用仅链接系统或应用包内的动态库",
  () => {
    const bundle = path.resolve(root, appPath);
    const executable = execFileSync("plutil", [
      "-extract", "CFBundleExecutable", "raw", "-o", "-",
      path.join(bundle, "Contents/Info.plist"),
    ], { encoding: "utf8" }).trim();
    const output = execFileSync("otool", [
      "-L", path.join(bundle, "Contents/MacOS", executable),
    ], { encoding: "utf8" });
    const libraries = output.trim().split("\n").slice(1)
      .map((line) => line.trim().split(" (compatibility version")[0]);

    expect(libraries.length).toBeGreaterThan(0);
    expect(libraries.filter((library) => ![
      "/System/Library/", "/usr/lib/", "@rpath/", "@executable_path/", "@loader_path/",
    ].some((prefix) => library.startsWith(prefix)))).toEqual([]);
  },
);
