import { Navigate, useNavigate } from "react-router-dom";
import { Card } from "../components/ui/card";
import { ErrorLogsPanel } from "../components/console/error-logs-panel";
import { CONSOLE_ERROR_LOGS_PATH } from "../lib/console-error-logs-panel";
import { useAppState } from "../providers/app-state";

export function ErrorLogsPage() {
  const navigate = useNavigate();
  const { currentConnection } = useAppState();

  if (currentConnection) {
    return <Navigate to={CONSOLE_ERROR_LOGS_PATH} replace />;
  }

  return (
    <div className="app-shell" onContextMenu={(event) => event.preventDefault()}>
      <main className="workspace-main h-full min-h-0">
        <Card className="flex h-full min-h-0 flex-col p-4 sm:p-5">
          <ErrorLogsPanel closeTitle="返回连接页" onClose={() => navigate("/connections")} />
        </Card>
      </main>
    </div>
  );
}
