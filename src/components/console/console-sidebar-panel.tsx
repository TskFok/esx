import { useMemo, useRef, useState } from "react";
import {
  CirclePlus,
  CopyPlus,
  Download,
  GripVertical,
  Hammer,
  PanelLeftClose,
  Pencil,
  Server,
  Tags,
  Trash2,
  Upload,
} from "lucide-react";
import { filterConnectionRequests } from "../../lib/request-list";
import { collectConnectionTags, type RequestTagFilter } from "../../lib/request-tags";
import type { SavedRequest } from "../../types/requests";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export type ConsoleSidebarPanelProps = {
  connectionName: string;
  requests: SavedRequest[];
  activeSavedRequestId: string | null;
  closeTitle?: string;
  onClose: () => void;
  onNavigateConnections: () => void;
  onNavigateStatus: () => void;
  onNavigateAdmin: () => void;
  onNavigateLogs: () => void;
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

export function ConsoleSidebarPanel({
  connectionName,
  requests,
  activeSavedRequestId,
  closeTitle = "隐藏侧边栏 (⌘B)",
  onClose,
  onNavigateConnections,
  onNavigateStatus,
  onNavigateAdmin,
  onNavigateLogs,
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
  const [draggedRequestId, setDraggedRequestId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const selectedIdSet = useMemo(() => new Set(selectedRequestIds), [selectedRequestIds]);

  const availableTags = useMemo(() => collectConnectionTags(requests), [requests]);
  const canReorder = !selectionMode && !searchQuery.trim() && tagFilter === "all";

  const visibleRequests = useMemo(
    () => filterConnectionRequests(requests, { searchQuery, tagFilter }),
    [requests, searchQuery, tagFilter],
  );

  function handleDrop(targetRequestId: string) {
    if (!draggedRequestId || !canReorder) {
      return;
    }

    const sourceIds = requests.map((request) => request.id);
    const draggedIndex = sourceIds.indexOf(draggedRequestId);
    const targetIndex = sourceIds.indexOf(targetRequestId);

    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
      setDraggedRequestId(null);
      return;
    }

    const next = [...sourceIds];
    next.splice(draggedIndex, 1);
    next.splice(targetIndex, 0, draggedRequestId);
    onReorderRequests(next);
    setDraggedRequestId(null);
  }

  function handleRequestClick(requestId: string) {
    if (selectionMode) {
      onToggleRequestSelection(requestId);
      return;
    }

    onSelectSavedRequest(requestId);
  }

  return (
    <div className={className}>
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">ESX Console</p>
            <h1 className="mt-0.5 text-lg font-bold leading-tight">连接与请求</h1>
          </div>
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
        <div className="flex flex-wrap gap-1">
          <Button variant="secondary" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={onNavigateConnections}>
            连接页
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg px-2 text-xs text-slate-200 hover:bg-white/10 hover:text-white"
            onClick={onNavigateStatus}
          >
            <Server className="mr-1 h-3.5 w-3.5" />
            状态
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg px-2 text-xs text-slate-200 hover:bg-white/10 hover:text-white"
            onClick={onNavigateAdmin}
          >
            <Hammer className="mr-1 h-3.5 w-3.5" />
            治理
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg px-2 text-xs text-slate-200 hover:bg-white/10 hover:text-white"
            onClick={onNavigateLogs}
          >
            错误日志
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
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

        <div className="mt-2">
          {requests.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-2 text-xs leading-5 text-slate-400">
              当前连接还没有请求。点击「新建」或运行并保存第一条请求。
            </div>
          ) : visibleRequests.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-2 text-xs leading-5 text-slate-400">
              没有匹配的请求，请调整搜索或标签筛选。
            </div>
          ) : (
            <div className="space-y-1.5">
              {!canReorder ? (
                <p className="px-1 text-[10px] text-slate-500">
                  {selectionMode ? "多选模式下无法拖拽排序。" : "清除搜索和标签筛选后可拖拽排序。"}
                </p>
              ) : null}
              {visibleRequests.map((request) => {
                const isActive = !selectionMode && activeSavedRequestId === request.id;
                const isSelected = selectedIdSet.has(request.id);
                const isDragging = draggedRequestId === request.id;

                return (
                  <div
                    key={request.id}
                    draggable={canReorder}
                    onDragStart={() => setDraggedRequestId(request.id)}
                    onDragEnd={() => setDraggedRequestId(null)}
                    onDragOver={(event) => {
                      if (!canReorder) {
                        return;
                      }
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDrop(request.id);
                    }}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer rounded-lg border p-2 text-xs transition ${
                      isActive || (selectionMode && isSelected)
                        ? "border-white/30 bg-white text-slate-950"
                        : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                    } ${isDragging ? "opacity-50" : ""}`}
                    onClick={() => handleRequestClick(request.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleRequestClick(request.id);
                      }
                    }}
                  >
                    <div className="flex items-start gap-1.5">
                      {selectionMode ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          className="mt-1"
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => onToggleRequestSelection(request.id)}
                        />
                      ) : null}
                      {canReorder ? (
                        <span
                          className="mt-0.5 cursor-grab text-slate-400 active:cursor-grabbing"
                          title="拖拽排序"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </span>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-bold leading-snug">{request.name}</p>
                          {request.lastStatus ? (
                            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-slate-700">
                              {request.lastStatus}
                            </span>
                          ) : null}
                        </div>
                        {request.tags.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {request.tags.map((tag) => (
                              <span
                                key={tag}
                                className={`rounded-full px-1.5 py-px text-[9px] font-semibold ${
                                  isActive || (selectionMode && isSelected)
                                    ? "bg-slate-200 text-slate-700"
                                    : "bg-white/10 text-slate-300"
                                }`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {!selectionMode ? (
                      <div className="mt-1.5 flex justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 px-0 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          title="编辑请求"
                          aria-label="编辑请求"
                          onClick={(event) => {
                            event.stopPropagation();
                            onEditRequest(request);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 px-0 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          title="复制请求"
                          aria-label="复制请求"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDuplicateRequest(request.id, request.name);
                          }}
                        >
                          <CopyPlus className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 px-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          title="删除请求"
                          aria-label="删除请求"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteRequest(request);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
