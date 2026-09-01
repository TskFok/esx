import { Navigate } from "react-router-dom";
import { CONSOLE_ADMIN_PATH } from "../lib/console-error-logs-panel";
import { useAppState } from "../providers/app-state";

export function AdminPage() {
  const { currentConnection } = useAppState();

  if (currentConnection) {
    return <Navigate to={CONSOLE_ADMIN_PATH} replace />;
  }

  return <Navigate to="/connections" replace />;
}
