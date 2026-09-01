import { Navigate } from "react-router-dom";
import { useAppState } from "../providers/app-state";

export function StatusPage() {
  const { currentConnection } = useAppState();

  if (currentConnection) {
    return <Navigate to="/console?status=1" replace />;
  }

  return <Navigate to="/connections" replace />;
}
