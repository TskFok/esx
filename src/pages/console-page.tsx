import { useMutation } from "@tanstack/react-query";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Loader2,
  PanelLeftOpen,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ConsoleBulkTagsDialog } from "../components/console/console-bulk-tags-dialog";
import { ConsoleContextBreadcrumb } from "../components/console/console-context-breadcrumb";
import { ConsoleExportDialog } from "../components/console/console-export-dialog";
import { ConsoleImportDialog } from "../components/console/console-import-dialog";
import { ConsoleTemplateDialog } from "../components/console/console-template-dialog";
import { ConsoleEditor } from "../components/console/console-editor";
import { AiSettingsDialog } from "../components/console/ai-settings-dialog";
import { AiAnalysisDialog } from "../components/console/ai-analysis-dialog";
import { AiGenerateDialog } from "../components/console/ai-generate-dialog";
import { ConsoleRequestToolbar } from "../components/console/console-request-toolbar";
import { ConsoleMobileDrawer } from "../components/console/console-mobile-drawer";
import { ConsoleShortcutsDialog } from "../components/console/console-shortcuts-dialog";
import { ConsoleSidebarPanel } from "../components/console/console-sidebar-panel";
import { ResponseViewer } from "../components/console/response-viewer";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { buildConsoleAutocompleteContext, extractIndexNamesFromPath } from "../lib/console-autocomplete";
import {
  isConsoleAiAnalysisShortcut,
  isConsoleShortcutsHelpShortcut,
  shouldIgnoreConsoleShortcutTarget,
} from "../lib/console-shortcuts";
import {
  buildConsoleContextBreadcrumbSegments,
  computeSidebarWidthFromDrag,
  isConsoleSidebarToggleShortcut,
  readStoredConsoleSidebarVisible,
  readStoredConsoleSidebarWidth,
  resetConsoleSidebarWidth,
  writeStoredConsoleSidebarVisible,
  writeStoredConsoleSidebarWidth,
  type ConsoleContextBreadcrumbSegment,
} from "../lib/console-sidebar";
import {
  CONSOLE_EDITOR_SPLIT_STORAGE_KEY,
  computeEditorFractionFromDrag,
  readStoredConsoleEditorFraction,
} from "../lib/console-split";
import { lockPanelDragSelection } from "../lib/panel-drag-selection";
import { getConnectionRequests } from "../lib/request-list";
import {
  buildExportFilename,
  buildRequestExportPayload,
  downloadExportContent,
  downloadRequestExport,
  parseRequestImportFile,
  parseRequestImportPayload,
  type RequestExportPayload,
} from "../lib/request-import-export";
import {
  buildEncryptedExportFilename,
  encryptRequestExportPayload,
  isEncryptedRequestExportFile,
  serializeEncryptedRequestExportFile,
} from "../lib/request-export-crypto";
import type { RequestTemplate } from "../lib/request-templates";
import { formatTagsInput, parseTagsInput } from "../lib/request-tags";
import { buildConnectionLogContextFromProfile, buildRequestLogContext } from "../lib/error-logs";
import { extractUnknownErrorDiagnostics, extractUnknownErrorMessage, getResponseErrorMessage } from "../lib/errors";
import { executeConsoleRequest } from "../lib/http-client";
import { formatConsoleRequest, parseConsoleRequest } from "../lib/console-parser";
import { analyzeRequestContent, type RequestAnalysisResult } from "../lib/request-analysis";
import { fetchAiModels, isAiAnalysisConfigured, testAiConnection } from "../lib/ai-analysis-client";
import { generateRequestContent } from "../lib/ai-generate-client";
import { MIN_RESPONSE_PREVIEW_BYTES } from "../lib/response-snapshot";
import { getSearchSizeWarning } from "../lib/search-size-warning";
import { formatShanghaiDateTime } from "../lib/time";
import { formatBytes } from "../lib/utils";
import { useAppState } from "../providers/app-state";
import type { ConnectionProfile } from "../types/connections";
import type { SavedRequest } from "../types/requests";

type RunPayload = {
  connection: ConnectionProfile;
  content: string;
  overwriteRequestId: string | null;
  requestName: string;
};

const DRAFT_SAVE_DEBOUNCE_MS = 600;

function resolveDraftRequestName(preferredName: string, fallbackName: string | null | undefined, content: string) {
  const manualName = preferredName.trim() || fallbackName?.trim();
  if (manualName) {
    return manualName;
  }

  try {
    const parsed = parseConsoleRequest(content);
    return `${parsed.method} ${parsed.path}`;
  } catch {
    return "未命名请求";
  }
}

function buildDuplicateRequestName(sourceName: string, existingNames: string[]) {
  const occupiedNames = new Set(existingNames);
  let candidate = `${sourceName} 副本`;
  let index = 2;

  while (occupiedNames.has(candidate)) {
    candidate = `${sourceName} 副本 ${index}`;
    index += 1;
  }

  return candidate;
}

function buildUntitledRequestName(existingNames: string[]) {
  const occupiedNames = new Set(existingNames);
  let candidate = "未命名请求";
  let index = 2;

  while (occupiedNames.has(candidate)) {
    candidate = `未命名请求 ${index}`;
    index += 1;
  }

  return candidate;
}

