import { useMutation } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Database,
  HardDrive,
  Loader2,
  RefreshCcw,
  Search,
  Server,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { buildConnectionLogContextFromProfile } from "../lib/error-logs";
import { extractUnknownErrorDiagnostics, extractUnknownErrorMessage } from "../lib/errors";
import { fetchServerStatus } from "../lib/http-client";
import { filterStatusIndices, sortStatusIndices } from "../lib/status";
import { formatShanghaiDateTime } from "../lib/time";
import { cn } from "../lib/utils";
import { useAppState } from "../providers/app-state";
import type { ConnectionProfile } from "../types/connections";
import type { IndexStatus, ServerHealth, ServerStatusSnapshot, ServerStatusSort } from "../types/status";

const healthLabels: Record<ServerHealth, string> = {
  green: "健康",
  yellow: "警告",
  red: "故障",
  unknown: "未知",
};

const healthTextClasses: Record<ServerHealth, string> = {
  green: "text-emerald-700",
  yellow: "text-amber-700",
  red: "text-rose-700",
  unknown: "text-slate-600",
};

const healthBadgeClasses: Record<ServerHealth, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  yellow: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-rose-200 bg-rose-50 text-rose-700",
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
};

const healthDotClasses: Record<ServerHealth, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-rose-500",
  unknown: "bg-slate-400",
};

function formatDataBytes(value: number | null) {
  if (value === null) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let normalized = value;
  let unitIndex = 0;
  while (normalized >= 1024 && unitIndex < units.length - 1) {
    normalized /= 1024;
    unitIndex += 1;
  }

  return `${unitIndex === 0 ? normalized.toFixed(0) : normalized.toFixed(1)} ${units[unitIndex]}`;
}

function formatNumber(value: number | null) {
  return value === null ? "-" : new Intl.NumberFormat("zh-CN").format(value);
}

function getHealthSegments(status: ServerStatusSnapshot) {
  const counts = status.summary.healthCounts;
  const total = Math.max(status.summary.totalIndices, 1);
  return (["green", "yellow", "red", "unknown"] as const).map((health) => ({
    health,
    count: counts[health],
    width: `${(counts[health] / total) * 100}%`,
  }));
}

function calculateDisplayedStats(indices: IndexStatus[]) {
  return indices.reduce(
    (stats, index) => ({
      docs: stats.docs + (index.docsCount ?? 0),
      store: stats.store + (index.storeBytes ?? 0),
      maxDocs: Math.max(stats.maxDocs, index.docsCount ?? 0),
      maxStore: Math.max(stats.maxStore, index.storeBytes ?? 0),
    }),
    { docs: 0, store: 0, maxDocs: 0, maxStore: 0 },
  );
}

