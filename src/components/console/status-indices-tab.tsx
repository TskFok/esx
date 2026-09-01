import { Activity, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { filterStatusIndices, sortStatusIndices } from "../../lib/status";
import { cn } from "../../lib/utils";
import type { IndexStatus, IndicesStatusSnapshot, ServerStatusSort } from "../../types/status";
import { formatDataBytes, formatNumber, healthBadgeClasses, healthTextClasses, RiskFindingsPanel } from "./status-overview-tab";

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

export function StatusIndicesTab({ snapshot }: { snapshot: IndicesStatusSnapshot }) {
  const [query, setQuery] = useState("");
  const [showSystemIndices, setShowSystemIndices] = useState(false);
  const [sort, setSort] = useState<ServerStatusSort>({ key: "store", direction: "desc" });

  const visibleIndices = useMemo(() => {
    const filtered = filterStatusIndices(snapshot.indices, { query, showSystemIndices });
    return sortStatusIndices(filtered, sort);
  }, [query, showSystemIndices, sort, snapshot.indices]);

  const displayedStats = useMemo(() => calculateDisplayedStats(visibleIndices), [visibleIndices]);

  function changeSort(key: ServerStatusSort["key"]) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }

  return (
    <div className="space-y-3">
      <RiskFindingsPanel risks={snapshot.risks} />

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
          <table className="min-w-[900px] w-full border-collapse text-left">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visibleIndices.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-xs text-slate-500 sm:text-sm" colSpan={7}>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
