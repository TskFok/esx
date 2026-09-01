import type { ReactNode } from "react";
import { getConsoleWorkspaceRightPane } from "../../lib/console-error-logs-panel";

export type ConsoleWorkspaceRightPaneProps = {
  logsVisible: boolean;
  errorLogs: ReactNode;
  workspace: ReactNode;
};

export function ConsoleWorkspaceRightPane({ logsVisible, errorLogs, workspace }: ConsoleWorkspaceRightPaneProps) {
  return getConsoleWorkspaceRightPane(logsVisible) === "error-logs" ? errorLogs : workspace;
}
