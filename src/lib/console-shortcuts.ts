import type { KeyboardShortcutEvent } from "./console-sidebar";

export type ConsoleShortcutDefinition = {
  id: string;
  label: string;
  macKeys: string;
  otherKeys: string;
  description: string;
};

export const CONSOLE_SHORTCUTS: ConsoleShortcutDefinition[] = [
  {
    id: "toggle-sidebar",
    label: "切换侧边栏",
    macKeys: "⌘B",
    otherKeys: "Ctrl+B",
    description: "显示或隐藏「连接与请求」侧边栏；小屏下打开/关闭抽屉。",
  },
  {
    id: "run-and-save",
    label: "运行并保存",
    macKeys: "⌘Enter",
    otherKeys: "Ctrl+Enter",
    description: "执行当前请求内容，并将结果保存到当前连接。",
  },
  {
    id: "ai-analysis",
    label: "AI 分析",
    macKeys: "⌘⇧A",
    otherKeys: "Ctrl+Shift+A",
    description: "分析当前请求格式并解释含义，不会连接 Elasticsearch。",
  },
  {
    id: "shortcuts-help",
    label: "快捷键帮助",
    macKeys: "? 或 ⌘/",
    otherKeys: "? 或 Ctrl+/",
    description: "打开或关闭本快捷键清单。",
  },
  {
    id: "close-overlay",
    label: "关闭浮层",
    macKeys: "Esc",
    otherKeys: "Esc",
    description: "关闭对话框、抽屉或快捷键帮助面板。",
  },
];

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function formatConsoleShortcutKeys(definition: ConsoleShortcutDefinition): string {
  return isMacPlatform() ? definition.macKeys : definition.otherKeys;
}

export function shouldIgnoreConsoleShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest(".monaco-editor"));
}

export function isConsoleAiAnalysisShortcut(event: KeyboardShortcutEvent): boolean {
  if (event.isComposing || event.altKey) {
    return false;
  }

  if (event.key.toLowerCase() !== "a") {
    return false;
  }

  return Boolean(event.shiftKey && (event.metaKey || event.ctrlKey));
}

export function isConsoleShortcutsHelpShortcut(event: KeyboardShortcutEvent): boolean {
  if (event.isComposing || event.altKey) {
    return false;
  }

  if (event.key === "?" && !event.metaKey && !event.ctrlKey) {
    return true;
  }

  if ((event.key === "/" || event.key === "?") && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
    return true;
  }

  return false;
}
