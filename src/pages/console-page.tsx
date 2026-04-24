import { useMutation } from "@tanstack/react-query";
import {
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  CirclePlus,
  CopyPlus,
  Folder,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ConsoleEditor } from "../components/console/console-editor";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { buildConsoleAutocompleteContext, extractIndexNamesFromPath } from "../lib/console-autocomplete";
import { buildRequestProjectTree } from "../lib/request-tree";
import { buildConnectionLogContextFromProfile, buildRequestLogContext } from "../lib/error-logs";
import { extractUnknownErrorDiagnostics, extractUnknownErrorMessage, getResponseErrorMessage } from "../lib/errors";
import { executeConsoleRequest } from "../lib/http-client";
import { formatConsoleRequest, parseConsoleRequest } from "../lib/console-parser";
import { formatShanghaiDateTime } from "../lib/time";
import { useAppState } from "../providers/app-state";
import type { ConnectionProfile } from "../types/connections";
import type { RequestModule, RequestProject, SavedRequest } from "../types/requests";

type RunPayload = {
  connection: ConnectionProfile;
  content: string;
  overwriteRequestId: string | null;
  moduleId: string;
  requestName: string;
};

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
    requestProjects,
    requestModules,
    requestsForCurrentConnection,
    searchMetadataByConnection,
    updateDraft,
    selectSavedRequest,
    saveRequestFromDraft,
    renameRequest,
    deleteRequest,
    duplicateRequest,
    refreshSearchMetadata,
    ensureIndexFields,
    upsertRequestProject,
    upsertRequestModule,
    deleteRequestProject,
    deleteRequestModule,
    getPassword,
    getSshSecret,
    getSshProfileForConnection,
    recordErrorLog,
  } = useAppState();
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<RequestProject | null>(null);
  const [editingModule, setEditingModule] = useState<RequestModule | null>(null);
  const [editingRequest, setEditingRequest] = useState<SavedRequest | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "project"; project: RequestProject }
    | { kind: "module"; module: RequestModule }
    | { kind: "request"; request: SavedRequest }
    | null
  >(null);
  const [moduleParentProjectId, setModuleParentProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [requestName, setRequestName] = useState("");

  const runMutation = useMutation({
    mutationFn: async (payload: RunPayload) => {
      const sshProfile = getSshProfileForConnection(payload.connection);
      const [password, sshSecret] = await Promise.all([getPassword(payload.connection), getSshSecret(sshProfile)]);

      if (!password) {
        throw new Error("当前连接未找到已保存密码，请回到连接页重新保存。");
      }

      const request = parseConsoleRequest(payload.content);
      return executeConsoleRequest(payload.connection, { password, sshSecret }, request, sshProfile?.tunnel ?? null);
    },
    onSuccess(response, payload) {
      let saveErrorMessage: string | null = null;

      try {
        saveRequestFromDraft({
          connectionId: payload.connection.id,
          moduleId: payload.moduleId,
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
          rawResponse: response.bodyText,
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
  const requestTree = useMemo(
    () =>
      activeConnection
        ? buildRequestProjectTree(activeConnection.id, requestProjects, requestModules, requestsForCurrentConnection)
        : [],
    [activeConnection, requestModules, requestProjects, requestsForCurrentConnection],
  );

  const requestProjectMap = useMemo(
    () =>
      new Map(
        requestProjects
          .filter((project) => project.connectionId === activeConnection?.id)
          .map((project) => [project.id, project]),
      ),
    [activeConnection?.id, requestProjects],
  );
  const requestModuleMap = useMemo(
    () => new Map(requestModules.map((module) => [module.id, module])),
    [requestModules],
  );

  const selectedModule = draft?.targetModuleId ? requestModuleMap.get(draft.targetModuleId) ?? null : null;
  const selectedProject = selectedModule ? requestProjectMap.get(selectedModule.projectId) ?? null : null;
  const moduleDialogProject = moduleParentProjectId ? requestProjectMap.get(moduleParentProjectId) ?? null : null;
  const activeRequest = draft?.activeSavedRequestId
    ? requestsForCurrentConnection.find((item) => item.id === draft.activeSavedRequestId) ?? null
    : null;
  const response = draft?.response ?? null;
  const firstModuleId = requestTree.flatMap((project) => project.modules).find((module) => Boolean(module))?.id ?? null;

  useEffect(() => {
    setExpandedProjects((current) => {
      const next = Object.fromEntries(requestTree.map((project) => [project.id, current[project.id] ?? true]));
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });

    setExpandedModules((current) => {
      const next = Object.fromEntries(
        requestTree.flatMap((project) => project.modules.map((module) => [module.id, current[module.id] ?? true])),
      );
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [requestTree]);

  useEffect(() => {
    if (!activeConnection || !draft || draft.targetModuleId || !firstModuleId) {
      return;
    }

    updateDraft(activeConnection.id, (currentDraftState) => ({
      ...currentDraftState,
      targetModuleId: firstModuleId,
    }));
  }, [activeConnection, draft, firstModuleId, updateDraft]);

  if (!activeConnection || !draft) {
    return <Navigate to="/connections" replace />;
  }

  const selectedConnection = activeConnection;
  const activeDraftState = draft;
  const metadataAutoRefreshRef = useRef<Record<string, string>>({});
  const connectionSearchMetadata = searchMetadataByConnection[selectedConnection.id] ?? null;
  const autocompleteContext = useMemo(
    () => buildConsoleAutocompleteContext(requestsForCurrentConnection, activeDraftState.content, connectionSearchMetadata),
    [requestsForCurrentConnection, activeDraftState.content, connectionSearchMetadata],
  );
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
    const firstLine = activeDraftState.content.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (!firstLine) {
      return "";
    }
    const [, ...pathParts] = firstLine.split(/\s+/);
    return extractIndexNamesFromPath(pathParts.join(" ").trim()).join(",");
  }, [activeDraftState.content]);
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
    if (!activeDraftState.content.trim()) {
      return;
    }

    try {
      const formatted = formatConsoleRequest(activeDraftState.content);
      updateDraft(selectedConnection.id, (currentDraftState) => ({
        ...currentDraftState,
        content: formatted,
      }));
      toast.success("请求已格式化。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "格式化失败");
    }
  }

  function handleRunAndSave() {
    if (runMutation.isPending) {
      return;
    }

    const moduleId = activeRequest?.moduleId ?? activeDraftState.targetModuleId;
    if (!moduleId) {
      toast.error("请先在当前连接下新建项目和模块，再创建请求。");
      return;
    }

    runMutation.mutate({
      connection: selectedConnection,
      content: activeDraftState.content,
      moduleId,
      overwriteRequestId: activeDraftState.activeSavedRequestId,
      requestName: resolveDraftRequestName(activeDraftState.name, activeRequest?.name, activeDraftState.content),
    });
  }

  function handleSelectModule(projectId: string, moduleId: string) {
    setExpandedProjects((current) => ({ ...current, [projectId]: true }));
    setExpandedModules((current) => ({ ...current, [moduleId]: !current[moduleId] }));
    updateDraft(selectedConnection.id, (currentDraftState) => ({
      ...currentDraftState,
      targetModuleId: moduleId,
    }));
  }

  function handleExpandAll() {
    setExpandedProjects(Object.fromEntries(requestTree.map((project) => [project.id, true])));
    setExpandedModules(
      Object.fromEntries(
        requestTree.flatMap((project) => project.modules.map((module) => [module.id, true])),
      ),
    );
  }

  function handleCollapseAll() {
    setExpandedProjects(Object.fromEntries(requestTree.map((project) => [project.id, false])));
    setExpandedModules(
      Object.fromEntries(
        requestTree.flatMap((project) => project.modules.map((module) => [module.id, false])),
      ),
    );
  }

  function handleCreateRequest(moduleId = activeDraftState.targetModuleId) {
    if (!moduleId) {
      toast.error("请先点击一个模块，再新建请求。");
      return;
    }

    const module = requestModuleMap.get(moduleId) ?? null;
    if (!module) {
      toast.error("目标模块不存在，请重新选择。");
      return;
    }

    const request = saveRequestFromDraft({
      connectionId: selectedConnection.id,
      moduleId,
      name: buildUntitledRequestName(requestsForCurrentConnection.map((item) => item.name)),
      content: "GET /_cluster/health",
      response: null,
    });

    setExpandedProjects((current) => ({ ...current, [module.projectId]: true }));
    setExpandedModules((current) => ({ ...current, [module.id]: true }));
    selectSavedRequest(request.id);
    toast.success("已在当前模块下新建请求。");
  }

  function handleDuplicateRequest(requestId: string, requestNameValue: string) {
    try {
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

  function openCreateProjectDialog() {
    setEditingProject(null);
    setProjectName("");
    setProjectDialogOpen(true);
  }

  function openEditProjectDialog(project: RequestProject) {
    setEditingProject(project);
    setProjectName(project.name);
    setProjectDialogOpen(true);
  }

  function openCreateModuleDialog(projectId: string) {
    setEditingModule(null);
    setModuleParentProjectId(projectId);
    setModuleName("");
    setModuleDialogOpen(true);
  }

  function openEditModuleDialog(module: RequestModule) {
    setEditingModule(module);
    setModuleParentProjectId(module.projectId);
    setModuleName(module.name);
    setModuleDialogOpen(true);
  }

  function openRenameRequestDialog(request: SavedRequest) {
    setEditingRequest(request);
    setRequestName(request.name);
    setRequestDialogOpen(true);
  }

  function submitProjectDialog() {
    const project = upsertRequestProject(selectedConnection.id, projectName, editingProject?.id);
    setExpandedProjects((current) => ({ ...current, [project.id]: true }));
    setProjectDialogOpen(false);
    setEditingProject(null);
    setProjectName("");
    toast.success(editingProject ? "项目名称已更新。" : "项目已创建。");
  }

  function submitModuleDialog() {
    if (!moduleParentProjectId) {
      toast.error("请先选择模块所属项目。");
      return;
    }

    const module = upsertRequestModule(moduleParentProjectId, moduleName, editingModule?.id);
    setExpandedProjects((current) => ({ ...current, [module.projectId]: true }));
    setExpandedModules((current) => ({ ...current, [module.id]: true }));
    setModuleDialogOpen(false);
    setEditingModule(null);
    setModuleParentProjectId("");
    setModuleName("");
    toast.success(editingModule ? "模块名称已更新。" : "模块已创建。");
  }

  function submitRequestDialog() {
    if (!editingRequest) {
      return;
    }

    renameRequest(editingRequest.id, requestName);
    setRequestDialogOpen(false);
    setEditingRequest(null);
    setRequestName("");
    toast.success("请求名称已更新。");
  }

  function handleDeleteProject(project: RequestProject) {
    setPendingDelete({ kind: "project", project });
  }

  function handleDeleteModule(module: RequestModule) {
    setPendingDelete({ kind: "module", module });
  }

  function handleDeleteRequest(request: SavedRequest) {
    setPendingDelete({ kind: "request", request });
  }

  function submitDeleteDialog() {
    if (!pendingDelete) {
      return;
    }

    if (pendingDelete.kind === "project") {
      deleteRequestProject(pendingDelete.project.id);
      toast.success("项目已删除。");
    } else if (pendingDelete.kind === "module") {
      deleteRequestModule(pendingDelete.module.id);
      toast.success("模块已删除。");
    } else {
      deleteRequest(pendingDelete.request.id);
      toast.success("请求已删除。");
    }

    setPendingDelete(null);
  }

  const responseSummary = response
    ? `${response.status || "FAILED"} ${response.statusText} · ${response.durationMs} ms · ${formatShanghaiDateTime(response.executedAt)}`
    : runMutation.isPending
      ? "请求执行中..."
      : "按 Command + Enter 运行并保存后，这里会显示返回内容。";

  const responseValue = response
    ? response.isJson
      ? response.bodyPretty
      : response.bodyText
    : runMutation.isPending
      ? '{\n  "message": "请求执行中..."\n}'
      : '{\n  "message": "按 Command + Enter 运行并保存后，这里会显示返回内容。"\n}';

  return (
    <div className="h-dvh overflow-hidden p-4 sm:p-6" onContextMenu={(event) => event.preventDefault()}>
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[30px] bg-slate-950 px-5 py-6 text-slate-50 shadow-2xl shadow-slate-900/25">
          <div className="mb-8 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-slate-400">ESX Console</p>
              <h1 className="mt-2 text-2xl font-extrabold">连接与请求</h1>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate("/connections")}>
              连接页
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/logs")}>
              错误日志
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="rounded-[26px] border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-emerald-300">当前连接</p>
              <p className="mt-3 text-lg font-bold text-white">{selectedConnection.name}</p>
            </div>

            <div className="mt-6 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-300">当前连接下的项目树</p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleExpandAll}>
                <ChevronsDown className="mr-2 h-4 w-4" />
                展开
              </Button>
              <Button variant="outline" size="sm" onClick={handleCollapseAll}>
                <ChevronsUp className="mr-2 h-4 w-4" />
                折叠
              </Button>
              <Button variant="ghost" size="sm" onClick={openCreateProjectDialog}>
                <CirclePlus className="mr-2 h-4 w-4" />
                项目
              </Button>
            </div>

            <div className="mt-3 rounded-[22px] border border-white/10 bg-white/5 p-4 text-sm leading-7 text-slate-300">
              {selectedProject && selectedModule
                ? `当前目标：${selectedProject.name} / ${selectedModule.name}`
                : "请先在当前连接下新建项目和模块，然后点击模块名称。"}
            </div>

            <div className="mt-4">
              {requestTree.length === 0 ? (
                <div className="rounded-[22px] border border-white/10 bg-white/5 p-4 text-sm leading-7 text-slate-400">
                  当前连接还没有项目。先新建项目，再新建模块和请求。
                </div>
              ) : (
                <div className="space-y-4">
                  {requestTree.map((project) => (
                    <div key={project.id} className="rounded-[22px] border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 flex-1 items-start gap-2">
                          <button
                            className="mt-1 rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
                            onClick={() =>
                              setExpandedProjects((current) => ({ ...current, [project.id]: !current[project.id] }))
                            }
                          >
                            {expandedProjects[project.id] ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            className="flex min-w-0 flex-1 items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/10"
                            onClick={() =>
                              setExpandedProjects((current) => ({ ...current, [project.id]: !current[project.id] }))
                            }
                          >
                            <Folder className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                            <span className="min-w-0 flex-1">
                              <span className="block whitespace-normal break-words text-sm font-bold leading-5 text-white">
                                {project.name}
                              </span>
                            </span>
                          </button>
                        </div>
                        <div className="ml-9 flex flex-wrap gap-2 sm:ml-0 sm:shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 px-0"
                            onClick={() => openCreateModuleDialog(project.id)}
                          >
                            <CirclePlus className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 px-0"
                            onClick={() => openEditProjectDialog(project)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 px-0 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                            onClick={() => handleDeleteProject(project)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {expandedProjects[project.id] ? (
                        <div className="mt-4 space-y-3">
                          {project.modules.length === 0 ? (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs leading-6 text-slate-400">
                              当前项目还没有模块。
                            </div>
                          ) : null}

                          {project.modules.map((module) => (
                            <div key={module.id} className="rounded-[18px] border border-white/10 bg-black/10 p-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex min-w-0 flex-1 items-start gap-2">
                                  <button
                                    className="mt-1 rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
                                    onClick={() =>
                                      setExpandedModules((current) => ({ ...current, [module.id]: !current[module.id] }))
                                    }
                                  >
                                    {expandedModules[module.id] ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                  <button
                                    className={`flex min-w-0 flex-1 items-start gap-3 rounded-xl px-3 py-3 text-left transition ${
                                      activeDraftState.targetModuleId === module.id
                                        ? "bg-emerald-500/20 text-white"
                                        : "hover:bg-white/10"
                                    }`}
                                    onClick={() => handleSelectModule(project.id, module.id)}
                                  >
                                    <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block whitespace-normal break-words text-sm font-semibold leading-5">
                                        {module.name}
                                      </span>
                                    </span>
                                  </button>
                                </div>
                                <div className="ml-9 flex flex-wrap gap-2 sm:ml-0 sm:shrink-0">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 px-0"
                                    onClick={() => handleCreateRequest(module.id)}
                                  >
                                    <CirclePlus className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 px-0"
                                    onClick={() => openEditModuleDialog(module)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 px-0 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                                    onClick={() => handleDeleteModule(module)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              {expandedModules[module.id] ? (
                                <div className="mt-3 space-y-2 border-l border-white/10 pl-3">
                                  {module.requests.length === 0 ? (
                                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs leading-6 text-slate-400">
                                      当前模块还没有请求。
                                    </div>
                                  ) : null}

                                  {module.requests.map((request) => {
                                    const isActive = activeDraftState.activeSavedRequestId === request.id;

                                    return (
                                      <div
                                        key={request.id}
                                        role="button"
                                        tabIndex={0}
                                        className={`cursor-pointer rounded-[18px] border p-3 transition ${
                                          isActive
                                            ? "border-white/30 bg-white text-slate-950"
                                            : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                                        }`}
                                        onClick={() => selectSavedRequest(request.id)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            selectSavedRequest(request.id);
                                          }
                                        }}
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <p className="truncate text-sm font-bold">{request.name}</p>
                                          {request.lastStatus ? (
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700">
                                              {request.lastStatus}
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="mt-3 flex justify-end gap-2">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            title="重命名请求"
                                            aria-label="重命名请求"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              openRenameRequestDialog(request);
                                            }}
                                          >
                                            <Pencil className="h-4 w-4" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            title="复制请求"
                                            aria-label="复制请求"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              handleDuplicateRequest(request.id, request.name);
                                            }}
                                          >
                                            <CopyPlus className="h-4 w-4" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            title="删除请求"
                                            aria-label="删除请求"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              handleDeleteRequest(request);
                                            }}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-h-0 min-w-0">
          <Card className="flex h-full min-h-0 min-w-0 flex-col p-5 sm:p-6">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
              <Button variant="outline" onClick={handleFormatJson}>
                <Check className="mr-2 h-4 w-4" />
                格式化 JSON
              </Button>
              <Input
                value={activeDraftState.name}
                onChange={(event) =>
                  updateDraft(selectedConnection.id, (currentDraftState) => ({
                    ...currentDraftState,
                    name: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
                    return;
                  }

                  event.preventDefault();
                  handleRunAndSave();
                }}
                placeholder="请求名称（为空时默认使用 METHOD /path，Command + Enter 运行并保存）"
              />
            </div>

            <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
              <Card className="flex min-h-[360px] min-w-0 flex-col overflow-hidden border border-slate-200 bg-white">
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
                    value={activeDraftState.content}
                    onChange={(value) =>
                      updateDraft(selectedConnection.id, (currentDraftState) => ({
                        ...currentDraftState,
                        content: value,
                      }))
                    }
                  />
                </div>
              </Card>

              <Card className="flex min-h-[360px] min-w-0 flex-col overflow-hidden border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-900">返回内容</p>
                    {runMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{responseSummary}</p>
                </div>
                <div className="min-h-0 flex-1 p-4">
                  <ConsoleEditor readOnly value={responseValue} onChange={() => {}} />
                </div>
              </Card>
            </div>
          </Card>
        </main>
      </div>

      <Dialog
        open={projectDialogOpen}
        title={editingProject ? "编辑项目名称" : "新建项目"}
        description="项目挂在当前连接下面，用来承载模块。"
        onClose={() => setProjectDialogOpen(false)}
        onConfirm={submitProjectDialog}
        confirmDisabled={!projectName.trim()}
        footer={
          <>
            <Button variant="outline" onClick={() => setProjectDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={submitProjectDialog} disabled={!projectName.trim()}>
              {editingProject ? "保存项目名称" : "创建项目"}
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">项目名称</span>
          <Input
            autoFocus
            placeholder="例如 搜索排障 / 运营分析 / 日志巡检"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
          />
        </label>
      </Dialog>

      <Dialog
        open={moduleDialogOpen}
        title={editingModule ? "编辑模块名称" : "新建模块"}
        description={moduleDialogProject ? `模块会创建在项目“${moduleDialogProject.name}”下。` : "请先选择所属项目。"}
        onClose={() => setModuleDialogOpen(false)}
        onConfirm={submitModuleDialog}
        confirmDisabled={!moduleParentProjectId || !moduleName.trim()}
        footer={
          <>
            <Button variant="outline" onClick={() => setModuleDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={submitModuleDialog} disabled={!moduleParentProjectId || !moduleName.trim()}>
              {editingModule ? "保存模块名称" : "创建模块"}
            </Button>
          </>
        }
      >
        <div className="grid gap-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">所属项目</span>
            <Input readOnly value={moduleDialogProject?.name ?? "未选择项目"} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">模块名称</span>
            <Input
              autoFocus
              placeholder="例如 聚合查询 / 索引维护 / 健康检查"
              value={moduleName}
              onChange={(event) => setModuleName(event.target.value)}
            />
          </label>
        </div>
      </Dialog>

      <Dialog
        open={requestDialogOpen}
        title="编辑请求名称"
        description="只修改当前请求名称，不影响请求内容。"
        onClose={() => setRequestDialogOpen(false)}
        onConfirm={submitRequestDialog}
        confirmDisabled={!requestName.trim()}
        footer={
          <>
            <Button variant="outline" onClick={() => setRequestDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={submitRequestDialog} disabled={!requestName.trim()}>
              保存请求名称
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">请求名称</span>
          <Input value={requestName} onChange={(event) => setRequestName(event.target.value)} />
        </label>
      </Dialog>

      <Dialog
        open={pendingDelete != null}
        title="确认删除"
        description={
          pendingDelete?.kind === "project"
            ? `删除项目“${pendingDelete.project.name}”后，下面的模块和请求都会一起删除。`
            : pendingDelete?.kind === "module"
              ? `删除模块“${pendingDelete.module.name}”后，下面的请求都会一起删除。`
              : pendingDelete?.kind === "request"
                ? `确定删除请求“${pendingDelete.request.name}”吗？`
                : ""
        }
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
    </div>
  );
}
