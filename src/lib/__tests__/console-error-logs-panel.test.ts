import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY,
  CONSOLE_ERROR_LOGS_WIDTH_DEFAULT,
  CONSOLE_ERROR_LOGS_WIDTH_MAX,
  CONSOLE_ERROR_LOGS_WIDTH_MIN,
  CONSOLE_ERROR_LOGS_WIDTH_STORAGE_KEY,
  clampConsoleErrorLogsWidth,
  computeErrorLogsWidthFromDrag,
  readStoredConsoleErrorLogsVisible,
  readStoredConsoleErrorLogsWidth,
  removeConsoleErrorLogsOpenParam,
  resetConsoleErrorLogsWidth,
  shouldOpenConsoleErrorLogs,
  writeStoredConsoleErrorLogsVisible,
  writeStoredConsoleErrorLogsWidth,
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

describe("console error logs width storage", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to standard width when storage is empty", () => {
    expect(readStoredConsoleErrorLogsWidth()).toBe(CONSOLE_ERROR_LOGS_WIDTH_DEFAULT);
  });

  it("reads persisted width", () => {
    localStorageMock.setItem(CONSOLE_ERROR_LOGS_WIDTH_STORAGE_KEY, "420");
    expect(readStoredConsoleErrorLogsWidth()).toBe(420);
  });

  it("writes clamped width to storage", () => {
    writeStoredConsoleErrorLogsWidth(999);
    expect(localStorageMock.getItem(CONSOLE_ERROR_LOGS_WIDTH_STORAGE_KEY)).toBe(String(CONSOLE_ERROR_LOGS_WIDTH_MAX));
  });
});

describe("clampConsoleErrorLogsWidth", () => {
  it("clamps below minimum", () => {
    expect(clampConsoleErrorLogsWidth(100)).toBe(CONSOLE_ERROR_LOGS_WIDTH_MIN);
  });

  it("clamps above maximum", () => {
    expect(clampConsoleErrorLogsWidth(900)).toBe(CONSOLE_ERROR_LOGS_WIDTH_MAX);
  });

  it("leaves in-range values unchanged", () => {
    expect(clampConsoleErrorLogsWidth(400)).toBe(400);
  });
});

describe("computeErrorLogsWidthFromDrag", () => {
  it("increases width when dragging the handle left", () => {
    expect(
      computeErrorLogsWidthFromDrag({
        startWidth: 380,
        startClientX: 800,
        currentClientX: 740,
      }),
    ).toBe(440);
  });

  it("respects clamp when dragging far left", () => {
    expect(
      computeErrorLogsWidthFromDrag({
        startWidth: 540,
        startClientX: 100,
        currentClientX: 0,
      }),
    ).toBe(CONSOLE_ERROR_LOGS_WIDTH_MAX);
  });
});

describe("resetConsoleErrorLogsWidth", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes default width to storage", () => {
    expect(resetConsoleErrorLogsWidth()).toBe(CONSOLE_ERROR_LOGS_WIDTH_DEFAULT);
    expect(localStorageMock.getItem(CONSOLE_ERROR_LOGS_WIDTH_STORAGE_KEY)).toBe(String(CONSOLE_ERROR_LOGS_WIDTH_DEFAULT));
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
