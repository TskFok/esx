import { Navigate } from "react-router-dom";
import { useAppStateField } from "../providers/app-state";

export function RootRedirect() {
  const ready = useAppStateField("ready");

  if (!ready) {
    return null;
  }

  return <Navigate to="/connections" replace />;
}
