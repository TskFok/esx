import { Navigate } from "react-router-dom";
import { useAppState } from "../providers/app-state";

export function AdminPage() {
  const { currentConnection } = useAppState();

  if (currentConnection) {
    return <Navigate to="/console?admin=1" replace />;
  }

  return <Navigate to="/connections" replace />;
}
