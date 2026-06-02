import { GitCompare, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Switch } from "../ui/switch";
import { formatShanghaiDateTime } from "../../lib/time";
import type { RequestAnalysisResult } from "../../lib/request-analysis";
import {
  filterAiAnalysisHistory,
  resolveHistoryCompareEntries,
  toggleHistoryCompareSelection,
  type AiAnalysisHistoryEntry,
} from "../../types/ai-analysis-history";

type AiAnalysisDialogProps = {
  open: boolean;
  isAnalyzing: boolean;
  streamingReasoningText: string;
  streamingContentText: string;
  analysisResult: RequestAnalysisResult | null;
  analysisError: string | null;
  history: AiAnalysisHistoryEntry[];
  selectedHistoryId: string | null;
  currentConnectionId: string | null;
  currentConnectionName: string;
  aiEnabled: boolean;
  aiConfigured: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onApplySuggestion: () => void;
  onSelectHistory: (entryId: string | null) => void;
  onClearHistory: () => void;
  onReanalyze: () => void;
};

function AnalysisResultView({ result }: { result: RequestAnalysisResult }) {
  if (result.valid) {
    return (
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {result.source === "ai" ? "AI 分析结果" : "本地规则分析"}
        </p>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-800">格式正确</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{result.meaning}</p>
        </div>
        {result.details.length > 0 ? (
          <div>
            <p className="text-sm font-semibold text-slate-700">请求体说明</p>
            <ul className="mt-2 space-y-2 text-sm leading-7 text-slate-600">
              {result.details.map((detail) => (
                <li key={detail} className="rounded-xl bg-slate-50 px-3 py-2">
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        {result.source === "ai" ? "AI 分析结果" : "本地规则分析"}
      </p>
      <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3">
        <p className="text-sm font-semibold text-amber-800">格式存在问题</p>
        <ul className="mt-2 space-y-2 text-sm leading-7 text-slate-700">
          {result.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      </div>
      {result.suggestion ? (
        <div>
          <p className="text-sm font-semibold text-slate-700">可能正确的请求内容</p>
          <pre className="mt-2 overflow-x-auto rounded-2xl bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
            {result.suggestion}
          </pre>
        </div>
      ) : (
        <p className="text-sm leading-7 text-slate-500">暂时无法自动生成修正建议，请检查第一行 METHOD /path 与 JSON 请求体。</p>
      )}
    </div>
  );
}

function HistoryCompareColumn({ entry, label }: { entry: AiAnalysisHistoryEntry; label: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{entry.requestPreview}</p>
      <p className="mt-1 text-xs text-slate-500">
        {formatShanghaiDateTime(entry.createdAt)} · {entry.model}
        {entry.connectionName ? ` · ${entry.connectionName}` : ""}
      </p>
      <div className="mt-4">
        <p className="text-sm font-semibold text-slate-700">请求内容</p>
        <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-slate-950 px-3 py-3 text-xs leading-6 text-slate-100">
          {entry.requestContent}
        </pre>
      </div>
      <div className="mt-4">
        <AnalysisResultView result={entry.result} />
      </div>
    </div>
  );
}

export function AiAnalysisDialog({
  open,
  isAnalyzing,
  streamingReasoningText,
  streamingContentText,
  analysisResult,
  analysisError,
  history,
  selectedHistoryId,
  currentConnectionId,
  currentConnectionName,
  aiEnabled,
  aiConfigured,
  onClose,
  onOpenSettings,
  onApplySuggestion,
  onSelectHistory,
  onClearHistory,
  onReanalyze,
}: AiAnalysisDialogProps) {
  const [onlyCurrentConnection, setOnlyCurrentConnection] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [compareEntryIds, setCompareEntryIds] = useState<[string | null, string | null]>([null, null]);

  useEffect(() => {
    if (!open) {
      setCompareMode(false);
      setCompareEntryIds([null, null]);
    }
  }, [open]);

  const filteredHistory = useMemo(
    () =>
      filterAiAnalysisHistory(history, {
        connectionId: currentConnectionId,
        onlyCurrentConnection,
      }),
    [currentConnectionId, history, onlyCurrentConnection],
  );

  const selectedHistory = useMemo(
    () => filteredHistory.find((item) => item.id === selectedHistoryId) ?? null,
    [filteredHistory, selectedHistoryId],
  );

  const compareEntries = useMemo(
    () => resolveHistoryCompareEntries(filteredHistory, compareEntryIds),
    [compareEntryIds, filteredHistory],
  );

  const showCompareView = compareMode && compareEntries.left && compareEntries.right;
  const displayResult = selectedHistory?.result ?? analysisResult;
  const hasStreamingReasoning = streamingReasoningText.trim().length > 0;
  const hasStreamingContent = streamingContentText.trim().length > 0;
  const showStreaming = isAnalyzing && (hasStreamingReasoning || hasStreamingContent);

  function handleHistoryClick(entryId: string) {
    if (compareMode) {
      setCompareEntryIds((current) => toggleHistoryCompareSelection(current, entryId));
      onSelectHistory(null);
      return;
    }

    onSelectHistory(entryId);
    setCompareEntryIds([null, null]);
  }

  function isHistoryHighlighted(entryId: string) {
    if (compareMode) {
      return compareEntryIds[0] === entryId || compareEntryIds[1] === entryId;
    }

    return selectedHistoryId === entryId;
  }

  return (
    <Dialog
      open={open}
      title="AI 分析"
      description="仅校验请求格式并解释含义，不会连接 Elasticsearch 或读取索引数据。"
      panelClassName="max-w-6xl"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          {!aiEnabled || !aiConfigured ? (
            <Button variant="outline" onClick={onOpenSettings}>
              配置 AI
            </Button>
          ) : null}
          <Button variant="outline" onClick={onReanalyze} disabled={isAnalyzing}>
            重新分析
          </Button>
          {displayResult && !displayResult.valid && displayResult.suggestion && !selectedHistory && !showCompareView ? (
            <Button onClick={onApplySuggestion}>应用建议</Button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">分析历史</p>
              {filteredHistory.length > 0 ? (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearHistory}>
                  清空
                </Button>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800">仅当前连接</p>
                <p className="truncate text-[11px] text-slate-500">{currentConnectionName}</p>
              </div>
              <Switch checked={onlyCurrentConnection} onChange={(event) => setOnlyCurrentConnection(event.target.checked)} />
            </div>

            <Button
              variant={compareMode ? "default" : "outline"}
              size="sm"
              className="w-full"
              onClick={() => {
                setCompareMode((current) => !current);
                setCompareEntryIds([null, null]);
                onSelectHistory(null);
              }}
            >
              <GitCompare className="mr-2 h-4 w-4" />
              {compareMode ? "退出对比" : "历史对比"}
            </Button>

            {compareMode ? (
              <p className="text-[11px] leading-5 text-slate-500">
                依次点击两条历史记录进行并排对比。已选：{compareEntryIds.filter(Boolean).length}/2
              </p>
            ) : null}
          </div>

          {filteredHistory.length === 0 ? (
            <p className="px-1 text-xs leading-5 text-slate-500">
              {onlyCurrentConnection
                ? "当前连接还没有 AI 分析历史。"
                : "完成 AI 分析后会保存在这里，便于对比和回溯。"}
            </p>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {filteredHistory.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                    isHistoryHighlighted(entry.id)
                      ? "border-emerald-200 bg-white shadow-sm"
                      : "border-transparent bg-white/70 hover:border-slate-200 hover:bg-white"
                  }`}
                  onClick={() => handleHistoryClick(entry.id)}
                >
                  <p className="truncate text-xs font-semibold text-slate-800">{entry.requestPreview}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{formatShanghaiDateTime(entry.createdAt)}</p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {entry.result.valid ? "格式正确" : "格式有误"} · {entry.model}
                    {!onlyCurrentConnection && entry.connectionName ? ` · ${entry.connectionName}` : ""}
                  </p>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="min-w-0">
          {showCompareView && compareEntries.left && compareEntries.right ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <HistoryCompareColumn entry={compareEntries.left} label="记录 A" />
              <HistoryCompareColumn entry={compareEntries.right} label="记录 B" />
            </div>
          ) : (
            <>
              {selectedHistory ? (
                <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">历史记录</p>
                  <p className="mt-2 text-sm font-semibold text-slate-800">{selectedHistory.requestPreview}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatShanghaiDateTime(selectedHistory.createdAt)} · {selectedHistory.model}
                    {selectedHistory.connectionName ? ` · ${selectedHistory.connectionName}` : ""}
                  </p>
                </div>
              ) : null}

              {isAnalyzing && !showStreaming ? (
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                  正在分析请求格式...
                </div>
              ) : null}

              {showStreaming ? (
                <div className="space-y-4">
                  {hasStreamingReasoning ? (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-violet-500">思考过程</p>
                      <pre className="max-h-56 overflow-auto rounded-2xl border border-violet-100 bg-violet-50/70 px-4 py-3 text-xs leading-6 text-slate-700">
                        {streamingReasoningText}
                      </pre>
                    </div>
                  ) : null}

                  {hasStreamingContent ? (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {hasStreamingReasoning ? "生成结果" : "AI 流式输出"}
                      </p>
                      <pre className="max-h-[420px] overflow-auto rounded-2xl bg-slate-950 px-4 py-3 text-xs leading-6 text-emerald-100">
                        {streamingContentText}
                      </pre>
                    </div>
                  ) : hasStreamingReasoning ? (
                    <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                      思考完成，正在生成分析结果...
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!isAnalyzing && analysisError ? (
                <div className="rounded-2xl border border-rose-100 bg-rose-50/70 px-4 py-3">
                  <p className="text-sm font-semibold text-rose-800">分析失败</p>
                  <p className="mt-2 text-sm leading-7 text-slate-700">{analysisError}</p>
                </div>
              ) : null}

              {!isAnalyzing && !analysisError && displayResult ? <AnalysisResultView result={displayResult} /> : null}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
