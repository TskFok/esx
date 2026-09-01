export const CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY = "esx.console.errorLogsVisible";
export const CONSOLE_ERROR_LOGS_OPEN_PARAM = "logs";

export type ConsoleWorkspaceRightPaneMode = "workspace" | "error-logs";

export function getConsoleWorkspaceRightPane(logsVisible: boolean): ConsoleWorkspaceRightPaneMode {
  return logsVisible ? "error-logs" : "workspace";
}

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
