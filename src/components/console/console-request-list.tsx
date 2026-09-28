import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { CopyPlus, GripVertical, Pencil, Trash2 } from "lucide-react";
import type { SavedRequest } from "../../types/requests";
import { Button } from "../ui/button";
import type { ConsoleSidebarPanelProps } from "./console-sidebar-panel";

export type ConsoleRequestListProps = Pick<
  ConsoleSidebarPanelProps,
  | "requests"
  | "activeSavedRequestId"
  | "selectionMode"
  | "selectedRequestIds"
  | "onSelectSavedRequest"
  | "onToggleRequestSelection"
  | "onEditRequest"
  | "onDuplicateRequest"
  | "onDeleteRequest"
  | "onReorderRequests"
> & { canReorder: boolean };

function ConsoleRequestListInner(props: ConsoleRequestListProps): ReactElement {
  const {
    requests, activeSavedRequestId, selectionMode, selectedRequestIds, canReorder,
    onSelectSavedRequest, onToggleRequestSelection, onEditRequest,
    onDuplicateRequest, onDeleteRequest, onReorderRequests,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const draggedIdRef = useRef<string | null>(null);
  const dragYRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const selectedIds = useMemo(() => new Set(selectedRequestIds), [selectedRequestIds]);
  const virtualized = requests.length >= 200;
  const virtualizer = useVirtualizer({
    count: requests.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 88,
    getItemKey: (index) => requests[index]?.id ?? index,
    overscan: 6,
    rangeExtractor: (range) => {
      const visible = defaultRangeExtractor(range);
      if (draggedIndex === null || requests[draggedIndex]?.id !== draggedId || visible.includes(draggedIndex)) {
        return visible;
      }
      return draggedIndex < visible[0] ? [draggedIndex, ...visible] : [...visible, draggedIndex];
    },
    enabled: virtualized,
  });

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const contentHeight = virtualized ? virtualizer.getTotalSize() : scroll.scrollHeight;
    const maxOffset = Math.max(0, contentHeight - scroll.offsetHeight);
    if (scroll.scrollTop > maxOffset) {
      scroll.scrollTop = maxOffset;
      virtualizer.scrollToOffset(maxOffset);
    }
  }, [requests, virtualized, virtualizer]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  useEffect(() => {
    if (draggedId === null) return;
    const cancel = () => finishDrag(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("dragend", cancel);
    document.addEventListener("drop", cancel);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("dragend", cancel);
      document.removeEventListener("drop", cancel);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", cancel);
    };
  }, [draggedId]);

  function finishDrag(targetId: string | null) {
    const sourceId = draggedIdRef.current;
    if (canReorder && sourceId && targetId) {
      const sourceIds = requests.map((request) => request.id);
      const sourceIndex = sourceIds.indexOf(sourceId);
      const targetIndex = sourceIds.indexOf(targetId);
      if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
        const next = [...sourceIds];
        next.splice(sourceIndex, 1);
        next.splice(targetIndex, 0, sourceId);
        onReorderRequests(next);
      }
    }
    draggedIdRef.current = null;
    dragYRef.current = null;
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
    setDraggedId(null);
    setDraggedIndex(null);
  }

  function scrollWhileDragging() {
    const scroll = scrollRef.current;
    const y = dragYRef.current;
    if (!scroll || y === null || !draggedIdRef.current || !canReorder) {
      scrollFrameRef.current = null;
      return;
    }
    const rect = scroll.getBoundingClientRect();
    const edge = 48;
    const direction = y < rect.top + edge ? -1 : y > rect.bottom - edge ? 1 : 0;
    if (!direction) {
      scrollFrameRef.current = null;
      return;
    }
    scroll.scrollTop += direction * 20;
    scrollFrameRef.current = requestAnimationFrame(scrollWhileDragging);
  }

  function handleClick(id: string) {
    if (selectionMode) onToggleRequestSelection(id);
    else onSelectSavedRequest(id);
  }

  function renderRow(request: SavedRequest, index: number, position?: number) {
    const isActive = !selectionMode && activeSavedRequestId === request.id;
    const isSelected = selectedIds.has(request.id);
    const highlighted = isActive || (selectionMode && isSelected);
    return (
      <div
        key={request.id}
        data-index={index}
        data-request-id={request.id}
        ref={virtualized ? virtualizer.measureElement : undefined}
        style={virtualized ? { position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${position ?? 0}px)`, paddingBottom: 6 } : undefined}
        draggable={canReorder}
        onDragStart={() => { draggedIdRef.current = request.id; setDraggedId(request.id); setDraggedIndex(index); }}
        onDragEnd={() => finishDrag(null)}
        onDragOver={(event) => { if (canReorder) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); finishDrag(request.id); }}
        role="button"
        tabIndex={0}
        aria-label={request.name}
        aria-pressed={selectionMode ? isSelected : isActive}
        className={`cursor-pointer rounded-lg border p-2 text-xs transition ${highlighted
          ? "border-white/30 bg-white text-slate-950"
          : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
        } ${draggedId === request.id ? "opacity-50" : ""}`}
        onClick={() => handleClick(request.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick(request.id);
          }
        }}
      >
        <div className="flex items-start gap-1.5">
          {selectionMode ? (
            <input type="checkbox" checked={isSelected} className="mt-1"
              onClick={(event) => event.stopPropagation()}
              onChange={() => onToggleRequestSelection(request.id)} />
          ) : null}
          {canReorder ? (
            <span className="mt-0.5 cursor-grab text-slate-400 active:cursor-grabbing" title="拖拽排序" onClick={(event) => event.stopPropagation()}>
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-bold leading-snug">{request.name}</p>
              {request.lastStatus ? (
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-slate-700">{request.lastStatus}</span>
              ) : null}
            </div>
            {request.tags.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {request.tags.map((tag) => (
                  <span key={tag} className={`rounded-full px-1.5 py-px text-[9px] font-semibold ${highlighted ? "bg-slate-200 text-slate-700" : "bg-white/10 text-slate-300"}`}>{tag}</span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {!selectionMode ? (
          <div className="mt-1.5 flex justify-end gap-0.5">
            <Button variant="ghost" size="sm" className="h-7 w-7 px-0 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="编辑请求" aria-label="编辑请求"
              onClick={(event) => { event.stopPropagation(); onEditRequest(request); }}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 px-0 text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="复制请求" aria-label="复制请求"
              onClick={(event) => { event.stopPropagation(); onDuplicateRequest(request.id, request.name); }}><CopyPlus className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 px-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700" title="删除请求" aria-label="删除请求"
              onClick={(event) => { event.stopPropagation(); onDeleteRequest(request); }}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={scrollRef} data-testid="console-request-scroll" className="min-h-0 flex-1 overflow-y-auto mt-2"
      onDragOver={(event) => {
        if (!draggedIdRef.current || !canReorder) return;
        event.preventDefault();
        dragYRef.current = event.clientY;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientY >= rect.top + 48 && event.clientY <= rect.bottom - 48) {
          if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
          scrollFrameRef.current = null;
          return;
        }
        if (scrollFrameRef.current === null) scrollWhileDragging();
      }}
      onDragLeave={(event) => {
        if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return;
        dragYRef.current = null;
        if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }}
      onDrop={(event) => { event.preventDefault(); finishDrag(null); }}>
      {requests.length === 0 ? null : (
        <div className={virtualized ? "relative" : "space-y-1.5"} style={virtualized ? { height: virtualizer.getTotalSize() } : undefined}>
          {virtualized
            ? virtualizer.getVirtualItems().filter((item) => requests[item.index]).map((item) => renderRow(requests[item.index], item.index, item.start))
            : requests.map((request, index) => renderRow(request, index))}
        </div>
      )}
    </div>
  );
}

export const ConsoleRequestList = memo(ConsoleRequestListInner);
