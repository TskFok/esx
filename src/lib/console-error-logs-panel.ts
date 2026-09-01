export const CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY = "esx.console.errorLogsVisible";
export const CONSOLE_ERROR_LOGS_WIDTH_STORAGE_KEY = "esx.console.errorLogsWidth";
export const CONSOLE_ERROR_LOGS_OPEN_PARAM = "logs";

export const CONSOLE_ERROR_LOGS_WIDTH_DEFAULT = 380;
export const CONSOLE_ERROR_LOGS_WIDTH_MIN = 300;
export const CONSOLE_ERROR_LOGS_WIDTH_MAX = 560;

export function readStoredConsoleErrorLogsVisible(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeStoredConsoleErrorLogsVisible(visible: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY, String(visible));
  } catch {
    /* ignore */
  }
}

export function clampConsoleErrorLogsWidth(value: number): number {
  return Math.min(CONSOLE_ERROR_LOGS_WIDTH_MAX, Math.max(CONSOLE_ERROR_LOGS_WIDTH_MIN, value));
}

export function readStoredConsoleErrorLogsWidth(): number {
  if (typeof window === "undefined") {
    return CONSOLE_ERROR_LOGS_WIDTH_DEFAULT;
  }

  try {
    const raw = window.localStorage.getItem(CONSOLE_ERROR_LOGS_WIDTH_STORAGE_KEY);
    const n = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(n) ? clampConsoleErrorLogsWidth(n) : CONSOLE_ERROR_LOGS_WIDTH_DEFAULT;
  } catch {
    return CONSOLE_ERROR_LOGS_WIDTH_DEFAULT;
  }
}

export function writeStoredConsoleErrorLogsWidth(width: number): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CONSOLE_ERROR_LOGS_WIDTH_STORAGE_KEY, String(clampConsoleErrorLogsWidth(width)));
  } catch {
    /* ignore */
  }
}

export function computeErrorLogsWidthFromDrag(params: {
  startWidth: number;
  startClientX: number;
  currentClientX: number;
}): number {
  const delta = params.startClientX - params.currentClientX;
  return clampConsoleErrorLogsWidth(params.startWidth + delta);
}

export function resetConsoleErrorLogsWidth(): number {
  writeStoredConsoleErrorLogsWidth(CONSOLE_ERROR_LOGS_WIDTH_DEFAULT);
  return CONSOLE_ERROR_LOGS_WIDTH_DEFAULT;
}

export function shouldOpenConsoleErrorLogs(search: string): boolean {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const value = new URLSearchParams(query).get(CONSOLE_ERROR_LOGS_OPEN_PARAM);
  return value === "1" || value === "true" || value === "open";
}

export function removeConsoleErrorLogsOpenParam(search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  params.delete(CONSOLE_ERROR_LOGS_OPEN_PARAM);
  const next = params.toString();
  return next ? `?${next}` : "";
}
