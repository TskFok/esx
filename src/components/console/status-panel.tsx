import { AlertTriangle, Loader2, PanelRightClose, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { buildConnectionLogContextFromProfile } from "../../lib/error-logs";
import { extractUnknownErrorDiagnostics, extractUnknownErrorMessage } from "../../lib/errors";
import { useStatusTabQuery, type StatusTab } from "../../lib/status-tab-query";
import { formatShanghaiDateTime } from "../../lib/time";
import { cn } from "../../lib/utils";
import { useAppState } from "../../providers/app-state";
import type { ConnectionProfile } from "../../types/connections";
import { healthBadgeClasses, healthLabels, StatusOverviewTab } from "./status-overview-tab";
import { StatusOperationsTab } from "./status-operations-tab";
import { StatusIndicesTab } from "./status-indices-tab";

const EMPTY_CONNECTION: ConnectionProfile = {
  id: "",
  name: "",
  baseUrl: "",
  username: "",
  auth: { type: "basic" },
  tls: { mode: "default" },
  environment: "dev",
  readonly: false,
  insecureTls: false,
  sshProfileId: null,
  createdAt: "",
  updatedAt: "",
  lastUsedAt: "",
};

const tabLabels: Record<StatusTab, string> = {
  overview: "概览",
  operations: "运维",
  indices: "索引",
};

const tabLoadingLabels: Record<StatusTab, string> = {
  overview: "正在读取集群健康...",
  operations: "正在读取节点指标...",
  indices: "正在读取索引列表...",
};

export type StatusPanelProps = {
  onClose: () => void;
  closeTitle?: string;
  className?: string;
};

export function StatusPanel({
  onClose,
  closeTitle = "关闭状态",
  className = "flex h-full min-h-0 flex-col overflow-hidden",
}: StatusPanelProps) {
  const {
    currentConnection,
    getSshProfileForConnection,
    recordErrorLog,
    recordStatusSnapshot,
    statusHistoryByConnection,
  } = useAppState();
  const [activeTab, setActiveTab] = useState<StatusTab>("overview");
  const lastNotifiedErrorUpdatedAtRef = useRef<Partial<Record<StatusTab, number>>>({});
  const suppressNextReactivationErrorRef = useRef<Partial<Record<StatusTab, boolean>>>({});
  const connection = currentConnection ?? EMPTY_CONNECTION;

  useEffect(() => {
    setActiveTab("overview");
    lastNotifiedErrorUpdatedAtRef.current = {};
    suppressNextReactivationErrorRef.current = {};
  }, [currentConnection?.id]);

  const overviewQuery = useStatusTabQuery(connection, "overview", Boolean(currentConnection) && activeTab === "overview");
  const operationsQuery = useStatusTabQuery(connection, "operations", Boolean(currentConnection) && activeTab === "operations");
  const indicesQuery = useStatusTabQuery(connection, "indices", Boolean(currentConnection) && activeTab === "indices");

  const currentQuery =
    activeTab === "overview" ? overviewQuery : activeTab === "operations" ? operationsQuery : indicesQuery;

  useEffect(() => {
    if (
      !currentConnection ||
      !currentQuery.isError ||
      currentQuery.errorUpdatedAt <= 0 ||
      lastNotifiedErrorUpdatedAtRef.current[activeTab] === currentQuery.errorUpdatedAt
    ) {
      return;
    }

    lastNotifiedErrorUpdatedAtRef.current[activeTab] = currentQuery.errorUpdatedAt;
    if (suppressNextReactivationErrorRef.current[activeTab]) {
      suppressNextReactivationErrorRef.current[activeTab] = false;
      return;
    }

    const message = extractUnknownErrorMessage(currentQuery.error, "服务器状态读取失败");
    toast.error(message);
    recordErrorLog({
      scope: "status-read",
      title: "服务器状态读取失败",
      summary: message,
      diagnostics: extractUnknownErrorDiagnostics(currentQuery.error),
      connection: buildConnectionLogContextFromProfile(currentConnection, getSshProfileForConnection(currentConnection)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentQuery.isError, currentQuery.error, currentQuery.errorUpdatedAt]);

  useEffect(() => {
    if (!currentConnection || !operationsQuery.isSuccess || !operationsQuery.data) {
      return;
    }

    recordStatusSnapshot(currentConnection.id, operationsQuery.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationsQuery.isSuccess, operationsQuery.dataUpdatedAt]);

  if (!currentConnection) {
    return null;
  }

  const statusHistory = statusHistoryByConnection[connection.id] ?? [];

  function refreshCurrentTab() {
    suppressNextReactivationErrorRef.current[activeTab] = false;
    void currentQuery.refetch();
  }

  function activateTab(tab: StatusTab) {
    const query = tab === "overview" ? overviewQuery : tab === "operations" ? operationsQuery : indicesQuery;
    if (query.isError) {
      suppressNextReactivationErrorRef.current[tab] = true;
    }
    setActiveTab(tab);
  }

  const currentError = currentQuery.isError
    ? extractUnknownErrorMessage(currentQuery.error, "服务器状态读取失败")
    : null;
  const currentFetchedAt = currentQuery.data?.fetchedAt ?? null;
  const isCurrentLoading = currentQuery.isLoading;

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-600">ESX Status</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <h1 className="text-base font-bold leading-tight text-slate-900">服务器状态</h1>
            {overviewQuery.data ? (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                  healthBadgeClasses[overviewQuery.data.cluster.health],
                )}
              >
                {healthLabels[overviewQuery.data.cluster.health]}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {connection.name} · {connection.baseUrl}
            {currentFetchedAt ? ` · 最近刷新 ${formatShanghaiDateTime(currentFetchedAt)}` : " · 打开标签后自动刷新一次"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button className="h-8 rounded-lg px-2.5 text-xs" onClick={refreshCurrentTab} disabled={currentQuery.isFetching}>
            {currentQuery.isFetching ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="mr-1 h-3.5 w-3.5" />
            )}
            刷新状态
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 rounded-lg px-2 text-xs"
            title={closeTitle}
            aria-label={closeTitle}
            onClick={onClose}
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1">
        {(Object.keys(tabLabels) as StatusTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em]",
              activeTab === tab ? "bg-emerald-50 text-emerald-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
            )}
            onClick={() => activateTab(tab)}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {currentError ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 p-2.5 text-xs leading-5 text-rose-700 sm:text-sm">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{currentError}</p>
        </div>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
        {isCurrentLoading ? (
          <Card className="flex min-h-[240px] items-center justify-center p-5">
            <div className="text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-600" />
              <p className="mt-2 text-xs font-semibold text-slate-700 sm:text-sm">{tabLoadingLabels[activeTab]}</p>
            </div>
          </Card>
        ) : activeTab === "overview" ? (
          overviewQuery.data ? (
            <StatusOverviewTab snapshot={overviewQuery.data} />
          ) : (
            <EmptyStatusCard />
          )
        ) : activeTab === "operations" ? (
          operationsQuery.data ? (
            <StatusOperationsTab snapshot={operationsQuery.data} history={statusHistory} />
          ) : (
            <EmptyStatusCard />
          )
        ) : indicesQuery.data ? (
          <StatusIndicesTab snapshot={indicesQuery.data} />
        ) : (
          <EmptyStatusCard />
        )}
      </div>
    </div>
  );
}

function EmptyStatusCard() {
  return (
    <Card className="p-5 text-center sm:p-6">
      <p className="text-sm font-bold text-slate-900">还没有服务器状态数据</p>
      <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">点击刷新状态重新读取当前连接。</p>
    </Card>
  );
}