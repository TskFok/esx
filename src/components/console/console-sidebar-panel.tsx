import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CirclePlus,
  Download,
  Hammer,
  PanelLeftClose,
  Server,
  Tags,
  Upload,
} from "lucide-react";
import { filterConnectionRequests } from "../../lib/request-list";
import { collectConnectionTags, type RequestTagFilter } from "../../lib/request-tags";
import type { SavedRequest } from "../../types/requests";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ConsoleRequestList } from "./console-request-list";

export type ConsoleSidebarPanelProps = {
  connectionName: string;
  requests: SavedRequest[];
  activeSavedRequestId: string | null;
  closeTitle?: string;
  onClose: () => void;
  onNavigateConnections: () => void;
  onNavigateConsole: () => void;
  onNavigateStatus: () => void;
  onNavigateAdmin: () => void;
  onNavigateLogs: () => void;
  logsPanelOpen?: boolean;
  statusPanelOpen?: boolean;
  adminPanelOpen?: boolean;
  onCreateRequest: () => void;
  onExportClick: () => void;
  onImportFileSelected: (file: File) => void;
  onSelectSavedRequest: (requestId: string) => void;
  onEditRequest: (request: SavedRequest) => void;
  onDuplicateRequest: (requestId: string, requestName: string) => void;
  onDeleteRequest: (request: SavedRequest) => void;
  onReorderRequests: (orderedRequestIds: string[]) => void;
  selectionMode: boolean;
  selectedRequestIds: string[];
  onToggleSelectionMode: () => void;
  onToggleRequestSelection: (requestId: string) => void;
  onSelectAllVisible: (requestIds: string[]) => void;
  onClearSelection: () => void;
  onOpenBulkTags: () => void;
  className?: string;
};

function useStableEvent<Args extends unknown[]>(callback: (...args: Args) => void) {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => { callbackRef.current = callback; });
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

