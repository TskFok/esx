import { beforeEach, describe, expect, it, vi } from "vitest";

const openMock = vi.hoisted(() => vi.fn());
const homeDirMock = vi.hoisted(() => vi.fn());
const joinMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: homeDirMock,
  join: joinMock,
}));

import {
  normalizePickedFilePath,
  pickSshPrivateKeyPath,
  sshPrivateKeyDialogOptions,
} from "../native-file-dialog";

describe("native-file-dialog", () => {
  beforeEach(() => {
    openMock.mockReset();
    homeDirMock.mockReset();
    joinMock.mockReset();
  });

  it("normalizePickedFilePath 只接受非空字符串路径", () => {
    expect(normalizePickedFilePath("/Users/me/.ssh/id_ed25519")).toBe("/Users/me/.ssh/id_ed25519");
    expect(normalizePickedFilePath("  /tmp/id_rsa  ")).toBe("/tmp/id_rsa");
    expect(normalizePickedFilePath("")).toBeNull();
    expect(normalizePickedFilePath("   ")).toBeNull();
    expect(normalizePickedFilePath(null)).toBeNull();
    expect(normalizePickedFilePath(["/a", "/b"])).toBeNull();
  });

  it("不按扩展名过滤，避免漏掉无后缀的 id_rsa", () => {
    const options = sshPrivateKeyDialogOptions("/Users/me/.ssh");
    expect(options.multiple).toBe(false);
    expect(options.directory).toBe(false);
    expect(options.canCreateDirectories).toBe(false);
    expect(options.title).toBe("选择 SSH 私钥文件");
    expect(options.defaultPath).toBe("/Users/me/.ssh");
    expect(options).not.toHaveProperty("filters");
    expect(sshPrivateKeyDialogOptions()).not.toHaveProperty("defaultPath");
  });

  it("选择文件后返回绝对路径，并优先定位到 ~/.ssh", async () => {
    homeDirMock.mockResolvedValue("/Users/me");
    joinMock.mockResolvedValue("/Users/me/.ssh");
    openMock.mockResolvedValue("/Users/me/.ssh/id_ed25519");

    await expect(pickSshPrivateKeyPath()).resolves.toBe("/Users/me/.ssh/id_ed25519");
    expect(joinMock).toHaveBeenCalledWith("/Users/me", ".ssh");
    expect(openMock).toHaveBeenCalledWith(sshPrivateKeyDialogOptions("/Users/me/.ssh"));
  });

  it("取消选择、无法解析默认目录或打开失败时返回 null", async () => {
    homeDirMock.mockRejectedValue(new Error("not-tauri"));
    openMock.mockResolvedValueOnce(null);
    await expect(pickSshPrivateKeyPath()).resolves.toBeNull();
    expect(openMock).toHaveBeenCalledWith(sshPrivateKeyDialogOptions());

    openMock.mockRejectedValueOnce(new Error("dialog-unavailable"));
    await expect(pickSshPrivateKeyPath()).resolves.toBeNull();
  });
});
