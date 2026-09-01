import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY,
  getConsoleWorkspaceRightPane,
  readStoredConsoleErrorLogsVisible,
  removeConsoleErrorLogsOpenParam,
  shouldOpenConsoleErrorLogs,
  writeStoredConsoleErrorLogsVisible,
} from "../console-error-logs-panel";

function createLocalStorageMock() {
  const store = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => (store.has(key) ? store.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

describe("console error logs visibility storage", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to hidden when storage is empty", () => {
    expect(readStoredConsoleErrorLogsVisible()).toBe(false);
  });

  it("reads persisted visible state", () => {
    localStorageMock.setItem(CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY, "true");
    expect(readStoredConsoleErrorLogsVisible()).toBe(true);
  });

  it("treats non-true values as hidden", () => {
    localStorageMock.setItem(CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY, "maybe");
    expect(readStoredConsoleErrorLogsVisible()).toBe(false);
  });

  it("writes visible state to storage", () => {
    writeStoredConsoleErrorLogsVisible(true);
    expect(localStorageMock.getItem(CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY)).toBe("true");

    writeStoredConsoleErrorLogsVisible(false);
    expect(localStorageMock.getItem(CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY)).toBe("false");
  });
});

describe("getConsoleWorkspaceRightPane", () => {
  it("replaces the whole workspace when logs are open", () => {
    expect(getConsoleWorkspaceRightPane(false)).toBe("workspace");
    expect(getConsoleWorkspaceRightPane(true)).toBe("error-logs");
  });
});

describe("console error logs search param", () => {
  it("opens when logs=1", () => {
    expect(shouldOpenConsoleErrorLogs("?logs=1")).toBe(true);
    expect(shouldOpenConsoleErrorLogs("logs=open")).toBe(true);
    expect(shouldOpenConsoleErrorLogs("?tab=editor")).toBe(false);
  });

  it("removes the open param and keeps others", () => {
    expect(removeConsoleErrorLogsOpenParam("?logs=1&foo=bar")).toBe("?foo=bar");
    expect(removeConsoleErrorLogsOpenParam("?logs=1")).toBe("");
  });
});
