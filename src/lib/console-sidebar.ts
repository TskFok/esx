export const CONSOLE_SIDEBAR_VISIBLE_STORAGE_KEY = "esx.console.sidebarVisible";
export const CONSOLE_SIDEBAR_WIDTH_STORAGE_KEY = "esx.console.sidebarWidth";

export const CONSOLE_SIDEBAR_WIDTH_DEFAULT = 280;
export const CONSOLE_SIDEBAR_WIDTH_MIN = 220;
export const CONSOLE_SIDEBAR_WIDTH_MAX = 480;

export type ConsoleContextBreadcrumb = {
  connectionName: string;
  requestName: string | null;
};

export type ConsoleContextBreadcrumbSegmentKind = "connection" | "request";

export type ConsoleContextBreadcrumbSegment = {
  kind: ConsoleContextBreadcrumbSegmentKind;
  label: string;
  requestId?: string;
};

export type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing"
>;

export function readStoredConsoleSidebarVisible(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    const raw = window.localStorage.getItem(CONSOLE_SIDEBAR_VISIBLE_STORAGE_KEY);
    if (raw === "false") {
      return false;
    }
    if (raw === "true") {
      return true;
    }
    return true;
  } catch {
    return true;
  }
}

export function writeStoredConsoleSidebarVisible(visible: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CONSOLE_SIDEBAR_VISIBLE_STORAGE_KEY, String(visible));
  } catch {
    /* ignore */
  }
}

export function clampConsoleSidebarWidth(value: number): number {
  return Math.min(CONSOLE_SIDEBAR_WIDTH_MAX, Math.max(CONSOLE_SIDEBAR_WIDTH_MIN, value));
}

export function readStoredConsoleSidebarWidth(): number {
  if (typeof window === "undefined") {
    return CONSOLE_SIDEBAR_WIDTH_DEFAULT;
  }

  try {
    const raw = window.localStorage.getItem(CONSOLE_SIDEBAR_WIDTH_STORAGE_KEY);
    const n = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(n) ? clampConsoleSidebarWidth(n) : CONSOLE_SIDEBAR_WIDTH_DEFAULT;
  } catch {
    return CONSOLE_SIDEBAR_WIDTH_DEFAULT;
  }
}

export function writeStoredConsoleSidebarWidth(width: number): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CONSOLE_SIDEBAR_WIDTH_STORAGE_KEY, String(clampConsoleSidebarWidth(width)));
  } catch {
    /* ignore */
  }
}

export function computeSidebarWidthFromDrag(params: {
  startWidth: number;
  startClientX: number;
  currentClientX: number;
}): number {
  const delta = params.currentClientX - params.startClientX;
  return clampConsoleSidebarWidth(params.startWidth + delta);
}

export function isConsoleSidebarToggleShortcut(event: KeyboardShortcutEvent): boolean {
  if (event.isComposing) {
    return false;
  }

  if (event.key !== "b" && event.key !== "B") {
    return false;
  }

  if (!event.metaKey && !event.ctrlKey) {
    return false;
  }

  if (event.altKey || event.shiftKey) {
    return false;
  }

  return true;
}

export function buildConsoleContextBreadcrumb(params: {
  connectionName: string;
  savedRequestName?: string | null;
  draftName?: string | null;
}): ConsoleContextBreadcrumb {
  const requestName = params.savedRequestName?.trim() || params.draftName?.trim() || null;

  return {
    connectionName: params.connectionName,
    requestName,
  };
}

export function formatConsoleContextBreadcrumbSegments(breadcrumb: ConsoleContextBreadcrumb): string[] {
  const segments = [breadcrumb.connectionName];

  if (breadcrumb.requestName) {
    segments.push(breadcrumb.requestName);
  }

  return segments;
}

export function buildConsoleContextBreadcrumbSegments(params: {
  connectionName: string;
  savedRequest?: { id: string; name: string } | null;
  draftName?: string | null;
}): ConsoleContextBreadcrumbSegment[] {
  const segments: ConsoleContextBreadcrumbSegment[] = [
    {
      kind: "connection",
      label: params.connectionName,
    },
  ];

  const requestName = params.savedRequest?.name.trim() || params.draftName?.trim() || null;
  if (requestName) {
    segments.push({
      kind: "request",
      label: requestName,
      requestId: params.savedRequest?.id,
    });
  }

  return segments;
}

export function resetConsoleSidebarWidth(): number {
  writeStoredConsoleSidebarWidth(CONSOLE_SIDEBAR_WIDTH_DEFAULT);
  return CONSOLE_SIDEBAR_WIDTH_DEFAULT;
}
