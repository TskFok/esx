import { homeDir, join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";

export type NativeOpenDialogResult = string | string[] | null;

export function normalizePickedFilePath(selected: NativeOpenDialogResult): string | null {
  if (typeof selected !== "string") {
    return null;
  }

  const path = selected.trim();
  return path || null;
}

export function sshPrivateKeyDialogOptions(defaultPath?: string) {
  return {
    multiple: false,
    directory: false,
    canCreateDirectories: false,
    title: "选择 SSH 私钥文件",
    ...(defaultPath ? { defaultPath } : {}),
  };
}

export async function resolveSshKeyPickerDefaultPath(): Promise<string | undefined> {
  try {
    return await join(await homeDir(), ".ssh");
  } catch {
    return undefined;
  }
}

export async function pickSshPrivateKeyPath(): Promise<string | null> {
  try {
    const defaultPath = await resolveSshKeyPickerDefaultPath();
    const selected = await open(sshPrivateKeyDialogOptions(defaultPath));
    return normalizePickedFilePath(selected);
  } catch {
    return null;
  }
}
