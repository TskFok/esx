import { Activity, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { filterStatusIndices, sortStatusIndices } from "../../lib/status";
import { paginate } from "../../lib/paginate";
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
        "inline-flex items-center gap-1 rounded px-1.5 py-1 text-left text-xs font-semibold",
        active ? "bg-secondary text-primary" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
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
  const [page, setPage] = useState(1);

  const visibleIndices = useMemo(() => {
    const filtered = filterStatusIndices(snapshot.indices, { query, showSystemIndices });
    return sortStatusIndices(filtered, sort);
  }, [query, showSystemIndices, sort, snapshot.indices]);

  const displayedStats = useMemo(() => calculateDisplayedStats(visibleIndices), [visibleIndices]);
  const paginatedIndices = useMemo(() => paginate(visibleIndices, page), [visibleIndices, page]);

  function changeSort(key: ServerStatusSort["key"]) {
    setPage(1);
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }

  return (
    <div className="space-y-3">
      <RiskFindingsPanel risks={snapshot.risks} />

      <Card className="overflow-hidden p-0">
        <div className="border-b border-slate-200 p-3 sm:p-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Index 数据与状态</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                当前筛选共 {formatNumber(visibleIndices.length)} 个 index，文档 {formatNumber(displayedStats.docs)}，
                存储 {formatDataBytes(displayedStats.store)}。
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative block min-w-[200px]">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  className="h-8 py-1 pl-8 text-xs"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                  placeholder="搜索 index 名称"
                />
              </label>
              <label className="flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700">
                <Switch checked={showSystemIndices} onChange={(event) => { setShowSystemIndices(event.target.checked); setPage(1); }} />
                显示系统索引
              </label>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse text-left text-xs">
            <thead className="bg-background">
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
                <th className="px-3 py-2 text-xs font-semibold text-slate-500">Pri/Rep</th>
                <th className="px-3 py-2">
                  <SortHeader label="Docs" sortKey="docs" currentSort={sort} onChange={changeSort} />
                </th>
                <th className="px-3 py-2 text-xs font-semibold text-slate-500">Deleted</th>
                <th className="px-3 py-2">
                  <SortHeader label="Store" sortKey="store" currentSort={sort} onChange={changeSort} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visibleIndices.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-xs text-slate-500" colSpan={7}>
                    没有匹配的 index。
                  </td>
                </tr>
              ) : (
                paginatedIndices.items.map((index) => (
                  <tr key={index.name} data-testid="status-index-row" className="align-top hover:bg-slate-50/80">
                    <td className="max-w-[320px] px-3 py-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <Activity className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", healthTextClasses[index.health])} />
                        <div className="min-w-0">
                          <p className="break-all text-xs font-semibold text-slate-950">{index.name}</p>
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
                    <td className="px-3 py-2 text-xs font-medium text-slate-700">{index.status}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {formatNumber(index.primaryShards)} / {formatNumber(index.replicaShards)}
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-xs font-medium text-slate-900">{formatNumber(index.docsCount)}</p>
                      <Meter value={index.docsCount} max={displayedStats.maxDocs} tone="docs" />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{formatNumber(index.docsDeleted)}</td>
                    <td className="px-3 py-2">
                      <p className="text-xs font-medium text-slate-900">{formatDataBytes(index.storeBytes)}</p>
                      <Meter value={index.storeBytes} max={displayedStats.maxStore} tone="store" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {paginatedIndices.pageCount > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
            <span>第 {paginatedIndices.page} / {paginatedIndices.pageCount} 页</span>
            <div className="flex gap-2">
              <button type="button" aria-label="上一页索引" disabled={paginatedIndices.page <= 1} onClick={() => setPage(paginatedIndices.page - 1)}>上一页</button>
              <button type="button" aria-label="下一页索引" disabled={paginatedIndices.page >= paginatedIndices.pageCount} onClick={() => setPage(paginatedIndices.page + 1)}>下一页</button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