function ConsoleSidebarPanelInner({
  connectionName,
  requests,
  activeSavedRequestId,
  closeTitle = "隐藏侧边栏 (⌘B)",
  onClose,
  onNavigateConnections,
  onNavigateConsole,
  onNavigateStatus,
  onNavigateAdmin,
  onNavigateLogs,
  logsPanelOpen = false,
  statusPanelOpen = false,
  adminPanelOpen = false,
  onCreateRequest,
  onExportClick,
  onImportFileSelected,
  onSelectSavedRequest,
  onEditRequest,
  onDuplicateRequest,
  onDeleteRequest,
  onReorderRequests,
  selectionMode,
  selectedRequestIds,
  onToggleSelectionMode,
  onToggleRequestSelection,
  onSelectAllVisible,
  onClearSelection,
  onOpenBulkTags,
  className = "flex h-full min-h-0 flex-col overflow-hidden",
}: ConsoleSidebarPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<RequestTagFilter>("all");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const availableTags = useMemo(() => collectConnectionTags(requests), [requests]);
  const selectRequest = useStableEvent(onSelectSavedRequest);
  const toggleRequestSelection = useStableEvent(onToggleRequestSelection);
  const editRequest = useStableEvent(onEditRequest);
  const duplicateRequest = useStableEvent(onDuplicateRequest);
  const deleteRequest = useStableEvent(onDeleteRequest);
  const reorderRequests = useStableEvent(onReorderRequests);
  const canReorder = !selectionMode && !searchQuery.trim() && tagFilter === "all";
  const consolePanelOpen = !statusPanelOpen && !adminPanelOpen && !logsPanelOpen;

  const visibleRequests = useMemo(
    () => filterConnectionRequests(requests, { searchQuery, tagFilter }),
    [requests, searchQuery, tagFilter],
  );

  return (
    <div className={className}>
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">ESX Console</p>
            <h1 className="mt-0.5 text-lg font-bold leading-tight">连接与请求</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg px-2 text-xs text-slate-200 hover:bg-white/10 hover:text-white"
              onClick={onNavigateConnections}
            >
              连接页
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 rounded-lg px-2 text-xs text-slate-200 hover:bg-white/10 hover:text-white"
              title={closeTitle}
              aria-label={closeTitle}
              onClick={onClose}
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 rounded-lg px-2 text-xs hover:bg-white/10 hover:text-white ${
              consolePanelOpen ? "bg-white/10 text-white" : "text-slate-200"
            }`}
            aria-pressed={consolePanelOpen}
            onClick={onNavigateConsole}
          >
            控制台
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 rounded-lg px-2 text-xs hover:bg-white/10 hover:text-white ${
              statusPanelOpen ? "bg-white/10 text-white" : "text-slate-200"
            }`}
            aria-pressed={statusPanelOpen}
            onClick={onNavigateStatus}
          >
            <Server className="mr-1 h-3.5 w-3.5" />
            状态
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 rounded-lg px-2 text-xs hover:bg-white/10 hover:text-white ${
              adminPanelOpen ? "bg-white/10 text-white" : "text-slate-200"
            }`}
            aria-pressed={adminPanelOpen}
            onClick={onNavigateAdmin}
          >
            <Hammer className="mr-1 h-3.5 w-3.5" />
            治理
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 rounded-lg px-2 text-xs hover:bg-white/10 hover:text-white ${
              logsPanelOpen ? "bg-white/10 text-white" : "text-slate-200"
            }`}
            aria-pressed={logsPanelOpen}
            onClick={onNavigateLogs}
          >
            错误日志
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 flex flex-col overflow-hidden pr-0.5">
        <div className="shrink-0 max-h-[60%] overflow-y-auto">
        <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
          <p className="text-xs font-semibold text-emerald-300">当前连接</p>
          <p className="mt-1 text-sm font-bold leading-snug text-white">{connectionName}</p>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-300">已保存请求</p>
          <div className="flex gap-1">
            <Button
              variant={selectionMode ? "secondary" : "ghost"}
              size="sm"
              className="h-8 rounded-lg px-2 text-xs text-slate-200 hover:bg-white/10 hover:text-white"
              onClick={onToggleSelectionMode}
            >
              多选
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg px-2 text-xs text-slate-200 hover:bg-white/10 hover:text-white"
              onClick={onCreateRequest}
            >
              <CirclePlus className="mr-1 h-3.5 w-3.5" />
              新建
            </Button>
          </div>
        </div>

        {selectionMode ? (
          <div className="mt-2 flex flex-wrap gap-1">
            <Button variant="outline" size="sm" className="h-8 rounded-lg px-2 text-xs" onClick={() => onSelectAllVisible(visibleRequests.map((request) => request.id))}>
              全选当前
            </Button>
            <Button variant="outline" size="sm" className="h-8 rounded-lg px-2 text-xs" onClick={onClearSelection}>
              清空
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg px-2 text-xs"
              disabled={selectedRequestIds.length === 0}
              onClick={onOpenBulkTags}
            >
              <Tags className="mr-1 h-3.5 w-3.5" />
              批量标签 ({selectedRequestIds.length})
            </Button>
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg px-2 text-xs"
            onClick={onExportClick}
            disabled={requests.length === 0}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            导出
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg px-2 text-xs"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="mr-1 h-3.5 w-3.5" />
            导入
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                onImportFileSelected(file);
              }
            }}
          />
        </div>

        <div className="mt-2">
          <Input
            className="h-8 rounded-lg border-white/10 bg-white/5 text-xs text-white placeholder:text-slate-400"
            placeholder="搜索请求名称、路径或标签"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        {availableTags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                tagFilter === "all" ? "bg-emerald-500/30 text-white" : "bg-white/10 text-slate-300 hover:bg-white/15"
              }`}
              onClick={() => setTagFilter("all")}
            >
              全部
            </button>
            <button
              type="button"
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                tagFilter === "untagged"
                  ? "bg-emerald-500/30 text-white"
                  : "bg-white/10 text-slate-300 hover:bg-white/15"
              }`}
              onClick={() => setTagFilter("untagged")}
            >
              无标签
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                  tagFilter === tag ? "bg-emerald-500/30 text-white" : "bg-white/10 text-slate-300 hover:bg-white/15"
                }`}
                onClick={() => setTagFilter(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        </div>
        {requests.length === 0 ? (
          <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-2 text-xs leading-5 text-slate-400">
            当前连接还没有请求。点击「新建」或运行并保存第一条请求。
          </div>
        ) : visibleRequests.length === 0 ? (
          <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-2 text-xs leading-5 text-slate-400">
            没有匹配的请求，请调整搜索或标签筛选。
          </div>
        ) : (
          <>
            {!canReorder ? (
              <p className="mt-2 px-1 text-[10px] text-slate-500">
                {selectionMode ? "多选模式下无法拖拽排序。" : "清除搜索和标签筛选后可拖拽排序。"}
              </p>
            ) : null}
            <ConsoleRequestList
              key={JSON.stringify([searchQuery.trim().toLowerCase(), tagFilter])}
              requests={visibleRequests}
              activeSavedRequestId={activeSavedRequestId}
              selectionMode={selectionMode}
              selectedRequestIds={selectedRequestIds}
              canReorder={canReorder}
              onSelectSavedRequest={selectRequest}
              onToggleRequestSelection={toggleRequestSelection}
              onEditRequest={editRequest}
              onDuplicateRequest={duplicateRequest}
              onDeleteRequest={deleteRequest}
              onReorderRequests={reorderRequests}
            />
          </>
        )}
      </div>
    </div>
  );
}

export const ConsoleSidebarPanel = memo(ConsoleSidebarPanelInner);
