import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSOLE_SIDEBAR_VISIBLE_STORAGE_KEY,
  CONSOLE_SIDEBAR_WIDTH_DEFAULT,
  CONSOLE_SIDEBAR_WIDTH_MAX,
  CONSOLE_SIDEBAR_WIDTH_MIN,
  CONSOLE_SIDEBAR_WIDTH_STORAGE_KEY,
  buildConsoleContextBreadcrumb,
  buildConsoleContextBreadcrumbSegments,
  clampConsoleSidebarWidth,
  computeSidebarWidthFromDrag,
  formatConsoleContextBreadcrumbSegments,
  isConsoleSidebarToggleShortcut,
  readStoredConsoleSidebarVisible,
  readStoredConsoleSidebarWidth,
  resetConsoleSidebarWidth,
  writeStoredConsoleSidebarVisible,
  writeStoredConsoleSidebarWidth,
} from "../console-sidebar";

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

describe("console sidebar visibility storage", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to visible when storage is empty", () => {
    expect(readStoredConsoleSidebarVisible()).toBe(true);
  });

  it("reads persisted hidden state", () => {
    localStorageMock.setItem(CONSOLE_SIDEBAR_VISIBLE_STORAGE_KEY, "false");
    expect(readStoredConsoleSidebarVisible()).toBe(false);
  });

  it("reads persisted visible state", () => {
    localStorageMock.setItem(CONSOLE_SIDEBAR_VISIBLE_STORAGE_KEY, "true");
    expect(readStoredConsoleSidebarVisible()).toBe(true);
  });

  it("treats invalid values as visible", () => {
    localStorageMock.setItem(CONSOLE_SIDEBAR_VISIBLE_STORAGE_KEY, "maybe");
    expect(readStoredConsoleSidebarVisible()).toBe(true);
  });

  it("writes visible state to storage", () => {
    writeStoredConsoleSidebarVisible(false);
    expect(localStorageMock.getItem(CONSOLE_SIDEBAR_VISIBLE_STORAGE_KEY)).toBe("false");

    writeStoredConsoleSidebarVisible(true);
    expect(localStorageMock.getItem(CONSOLE_SIDEBAR_VISIBLE_STORAGE_KEY)).toBe("true");
  });
});

describe("console sidebar width storage", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to standard width when storage is empty", () => {
    expect(readStoredConsoleSidebarWidth()).toBe(CONSOLE_SIDEBAR_WIDTH_DEFAULT);
  });

  it("reads persisted width", () => {
    localStorageMock.setItem(CONSOLE_SIDEBAR_WIDTH_STORAGE_KEY, "320");
    expect(readStoredConsoleSidebarWidth()).toBe(320);
  });

  it("writes clamped width to storage", () => {
    writeStoredConsoleSidebarWidth(999);
    expect(localStorageMock.getItem(CONSOLE_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(CONSOLE_SIDEBAR_WIDTH_MAX));
  });
});

describe("clampConsoleSidebarWidth", () => {
  it("clamps below minimum", () => {
    expect(clampConsoleSidebarWidth(100)).toBe(CONSOLE_SIDEBAR_WIDTH_MIN);
  });

  it("clamps above maximum", () => {
    expect(clampConsoleSidebarWidth(900)).toBe(CONSOLE_SIDEBAR_WIDTH_MAX);
  });

  it("leaves in-range values unchanged", () => {
    expect(clampConsoleSidebarWidth(300)).toBe(300);
  });
});

describe("computeSidebarWidthFromDrag", () => {
  it("adds horizontal movement to start width", () => {
    expect(
      computeSidebarWidthFromDrag({
        startWidth: 280,
        startClientX: 100,
        currentClientX: 150,
      }),
    ).toBe(330);
  });

  it("respects clamp when dragging far right", () => {
    expect(
      computeSidebarWidthFromDrag({
        startWidth: 460,
        startClientX: 0,
        currentClientX: 100,
      }),
    ).toBe(CONSOLE_SIDEBAR_WIDTH_MAX);
  });
});

describe("isConsoleSidebarToggleShortcut", () => {
  it("matches Command + B", () => {
    expect(
      isConsoleSidebarToggleShortcut({
        key: "b",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it("matches Ctrl + B", () => {
    expect(
      isConsoleSidebarToggleShortcut({
        key: "B",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it("rejects plain B", () => {
    expect(
      isConsoleSidebarToggleShortcut({
        key: "b",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(false);
  });

  it("rejects while composing", () => {
    expect(
      isConsoleSidebarToggleShortcut({
        key: "b",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });
});

describe("console context breadcrumb", () => {
  it("builds connection and request path when request exists", () => {
    const breadcrumb = buildConsoleContextBreadcrumb({
      connectionName: "生产集群",
      savedRequestName: "集群健康",
    });

    expect(formatConsoleContextBreadcrumbSegments(breadcrumb)).toEqual(["生产集群", "集群健康"]);
  });

  it("falls back to draft name when no saved request name", () => {
    const breadcrumb = buildConsoleContextBreadcrumb({
      connectionName: "生产集群",
      draftName: "GET /_cluster/health",
    });

    expect(formatConsoleContextBreadcrumbSegments(breadcrumb)).toEqual(["生产集群", "GET /_cluster/health"]);
  });

  it("shows only connection when no request is selected", () => {
    const breadcrumb = buildConsoleContextBreadcrumb({
      connectionName: "生产集群",
    });

    expect(formatConsoleContextBreadcrumbSegments(breadcrumb)).toEqual(["生产集群"]);
  });
});

describe("buildConsoleContextBreadcrumbSegments", () => {
  it("includes request id for actionable request segment", () => {
    expect(
      buildConsoleContextBreadcrumbSegments({
        connectionName: "生产集群",
        savedRequest: { id: "request-1", name: "集群健康" },
      }),
    ).toEqual([
      { kind: "connection", label: "生产集群" },
      {
        kind: "request",
        label: "集群健康",
        requestId: "request-1",
      },
    ]);
  });
});

describe("resetConsoleSidebarWidth", () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes default width to storage", () => {
    expect(resetConsoleSidebarWidth()).toBe(CONSOLE_SIDEBAR_WIDTH_DEFAULT);
    expect(localStorageMock.getItem(CONSOLE_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(CONSOLE_SIDEBAR_WIDTH_DEFAULT));
  });
});