function MetricBlock({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <div className="rounded-lg bg-slate-100 p-1.5 text-slate-600">{icon}</div>
      </div>
      <p className="mt-2 text-lg font-bold leading-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function HealthDistribution({ status }: { status: ServerStatusSnapshot }) {
  const segments = getHealthSegments(status);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">健康分布</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">按 index 健康状态统计</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold",
            healthBadgeClasses[status.cluster.health],
          )}
        >
          {healthLabels[status.cluster.health]}
        </span>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
        {segments.map((segment) =>
          segment.count > 0 ? (
            <div
              key={segment.health}
              className={cn(healthDotClasses[segment.health])}
              style={{ width: segment.width }}
              title={`${healthLabels[segment.health]}：${segment.count}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
        {segments.map((segment) => (
          <div key={segment.health} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1">
            <span className={cn("h-2 w-2 rounded-full", healthDotClasses[segment.health])} />
            <span className="text-slate-500">{healthLabels[segment.health]}</span>
            <span className="ml-auto font-bold text-slate-900">{segment.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShardOverview({ status }: { status: ServerStatusSnapshot }) {
  const shardCounts = status.summary.shardCounts;
  const total =
    shardCounts.started +
    shardCounts.relocating +
    shardCounts.initializing +
    shardCounts.unassigned +
    shardCounts.other;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">分片状态</p>
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
        <p className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700">Started {shardCounts.started}</p>
        <p className="rounded-lg bg-cyan-50 px-2 py-1 text-cyan-700">Relocating {shardCounts.relocating}</p>
        <p className="rounded-lg bg-amber-50 px-2 py-1 text-amber-700">Initializing {shardCounts.initializing}</p>
        <p className="rounded-lg bg-rose-50 px-2 py-1 text-rose-700">Unassigned {shardCounts.unassigned}</p>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        {total > 0 ? `已读取 ${formatNumber(total)} 个分片。` : "分片接口未返回可汇总数据。"}
      </p>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  onChange,
}: {
  label: string;
  sortKey: ServerStatusSort["key"];
  currentSort: ServerStatusSort;
  onChange: (key: ServerStatusSort["key"]) => void;
}) {
  const active = currentSort.key === sortKey;
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-left text-xs font-bold uppercase tracking-[0.16em]",
        active ? "bg-emerald-50 text-emerald-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
      )}
      onClick={() => onChange(sortKey)}
    >
      {label}
      <span>{active ? (currentSort.direction === "asc" ? "↑" : "↓") : ""}</span>
    </button>
  );
}

function Meter({ value, max, tone }: { value: number | null; max: number; tone: "docs" | "store" }) {
  const width = value && max > 0 ? Math.max(3, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        className={cn("h-full rounded-full", tone === "docs" ? "bg-cyan-500" : "bg-emerald-500")}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function StatusPage() {
  const navigate = useNavigate();
  const {
    currentConnection,
    getPassword,
    getSshSecret,
    getSshProfileForConnection,
    recordErrorLog,
  } = useAppState();
  const [status, setStatus] = useState<ServerStatusSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [showSystemIndices, setShowSystemIndices] = useState(false);
  const [sort, setSort] = useState<ServerStatusSort>({ key: "store", direction: "desc" });
  const autoRefreshKeyRef = useRef("");

  const statusMutation = useMutation({
    mutationFn: async (connection: ConnectionProfile) => {
      const sshProfile = getSshProfileForConnection(connection);
      const [password, sshSecret] = await Promise.all([getPassword(connection), getSshSecret(sshProfile)]);
      if (!password) {
        throw new Error("当前连接未找到已保存密码，请回到连接页重新保存。");
      }

      return fetchServerStatus(connection, { password, sshSecret }, sshProfile?.tunnel ?? null);
    },
    onSuccess(nextStatus) {
      setStatus(nextStatus);
    },
    onError(error) {
      const message = extractUnknownErrorMessage(error, "服务器状态读取失败");
      toast.error(message);
      if (!currentConnection) {
        return;
      }

      recordErrorLog({
        scope: "status-read",
        title: "服务器状态读取失败",
        summary: message,
        diagnostics: extractUnknownErrorDiagnostics(error),
        connection: buildConnectionLogContextFromProfile(currentConnection, getSshProfileForConnection(currentConnection)),
      });
    },
  });

  useEffect(() => {
    if (!currentConnection) {
      return;
    }

    const refreshKey = `${currentConnection.id}:${currentConnection.updatedAt}`;
    if (autoRefreshKeyRef.current === refreshKey) {
      return;
    }

    autoRefreshKeyRef.current = refreshKey;
    statusMutation.mutate(currentConnection);
  }, [currentConnection, statusMutation]);

  const visibleIndices = useMemo(() => {
    const filtered = filterStatusIndices(status?.indices ?? [], { query, showSystemIndices });
    return sortStatusIndices(filtered, sort);
  }, [query, showSystemIndices, sort, status?.indices]);

  const displayedStats = useMemo(() => calculateDisplayedStats(visibleIndices), [visibleIndices]);

  if (!currentConnection) {
    return <Navigate to="/connections" replace />;
  }

  const connection = currentConnection;

  function refreshStatus() {
    statusMutation.mutate(connection);
  }

  function changeSort(key: ServerStatusSort["key"]) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }

  const loading = statusMutation.isPending;
  const statusError = statusMutation.error
    ? extractUnknownErrorMessage(statusMutation.error, "服务器状态读取失败")
    : null;

  return (
    <div className="min-h-screen bg-hero-grid px-4 py-4 sm:px-6 sm:py-5" onContextMenu={(event) => event.preventDefault()}>
      <div className="mx-auto max-w-7xl space-y-3">
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-600">ESX Status</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold leading-tight text-slate-950">服务器状态</h1>
                {status ? (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                      healthBadgeClasses[status.cluster.health],
                    )}
                  >
                    {healthLabels[status.cluster.health]}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
                {connection.name} · {connection.baseUrl}
                {status ? ` · 最近刷新 ${formatShanghaiDateTime(status.fetchedAt)}` : " · 进入页面后自动刷新一次"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <Button variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => navigate("/console")}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                返回控制台
              </Button>
              <Button variant="ghost" className="h-8 rounded-lg px-2 text-xs" onClick={() => navigate("/connections")}>
                连接页
              </Button>
              <Button className="h-8 rounded-lg px-2.5 text-xs" onClick={refreshStatus} disabled={loading}>
                {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1 h-3.5 w-3.5" />}
                刷新状态
              </Button>
            </div>
          </div>

          {statusError ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 p-2.5 text-xs leading-5 text-rose-700 sm:text-sm">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>{statusError}</p>
            </div>
          ) : null}

          {status?.partialFailures.length ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 p-2.5 text-xs leading-5 text-amber-800 sm:text-sm">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-bold">分片状态不完整</p>
                <p className="mt-0.5">{status.partialFailures[0]}</p>
              </div>
            </div>
          ) : null}
        </Card>

        {loading && !status ? (
          <Card className="flex min-h-[240px] items-center justify-center p-5">
            <div className="text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-600" />
              <p className="mt-2 text-xs font-semibold text-slate-700 sm:text-sm">正在读取集群、索引和分片状态...</p>
            </div>
          </Card>
        ) : status ? (
          <>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <MetricBlock
                icon={<Server className="h-4 w-4" />}
                label="集群"
                value={status.cluster.name}
                detail={`${formatNumber(status.cluster.nodes)} 个节点 · ${formatNumber(status.cluster.activeShards)} 个 active shards`}
              />
              <MetricBlock
                icon={<Boxes className="h-4 w-4" />}
                label="Index"
                value={formatNumber(status.summary.totalIndices)}
                detail={`${status.summary.systemIndices} 个系统/隐藏 index`}
              />
              <MetricBlock
                icon={<Database className="h-4 w-4" />}
                label="文档总量"
                value={formatNumber(status.summary.visibleDocsCount)}
                detail={`当前列表显示 ${formatNumber(visibleIndices.length)} 个 index`}
              />
              <MetricBlock
                icon={<HardDrive className="h-4 w-4" />}
                label="存储占用"
                value={formatDataBytes(status.summary.visibleStoreBytes)}
                detail={`主分片 ${formatNumber(status.cluster.activePrimaryShards)} · 未分配 ${formatNumber(status.cluster.unassignedShards)}`}
              />
            </div>

            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_280px]">
              <HealthDistribution status={status} />
              <ShardOverview status={status} />
            </div>

            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-100 p-3 sm:p-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-600">Indices</p>
                    <h2 className="mt-1 text-lg font-bold text-slate-950">Index 数据与状态</h2>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500 sm:text-sm">
                      当前筛选共 {formatNumber(visibleIndices.length)} 个 index，文档 {formatNumber(displayedStats.docs)}，
                      存储 {formatDataBytes(displayedStats.store)}。
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label className="relative block min-w-[200px]">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <Input
                        className="h-9 py-1 pl-8 text-sm"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="搜索 index 名称"
                      />
                    </label>
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 sm:text-sm">
                      <Switch checked={showSystemIndices} onChange={(event) => setShowSystemIndices(event.target.checked)} />
                      显示系统索引
                    </label>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full border-collapse text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2">
                        <SortHeader label="Index" sortKey="name" currentSort={sort} onChange={changeSort} />
                      </th>
                      <th className="px-3 py-2">
                        <SortHeader label="Health" sortKey="health" currentSort={sort} onChange={changeSort} />
                      </th>
                      <th className="px-3 py-2">
                        <SortHeader label="Status" sortKey="status" currentSort={sort} onChange={changeSort} />
                      </th>
                      <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Pri/Rep</th>
                      <th className="px-3 py-2">
                        <SortHeader label="Docs" sortKey="docs" currentSort={sort} onChange={changeSort} />
                      </th>
                      <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Deleted</th>
                      <th className="px-3 py-2">
                        <SortHeader label="Store" sortKey="store" currentSort={sort} onChange={changeSort} />
                      </th>
                      <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Shards</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {visibleIndices.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-xs text-slate-500 sm:text-sm" colSpan={8}>
                          没有匹配的 index。
                        </td>
                      </tr>
                    ) : (
                      visibleIndices.map((index) => (
                        <tr key={index.name} className="align-top hover:bg-slate-50/80">
                          <td className="max-w-[320px] px-3 py-2">
                            <div className="flex min-w-0 items-start gap-2">
                              <Activity className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", healthTextClasses[index.health])} />
                              <div className="min-w-0">
                                <p className="break-all text-xs font-bold text-slate-950 sm:text-sm">{index.name}</p>
                                {index.name.startsWith(".") ? (
                                  <p className="mt-0.5 text-[11px] text-slate-500">系统/隐藏 index</p>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={cn("rounded-full border px-1.5 py-px text-[10px] font-bold", healthBadgeClasses[index.health])}>
                              {index.health}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs font-semibold text-slate-700 sm:text-sm">{index.status}</td>
                          <td className="px-3 py-2 text-xs text-slate-600 sm:text-sm">
                            {formatNumber(index.primaryShards)} / {formatNumber(index.replicaShards)}
                          </td>
                          <td className="px-3 py-2">
                            <p className="text-xs font-semibold text-slate-900 sm:text-sm">{formatNumber(index.docsCount)}</p>
                            <Meter value={index.docsCount} max={displayedStats.maxDocs} tone="docs" />
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600 sm:text-sm">{formatNumber(index.docsDeleted)}</td>
                          <td className="px-3 py-2">
                            <p className="text-xs font-semibold text-slate-900 sm:text-sm">{formatDataBytes(index.storeBytes)}</p>
                            <Meter value={index.storeBytes} max={displayedStats.maxStore} tone="store" />
                          </td>
                          <td className="px-3 py-2 text-[11px] leading-4 text-slate-600">
                            <p>Started {index.shardSummary.started}</p>
                            <p>Relocating {index.shardSummary.relocating}</p>
                            <p>Initializing {index.shardSummary.initializing}</p>
                            <p>Unassigned {index.shardSummary.unassigned}</p>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : (
          <Card className="p-5 text-center sm:p-6">
            <p className="text-sm font-bold text-slate-900">还没有服务器状态数据</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">点击刷新状态重新读取当前连接。</p>
          </Card>
        )}
      </div>
    </div>
  );
}
