import { AlertTriangle, Database, Gauge, RefreshCcw, Search } from "lucide-react";
import { Card } from "../ui/card";
import { buildOperationsDiagnosticActions, buildStatusTrendSummary } from "../../lib/status-diagnostics";
import { cn } from "../../lib/utils";
import type { DiskWatermark, OperationsStatusSnapshot, ServerOperationStatus } from "../../types/status";
import {
  CompactMetric,
  DiagnosticsPanel,
  formatDataBytes,
  formatMillis,
  formatNumber,
  formatPercent,
  RiskFindingsPanel,
} from "./status-overview-tab";

const diskWatermarkLabels: Record<DiskWatermark, string> = {
  normal: "正常",
  low: "Low",
  high: "High",
  flood_stage: "Flood",
  unknown: "未知",
};

const diskWatermarkClasses: Record<DiskWatermark, string> = {
  normal: "border-emerald-200 bg-emerald-50 text-emerald-700",
  low: "border-amber-200 bg-amber-50 text-amber-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  flood_stage: "border-rose-200 bg-rose-50 text-rose-700",
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
};

function OperationsPanel({ operations }: { operations: ServerOperationStatus }) {
  if (operations.nodeCount === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-start gap-2 text-sm text-slate-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-bold text-slate-900">节点运维指标未返回</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">基础集群、索引和分片状态仍可用；请检查 `_nodes/stats` 权限。</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-600">Operations</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">核心运维指标</h2>
            <p className="mt-0.5 text-xs leading-5 text-slate-500 sm:text-sm">
              来自 `_nodes/stats`，吞吐为节点启动以来累计数据。
            </p>
          </div>
          <span className={cn("w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold", diskWatermarkClasses[operations.diskWatermark])}>
            磁盘水位 {diskWatermarkLabels[operations.diskWatermark]}
          </span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <CompactMetric
            label="CPU"
            value={`最高 ${formatPercent(operations.maxCpuPercent)}`}
            detail={`平均 ${formatPercent(operations.avgCpuPercent)} · ${formatNumber(operations.nodeCount)} 节点`}
          />
          <CompactMetric
            label="Heap"
            value={`最高 ${formatPercent(operations.maxHeapPercent)}`}
            detail={`${formatDataBytes(operations.heapUsedBytes)} / ${formatDataBytes(operations.heapMaxBytes)}`}
          />
          <CompactMetric
            label="GC"
            value={`${formatNumber(operations.gc.collectionCount)} 次`}
            detail={`累计耗时 ${formatMillis(operations.gc.collectionTimeMs)}`}
          />
          <CompactMetric
            label="Disk"
            value={formatPercent(operations.diskUsedPercent)}
            detail={`可用 ${formatDataBytes(operations.diskAvailableBytes)} · 空闲 ${formatDataBytes(operations.diskFreeBytes)}`}
          />
          <CompactMetric
            label="Thread Pool"
            value={`Queue ${formatNumber(operations.threadPools.queue)}`}
            detail={`Active ${formatNumber(operations.threadPools.active)} · Rejected ${formatNumber(operations.threadPools.rejected)}`}
          />
          <CompactMetric
            label="Breaker"
            value={`${formatDataBytes(operations.breakers.estimatedBytes)}`}
            detail={`Limit ${formatDataBytes(operations.breakers.limitBytes)} · Tripped ${formatNumber(operations.breakers.tripped)}`}
          />
          <CompactMetric
            label="Segments"
            value={formatNumber(operations.segments.count)}
            detail={`内存 ${formatDataBytes(operations.segments.memoryBytes)}`}
          />
          <CompactMetric
            label="Merge"
            value={`Current ${formatNumber(operations.merges.current)}`}
            detail={`累计 ${formatNumber(operations.merges.total)} · ${formatMillis(operations.merges.totalTimeMs)}`}
          />
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 p-2.5">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-cyan-600" />
              <p className="text-xs font-bold text-slate-950">Search 吞吐</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <CompactMetric label="Query" value={formatNumber(operations.search.queryTotal)} detail={`平均 ${formatMillis(operations.search.queryAvgMs)}`} />
              <CompactMetric label="Fetch" value={formatNumber(operations.search.fetchTotal)} detail={`平均 ${formatMillis(operations.search.fetchAvgMs)}`} />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-2.5">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-600" />
              <p className="text-xs font-bold text-slate-950">Indexing 吞吐</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <CompactMetric label="Index" value={formatNumber(operations.indexing.indexTotal)} detail={`平均 ${formatMillis(operations.indexing.indexAvgMs)}`} />
              <CompactMetric label="Delete" value={formatNumber(operations.indexing.deleteTotal)} detail={`平均 ${formatMillis(operations.indexing.deleteAvgMs)}`} />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-2.5">
            <div className="flex items-center gap-2">
              <RefreshCcw className="h-4 w-4 text-amber-600" />
              <p className="text-xs font-bold text-slate-950">Refresh</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <CompactMetric label="Total" value={formatNumber(operations.refresh.total)} detail={`平均 ${formatMillis(operations.refresh.avgMs)}`} />
              <CompactMetric label="Time" value={formatMillis(operations.refresh.totalTimeMs)} detail="累计刷新耗时" />
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-600">Nodes</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">节点压力</h2>
          </div>
          <Gauge className="h-4 w-4 text-slate-500" />
        </div>
        <div className="mt-3 space-y-2">
          {operations.nodes.slice(0, 6).map((node) => (
            <div key={node.id} className="rounded-xl border border-slate-200 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-950 sm:text-sm">{node.name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{node.id}</p>
                </div>
                <span className={cn("shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold", diskWatermarkClasses[node.diskWatermark])}>
                  {diskWatermarkLabels[node.diskWatermark]}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                <p className="rounded-lg bg-slate-50 px-2 py-1">
                  CPU <span className="font-bold text-slate-900">{formatPercent(node.cpuPercent)}</span>
                </p>
                <p className="rounded-lg bg-slate-50 px-2 py-1">
                  Heap <span className="font-bold text-slate-900">{formatPercent(node.heapPercent)}</span>
                </p>
                <p className="rounded-lg bg-slate-50 px-2 py-1">
                  Disk <span className="font-bold text-slate-900">{formatPercent(node.diskUsedPercent)}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
        {operations.topThreadPools.length ? (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="text-xs font-bold text-slate-950">Thread Pool 热点</p>
            <div className="mt-2 space-y-1.5">
              {operations.topThreadPools.slice(0, 4).map((pool) => (
                <p key={pool.name} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                  <span className="min-w-0 flex-1 truncate font-bold text-slate-900">{pool.name}</span>
                  <span>Q {formatNumber(pool.queue)}</span>
                  <span>R {formatNumber(pool.rejected)}</span>
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function TrendPanel({ history }: { history: OperationsStatusSnapshot[] }) {
  const trend = buildStatusTrendSummary(history);
  if (!trend) {
    return null;
  }

  return (
    <Card className="p-3 sm:p-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-600">Trend</p>
        <h2 className="mt-1 text-lg font-bold text-slate-950">最近快照增量</h2>
        <p className="mt-0.5 text-xs leading-5 text-slate-500 sm:text-sm">
          基于最近两次手动/页面刷新计算，间隔 {formatNumber(trend.intervalSeconds)} 秒。
        </p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <CompactMetric label="Search QPS" value={String(trend.searchQueriesPerSecond)} detail={`增量 ${formatNumber(trend.searchQueriesDelta)}`} />
        <CompactMetric label="Indexing/s" value={String(trend.indexingPerSecond)} detail={`增量 ${formatNumber(trend.indexingDelta)}`} />
        <CompactMetric label="Rejected" value={formatNumber(trend.threadPoolRejectedDelta)} detail="Thread pool rejected 增量" />
        <CompactMetric label="Breaker" value={formatNumber(trend.breakerTrippedDelta)} detail="Circuit breaker tripped 增量" />
      </div>
    </Card>
  );
}

export function StatusOperationsTab({
  snapshot,
  history,
}: {
  snapshot: OperationsStatusSnapshot;
  history: OperationsStatusSnapshot[];
}) {
  const actions = buildOperationsDiagnosticActions(snapshot);

  return (
    <div className="space-y-3">
      {snapshot.partialFailures.length ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 p-2.5 text-xs leading-5 text-amber-800 sm:text-sm">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-bold">状态指标不完整</p>
            <p className="mt-0.5">{snapshot.partialFailures[0]}</p>
          </div>
        </div>
      ) : null}

      <RiskFindingsPanel risks={snapshot.risks} />

      <DiagnosticsPanel actions={actions} />

      <TrendPanel history={history} />

      <OperationsPanel operations={snapshot.operations} />
    </div>
  );
}
