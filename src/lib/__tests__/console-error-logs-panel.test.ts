import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSOLE_ADMIN_PATH,
  CONSOLE_ADMIN_VISIBLE_STORAGE_KEY,
  CONSOLE_ERROR_LOGS_PATH,
  CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY,
  CONSOLE_STATUS_PATH,
  CONSOLE_STATUS_VISIBLE_STORAGE_KEY,
  CONSOLE_WORKSPACE_PATH,
  consolePathForRightPane,
  getConsoleWorkspaceRightPane,
  readInitialConsoleRightPaneFlags,
  readInitialConsoleRightPaneMode,
  readStoredConsoleAdminVisible,
  readStoredConsoleErrorLogsVisible,
  readStoredConsoleStatusVisible,
  removeConsoleAdminOpenParam,
  removeConsoleErrorLogsOpenParam,
  removeConsoleRightPaneOpenParams,
  removeConsoleStatusOpenParam,
  removeConsoleWorkspaceOpenParam,
  resolveConsoleRightPaneFromSearch,
  shouldOpenConsoleAdmin,
  shouldOpenConsoleErrorLogs,
  shouldOpenConsoleStatus,
  shouldOpenConsoleWorkspace,
  writeStoredConsoleAdminVisible,
  writeStoredConsoleErrorLogsVisible,
  writeStoredConsoleRightPaneMode,
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

describe("console workspace search param", () => {
  it("opens the request workspace when workspace=1", () => {
    expect(shouldOpenConsoleWorkspace("?workspace=1")).toBe(true);
    expect(shouldOpenConsoleWorkspace("workspace=open")).toBe(true);
    expect(shouldOpenConsoleWorkspace("?status=1")).toBe(false);
  });

  it("removes the workspace param and keeps others", () => {
    expect(removeConsoleWorkspaceOpenParam("?workspace=1&foo=bar")).toBe("?foo=bar");
    expect(removeConsoleWorkspaceOpenParam("?workspace=1")).toBe("");
    expect(removeConsoleWorkspaceOpenParam("?status=1&workspace=1")).toBe("?status=1");
  });

  it("points connection-to-console navigation at the request workspace", () => {
    expect(CONSOLE_WORKSPACE_PATH).toBe("/console?workspace=1");
  });
});

describe("console right pane navigation paths", () => {
  it("maps each right pane mode to a dedicated console path", () => {
    expect(consolePathForRightPane("workspace")).toBe(CONSOLE_WORKSPACE_PATH);
    expect(consolePathForRightPane("status")).toBe(CONSOLE_STATUS_PATH);
    expect(consolePathForRightPane("admin")).toBe(CONSOLE_ADMIN_PATH);
    expect(consolePathForRightPane("error-logs")).toBe(CONSOLE_ERROR_LOGS_PATH);
    expect(CONSOLE_STATUS_PATH).toBe("/console?status=1");
    expect(CONSOLE_ADMIN_PATH).toBe("/console?admin=1");
    expect(CONSOLE_ERROR_LOGS_PATH).toBe("/console?logs=1");
  });
});

describe("resolveConsoleRightPaneFromSearch", () => {
  it("forces the request workspace even when status is also requested", () => {
    expect(resolveConsoleRightPaneFromSearch("?workspace=1")).toBe("workspace");
    expect(resolveConsoleRightPaneFromSearch("?status=1&workspace=1")).toBe("workspace");
  });

  it("keeps existing panel params when workspace is absent", () => {
    expect(resolveConsoleRightPaneFromSearch("?admin=1")).toBe("admin");
    expect(resolveConsoleRightPaneFromSearch("?status=1")).toBe("status");
    expect(resolveConsoleRightPaneFromSearch("?logs=1")).toBe("error-logs");
    expect(resolveConsoleRightPaneFromSearch("")).toBeNull();
  });
});

describe("readInitialConsoleRightPaneFlags", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the request workspace when workspace=1 even if status was persisted", () => {
    localStorageMock.setItem(CONSOLE_STATUS_VISIBLE_STORAGE_KEY, "true");

    expect(readInitialConsoleRightPaneFlags("?workspace=1")).toEqual({
      logsVisible: false,
      statusVisible: false,
      adminVisible: false,
    });
  });

  it("restores persisted status when landing on /console without panel params", () => {
    localStorageMock.setItem(CONSOLE_STATUS_VISIBLE_STORAGE_KEY, "true");

    expect(readInitialConsoleRightPaneFlags("")).toEqual({
      logsVisible: false,
      statusVisible: true,
      adminVisible: false,
    });
  });
});

describe("readInitialConsoleRightPaneMode", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns workspace when workspace=1 even if status was persisted", () => {
    localStorageMock.setItem(CONSOLE_STATUS_VISIBLE_STORAGE_KEY, "true");
    expect(readInitialConsoleRightPaneMode("?workspace=1")).toBe("workspace");
  });

  it("returns persisted status when landing without panel params", () => {
    localStorageMock.setItem(CONSOLE_STATUS_VISIBLE_STORAGE_KEY, "true");
    expect(readInitialConsoleRightPaneMode("")).toBe("status");
  });

  it("defaults to workspace when nothing is persisted or requested", () => {
    expect(readInitialConsoleRightPaneMode("")).toBe("workspace");
  });
});

describe("writeStoredConsoleRightPaneMode", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists exclusive flags for the selected mode", () => {
    writeStoredConsoleRightPaneMode("status");

    expect(localStorageMock.getItem(CONSOLE_STATUS_VISIBLE_STORAGE_KEY)).toBe("true");
    expect(localStorageMock.getItem(CONSOLE_ADMIN_VISIBLE_STORAGE_KEY)).toBe("false");
    expect(localStorageMock.getItem(CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY)).toBe("false");

    writeStoredConsoleRightPaneMode("workspace");

    expect(localStorageMock.getItem(CONSOLE_STATUS_VISIBLE_STORAGE_KEY)).toBe("false");
    expect(localStorageMock.getItem(CONSOLE_ADMIN_VISIBLE_STORAGE_KEY)).toBe("false");
    expect(localStorageMock.getItem(CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY)).toBe("false");
  });
});

describe("removeConsoleRightPaneOpenParams", () => {
  it("strips all right-pane open params in one pass", () => {
    expect(removeConsoleRightPaneOpenParams("?workspace=1&status=1&admin=1&logs=1&foo=bar")).toBe("?foo=bar");
    expect(removeConsoleRightPaneOpenParams("?workspace=1")).toBe("");
  });
});
