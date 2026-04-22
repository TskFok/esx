import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { ConnectionsPage } from "./pages/connections-page";
import { ConsolePage } from "./pages/console-page";
import { ErrorLogsPage } from "./pages/error-logs-page";
import { useAppState } from "./providers/app-state";

function RootRedirect() {
  const { ready, currentConnection, connections } = useAppState();

  if (!ready) {
    return null;
  }

  if (!connections.length) {
    return <Navigate to="/connections" replace />;
  }

  return <Navigate to={currentConnection ? "/console" : "/connections"} replace />;
}

function GlobalGuards() {
  useEffect(() => {
    const preventContextMenu = (event: Event) => event.preventDefault();
    const preventMetaLinkOpen = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (event.metaKey && target.closest("a")) {
        event.preventDefault();
      }
    };

    window.addEventListener("contextmenu", preventContextMenu);
    window.addEventListener("click", preventMetaLinkOpen, true);

    return () => {
      window.removeEventListener("contextmenu", preventContextMenu);
      window.removeEventListener("click", preventMetaLinkOpen, true);
    };
  }, []);

  return null;
}

export default function App() {
  const { ready } = useAppState();

  return (
    <HashRouter>
      <GlobalGuards />
      {ready ? (
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/console" element={<ConsolePage />} />
          <Route path="/logs" element={<ErrorLogsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <div className="flex min-h-screen items-center justify-center">
          <div className="glass-panel flex items-center gap-3 px-6 py-5 text-sm font-semibold text-slate-700">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
            正在加载本地连接与请求...
          </div>
        </div>
      )}
      <Toaster richColors position="top-right" />
    </HashRouter>
  );
}
