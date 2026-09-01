import { Activity, Boxes, Database, HardDrive, Server } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "../ui/card";
import { buildOverviewDiagnosticActions, type DiagnosticAction } from "../../lib/status-diagnostics";
import { cn } from "../../lib/utils";
import type { ClusterOverviewSnapshot, ServerHealth, ServerRiskFinding } from "../../types/status";

export const healthLabels: Record<ServerHealth, string> = {
  green: "健康",
  yellow: "警告",
  red: "故障",
  unknown: "未知",
};

export const healthTextClasses: Record<ServerHealth, string> = {
  green: "text-emerald-700",
  yellow: "text-amber-700",
  red: "text-rose-700",
  unknown: "text-slate-600",
};

export const healthBadgeClasses: Record<ServerHealth, string> = {
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

const riskSeverityLabels: Record<ServerRiskFinding["severity"], string> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};

const riskSeverityClasses: Record<ServerRiskFinding["severity"], string> = {
  critical: "border-rose-200 bg-rose-50 text-rose-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  info: "border-cyan-200 bg-cyan-50 text-cyan-700",
};

export function formatDataBytes(value: number | null) {
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

export function formatNumber(value: number | null) {
  return value === null ? "-" : new Intl.NumberFormat("zh-CN").format(value);
}

export function formatPercent(value: number | null) {
  return value === null ? "-" : `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

export function formatMillis(value: number | null) {
  if (value === null) {
    return "-";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)} ms`;
}

function getHealthSegments(status: ClusterOverviewSnapshot) {
  const counts = status.summary.healthCounts;
  const total = Math.max(status.summary.totalIndices, 1);
  return (["green", "yellow", "red", "unknown"] as const).map((health) => ({
    health,
    count: counts[health],
    width: `${(counts[health] / total) * 100}%`,
  }));
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

export function CompactMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold leading-tight text-slate-950">{value}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{detail}</p>
    </div>
  );
}

export function HealthDistribution({ status }: { status: ClusterOverviewSnapshot }) {
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

export function ShardOverview({ status }: { status: ClusterOverviewSnapshot }) {
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

export function RiskFindingsPanel({ risks }: { risks: ServerRiskFinding[] }) {
  if (risks.length === 0) {
    return (
      <Card className="border-emerald-100 bg-emerald-50/70 p-3 sm:p-4">
        <div className="flex items-start gap-2">
          <Activity className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-bold text-emerald-950">暂无明显运维风险</p>
            <p className="mt-0.5 text-xs leading-5 text-emerald-800 sm:text-sm">
              当前快照未触发集群健康、磁盘、Heap、CPU、Thread Pool、Breaker 或索引膨胀风险规则。
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const criticalCount = risks.filter((risk) => risk.severity === "critical").length;
  const warningCount = risks.filter((risk) => risk.severity === "warning").length;

  return (
    <Card className="p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-600">Risk Findings</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">风险结论</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-500 sm:text-sm">
            命中 {risks.length} 条规则，严重 {criticalCount} 条，警告 {warningCount} 条。
          </p>
        </div>
        <span
          className={cn(
            "w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold",
            criticalCount > 0 ? riskSeverityClasses.critical : warningCount > 0 ? riskSeverityClasses.warning : riskSeverityClasses.info,
          )}
        >
          {criticalCount > 0 ? "需要优先处理" : warningCount > 0 ? "建议关注" : "仅提示"}
        </span>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {risks.map((risk) => (
          <div key={risk.id} className="rounded-xl border border-slate-200 bg-white p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn("rounded-full border px-1.5 py-px text-[10px] font-bold", riskSeverityClasses[risk.severity])}>
                {riskSeverityLabels[risk.severity]}
              </span>
              <p className="text-sm font-bold text-slate-950">{risk.title}</p>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-slate-600 sm:text-sm">{risk.detail}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">{risk.recommendation}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function DiagnosticsPanel({ actions }: { actions: DiagnosticAction[] }) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <Card className="p-3 sm:p-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-600">Diagnostics</p>
        <h2 className="mt-1 text-lg font-bold text-slate-950">建议诊断请求</h2>
        <p className="mt-0.5 text-xs leading-5 text-slate-500 sm:text-sm">
          根据当前状态快照推荐下一步排障入口，可复制到 Console 执行。
        </p>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {actions.map((action) => (
          <div key={action.id} className="rounded-xl border border-slate-200 bg-white p-2.5">
            <p className="text-sm font-bold text-slate-950">{action.title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{action.reason}</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-2 text-[11px] leading-5 text-slate-100">
              GET {action.path}
            </pre>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function StatusOverviewTab({ snapshot }: { snapshot: ClusterOverviewSnapshot }) {
  const actions = buildOverviewDiagnosticActions(snapshot);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <MetricBlock
          icon={<Server className="h-4 w-4" />}
          label="集群"
          value={snapshot.cluster.name}
          detail={`${formatNumber(snapshot.cluster.nodes)} 个节点 · ${formatNumber(snapshot.cluster.activeShards)} 个 active shards`}
        />
        <MetricBlock
          icon={<Database className="h-4 w-4" />}
          label="节点"
          value={formatNumber(snapshot.cluster.nodes)}
          detail={`relocating ${formatNumber(snapshot.cluster.relocatingShards)} · initializing ${formatNumber(snapshot.cluster.initializingShards)} · unassigned ${formatNumber(snapshot.cluster.unassignedShards)}`}
        />
        <MetricBlock
          icon={<Boxes className="h-4 w-4" />}
          label="Index"
          value={formatNumber(snapshot.summary.totalIndices)}
          detail={`${snapshot.summary.systemIndices} 个系统/隐藏 index`}
        />
        <MetricBlock
          icon={<HardDrive className="h-4 w-4" />}
          label="分片"
          value={formatNumber(snapshot.cluster.activeShards)}
          detail={`主分片 ${formatNumber(snapshot.cluster.activePrimaryShards)} · 未分配 ${formatNumber(snapshot.cluster.unassignedShards)}`}
        />
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_280px]">
        <HealthDistribution status={snapshot} />
        <ShardOverview status={snapshot} />
      </div>

      <RiskFindingsPanel risks={snapshot.risks} />

      <DiagnosticsPanel actions={actions} />
    </div>
  );
}
