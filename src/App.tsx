import { Component, Suspense, lazy, useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { HashRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { ConnectionsPage } from "./pages/connections-page";
import { RootRedirect } from "./pages/root-redirect";
import { useAppStateField } from "./providers/app-state";

const ConsolePage = lazy(() => import("./pages/console-page").then((module) => ({ default: module.ConsolePage })));
const AdminPage = lazy(() => import("./pages/admin-page").then((module) => ({ default: module.AdminPage })));
const StatusPage = lazy(() => import("./pages/status-page").then((module) => ({ default: module.StatusPage })));
const ErrorLogsPage = lazy(() => import("./pages/error-logs-page").then((module) => ({ default: module.ErrorLogsPage })));

class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 text-slate-700">
          <p>页面加载失败，请重新打开页面。</p>
          <div className="flex gap-4">
            <Link to="/connections">返回连接页</Link>
            <button type="button" onClick={() => window.location.reload()}>重新打开页面</button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppRoutes() {
  const location = useLocation();

  return (
    <PageLoadBoundary key={location.pathname}>
      <Suspense fallback={<div role="status" className="flex min-h-screen items-center justify-center text-slate-700">正在加载页面...</div>}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/console" element={<ConsolePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/logs" element={<ErrorLogsPage />} />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </Suspense>
    </PageLoadBoundary>
  );
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
  const ready = useAppStateField("ready");

  return (
    <HashRouter>
      <GlobalGuards />
      {ready ? (
        <AppRoutes />
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