export function ConsolePage() {
  const navigate = useNavigate();
  const {
    currentConnection,
    currentDraft,
    connections,
    requestsForCurrentConnection,
    searchMetadataByConnection,
    responsePreviewBytes,
    updateDraft,
    setResponsePreviewBytes,
    selectSavedRequest,
    saveRequestFromDraft,
    updateRequest,
    bulkUpdateRequestTags,
    deleteRequest,
    duplicateRequest,
    reorderConnectionRequests,
    importConnectionRequests,
    refreshSearchMetadata,
    ensureIndexFields,
    getPassword,
    getSshSecret,
    getSshProfileForConnection,
    recordErrorLog,
    aiSettings,
    aiApiKeyConfigured,
    aiAnalysisHistory,
    saveAiSettings,
    getAiApiKey,
    recordAiAnalysisHistory,
    clearAiAnalysisHistory,
  } = useAppState();
  const [sidebarVisible, setSidebarVisible] = useState(readStoredConsoleSidebarVisible);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredConsoleSidebarWidth);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const sidebarDragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [responseExpanded, setResponseExpanded] = useState(true);
  const [editorFraction, setEditorFraction] = useState(readStoredConsoleEditorFraction);
  const [isLgSplit, setIsLgSplit] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const [splitDragging, setSplitDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const splitDragRef = useRef<{ pointerId: number; startX: number; startFraction: number } | null>(null);
  const editorFractionRef = useRef(editorFraction);
  editorFractionRef.current = editorFraction;
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<SavedRequest | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedRequest | null>(null);
  const [requestName, setRequestName] = useState("");
  const [requestTagsInput, setRequestTagsInput] = useState("");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    rawJson: unknown;
    encrypted: boolean;
    payload: RequestExportPayload | null;
  } | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [bulkTagsDialogOpen, setBulkTagsDialogOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [responsePreviewInputKb, setResponsePreviewInputKb] = useState("");
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<RequestAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisStreamingReasoning, setAnalysisStreamingReasoning] = useState("");
  const [analysisStreamingContent, setAnalysisStreamingContent] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [aiSettingsDialogOpen, setAiSettingsDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateStreamingReasoning, setGenerateStreamingReasoning] = useState("");
  const [generateStreamingContent, setGenerateStreamingContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const analysisRequestRef = useRef(0);
  const generateRequestRef = useRef(0);
  const triggerAnalysisRef = useRef<() => void>(() => {});

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsLgSplit(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inDialog = Boolean(target?.closest('[role="dialog"]'));

      if (isConsoleSidebarToggleShortcut(event)) {
        if (inDialog) {
          return;
        }

        event.preventDefault();
        if (isLgSplit) {
          setSidebarVisible((current) => {
            const next = !current;
            writeStoredConsoleSidebarVisible(next);
            return next;
          });
        } else {
          setMobileDrawerOpen((current) => !current);
        }
        return;
      }

      if (isConsoleShortcutsHelpShortcut(event)) {
        if (shouldIgnoreConsoleShortcutTarget(target)) {
          return;
        }

        event.preventDefault();
        setShortcutsOpen((current) => !current);
        return;
      }

      if (isConsoleAiAnalysisShortcut(event)) {
        if (inDialog || shouldIgnoreConsoleShortcutTarget(target)) {
          return;
        }

        event.preventDefault();
        triggerAnalysisRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLgSplit]);

  useEffect(() => {
    if (isLgSplit) {
      setMobileDrawerOpen(false);
    }
  }, [isLgSplit]);

  const isPanelDragging = sidebarDragging || splitDragging;

  useEffect(() => {
    if (!isPanelDragging) {
      return;
    }

    return lockPanelDragSelection();
  }, [isPanelDragging]);

  const endSidebarDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = sidebarDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    sidebarDragRef.current = null;
    setSidebarDragging(false);
    writeStoredConsoleSidebarWidth(sidebarWidthRef.current);
  }, []);

  const handleSidebarPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isLgSplit || event.button !== 0) {
        return;
      }

      event.preventDefault();

      sidebarDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: sidebarWidthRef.current,
      };
      setSidebarDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [isLgSplit],
  );

  const handleSidebarPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = sidebarDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    const next = computeSidebarWidthFromDrag({
      startWidth: drag.startWidth,
      startClientX: drag.startX,
      currentClientX: event.clientX,
    });
    sidebarWidthRef.current = next;
    setSidebarWidth(next);
  }, []);

  const handleSidebarDoubleClick = useCallback(() => {
    const next = resetConsoleSidebarWidth();
    sidebarWidthRef.current = next;
    setSidebarWidth(next);
  }, []);

  const endSplitDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    splitDragRef.current = null;
    setSplitDragging(false);
    try {
      localStorage.setItem(CONSOLE_EDITOR_SPLIT_STORAGE_KEY, String(editorFractionRef.current));
    } catch {
      /* ignore */
    }
  }, []);

  const handleSplitPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isLgSplit || event.button !== 0) {
        return;
      }

      event.preventDefault();

      splitDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startFraction: editorFractionRef.current,
      };
      setSplitDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [isLgSplit],
  );

  const handleSplitPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    const pane = splitRef.current;
    if (!pane) {
      return;
    }

    const width = pane.getBoundingClientRect().width;
    const next = computeEditorFractionFromDrag({
      startFraction: drag.startFraction,
      startClientX: drag.startX,
      currentClientX: event.clientX,
      containerWidth: width,
    });
    editorFractionRef.current = next;
    setEditorFraction(next);
  }, []);

  const aiConfiguredForAnalysis =
    aiSettings.apiKeyRequired ? aiApiKeyConfigured : Boolean(aiSettings.baseUrl.trim() && aiSettings.model.trim());

  async function runAnalysis(content: string) {
    if (isAnalyzing) {
      return;
    }

    const requestId = analysisRequestRef.current + 1;
    analysisRequestRef.current = requestId;
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setAnalysisError(null);
    setAnalysisStreamingReasoning("");
    setAnalysisStreamingContent("");
    setSelectedHistoryId(null);
    setAnalysisDialogOpen(true);

    try {
      const apiKey = await getAiApiKey();
      const useAiStream = isAiAnalysisConfigured(aiSettings, apiKey);
      const result = await analyzeRequestContent({
        content,
        aiSettings,
        apiKey,
        onStreamDelta: useAiStream
          ? (delta) => {
              if (analysisRequestRef.current !== requestId) {
                return;
              }

              if (delta.kind === "reasoning") {
                setAnalysisStreamingReasoning((current) => current + delta.text);
                return;
              }

              setAnalysisStreamingContent((current) => current + delta.text);
            }
          : undefined,
      });

      if (analysisRequestRef.current !== requestId) {
        return;
      }

      setAnalysisResult(result);
      setAnalysisStreamingReasoning("");
    setAnalysisStreamingContent("");

      if (result.source === "ai") {
        recordAiAnalysisHistory({
          connectionId: currentConnection?.id ?? null,
          connectionName: currentConnection?.name ?? null,
          requestContent: content,
          result,
        });
      } else if (aiSettings.enabled && isAiAnalysisConfigured(aiSettings, apiKey)) {
        toast.message("AI 分析失败，已回退到本地规则分析。");
      }
    } catch (error) {
      if (analysisRequestRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : "AI 分析失败";
      setAnalysisError(message);
      setAnalysisStreamingReasoning("");
    setAnalysisStreamingContent("");
    } finally {
      if (analysisRequestRef.current === requestId) {
        setIsAnalyzing(false);
      }
    }
  }

  const runMutation = useMutation({
    mutationFn: async (payload: RunPayload) => {
      const sshProfile = getSshProfileForConnection(payload.connection);
      const [password, sshSecret] = await Promise.all([getPassword(payload.connection), getSshSecret(sshProfile)]);

      if (!password) {
        throw new Error("当前连接未找到已保存密码，请回到连接页重新保存。");
      }

      const request = parseConsoleRequest(payload.content);
      return executeConsoleRequest(payload.connection, { password, sshSecret }, request, sshProfile?.tunnel ?? null, {
        responsePreviewBytes,
      });
    },
    onSuccess(response, payload) {
      let saveErrorMessage: string | null = null;

      try {
        saveRequestFromDraft({
          connectionId: payload.connection.id,
          name: payload.requestName,
          content: payload.content,
          response,
          overwriteRequestId: payload.overwriteRequestId,
        });
      } catch (error) {
        saveErrorMessage = error instanceof Error ? error.message : "保存失败";
      }

      if (!response.ok) {
        const message = getResponseErrorMessage(response, "请求失败");
        recordErrorLog({
          scope: "request-execution",
          title: "请求执行失败",
          summary: message,
          diagnostics: response.diagnostics,
          status: response.status,
          rawResponse: response.bodyPreview,
          connection: buildConnectionLogContextFromProfile(payload.connection, getSshProfileForConnection(payload.connection)),
          request: buildRequestLogContext(payload.content),
        });

        if (saveErrorMessage) {
          toast.error(`${message}，且${saveErrorMessage}`);
          return;
        }

        toast.error(`${message}，当前请求已保存。`);
        return;
      }

      if (saveErrorMessage) {
        toast.error(`请求已完成，但${saveErrorMessage}`);
        return;
      }

      toast.success("请求已完成并保存。");
    },
    onError(error, payload) {
      const message = extractUnknownErrorMessage(error, "请求失败");
      toast.error(message);

      recordErrorLog({
        scope: "request-execution",
        title: "请求执行异常",
        summary: message,
        diagnostics: extractUnknownErrorDiagnostics(error),
        connection: buildConnectionLogContextFromProfile(payload.connection, getSshProfileForConnection(payload.connection)),
        request: buildRequestLogContext(payload.content),
      });
    },
  });

  const activeConnection = currentConnection;
  const draft = currentDraft;
  const connectionRequests = useMemo(
    () => (activeConnection ? getConnectionRequests(activeConnection.id, requestsForCurrentConnection) : []),
    [activeConnection, requestsForCurrentConnection],
  );

  const activeRequest = draft?.activeSavedRequestId
    ? requestsForCurrentConnection.find((item) => item.id === draft.activeSavedRequestId) ?? null
    : null;
  const response = draft?.response ?? null;

  useEffect(() => {
    setResponsePreviewInputKb(String(Math.round(responsePreviewBytes / 1024)));
  }, [responsePreviewBytes]);

  if (!activeConnection || !draft) {
    return <Navigate to="/connections" replace />;
  }

  const selectedConnection = activeConnection;
  const activeDraftState = draft;
  const draftKey = `${selectedConnection.id}:${activeDraftState.activeSavedRequestId ?? "__draft__"}`;
  const [editorContent, setEditorContent] = useState(activeDraftState.content);
  const editorContentRef = useRef(activeDraftState.content);
  const latestDraftContentRef = useRef(activeDraftState.content);
  const lastFlushedContentRef = useRef(activeDraftState.content);
  const lastDraftKeyRef = useRef(draftKey);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataAutoRefreshRef = useRef<Record<string, string>>({});
  const connectionSearchMetadata = searchMetadataByConnection[selectedConnection.id] ?? null;

  const clearDraftSaveTimer = useCallback(() => {
    if (!draftSaveTimerRef.current) {
      return;
    }

    clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = null;
  }, []);

  const flushEditorContent = useCallback(() => {
    clearDraftSaveTimer();
    const nextContent = editorContentRef.current;
    if (nextContent === latestDraftContentRef.current) {
      return;
    }

    lastFlushedContentRef.current = nextContent;
    latestDraftContentRef.current = nextContent;
    updateDraft(selectedConnection.id, (currentDraftState) => ({
      ...currentDraftState,
      content: nextContent,
    }));
  }, [clearDraftSaveTimer, selectedConnection.id, updateDraft]);

  const updateEditorContent = useCallback(
    (value: string) => {
      editorContentRef.current = value;
      setEditorContent(value);
      clearDraftSaveTimer();
      draftSaveTimerRef.current = setTimeout(() => {
        flushEditorContent();
      }, DRAFT_SAVE_DEBOUNCE_MS);
    },
    [clearDraftSaveTimer, flushEditorContent],
  );
  const flushEditorContentRef = useRef(flushEditorContent);

  useEffect(() => {
    flushEditorContentRef.current = flushEditorContent;
  }, [flushEditorContent]);

  useEffect(() => {
    latestDraftContentRef.current = activeDraftState.content;
  }, [activeDraftState.content]);

  useEffect(() => {
    if (lastDraftKeyRef.current !== draftKey) {
      clearDraftSaveTimer();
      lastDraftKeyRef.current = draftKey;
      lastFlushedContentRef.current = activeDraftState.content;
      latestDraftContentRef.current = activeDraftState.content;
      editorContentRef.current = activeDraftState.content;
      setEditorContent(activeDraftState.content);
      return;
    }

    if (
      activeDraftState.content !== lastFlushedContentRef.current &&
      activeDraftState.content !== editorContentRef.current
    ) {
      clearDraftSaveTimer();
      lastFlushedContentRef.current = activeDraftState.content;
      latestDraftContentRef.current = activeDraftState.content;
      editorContentRef.current = activeDraftState.content;
      setEditorContent(activeDraftState.content);
    }
  }, [activeDraftState.content, clearDraftSaveTimer, draftKey]);

  useEffect(() => () => flushEditorContentRef.current(), []);

  const autocompleteContext = useMemo(
    () => buildConsoleAutocompleteContext(requestsForCurrentConnection, editorContent, connectionSearchMetadata),
    [requestsForCurrentConnection, editorContent, connectionSearchMetadata],
  );

  async function runGeneration(description: string) {
    if (isGenerating) {
      return;
    }

    const requestId = generateRequestRef.current + 1;
    generateRequestRef.current = requestId;
    setIsGenerating(true);
    setGeneratedContent(null);
    setGenerateError(null);
    setGenerateStreamingReasoning("");
    setGenerateStreamingContent("");

    try {
      const apiKey = await getAiApiKey();
      const useAiStream = isAiAnalysisConfigured(aiSettings, apiKey);
      const content = await generateRequestContent({
        description,
        aiSettings,
        apiKey,
        context: {
          indexNames: autocompleteContext.indexNames,
          aliasNames: autocompleteContext.aliasNames,
        },
        onStreamDelta: useAiStream
          ? (delta) => {
              if (generateRequestRef.current !== requestId) {
                return;
              }

              if (delta.kind === "reasoning") {
                setGenerateStreamingReasoning((current) => current + delta.text);
                return;
              }

              setGenerateStreamingContent((current) => current + delta.text);
            }
          : undefined,
      });

      if (generateRequestRef.current !== requestId) {
        return;
      }

      setGeneratedContent(content);
      setGenerateStreamingReasoning("");
      setGenerateStreamingContent("");
    } catch (error) {
      if (generateRequestRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : "AI 生成失败";
      setGenerateError(message);
      setGenerateStreamingReasoning("");
      setGenerateStreamingContent("");
    } finally {
      if (generateRequestRef.current === requestId) {
        setIsGenerating(false);
      }
    }
  }

  const metadataRefreshMutation = useMutation({
    mutationFn: async (payload: { force: boolean }) => refreshSearchMetadata(selectedConnection, payload),
    onError(error, payload) {
      if (!payload.force) {
        return;
      }

      toast.error(error instanceof Error ? error.message : "索引元数据刷新失败");
    },
  });

  useEffect(() => {
    if (metadataRefreshMutation.isPending) {
      return;
    }

    if (connectionSearchMetadata && new Date(connectionSearchMetadata.expiresAt).getTime() > Date.now()) {
      return;
    }

    const refreshKey = `${selectedConnection.id}:${selectedConnection.updatedAt}:${connectionSearchMetadata?.expiresAt ?? "missing"}`;
    if (metadataAutoRefreshRef.current[selectedConnection.id] === refreshKey) {
      return;
    }

    metadataAutoRefreshRef.current[selectedConnection.id] = refreshKey;
    void metadataRefreshMutation.mutateAsync({ force: false }).catch(() => undefined);
  }, [connectionSearchMetadata?.expiresAt, metadataRefreshMutation, selectedConnection.id, selectedConnection.updatedAt]);

  const indexFieldsAttemptedRef = useRef<Record<string, Set<string>>>({});
  useEffect(() => {
    if (!connectionSearchMetadata) {
      return;
    }
    indexFieldsAttemptedRef.current[selectedConnection.id] = new Set<string>();
  }, [connectionSearchMetadata?.fetchedAt, selectedConnection.id]);

  const currentPathIndexNamesKey = useMemo(() => {
    const firstLine = editorContent.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (!firstLine) {
      return "";
    }
    const [, ...pathParts] = firstLine.split(/\s+/);
    return extractIndexNamesFromPath(pathParts.join(" ").trim()).join(",");
  }, [editorContent]);
  const currentPathIndexNames = useMemo(
    () => (currentPathIndexNamesKey ? currentPathIndexNamesKey.split(",") : []),
    [currentPathIndexNamesKey],
  );

  useEffect(() => {
    if (currentPathIndexNames.length === 0 || !connectionSearchMetadata) {
      return;
    }
    const connectionId = selectedConnection.id;
    const attempted = (indexFieldsAttemptedRef.current[connectionId] ??= new Set<string>());
    const fieldsByIndex = connectionSearchMetadata.fieldsByIndex ?? {};
    const aliasToIndices = connectionSearchMetadata.aliasToIndices ?? {};

    currentPathIndexNames.forEach((name) => {
      if (attempted.has(name)) {
        return;
      }
      const directCached = (fieldsByIndex[name]?.length ?? 0) > 0;
      if (directCached) {
        return;
      }
      const aliasTargets = aliasToIndices[name] ?? [];
      const aliasCached =
        aliasTargets.length > 0 && aliasTargets.every((indexName) => (fieldsByIndex[indexName]?.length ?? 0) > 0);
      if (aliasCached) {
        return;
      }

      attempted.add(name);
      void ensureIndexFields(selectedConnection, name).catch(() => {
        attempted.delete(name);
      });
    });
  }, [
    currentPathIndexNames,
    ensureIndexFields,
    connectionSearchMetadata,
    selectedConnection,
  ]);

  function handleRefreshSearchMetadata() {
    indexFieldsAttemptedRef.current[selectedConnection.id] = new Set<string>();
    void metadataRefreshMutation.mutateAsync({ force: true }).then(() => {
      toast.success("索引元数据已刷新。");
    }).catch(() => undefined);
  }

  const hasMetadataAutoAttempted = Boolean(metadataAutoRefreshRef.current[selectedConnection.id]);
  const metadataStatus = connectionSearchMetadata
    ? new Date(connectionSearchMetadata.expiresAt).getTime() > Date.now()
      ? `索引元数据已同步：${formatShanghaiDateTime(connectionSearchMetadata.fetchedAt)}`
      : `索引元数据已过期：${formatShanghaiDateTime(connectionSearchMetadata.fetchedAt)}`
    : metadataRefreshMutation.isPending
      ? "正在拉取索引 / alias 元数据..."
      : hasMetadataAutoAttempted
        ? "索引元数据自动拉取失败，可手动重试。"
        : "首次进入时会自动拉取索引 / alias 元数据。";

  function handleFormatJson() {
    const content = editorContentRef.current;
    if (!content.trim()) {
      return;
    }

    try {
      const formatted = formatConsoleRequest(content);
      editorContentRef.current = formatted;
      setEditorContent(formatted);
      lastFlushedContentRef.current = formatted;
      latestDraftContentRef.current = formatted;
      clearDraftSaveTimer();
      updateDraft(selectedConnection.id, (currentDraftState) => ({ ...currentDraftState, content: formatted }));
      toast.success("请求已格式化。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "格式化失败");
    }
  }

  function handleAnalyzeRequest() {
    const content = editorContentRef.current;
    void runAnalysis(content);
  }

  function handleOpenGenerateDialog() {
    setGeneratedContent(null);
    setGenerateError(null);
    setGenerateStreamingReasoning("");
    setGenerateStreamingContent("");
    setGenerateDialogOpen(true);
  }

  function handleApplyGeneratedContent() {
    if (!generatedContent) {
      return;
    }

    editorContentRef.current = generatedContent;
    setEditorContent(generatedContent);
    lastFlushedContentRef.current = generatedContent;
    latestDraftContentRef.current = generatedContent;
    clearDraftSaveTimer();
    updateDraft(selectedConnection.id, (currentDraftState) => ({ ...currentDraftState, content: generatedContent }));
    setGenerateDialogOpen(false);
    toast.success("已应用 AI 生成的请求内容。");
  }

  triggerAnalysisRef.current = handleAnalyzeRequest;

  async function handleSaveAiSettings(payload: {
    settings: typeof aiSettings;
    apiKey: string | null;
    clearApiKey: boolean;
  }) {
    try {
      await saveAiSettings(payload);
      toast.success("AI 分析设置已保存。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存 AI 设置失败");
      throw error;
    }
  }

  async function handleTestAiConnection(payload: { settings: typeof aiSettings; apiKey: string }) {
    return testAiConnection(payload);
  }

  async function handleFetchAiModels(payload: { settings: typeof aiSettings; apiKey: string }) {
    return fetchAiModels(payload);
  }

  function handleApplyAnalysisSuggestion() {
    if (!analysisResult || analysisResult.valid || !analysisResult.suggestion) {
      return;
    }

    const suggestion = analysisResult.suggestion;
    editorContentRef.current = suggestion;
    setEditorContent(suggestion);
    lastFlushedContentRef.current = suggestion;
    latestDraftContentRef.current = suggestion;
    clearDraftSaveTimer();
    updateDraft(selectedConnection.id, (currentDraftState) => ({ ...currentDraftState, content: suggestion }));
    setAnalysisDialogOpen(false);
    toast.success("已应用建议的请求内容。");
  }

  function handleRunAndSave() {
    if (runMutation.isPending) {
      return;
    }

    const content = editorContentRef.current;
    flushEditorContent();
    const searchSizeWarning = getSearchSizeWarning(content);
    if (searchSizeWarning) {
      toast.warning(searchSizeWarning.message);
    }

    runMutation.mutate({
      connection: selectedConnection,
      content,
      overwriteRequestId: activeDraftState.activeSavedRequestId,
      requestName: resolveDraftRequestName(activeDraftState.name, activeRequest?.name, content),
    });
  }

  function handleCreateRequest() {
    flushEditorContent();
    const request = saveRequestFromDraft({
      connectionId: selectedConnection.id,
      name: buildUntitledRequestName(requestsForCurrentConnection.map((item) => item.name)),
      content: "GET /_cluster/health",
      response: null,
    });

    selectSavedRequest(request.id);
    toast.success("已新建请求。");
  }

  function handleSelectSavedRequest(requestId: string) {
    flushEditorContent();
    selectSavedRequest(requestId);
  }

  function handleDuplicateRequest(requestId: string, requestNameValue: string) {
    try {
      flushEditorContent();
      const duplicated = duplicateRequest(
        requestId,
        buildDuplicateRequestName(
          requestNameValue,
          requestsForCurrentConnection.map((item) => item.name),
        ),
      );
      selectSavedRequest(duplicated.id);
      toast.success(`已复制为“${duplicated.name}”。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制失败");
    }
  }

  function openEditRequestDialog(request: SavedRequest) {
    setEditingRequest(request);
    setRequestName(request.name);
    setRequestTagsInput(formatTagsInput(request.tags));
    setRequestDialogOpen(true);
  }

  function submitRequestDialog() {
    if (!editingRequest) {
      return;
    }

    updateRequest(editingRequest.id, {
      name: requestName,
      tags: parseTagsInput(requestTagsInput),
    });
    setRequestDialogOpen(false);
    setEditingRequest(null);
    setRequestName("");
    setRequestTagsInput("");
    toast.success("请求已更新。");
  }

  function handleExportClick() {
    setExportDialogOpen(true);
  }

  async function handleConfirmExport(payload: { encrypt: boolean; password: string }) {
    setExporting(true);
    try {
      const exportPayload = buildRequestExportPayload(selectedConnection.name, connectionRequests);
      if (payload.encrypt) {
        const encrypted = await encryptRequestExportPayload(exportPayload, payload.password);
        downloadExportContent(
          serializeEncryptedRequestExportFile(encrypted),
          buildEncryptedExportFilename(selectedConnection.name),
        );
      } else {
        downloadRequestExport(exportPayload, buildExportFilename(selectedConnection.name));
      }

      setExportDialogOpen(false);
      toast.success(`已导出 ${exportPayload.requests.length} 条请求。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFileSelected(file: File) {
    try {
      const rawJson = JSON.parse(await file.text());
      const encrypted = isEncryptedRequestExportFile(rawJson);
      setPendingImport({
        fileName: file.name,
        rawJson,
        encrypted,
        payload: encrypted ? null : parseRequestImportPayload(rawJson),
      });
      setImportError(null);
      setImportDialogOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法读取导入文件");
    }
  }

  async function handleConfirmImport(payload: {
    connectionId: string;
    mode: "merge" | "replace";
    password: string;
  }) {
    if (!pendingImport) {
      return;
    }

    setImporting(true);
    setImportError(null);

    try {
      const parsed = pendingImport.encrypted
        ? await parseRequestImportFile(pendingImport.rawJson, payload.password)
        : pendingImport.payload;
      if (!parsed) {
        throw new Error("无法解析导入文件。");
      }

      const imported = importConnectionRequests(payload.connectionId, parsed.requests, payload.mode);
      setImportDialogOpen(false);
      setPendingImport(null);
      toast.success(
        payload.mode === "merge"
          ? `已合并导入 ${imported.length} 条请求。`
          : `已替换为 ${imported.length} 条导入请求。`,
      );
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  function handleReorderRequests(orderedRequestIds: string[]) {
    reorderConnectionRequests(selectedConnection.id, orderedRequestIds);
  }

  function handleToggleSelectionMode() {
    setSelectionMode((current) => {
      if (current) {
        setSelectedRequestIds([]);
      }
      return !current;
    });
  }

  function handleToggleRequestSelection(requestId: string) {
    setSelectedRequestIds((current) =>
      current.includes(requestId) ? current.filter((id) => id !== requestId) : [...current, requestId],
    );
  }

  function handleApplyBulkTags(payload: { add: string[]; remove: string[] }) {
    const count = selectedRequestIds.length;
    bulkUpdateRequestTags(selectedRequestIds, payload);
    setBulkTagsDialogOpen(false);
    setSelectedRequestIds([]);
    setSelectionMode(false);
    toast.success(`已更新 ${count} 条请求的标签。`);
  }

  function handleApplyTemplate(template: RequestTemplate) {
    editorContentRef.current = template.content;
    setEditorContent(template.content);
    lastFlushedContentRef.current = template.content;
    latestDraftContentRef.current = template.content;
    clearDraftSaveTimer();
    updateDraft(selectedConnection.id, (currentDraftState) => ({
      ...currentDraftState,
      content: template.content,
      name: currentDraftState.name.trim() || template.name,
    }));
    setTemplateDialogOpen(false);
    toast.success(`已插入模板“${template.name}”。`);
  }

  function handleDeleteRequest(request: SavedRequest) {
    setPendingDelete(request);
  }

  function submitDeleteDialog() {
    if (!pendingDelete) {
      return;
    }

    deleteRequest(pendingDelete.id);
    toast.success("请求已删除。");
    setPendingDelete(null);
  }

  const minResponsePreviewKb = Math.round(MIN_RESPONSE_PREVIEW_BYTES / 1024);

  function openSidebar() {
    if (isLgSplit) {
      setSidebarVisible(true);
      writeStoredConsoleSidebarVisible(true);
      return;
    }

    setMobileDrawerOpen(true);
  }

  function closeSidebar() {
    if (isLgSplit) {
      setSidebarVisible(false);
      writeStoredConsoleSidebarVisible(false);
      return;
    }

    setMobileDrawerOpen(false);
  }

  function toggleSidebar() {
    if (isLgSplit) {
      setSidebarVisible((current) => {
        const next = !current;
        writeStoredConsoleSidebarVisible(next);
        return next;
      });
      return;
    }

    setMobileDrawerOpen((current) => !current);
  }

  function handleBreadcrumbSegmentClick(segment: ConsoleContextBreadcrumbSegment) {
    openSidebar();

    if (segment.kind === "connection") {
      return;
    }

    if (segment.kind === "request" && segment.requestId) {
      flushEditorContent();
      selectSavedRequest(segment.requestId);
      if (!isLgSplit) {
        setMobileDrawerOpen(false);
      }
    }
  }

  function commitResponsePreviewInput() {
    const nextKilobytes = Number(responsePreviewInputKb);
    if (!Number.isFinite(nextKilobytes)) {
      setResponsePreviewInputKb(String(Math.round(responsePreviewBytes / 1024)));
      return;
    }

    const nextBytes = Math.round(nextKilobytes * 1024);
    setResponsePreviewBytes(nextBytes);
  }

  const responseSummary = response
    ? `${response.status || "FAILED"} ${response.statusText} · ${response.durationMs} ms · ${formatShanghaiDateTime(response.executedAt)} · 预览上限 ${formatBytes(responsePreviewBytes)}`
    : runMutation.isPending
      ? "请求执行中..."
      : "按 Command + Enter 运行并保存后，这里会显示返回内容。";

  const responseFallbackValue = runMutation.isPending
    ? '{\n  "message": "请求执行中..."\n}'
    : '{\n  "message": "按 Command + Enter 运行并保存后，这里会显示返回内容。"\n}';

  const breadcrumbSegments = buildConsoleContextBreadcrumbSegments({
    connectionName: selectedConnection.name,
    savedRequest: activeRequest,
    draftName: activeDraftState.name,
  });

  const showDockedSidebar = sidebarVisible && isLgSplit;
  const showContextBar = !isLgSplit || !sidebarVisible;

  const sidebarPanel = (
    <ConsoleSidebarPanel
      connectionName={selectedConnection.name}
      requests={connectionRequests}
      activeSavedRequestId={activeDraftState.activeSavedRequestId}
      closeTitle={isLgSplit ? "隐藏侧边栏 (⌘B)" : "关闭抽屉 (⌘B)"}
      onClose={closeSidebar}
      onNavigateConnections={() => navigate("/connections")}
      onNavigateStatus={() => navigate("/status")}
      onNavigateLogs={() => navigate("/logs")}
      onCreateRequest={handleCreateRequest}
      onExportClick={handleExportClick}
      onImportFileSelected={handleImportFileSelected}
      onSelectSavedRequest={(requestId) => {
        handleSelectSavedRequest(requestId);
        if (!isLgSplit) {
          setMobileDrawerOpen(false);
        }
      }}
      onEditRequest={openEditRequestDialog}
      onDuplicateRequest={handleDuplicateRequest}
      onDeleteRequest={handleDeleteRequest}
      onReorderRequests={handleReorderRequests}
      selectionMode={selectionMode}
      selectedRequestIds={selectedRequestIds}
      onToggleSelectionMode={handleToggleSelectionMode}
      onToggleRequestSelection={handleToggleRequestSelection}
      onSelectAllVisible={(requestIds) => setSelectedRequestIds(requestIds)}
      onClearSelection={() => setSelectedRequestIds([])}
      onOpenBulkTags={() => setBulkTagsDialogOpen(true)}
    />
  );

  return (
    <div className="h-dvh overflow-hidden p-4 sm:p-6" onContextMenu={(event) => event.preventDefault()}>
      <div
        className={`flex h-full min-h-0 gap-3 ${showDockedSidebar ? "lg:flex-row" : ""} ${
          sidebarDragging ? "select-none" : ""
        }`}
        style={sidebarDragging ? { cursor: "col-resize" } : undefined}
      >
        {showDockedSidebar ? (
          <>
            <aside
              className="hidden min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl bg-slate-950 px-3 py-3 text-slate-50 shadow-xl shadow-slate-900/25 lg:flex"
              style={{ width: sidebarWidth }}
            >
              {sidebarPanel}
            </aside>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动调整侧边栏宽度，双击恢复默认宽度"
              title="拖动调整宽度，双击恢复默认宽度"
              className={`hidden w-2 shrink-0 cursor-col-resize select-none lg:flex lg:items-stretch lg:justify-center lg:active:bg-slate-100 ${
                sidebarDragging ? "lg:bg-emerald-50" : "lg:hover:bg-slate-50"
              }`}
              onPointerDown={handleSidebarPointerDown}
              onPointerMove={handleSidebarPointerMove}
              onPointerUp={endSidebarDrag}
              onPointerCancel={endSidebarDrag}
              onLostPointerCapture={endSidebarDrag}
              onDoubleClick={handleSidebarDoubleClick}
            >
              <div className="pointer-events-none my-3 w-px flex-1 rounded-full bg-slate-200 shadow-sm lg:hover:bg-emerald-400" />
            </div>
          </>
        ) : null}

        <ConsoleMobileDrawer open={mobileDrawerOpen && !isLgSplit} onClose={closeSidebar}>
          {sidebarPanel}
        </ConsoleMobileDrawer>

        <main className="min-h-0 min-w-0 flex-1">
          <Card className="flex h-full min-h-0 min-w-0 flex-col p-5 sm:p-6">
            {showContextBar ? (
              <div className="mb-3 flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
                <Button
                  variant="outline"
                  className="shrink-0 self-start"
                  title="显示连接与请求 (⌘B)"
                  aria-label="显示连接与请求"
                  onClick={toggleSidebar}
                >
                  <PanelLeftOpen className="mr-2 h-4 w-4" />
                  连接与请求
                </Button>
                <ConsoleContextBreadcrumb
                  segments={breadcrumbSegments}
                  onSegmentClick={handleBreadcrumbSegmentClick}
                />
              </div>
            ) : null}
            <ConsoleRequestToolbar
              requestName={activeDraftState.name}
              isAnalyzing={isAnalyzing}
              isGenerating={isGenerating}
              onRequestNameChange={(value) =>
                updateDraft(selectedConnection.id, (currentDraftState) => ({
                  ...currentDraftState,
                  name: value,
                }))
              }
              onRunAndSave={handleRunAndSave}
              onFormatJson={handleFormatJson}
              onAnalyze={handleAnalyzeRequest}
              onGenerate={handleOpenGenerateDialog}
              onOpenTemplates={() => setTemplateDialogOpen(true)}
              onOpenAiSettings={() => setAiSettingsDialogOpen(true)}
              onOpenShortcuts={() => setShortcutsOpen(true)}
            />

            <div
              ref={splitRef}
              className={`mt-4 flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-0 ${
                splitDragging ? "select-none" : ""
              }`}
              style={splitDragging ? { cursor: "col-resize" } : undefined}
            >
              <Card
                className={`flex min-h-[360px] min-w-0 flex-col overflow-hidden border border-slate-200 bg-white lg:min-h-0 ${
                  isLgSplit ? "lg:shrink-0" : ""
                } ${splitDragging ? "pointer-events-none" : ""}`}
                style={isLgSplit ? { width: `${editorFraction * 100}%` } : undefined}
              >
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-900">请求内容</p>
                      <p className="mt-1 text-xs text-slate-500">Command + Enter 运行并保存</p>
                      <p className="mt-1 text-xs text-slate-500">{metadataStatus}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRefreshSearchMetadata}
                      disabled={metadataRefreshMutation.isPending}
                    >
                      {metadataRefreshMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Boxes className="mr-2 h-4 w-4" />
                      )}
                      刷新索引
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 p-4">
                  <ConsoleEditor
                    autocompleteContext={autocompleteContext}
                    onRunShortcut={handleRunAndSave}
                    onAnalyzeShortcut={handleAnalyzeRequest}
                    value={editorContent}
                    onChange={updateEditorContent}
                  />
                </div>
              </Card>

              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整请求区与返回区宽度"
                className={`hidden w-2 shrink-0 cursor-col-resize select-none lg:flex lg:items-stretch lg:justify-center lg:active:bg-slate-100 ${
                  splitDragging ? "lg:bg-emerald-50" : "lg:hover:bg-slate-50"
                }`}
                onPointerDown={handleSplitPointerDown}
                onPointerMove={handleSplitPointerMove}
                onPointerUp={endSplitDrag}
                onPointerCancel={endSplitDrag}
                onLostPointerCapture={endSplitDrag}
              >
                <div className="pointer-events-none my-3 w-px flex-1 rounded-full bg-slate-200 shadow-sm lg:hover:bg-emerald-400" />
              </div>

              <Card
                className={`flex min-w-0 flex-col overflow-hidden border border-slate-200 bg-white lg:min-h-0 lg:min-w-0 lg:flex-1 ${
                  responseExpanded ? "min-h-[360px]" : "self-start"
                } ${splitDragging ? "pointer-events-none" : ""}`}
              >
                <div className={`${responseExpanded ? "border-b" : ""} border-slate-100 px-5 py-4`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-900">返回内容</p>
                        {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{responseSummary}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        预览 KB
                        <Input
                          className="h-9 w-24 rounded-xl px-3 py-2 text-xs"
                          inputMode="numeric"
                          min={minResponsePreviewKb}
                          step={64}
                          type="number"
                          value={responsePreviewInputKb}
                          onBlur={commitResponsePreviewInput}
                          onChange={(event) => setResponsePreviewInputKb(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing || event.key !== "Enter") {
                              return;
                            }

                            event.preventDefault();
                            commitResponsePreviewInput();
                            event.currentTarget.blur();
                          }}
                        />
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-controls="console-response-body"
                        aria-expanded={responseExpanded}
                        onClick={() => setResponseExpanded((current) => !current)}
                      >
                        {responseExpanded ? (
                          <ChevronDown className="mr-2 h-4 w-4" />
                        ) : (
                          <ChevronRight className="mr-2 h-4 w-4" />
                        )}
                        {responseExpanded ? "收起" : "展开"}
                      </Button>
                    </div>
                  </div>
                </div>
                {responseExpanded ? (
                  <div id="console-response-body" className="min-h-0 flex-1 p-4">
                    <ResponseViewer response={response} fallbackValue={responseFallbackValue} />
                  </div>
                ) : null}
              </Card>
            </div>
          </Card>
        </main>
      </div>

      <AiAnalysisDialog
        open={analysisDialogOpen}
        isAnalyzing={isAnalyzing}
        streamingReasoningText={analysisStreamingReasoning}
        streamingContentText={analysisStreamingContent}
        analysisResult={analysisResult}
        analysisError={analysisError}
        history={aiAnalysisHistory}
        selectedHistoryId={selectedHistoryId}
        currentConnectionId={selectedConnection.id}
        currentConnectionName={selectedConnection.name}
        aiEnabled={aiSettings.enabled}
        aiConfigured={aiConfiguredForAnalysis}
        onClose={() => setAnalysisDialogOpen(false)}
        onOpenSettings={() => setAiSettingsDialogOpen(true)}
        onApplySuggestion={handleApplyAnalysisSuggestion}
        onSelectHistory={setSelectedHistoryId}
        onClearHistory={() => {
          clearAiAnalysisHistory();
          setSelectedHistoryId(null);
          toast.success("分析历史已清空。");
        }}
        onReanalyze={() => {
          void runAnalysis(editorContentRef.current);
        }}
      />

      <AiGenerateDialog
        open={generateDialogOpen}
        isGenerating={isGenerating}
        streamingReasoningText={generateStreamingReasoning}
        streamingContentText={generateStreamingContent}
        generatedContent={generatedContent}
        generateError={generateError}
        aiEnabled={aiSettings.enabled}
        aiConfigured={aiConfiguredForAnalysis}
        onClose={() => setGenerateDialogOpen(false)}
        onOpenSettings={() => setAiSettingsDialogOpen(true)}
        onGenerate={(description) => {
          void runGeneration(description);
        }}
        onApply={handleApplyGeneratedContent}
      />

      <AiSettingsDialog
        open={aiSettingsDialogOpen}
        settings={aiSettings}
        apiKeyConfigured={aiApiKeyConfigured}
        onClose={() => setAiSettingsDialogOpen(false)}
        onSave={handleSaveAiSettings}
        onTestConnection={handleTestAiConnection}
        onFetchModels={handleFetchAiModels}
        onLoadStoredApiKey={getAiApiKey}
      />

      <Dialog
        open={requestDialogOpen}
        title="编辑请求"
        description="修改请求名称与标签，不影响请求内容。"
        onClose={() => setRequestDialogOpen(false)}
        onConfirm={submitRequestDialog}
        confirmDisabled={!requestName.trim()}
        footer={
          <>
            <Button variant="outline" onClick={() => setRequestDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={submitRequestDialog} disabled={!requestName.trim()}>
              保存
            </Button>
          </>
        }
      >
        <div className="grid gap-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">请求名称</span>
            <Input value={requestName} onChange={(event) => setRequestName(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">标签</span>
            <Input
              placeholder="例如 巡检，排障（多个标签用逗号分隔）"
              value={requestTagsInput}
              onChange={(event) => setRequestTagsInput(event.target.value)}
            />
          </label>
        </div>
      </Dialog>

      <Dialog
        open={pendingDelete != null}
        title="确认删除"
        description={pendingDelete ? `确定删除请求“${pendingDelete.name}”吗？` : ""}
        onClose={() => setPendingDelete(null)}
        onConfirm={submitDeleteDialog}
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={submitDeleteDialog}>
              删除
            </Button>
          </>
        }
      >
        <div className="text-sm leading-7 text-slate-600">删除后不可恢复。</div>
      </Dialog>

      <ConsoleExportDialog
        open={exportDialogOpen}
        connectionName={selectedConnection.name}
        requestCount={connectionRequests.length}
        exporting={exporting}
        onClose={() => setExportDialogOpen(false)}
        onConfirm={handleConfirmExport}
      />

      <ConsoleImportDialog
        open={importDialogOpen}
        fileName={pendingImport?.fileName ?? ""}
        encrypted={pendingImport?.encrypted ?? false}
        payload={pendingImport?.payload ?? null}
        connections={connections.map((connection) => ({ id: connection.id, name: connection.name }))}
        defaultConnectionId={selectedConnection.id}
        errorMessage={importError}
        importing={importing}
        onClose={() => {
          setImportDialogOpen(false);
          setPendingImport(null);
          setImportError(null);
        }}
        onConfirm={handleConfirmImport}
      />

      <ConsoleTemplateDialog
        open={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
        onApply={handleApplyTemplate}
      />

      <ConsoleBulkTagsDialog
        open={bulkTagsDialogOpen}
        selectedCount={selectedRequestIds.length}
        onClose={() => setBulkTagsDialogOpen(false)}
        onApply={handleApplyBulkTags}
      />

      <ConsoleShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
