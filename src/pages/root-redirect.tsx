import { Navigate } from "react-router-dom";
import { useAppState } from "../providers/app-state";

export function RootRedirect() {
  const { ready } = useAppState();

  if (!ready) {
    return null;
  }

  return <Navigate to="/connections" replace />;
}
