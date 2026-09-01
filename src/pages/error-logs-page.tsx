import { Navigate, useNavigate } from "react-router-dom";
import { Card } from "../components/ui/card";
import { ErrorLogsPanel } from "../components/console/error-logs-panel";
import { useAppState } from "../providers/app-state";

export function ErrorLogsPage() {
  const navigate = useNavigate();
  const { currentConnection } = useAppState();

  if (currentConnection) {
    return <Navigate to="/console?logs=1" replace />;
  }

  return (
    <div className="h-dvh overflow-hidden p-4 sm:p-6" onContextMenu={(event) => event.preventDefault()}>
      <div className="flex h-full min-h-0 justify-end">
        <Card className="flex h-full w-full max-w-md min-h-0 flex-col p-4 sm:p-5">
          <ErrorLogsPanel closeTitle="返回连接页" onClose={() => navigate("/connections")} />
        </Card>
      </div>
    </div>
  );
}
