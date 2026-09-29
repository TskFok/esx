import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CirclePlus,
  Download,
  FileCode2,
  Hammer,
  Logs,
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
      <div className="mb-3 flex max-h-[45%] shrink-0 flex-col overflow-y-auto border-b border-white/10 pb-3">
        <div className="flex items-center justify-between gap-2 py-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#8ba2ff]/60 bg-[#8ba2ff]/10 font-mono text-xs font-bold text-[#b8c5ff]">ESX</span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight text-white">Elasticsearch Client</h1>
              <p className="mt-0.5 text-[11px] leading-tight text-[#9ca8c7]">连接与请求</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 rounded-md px-2 text-xs text-[#b8c5e8] hover:bg-white/10 hover:text-white"
              title={closeTitle}
              aria-label={closeTitle}
              onClick={onClose}
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 h-8 w-full justify-start gap-2 rounded-md border border-white/10 px-2.5 text-xs text-[#b8c5e8] hover:bg-white/10 hover:text-white"
          onClick={onNavigateConnections}
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
          连接页
        </Button>
        <p className="mb-1 mt-4 px-2 text-[11px] font-semibold tracking-[0.12em] text-[#8f9cbb]">导航</p>
        <nav aria-label="工作区导航" className="grid gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={`h-9 w-full justify-start gap-2.5 rounded-md px-2.5 text-xs hover:bg-[#465282]/50 hover:text-white ${
              consolePanelOpen ? "border border-[#8ba2ff]/40 bg-[#465282]/60 text-white shadow-[inset_3px_0_0_#8ba2ff]" : "border border-transparent text-[#b8c5e8]"
            }`}
            aria-pressed={consolePanelOpen}
            onClick={onNavigateConsole}
          >
            <FileCode2 className="h-4 w-4 shrink-0" />
            控制台
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-9 w-full justify-start gap-2.5 rounded-md px-2.5 text-xs hover:bg-[#465282]/50 hover:text-white ${
              statusPanelOpen ? "border border-[#8ba2ff]/40 bg-[#465282]/60 text-white shadow-[inset_3px_0_0_#8ba2ff]" : "border border-transparent text-[#b8c5e8]"
            }`}
            aria-pressed={statusPanelOpen}
            onClick={onNavigateStatus}
          >
            <Server className="h-4 w-4 shrink-0" />
            状态
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-9 w-full justify-start gap-2.5 rounded-md px-2.5 text-xs hover:bg-[#465282]/50 hover:text-white ${
              adminPanelOpen ? "border border-[#8ba2ff]/40 bg-[#465282]/60 text-white shadow-[inset_3px_0_0_#8ba2ff]" : "border border-transparent text-[#b8c5e8]"
            }`}
            aria-pressed={adminPanelOpen}
            onClick={onNavigateAdmin}
          >
            <Hammer className="h-4 w-4 shrink-0" />
            治理
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-9 w-full justify-start gap-2.5 rounded-md px-2.5 text-xs hover:bg-[#465282]/50 hover:text-white ${
              logsPanelOpen ? "border border-[#8ba2ff]/40 bg-[#465282]/60 text-white shadow-[inset_3px_0_0_#8ba2ff]" : "border border-transparent text-[#b8c5e8]"
            }`}
            aria-pressed={logsPanelOpen}
            onClick={onNavigateLogs}
          >
            <Logs className="h-4 w-4 shrink-0" />
            错误日志
          </Button>
        </nav>
      </div>

      <div className="min-h-0 flex-1 flex flex-col overflow-hidden pr-0.5">
        <div className="shrink-0 max-h-[60%] overflow-y-auto">
        <div className="rounded-md border border-white/10 bg-white/5 p-2.5">
          <p className="text-[11px] font-semibold text-[#9ca8c7]">当前连接</p>
          <p className="mt-1 truncate text-sm font-semibold leading-snug text-white" title={connectionName}>{connectionName}</p>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-300">已保存请求</p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 rounded-md px-2 text-xs hover:bg-white/10 hover:text-white ${selectionMode ? "bg-[#465282] text-white" : "text-[#b8c5e8]"}`}
              onClick={onToggleSelectionMode}
            >
              多选
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-md px-2 text-xs text-[#b8c5e8] hover:bg-white/10 hover:text-white"
              onClick={onCreateRequest}
            >
              <CirclePlus className="mr-1 h-3.5 w-3.5" />
              新建
            </Button>
          </div>
        </div>

        {selectionMode ? (
          <div className="mt-2 flex flex-wrap gap-1">
            <Button variant="outline" size="sm" className="h-8 rounded-md border-white/20 bg-white/5 px-2 text-xs text-white hover:bg-white/10" onClick={() => onSelectAllVisible(visibleRequests.map((request) => request.id))}>
              全选当前
            </Button>
            <Button variant="outline" size="sm" className="h-8 rounded-md border-white/20 bg-white/5 px-2 text-xs text-white hover:bg-white/10" onClick={onClearSelection}>
              清空
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-md border-white/20 bg-white/5 px-2 text-xs text-white hover:bg-white/10"
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
            className="h-8 rounded-md border-white/20 bg-white/5 px-2 text-xs text-white hover:bg-white/10"
            onClick={onExportClick}
            disabled={requests.length === 0}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            导出
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-md border-white/20 bg-white/5 px-2 text-xs text-white hover:bg-white/10"
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
            className="h-8 rounded-md border-white/20 bg-white/5 text-xs text-white placeholder:text-[#9ca8c7]"
            placeholder="搜索请求名称、路径或标签"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        {availableTags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                tagFilter === "all" ? "bg-[#465282] text-white" : "bg-white/10 text-[#b8c5e8] hover:bg-white/15"
              }`}
              onClick={() => setTagFilter("all")}
            >
              全部
            </button>
            <button
              type="button"
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                tagFilter === "untagged"
                  ? "bg-[#465282] text-white"
                  : "bg-white/10 text-[#b8c5e8] hover:bg-white/15"
              }`}
              onClick={() => setTagFilter("untagged")}
            >
              无标签
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  tagFilter === tag ? "bg-[#465282] text-white" : "bg-white/10 text-[#b8c5e8] hover:bg-white/15"
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
          <div className="mt-2 rounded-md border border-white/10 bg-white/5 p-2 text-xs leading-5 text-[#9ca8c7]">
            当前连接还没有请求。点击「新建」或运行并保存第一条请求。
          </div>
        ) : visibleRequests.length === 0 ? (
          <div className="mt-2 rounded-md border border-white/10 bg-white/5 p-2 text-xs leading-5 text-[#9ca8c7]">
            没有匹配的请求，请调整搜索或标签筛选。
          </div>
        ) : (
          <>
            {!canReorder ? (
              <p className="mt-2 px-1 text-[11px] text-[#9ca8c7]">
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
