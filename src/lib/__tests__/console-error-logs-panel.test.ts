import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSOLE_ADMIN_VISIBLE_STORAGE_KEY,
  CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY,
  CONSOLE_STATUS_VISIBLE_STORAGE_KEY,
  getConsoleWorkspaceRightPane,
  readStoredConsoleAdminVisible,
  readStoredConsoleErrorLogsVisible,
  readStoredConsoleStatusVisible,
  removeConsoleAdminOpenParam,
  removeConsoleErrorLogsOpenParam,
  removeConsoleStatusOpenParam,
  shouldOpenConsoleAdmin,
  shouldOpenConsoleErrorLogs,
  shouldOpenConsoleStatus,
  writeStoredConsoleAdminVisible,
  writeStoredConsoleErrorLogsVisible,
  writeStoredConsoleStatusVisible,
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
    expect(getConsoleWorkspaceRightPane({ logsVisible: false, statusVisible: false, adminVisible: false })).toBe("workspace");
    expect(getConsoleWorkspaceRightPane({ logsVisible: true, statusVisible: false, adminVisible: false })).toBe("error-logs");
  });

  it("replaces the whole workspace when status is open", () => {
    expect(getConsoleWorkspaceRightPane({ logsVisible: false, statusVisible: true, adminVisible: false })).toBe("status");
  });

  it("replaces the whole workspace when admin is open", () => {
    expect(getConsoleWorkspaceRightPane({ logsVisible: false, statusVisible: false, adminVisible: true })).toBe("admin");
  });

  it("prefers admin over status and logs when multiple panels are marked visible", () => {
    expect(getConsoleWorkspaceRightPane({ logsVisible: true, statusVisible: true, adminVisible: false })).toBe("status");
    expect(getConsoleWorkspaceRightPane({ logsVisible: true, statusVisible: true, adminVisible: true })).toBe("admin");
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

describe("console status visibility storage", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to hidden when storage is empty", () => {
    expect(readStoredConsoleStatusVisible()).toBe(false);
  });

  it("reads and writes persisted visible state", () => {
    localStorageMock.setItem(CONSOLE_STATUS_VISIBLE_STORAGE_KEY, "true");
    expect(readStoredConsoleStatusVisible()).toBe(true);

    writeStoredConsoleStatusVisible(false);
    expect(localStorageMock.getItem(CONSOLE_STATUS_VISIBLE_STORAGE_KEY)).toBe("false");
  });
});

describe("console status search param", () => {
  it("opens when status=1", () => {
    expect(shouldOpenConsoleStatus("?status=1")).toBe(true);
    expect(shouldOpenConsoleStatus("status=open")).toBe(true);
    expect(shouldOpenConsoleStatus("?tab=editor")).toBe(false);
  });

  it("removes the open param and keeps others", () => {
    expect(removeConsoleStatusOpenParam("?status=1&foo=bar")).toBe("?foo=bar");
    expect(removeConsoleStatusOpenParam("?status=1")).toBe("");
    expect(removeConsoleStatusOpenParam("?logs=1&status=1")).toBe("?logs=1");
  });
});

describe("console admin visibility storage", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to hidden when storage is empty", () => {
    expect(readStoredConsoleAdminVisible()).toBe(false);
  });

  it("reads and writes persisted visible state", () => {
    localStorageMock.setItem(CONSOLE_ADMIN_VISIBLE_STORAGE_KEY, "true");
    expect(readStoredConsoleAdminVisible()).toBe(true);

    writeStoredConsoleAdminVisible(false);
    expect(localStorageMock.getItem(CONSOLE_ADMIN_VISIBLE_STORAGE_KEY)).toBe("false");
  });
});

describe("console admin search param", () => {
  it("opens when admin=1", () => {
    expect(shouldOpenConsoleAdmin("?admin=1")).toBe(true);
    expect(shouldOpenConsoleAdmin("admin=open")).toBe(true);
    expect(shouldOpenConsoleAdmin("?tab=editor")).toBe(false);
  });

  it("removes the open param and keeps others", () => {
    expect(removeConsoleAdminOpenParam("?admin=1&foo=bar")).toBe("?foo=bar");
    expect(removeConsoleAdminOpenParam("?admin=1")).toBe("");
    expect(removeConsoleAdminOpenParam("?status=1&admin=1")).toBe("?status=1");
  });
});
