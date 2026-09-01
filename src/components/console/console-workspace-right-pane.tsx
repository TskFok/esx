import type { ReactNode } from "react";
import { getConsoleWorkspaceRightPane } from "../../lib/console-error-logs-panel";

export type ConsoleWorkspaceRightPaneProps = {
  logsVisible: boolean;
  statusVisible: boolean;
  adminVisible: boolean;
  errorLogs: ReactNode;
  status: ReactNode;
  admin: ReactNode;
  workspace: ReactNode;
};

export function ConsoleWorkspaceRightPane({
  logsVisible,
  statusVisible,
  adminVisible,
  errorLogs,
  status,
  admin,
  workspace,
}: ConsoleWorkspaceRightPaneProps) {
  const mode = getConsoleWorkspaceRightPane({ logsVisible, statusVisible, adminVisible });
  if (mode === "admin") {
    return admin;
  }
  if (mode === "status") {
    return status;
  }
  if (mode === "error-logs") {
    return errorLogs;
  }
  return workspace;
}
