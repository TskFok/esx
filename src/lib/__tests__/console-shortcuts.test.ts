/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import {
  CONSOLE_SHORTCUTS,
  formatConsoleShortcutKeys,
  isConsoleAiAnalysisShortcut,
  isConsoleShortcutsHelpShortcut,
  shouldIgnoreConsoleShortcutTarget,
} from "../console-shortcuts";

describe("isConsoleAiAnalysisShortcut", () => {
  it("matches command shift a", () => {
    expect(
      isConsoleAiAnalysisShortcut({
        key: "a",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it("rejects plain a", () => {
    expect(
      isConsoleAiAnalysisShortcut({
        key: "a",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(false);
  });
});

describe("isConsoleShortcutsHelpShortcut", () => {
  it("matches question mark", () => {
    expect(
      isConsoleShortcutsHelpShortcut({
        key: "?",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it("matches command slash", () => {
    expect(
      isConsoleShortcutsHelpShortcut({
        key: "/",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it("rejects plain slash", () => {
    expect(
      isConsoleShortcutsHelpShortcut({
        key: "/",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(false);
  });
});

describe("shouldIgnoreConsoleShortcutTarget", () => {
  it("ignores input elements", () => {
    const input = document.createElement("input");
    expect(shouldIgnoreConsoleShortcutTarget(input)).toBe(true);
  });

  it("ignores monaco editor targets", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "monaco-editor";
    const child = document.createElement("div");
    wrapper.appendChild(child);
    expect(shouldIgnoreConsoleShortcutTarget(child)).toBe(true);
  });

  it("allows regular page targets", () => {
    const button = document.createElement("button");
    expect(shouldIgnoreConsoleShortcutTarget(button)).toBe(false);
  });
});

describe("formatConsoleShortcutKeys", () => {
  it("returns a non-empty label for every shortcut", () => {
    for (const shortcut of CONSOLE_SHORTCUTS) {
      expect(formatConsoleShortcutKeys(shortcut).length).toBeGreaterThan(0);
    }
  });

  it("uses mac keys on mac platform", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(formatConsoleShortcutKeys(CONSOLE_SHORTCUTS[0])).toBe("⌘B");
    vi.unstubAllGlobals();
  });
});
