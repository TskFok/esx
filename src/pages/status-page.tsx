import { Navigate } from "react-router-dom";
import { CONSOLE_STATUS_PATH } from "../lib/console-error-logs-panel";
import { useAppState } from "../providers/app-state";

export function StatusPage() {
  const { currentConnection } = useAppState();

  if (currentConnection) {
    return <Navigate to={CONSOLE_STATUS_PATH} replace />;
  }

  return <Navigate to="/connections" replace />;
}
