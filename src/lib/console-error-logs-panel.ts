export const CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY = "esx.console.errorLogsVisible";
export const CONSOLE_ERROR_LOGS_OPEN_PARAM = "logs";
export const CONSOLE_STATUS_VISIBLE_STORAGE_KEY = "esx.console.statusVisible";
export const CONSOLE_STATUS_OPEN_PARAM = "status";
export const CONSOLE_ADMIN_VISIBLE_STORAGE_KEY = "esx.console.adminVisible";
export const CONSOLE_ADMIN_OPEN_PARAM = "admin";
export const CONSOLE_WORKSPACE_OPEN_PARAM = "workspace";
export const CONSOLE_WORKSPACE_PATH = "/console?workspace=1";

export type ConsoleWorkspaceRightPaneMode = "workspace" | "error-logs" | "status" | "admin";

export type ConsoleRightPaneFlags = {
  logsVisible: boolean;
  statusVisible: boolean;
  adminVisible: boolean;
};

export function getConsoleWorkspaceRightPane(input: {
  logsVisible: boolean;
  statusVisible: boolean;
  adminVisible: boolean;
}): ConsoleWorkspaceRightPaneMode {
  if (input.adminVisible) {
    return "admin";
  }
  if (input.statusVisible) {
    return "status";
  }

  return input.logsVisible ? "error-logs" : "workspace";
}

export function flagsFromConsoleRightPaneMode(mode: ConsoleWorkspaceRightPaneMode): ConsoleRightPaneFlags {
  return {
    logsVisible: mode === "error-logs",
    statusVisible: mode === "status",
    adminVisible: mode === "admin",
  };
}

export function resolveConsoleRightPaneFromSearch(search: string): ConsoleWorkspaceRightPaneMode | null {
  if (shouldOpenConsoleWorkspace(search)) {
    return "workspace";
  }
  if (shouldOpenConsoleAdmin(search)) {
    return "admin";
  }
  if (shouldOpenConsoleStatus(search)) {
    return "status";
  }
  if (shouldOpenConsoleErrorLogs(search)) {
    return "error-logs";
  }

  return null;
}

export function readStoredConsoleRightPaneFlags(): ConsoleRightPaneFlags {
  const adminVisible = readStoredConsoleAdminVisible();
  const statusVisible = adminVisible ? false : readStoredConsoleStatusVisible();
  const logsVisible = adminVisible || statusVisible ? false : readStoredConsoleErrorLogsVisible();

  return { logsVisible, statusVisible, adminVisible };
}

export function readInitialConsoleRightPaneFlags(search: string): ConsoleRightPaneFlags {
  const fromSearch = resolveConsoleRightPaneFromSearch(search);
  if (fromSearch) {
    return flagsFromConsoleRightPaneMode(fromSearch);
  }

  return readStoredConsoleRightPaneFlags();
}

function readStoredFlag(key: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeStoredFlag(key: string, visible: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, String(visible));
  } catch {
    /* ignore */
  }
}

function shouldOpenFlag(search: string, key: string): boolean {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const value = new URLSearchParams(query).get(key);
  return value === "1" || value === "true" || value === "open";
}

function removeSearchParam(search: string, key: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  params.delete(key);
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function readStoredConsoleErrorLogsVisible(): boolean {
  return readStoredFlag(CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY);
}

export function writeStoredConsoleErrorLogsVisible(visible: boolean): void {
  writeStoredFlag(CONSOLE_ERROR_LOGS_VISIBLE_STORAGE_KEY, visible);
}

export function shouldOpenConsoleErrorLogs(search: string): boolean {
  return shouldOpenFlag(search, CONSOLE_ERROR_LOGS_OPEN_PARAM);
}

export function removeConsoleErrorLogsOpenParam(search: string): string {
  return removeSearchParam(search, CONSOLE_ERROR_LOGS_OPEN_PARAM);
}

export function readStoredConsoleStatusVisible(): boolean {
  return readStoredFlag(CONSOLE_STATUS_VISIBLE_STORAGE_KEY);
}

export function writeStoredConsoleStatusVisible(visible: boolean): void {
  writeStoredFlag(CONSOLE_STATUS_VISIBLE_STORAGE_KEY, visible);
}

export function shouldOpenConsoleStatus(search: string): boolean {
  return shouldOpenFlag(search, CONSOLE_STATUS_OPEN_PARAM);
}

export function removeConsoleStatusOpenParam(search: string): string {
  return removeSearchParam(search, CONSOLE_STATUS_OPEN_PARAM);
}

export function readStoredConsoleAdminVisible(): boolean {
  return readStoredFlag(CONSOLE_ADMIN_VISIBLE_STORAGE_KEY);
}

export function writeStoredConsoleAdminVisible(visible: boolean): void {
  writeStoredFlag(CONSOLE_ADMIN_VISIBLE_STORAGE_KEY, visible);
}

export function shouldOpenConsoleAdmin(search: string): boolean {
  return shouldOpenFlag(search, CONSOLE_ADMIN_OPEN_PARAM);
}

export function removeConsoleAdminOpenParam(search: string): string {
  return removeSearchParam(search, CONSOLE_ADMIN_OPEN_PARAM);
}

export function shouldOpenConsoleWorkspace(search: string): boolean {
  return shouldOpenFlag(search, CONSOLE_WORKSPACE_OPEN_PARAM);
}

export function removeConsoleWorkspaceOpenParam(search: string): string {
  return removeSearchParam(search, CONSOLE_WORKSPACE_OPEN_PARAM);
}
