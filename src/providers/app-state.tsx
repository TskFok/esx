import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { toast } from "sonner";
import { buildConsoleContent, parseConsoleRequest } from "../lib/console-parser";
import { fetchConnectionSearchMetadata, fetchIndexMappingFields } from "../lib/http-client";
import {
  createDefaultDraft,
  createEmptyStorage,
  readAppStorage,
  writeAppStorage,
} from "../lib/storage";
import {
  createTextPreview,
  normalizeResponsePreviewBytes,
  normalizeResponseSnapshot,
} from "../lib/response-snapshot";
import { buildSshTunnelConfig, getSshSecretFromForm } from "../lib/connections";
import type { ErrorLogConnectionContext, ErrorLogEntry, ErrorLogRequestContext } from "../types/logs";
import {
  deleteConnectionSshSecret,
  deleteConnectionPassword,
  getConnectionSshSecret,
  getConnectionPassword,
  saveConnectionSshSecret,
  saveConnectionPassword,
} from "../lib/tauri";
import { normalizeBaseUrl } from "../lib/http-client";
import type {
  ConnectionFormValues,
  ConnectionProfile,
  ModuleFormValues,
  ModuleProfile,
  ProjectFormValues,
  ProjectProfile,
  SshProfile,
  SshProfileFormValues,
} from "../types/connections";
import type {
  ConnectionSearchMetadata,
  ConsoleDraft,
  RequestModule,
  RequestProject,
  ResponseSnapshot,
  SavedRequest,
} from "../types/requests";

type AppStateShape = ReturnType<typeof createEmptyStorage>;

type SaveRequestPayload = {
  connectionId: string;
  moduleId: string;
  name: string;
  content: string;
  response: ResponseSnapshot | null;
  overwriteRequestId?: string | null;
};

type AppStateContextValue = {
  ready: boolean;
  projects: ProjectProfile[];
  modules: ModuleProfile[];
  connections: ConnectionProfile[];
  sshProfiles: SshProfile[];
  requestProjects: RequestProject[];
  requestModules: RequestModule[];
  searchMetadataByConnection: Record<string, ConnectionSearchMetadata>;
  currentConnection: ConnectionProfile | null;
  currentDraft: ConsoleDraft | null;
  requestsForCurrentConnection: SavedRequest[];
  errorLoggingEnabled: boolean;
  responsePreviewBytes: number;
  errorLogs: ErrorLogEntry[];
  setCurrentConnection: (connectionId: string) => void;
  setErrorLoggingEnabled: (enabled: boolean) => void;
  setResponsePreviewBytes: (bytes: number) => void;
  clearErrorLogs: () => void;
  recordErrorLog: (payload: {
    scope: ErrorLogEntry["scope"];
    title: string;
    summary: string;
    diagnostics?: string[];
    status?: number | null;
    rawResponse?: string;
    connection?: ErrorLogConnectionContext;
    request?: ErrorLogRequestContext;
  }) => void;
  updateDraft: (connectionId: string, updater: (draft: ConsoleDraft) => ConsoleDraft) => void;
  createBlankDraft: (connectionId: string) => void;
  selectSavedRequest: (requestId: string) => void;
  saveRequestFromDraft: (payload: SaveRequestPayload) => SavedRequest;
  renameRequest: (requestId: string, name: string) => void;
  deleteRequest: (requestId: string) => void;
  duplicateRequest: (requestId: string, name: string) => SavedRequest;
  refreshSearchMetadata: (
    connection: ConnectionProfile,
    options?: { force?: boolean },
  ) => Promise<ConnectionSearchMetadata>;
  ensureIndexFields: (
    connection: ConnectionProfile,
    indexOrAlias: string,
    options?: { force?: boolean },
  ) => Promise<string[] | null>;
  recordExecution: (
    connectionId: string,
    content: string,
    response: ResponseSnapshot,
  ) => void;
  upsertRequestProject: (connectionId: string, name: string, existingProjectId?: string) => RequestProject;
  upsertRequestModule: (projectId: string, name: string, existingModuleId?: string) => RequestModule;
  deleteRequestProject: (projectId: string) => void;
  deleteRequestModule: (moduleId: string) => void;
  upsertProject: (formValues: ProjectFormValues, existingProjectId?: string) => ProjectProfile;
  upsertModule: (
    formValues: ModuleFormValues,
    projectId: string,
    existingModuleId?: string,
  ) => ModuleProfile;
  upsertSshProfile: (formValues: SshProfileFormValues, existingProfileId?: string) => Promise<SshProfile>;
  upsertConnection: (
    formValues: ConnectionFormValues,
    existingConnectionId?: string,
  ) => Promise<ConnectionProfile>;
  deleteProject: (projectId: string) => Promise<void>;
  deleteModule: (moduleId: string) => Promise<void>;
  deleteSshProfile: (profileId: string) => Promise<void>;
  deleteConnection: (connectionId: string) => Promise<void>;
  getPassword: (connection: ConnectionProfile) => Promise<string | null>;
  getSshSecret: (sshProfile: SshProfile | null) => Promise<string | null>;
  getSshProfileForConnection: (connection: ConnectionProfile) => SshProfile | null;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);
const MAX_ERROR_LOGS = 200;
const SEARCH_METADATA_TTL_MS = 5 * 60 * 1000;

function now() {
  return new Date().toISOString();
}

function normalizeStoredProject(project: ProjectProfile) {
  return {
    ...project,
    name: project.name.trim() || "未命名项目",
  } satisfies ProjectProfile;
}

function normalizeStoredModule(module: ModuleProfile) {
  return {
    ...module,
    name: module.name.trim() || "未命名模块",
  } satisfies ModuleProfile;
}

function normalizeStoredRequestProject(project: RequestProject) {
  return {
    ...project,
    name: project.name.trim() || "未命名项目",
  } satisfies RequestProject;
}

function normalizeStoredRequestModule(module: RequestModule) {
  return {
    ...module,
    name: module.name.trim() || "未命名模块",
  } satisfies RequestModule;
}

function normalizeStoredConnection(connection: ConnectionProfile) {
  return {
    ...connection,
    moduleId: null,
    sshProfileId: connection.sshProfileId ?? (connection.sshTunnel ? connection.id : null),
    sshTunnel: connection.sshTunnel ?? null,
  } satisfies ConnectionProfile;
}

function normalizeStoredErrorLog(log: ErrorLogEntry, responsePreviewBytes: number) {
  return {
    ...log,
    diagnostics: (log.diagnostics ?? []).map((item) => createTextPreview(item, responsePreviewBytes).text),
    rawResponse: log.rawResponse ? createTextPreview(log.rawResponse, responsePreviewBytes).text : undefined,
  } satisfies ErrorLogEntry;
}

function normalizeStringRecordOfLists(
  value: Record<string, unknown> | undefined | null,
): Record<string, string[]> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result: Record<string, string[]> = {};
  Object.entries(value).forEach(([key, list]) => {
    const trimmedKey = key.trim();
    if (!trimmedKey || !Array.isArray(list)) {
      return;
    }
    const normalized = [
      ...new Set(list.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)),
    ].sort((left, right) => left.localeCompare(right, "zh-CN"));
    if (normalized.length > 0) {
      result[trimmedKey] = normalized;
    }
  });
  return result;
}

function normalizeStoredSearchMetadata(
  cache: ConnectionSearchMetadata,
  connectionIds: Set<string>,
) {
  if (!connectionIds.has(cache.connectionId)) {
    return null;
  }

  return {
    connectionId: cache.connectionId,
    indices: [...new Set((cache.indices ?? []).map((item) => item.trim()).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    ),
    aliases: [...new Set((cache.aliases ?? []).map((item) => item.trim()).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    ),
    fields: [...new Set((cache.fields ?? []).map((item) => item.trim()).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    ),
    fieldsByIndex: normalizeStringRecordOfLists(cache.fieldsByIndex),
    aliasToIndices: normalizeStringRecordOfLists(cache.aliasToIndices),
    fetchedAt: cache.fetchedAt,
    expiresAt: cache.expiresAt,
  } satisfies ConnectionSearchMetadata;
}

function normalizeStoredSshProfile(profile: SshProfile) {
  return {
    ...profile,
    name: profile.name.trim() || `${profile.tunnel.username}@${profile.tunnel.host}`,
  } satisfies SshProfile;
}

function buildLegacySshProfile(connection: ConnectionProfile) {
  if (!connection.sshTunnel) {
    return null;
  }

  return {
    id: connection.id,
    name: `${connection.name} SSH`,
    tunnel: connection.sshTunnel,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    lastVerifiedAt: connection.updatedAt,
  } satisfies SshProfile;
}

function buildSavedRequest(connectionId: string, name: string, content: string, response: ResponseSnapshot | null, requestId?: string) {
  const parsed = parseConsoleRequest(content);
  const timestamp = now();

  return {
    id: requestId ?? crypto.randomUUID(),
    connectionId,
    moduleId: null,
    name: name.trim(),
    method: parsed.method,
    path: parsed.path,
    body: parsed.bodyText,
    headers: {},
    lastResponse: response,
    lastStatus: response?.status ?? null,
    lastDurationMs: response?.durationMs ?? null,
    updatedAt: timestamp,
  } satisfies SavedRequest;
}

function buildSavedRequestWithModule(
  connectionId: string,
  moduleId: string,
  name: string,
  content: string,
  response: ResponseSnapshot | null,
  requestId?: string,
) {
  return {
    ...buildSavedRequest(connectionId, name, content, response, requestId),
    moduleId,
  } satisfies SavedRequest;
}

function createDefaultRequestProject(connectionId: string, timestamp: string) {
  return {
    id: `__default-request-project__${connectionId}`,
    connectionId,
    name: "默认项目",
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies RequestProject;
}

function createDefaultRequestModule(projectId: string, connectionId: string, timestamp: string) {
  return {
    id: `__default-request-module__${connectionId}`,
    projectId,
    name: "默认模块",
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies RequestModule;
}

function getFirstRequestModuleIdForConnection(
  connectionId: string,
  requestProjects: RequestProject[],
  requestModules: RequestModule[],
) {
  const projectIds = new Set(
    requestProjects
      .filter((project) => project.connectionId === connectionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((project) => project.id),
  );

  return (
    requestModules
      .filter((module) => projectIds.has(module.projectId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id ?? null
  );
}

function cleanupRemovedRequests(
  current: AppStateShape,
  requestIds: Set<string>,
  removedModuleIds: Set<string> = new Set(),
) {
  if (requestIds.size === 0 && removedModuleIds.size === 0) {
    return current;
  }

  const nextDrafts = { ...current.drafts };
  Object.entries(nextDrafts).forEach(([connectionId, draft]) => {
    const needsResetActive = draft.activeSavedRequestId ? requestIds.has(draft.activeSavedRequestId) : false;
    const needsResetTarget = draft.targetModuleId ? removedModuleIds.has(draft.targetModuleId) : false;
    if (!needsResetActive && !needsResetTarget) {
      return;
    }

    nextDrafts[connectionId] = {
      ...draft,
      activeSavedRequestId: needsResetActive ? null : draft.activeSavedRequestId,
      targetModuleId: needsResetTarget ? null : draft.targetModuleId,
    };
  });

  return normalizeState({
    ...current,
    requests: current.requests.filter((request) => !requestIds.has(request.id)),
    drafts: nextDrafts,
  });
}

function removeConnectionsFromState(current: AppStateShape, connectionIds: Set<string>) {
  if (connectionIds.size === 0) {
    return current;
  }

  const nextConnections = current.connections.filter((item) => !connectionIds.has(item.id));
  const nextDrafts = { ...current.drafts };
  connectionIds.forEach((connectionId) => {
    delete nextDrafts[connectionId];
  });

  return normalizeState({
    ...current,
    connections: nextConnections,
    requests: current.requests.filter((item) => !connectionIds.has(item.connectionId)),
    searchMetadata: Object.fromEntries(
      Object.entries(current.searchMetadata ?? {}).filter(([connectionId]) => !connectionIds.has(connectionId)),
    ),
    drafts: nextDrafts,
    currentConnectionId:
      current.currentConnectionId && connectionIds.has(current.currentConnectionId)
        ? nextConnections[0]?.id ?? null
        : current.currentConnectionId,
  });
}

function normalizeState(state: AppStateShape): AppStateShape {
  const responsePreviewBytes = normalizeResponsePreviewBytes(state.settings?.responsePreviewBytes);
  const timestamp =
    state.connections[0]?.createdAt ??
    state.modules?.[0]?.createdAt ??
    state.projects?.[0]?.createdAt ??
    now();

  const normalizedProjects = [...(state.projects ?? [])].map(normalizeStoredProject);
  const projectIds = new Set(normalizedProjects.map((project) => project.id));
  const normalizedModules = [...(state.modules ?? [])]
    .map(normalizeStoredModule)
    .filter((module) => projectIds.has(module.projectId));

  const normalizedConnections = [...state.connections]
    .map(normalizeStoredConnection)
    .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));

  const connectionIds = new Set(normalizedConnections.map((connection) => connection.id));
  const normalizedSearchMetadata = Object.fromEntries(
    Object.entries(state.searchMetadata ?? {})
      .map(([connectionId, cache]) => [connectionId, normalizeStoredSearchMetadata(cache, connectionIds)] as const)
      .filter((entry): entry is readonly [string, ConnectionSearchMetadata] => Boolean(entry[1])),
  );

  let normalizedRequestProjects = [...(state.requestProjects ?? [])]
    .map(normalizeStoredRequestProject)
    .filter((project) => connectionIds.has(project.connectionId));
  const requestProjectIds = new Set(normalizedRequestProjects.map((project) => project.id));

  let normalizedRequestModules = [...(state.requestModules ?? [])]
    .map(normalizeStoredRequestModule)
    .filter((module) => requestProjectIds.has(module.projectId));
  let requestModuleIds = new Set(normalizedRequestModules.map((module) => module.id));

  function ensureDefaultRequestModule(connectionId: string) {
    const defaultProjectId = `__default-request-project__${connectionId}`;
    const defaultModuleId = `__default-request-module__${connectionId}`;
    const projectExists = normalizedRequestProjects.some((project) => project.id === defaultProjectId);

    if (!projectExists) {
      normalizedRequestProjects = [createDefaultRequestProject(connectionId, timestamp), ...normalizedRequestProjects];
      requestProjectIds.add(defaultProjectId);
    }

    if (!requestModuleIds.has(defaultModuleId)) {
      normalizedRequestModules = [
        createDefaultRequestModule(defaultProjectId, connectionId, timestamp),
        ...normalizedRequestModules,
      ];
      requestModuleIds = new Set(normalizedRequestModules.map((module) => module.id));
    }

    return defaultModuleId;
  }

  const normalizedSshProfiles = [...(state.sshProfiles ?? [])].map(normalizeStoredSshProfile);
  const sshProfilesById = new Map(normalizedSshProfiles.map((profile) => [profile.id, profile]));

  normalizedConnections.forEach((connection) => {
    const legacyProfile = buildLegacySshProfile(connection);
    if (legacyProfile && !sshProfilesById.has(legacyProfile.id)) {
      sshProfilesById.set(legacyProfile.id, legacyProfile);
    }
  });

  const nextRequests = (state.requests ?? [])
    .filter((request) => connectionIds.has(request.connectionId))
    .map((request) => {
      const lastResponse = normalizeResponseSnapshot(request.lastResponse, responsePreviewBytes);
      const normalizedRequest = {
        ...request,
        lastResponse,
        lastStatus: lastResponse?.status ?? request.lastStatus ?? null,
        lastDurationMs: lastResponse?.durationMs ?? request.lastDurationMs ?? null,
      } satisfies SavedRequest;

      if (request.moduleId && requestModuleIds.has(request.moduleId)) {
        return normalizedRequest;
      }

      return {
        ...normalizedRequest,
        moduleId: ensureDefaultRequestModule(request.connectionId),
      } satisfies SavedRequest;
    });

  const requestsById = new Map(nextRequests.map((request) => [request.id, request]));
  const nextDrafts = Object.fromEntries(
    Object.entries(state.drafts ?? {}).filter(([connectionId]) => connectionIds.has(connectionId)),
  );

  normalizedConnections.forEach((connection) => {
    const currentDraftState = nextDrafts[connection.id];
    const activeRequest =
      currentDraftState?.activeSavedRequestId ? requestsById.get(currentDraftState.activeSavedRequestId) ?? null : null;
    const firstModuleId = getFirstRequestModuleIdForConnection(
      connection.id,
      normalizedRequestProjects,
      normalizedRequestModules,
    );
    const targetModuleId =
      activeRequest?.moduleId ??
      (currentDraftState?.targetModuleId && requestModuleIds.has(currentDraftState.targetModuleId)
        ? currentDraftState.targetModuleId
        : firstModuleId);

    nextDrafts[connection.id] = currentDraftState
      ? {
          ...currentDraftState,
          targetModuleId,
          activeSavedRequestId: activeRequest?.id ?? null,
          response: activeRequest?.lastResponse ?? normalizeResponseSnapshot(currentDraftState.response, responsePreviewBytes),
        }
      : createDefaultDraft(connection.id, targetModuleId);
  });

  return {
    projects: [...normalizedProjects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    modules: [...normalizedModules].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    connections: normalizedConnections,
    sshProfiles: [...sshProfilesById.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    requestProjects: [...normalizedRequestProjects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    requestModules: [...normalizedRequestModules].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    requests: nextRequests,
    searchMetadata: normalizedSearchMetadata,
    drafts: nextDrafts,
    currentConnectionId:
      state.currentConnectionId && normalizedConnections.some((item) => item.id === state.currentConnectionId)
        ? state.currentConnectionId
        : normalizedConnections[0]?.id ?? null,
    settings: {
      enabled: state.settings?.enabled ?? false,
      responsePreviewBytes,
    },
    errorLogs: [...(state.errorLogs ?? [])]
      .map((log) => normalizeStoredErrorLog(log, responsePreviewBytes))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
}

function buildSearchMetadataCache(
  connectionId: string,
  metadata: {
    indices: string[];
    aliases: string[];
    fields: string[];
    fieldsByIndex?: Record<string, string[]>;
    aliasToIndices?: Record<string, string[]>;
  },
  timestamp = now(),
) {
  return {
    connectionId,
    indices: metadata.indices,
    aliases: metadata.aliases,
    fields: metadata.fields,
    fieldsByIndex: metadata.fieldsByIndex ?? {},
    aliasToIndices: metadata.aliasToIndices ?? {},
    fetchedAt: timestamp,
    expiresAt: new Date(new Date(timestamp).getTime() + SEARCH_METADATA_TTL_MS).toISOString(),
  } satisfies ConnectionSearchMetadata;
}

function isSearchMetadataExpired(cache: ConnectionSearchMetadata | null | undefined) {
  if (!cache) {
    return true;
  }

  return new Date(cache.expiresAt).getTime() <= Date.now();
}

export function AppStateProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AppStateShape>(createEmptyStorage());
  const indexFieldFetchInFlight = useRef(new Map<string, Promise<string[] | null>>());

  useEffect(() => {
    let cancelled = false;

    readAppStorage()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setState(normalizeState(loaded));
        setReady(true);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setReady(true);
          toast.error("本地数据读取失败，已使用空白状态启动。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }

    writeAppStorage(state).catch((error) => {
      console.error(error);
      toast.error("本地数据保存失败。");
    });
  }, [ready, state]);

  const currentConnection = useMemo(
    () => state.connections.find((item) => item.id === state.currentConnectionId) ?? null,
    [state.connections, state.currentConnectionId],
  );

  const currentDraft = currentConnection
    ? state.drafts[currentConnection.id] ??
      createDefaultDraft(
        currentConnection.id,
        getFirstRequestModuleIdForConnection(currentConnection.id, state.requestProjects, state.requestModules),
      )
    : null;

  const requestsForCurrentConnection = useMemo(
    () =>
      currentConnection
        ? state.requests
            .filter((item) => item.connectionId === currentConnection.id)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        : [],
    [currentConnection, state.requests],
  );
  const responsePreviewBytes = normalizeResponsePreviewBytes(state.settings.responsePreviewBytes);

  const value = useMemo<AppStateContextValue>(
    () => ({
      ready,
      projects: state.projects,
      modules: state.modules,
      connections: state.connections,
      sshProfiles: state.sshProfiles,
      requestProjects: state.requestProjects,
      requestModules: state.requestModules,
      searchMetadataByConnection: state.searchMetadata,
      currentConnection,
      currentDraft,
      requestsForCurrentConnection,
      errorLoggingEnabled: state.settings.enabled,
      responsePreviewBytes,
      errorLogs: state.errorLogs,
      setCurrentConnection(connectionId) {
        setState((current) =>
          normalizeState({
            ...current,
            currentConnectionId: connectionId,
            connections: current.connections.map((connection) =>
              connection.id === connectionId ? { ...connection, lastUsedAt: now() } : connection,
            ),
          }),
        );
      },
      setErrorLoggingEnabled(enabled) {
        setState((current) => ({
          ...current,
          settings: {
            ...current.settings,
            enabled,
          },
        }));
      },
      setResponsePreviewBytes(bytes) {
        setState((current) =>
          normalizeState({
            ...current,
            settings: {
              ...current.settings,
              responsePreviewBytes: normalizeResponsePreviewBytes(bytes),
            },
          }),
        );
      },
      clearErrorLogs() {
        setState((current) => ({
          ...current,
          errorLogs: [],
        }));
      },
      recordErrorLog(payload) {
        setState((current) => {
          if (!current.settings.enabled) {
            return current;
          }

          const entry = {
            id: crypto.randomUUID(),
            createdAt: now(),
            scope: payload.scope,
            title: payload.title,
            summary: payload.summary,
            diagnostics: (payload.diagnostics ?? []).map((item) => createTextPreview(item, current.settings.responsePreviewBytes).text),
            status: payload.status ?? null,
            rawResponse: payload.rawResponse ? createTextPreview(payload.rawResponse, current.settings.responsePreviewBytes).text : undefined,
            connection: payload.connection,
            request: payload.request,
          } satisfies ErrorLogEntry;

          return {
            ...current,
            errorLogs: [entry, ...current.errorLogs].slice(0, MAX_ERROR_LOGS),
          };
        });
      },
      getSshProfileForConnection(connection) {
        if (!connection.sshProfileId) {
          return null;
        }
        return state.sshProfiles.find((profile) => profile.id === connection.sshProfileId) ?? null;
      },
      updateDraft(connectionId, updater) {
        setState((current) => {
          const currentDraftState = current.drafts[connectionId] ?? createDefaultDraft(connectionId);
          return {
            ...current,
            drafts: {
              ...current.drafts,
              [connectionId]: updater(currentDraftState),
            },
          };
        });
      },
      createBlankDraft(connectionId) {
        setState((current) => {
          const targetModuleId =
            current.drafts[connectionId]?.targetModuleId ??
            getFirstRequestModuleIdForConnection(connectionId, current.requestProjects, current.requestModules);

          return {
            ...current,
            drafts: {
              ...current.drafts,
              [connectionId]: createDefaultDraft(connectionId, targetModuleId),
            },
          };
        });
      },
      selectSavedRequest(requestId) {
        setState((current) => {
          const request = current.requests.find((item) => item.id === requestId);
          if (!request) {
            return current;
          }

          return normalizeState({
            ...current,
            currentConnectionId: request.connectionId,
            drafts: {
              ...current.drafts,
              [request.connectionId]: {
                connectionId: request.connectionId,
                targetModuleId: request.moduleId,
                name: request.name,
                content: buildConsoleContent(request.method, request.path, request.body),
                activeSavedRequestId: request.id,
                response: request.lastResponse,
              },
            },
          });
        });
      },
      saveRequestFromDraft(payload) {
        const request = buildSavedRequestWithModule(
          payload.connectionId,
          payload.moduleId,
          payload.name,
          payload.content,
          payload.response,
          payload.overwriteRequestId ?? undefined,
        );

        setState((current) => {
          const targetModule = current.requestModules.find((item) => item.id === payload.moduleId) ?? null;
          if (!targetModule) {
            throw new Error("请先选择一个请求模块。");
          }

          const targetProject = current.requestProjects.find((item) => item.id === targetModule.projectId) ?? null;
          if (!targetProject || targetProject.connectionId !== payload.connectionId) {
            throw new Error("当前请求模块不属于这个连接。");
          }

          const existingIndex = current.requests.findIndex((item) => item.id === request.id);
          const nextRequests = [...current.requests];

          if (existingIndex >= 0) {
            nextRequests[existingIndex] = request;
          } else {
            nextRequests.unshift(request);
          }

          return {
            ...current,
            requests: nextRequests,
            drafts: {
              ...current.drafts,
              [payload.connectionId]: {
                connectionId: payload.connectionId,
                targetModuleId: payload.moduleId,
                name: request.name,
                content: payload.content,
                activeSavedRequestId: request.id,
                response: payload.response,
              },
            },
          };
        });

        return request;
      },
      renameRequest(requestId, name) {
        const nextName = name.trim() || "未命名请求";
        setState((current) => ({
          ...current,
          requests: current.requests.map((request) =>
            request.id === requestId
              ? {
                  ...request,
                  name: nextName,
                  updatedAt: now(),
                }
              : request,
          ),
          drafts: Object.fromEntries(
            Object.entries(current.drafts).map(([connectionId, draft]) => [
              connectionId,
              draft.activeSavedRequestId === requestId
                ? {
                    ...draft,
                    name: nextName,
                  }
                : draft,
            ]),
          ),
        }));
      },
      deleteRequest(requestId) {
        setState((current) => {
          const request = current.requests.find((item) => item.id === requestId);
          if (!request) {
            return current;
          }

          const currentDraftState = current.drafts[request.connectionId] ?? createDefaultDraft(request.connectionId);
          const nextDraft =
            currentDraftState.activeSavedRequestId === requestId
              ? { ...currentDraftState, activeSavedRequestId: null }
              : currentDraftState;

          return {
            ...current,
            requests: current.requests.filter((item) => item.id !== requestId),
            drafts: {
              ...current.drafts,
              [request.connectionId]: nextDraft,
            },
          };
        });
      },
      duplicateRequest(requestId, name) {
        const source = state.requests.find((item) => item.id === requestId);
        if (!source) {
          throw new Error("请求不存在。");
        }

        const duplicate = {
          ...source,
          id: crypto.randomUUID(),
          name: name.trim(),
          updatedAt: now(),
        } satisfies SavedRequest;

        setState((current) => ({
          ...current,
          requests: [duplicate, ...current.requests],
          drafts: {
            ...current.drafts,
            [duplicate.connectionId]: {
              connectionId: duplicate.connectionId,
              targetModuleId: duplicate.moduleId,
              name: duplicate.name,
              content: buildConsoleContent(duplicate.method, duplicate.path, duplicate.body),
              activeSavedRequestId: duplicate.id,
              response: duplicate.lastResponse,
            },
          },
        }));

        return duplicate;
      },
      async refreshSearchMetadata(connection, options) {
        const currentCache = state.searchMetadata[connection.id] ?? null;
        if (!options?.force && currentCache && !isSearchMetadataExpired(currentCache)) {
          return currentCache;
        }

        const sshProfile =
          connection.sshProfileId
            ? state.sshProfiles.find((profile) => profile.id === connection.sshProfileId) ?? null
            : null;
        const [password, sshSecret] = await Promise.all([
          getConnectionPassword(connection.id, connection.username),
          sshProfile ? getConnectionSshSecret(sshProfile.id) : Promise.resolve(null),
        ]);

        if (!password) {
          throw new Error("当前连接未找到已保存密码，请回到连接页重新保存。");
        }

        const metadata = await fetchConnectionSearchMetadata(
          connection,
          { password, sshSecret },
          sshProfile?.tunnel ?? null,
        );
        const cache = buildSearchMetadataCache(connection.id, metadata);

        setState((current) => {
          if (!current.connections.some((item) => item.id === connection.id)) {
            return current;
          }

          return {
            ...current,
            searchMetadata: {
              ...current.searchMetadata,
              [connection.id]: cache,
            },
          };
        });

        return cache;
      },
      async ensureIndexFields(connection, indexOrAlias, options) {
        const trimmedName = indexOrAlias.trim();
        if (!trimmedName || trimmedName.startsWith("_") || trimmedName.includes("*")) {
          return null;
        }

        const currentCache = state.searchMetadata[connection.id] ?? null;
        const aliasTargets = currentCache?.aliasToIndices?.[trimmedName] ?? [];
        const resolvedTargets = aliasTargets.length > 0 ? aliasTargets : [trimmedName];
        const hasAllCached = resolvedTargets.every(
          (name) => (currentCache?.fieldsByIndex?.[name]?.length ?? 0) > 0,
        );
        if (!options?.force && hasAllCached) {
          const merged = new Set<string>();
          resolvedTargets.forEach((name) => {
            currentCache?.fieldsByIndex?.[name]?.forEach((item) => merged.add(item));
          });
          return [...merged].sort((left, right) => left.localeCompare(right, "zh-CN"));
        }

        const cacheKey = `${connection.id}::${trimmedName}`;
        const inFlightMap = indexFieldFetchInFlight.current;
        if (!options?.force) {
          const existing = inFlightMap.get(cacheKey);
          if (existing) {
            return existing;
          }
        }

        const sshProfile =
          connection.sshProfileId
            ? state.sshProfiles.find((profile) => profile.id === connection.sshProfileId) ?? null
            : null;

        const run = (async (): Promise<string[] | null> => {
          const [password, sshSecret] = await Promise.all([
            getConnectionPassword(connection.id, connection.username),
            sshProfile ? getConnectionSshSecret(sshProfile.id) : Promise.resolve(null),
          ]);

          if (!password) {
            throw new Error("当前连接未找到已保存密码，请回到连接页重新保存。");
          }

          const result = await fetchIndexMappingFields(
            connection,
            { password, sshSecret },
            trimmedName,
            sshProfile?.tunnel ?? null,
          );

          const fetchedIndexNames = Object.keys(result.fieldsByIndex);
          if (fetchedIndexNames.length === 0) {
            return [];
          }

          const merged = new Set<string>();
          fetchedIndexNames.forEach((indexName) => {
            result.fieldsByIndex[indexName].forEach((item) => merged.add(item));
          });

          setState((current) => {
            const existingCache = current.searchMetadata[connection.id];
            if (!existingCache) {
              return current;
            }

            const nextFieldsByIndex = { ...existingCache.fieldsByIndex };
            fetchedIndexNames.forEach((indexName) => {
              const combined = new Set<string>(nextFieldsByIndex[indexName] ?? []);
              result.fieldsByIndex[indexName].forEach((item) => combined.add(item));
              nextFieldsByIndex[indexName] = [...combined].sort((left, right) =>
                left.localeCompare(right, "zh-CN"),
              );
            });

            const nextFields = new Set<string>(existingCache.fields);
            merged.forEach((item) => nextFields.add(item));

            const nextIndices = new Set<string>(existingCache.indices);
            fetchedIndexNames.forEach((indexName) => nextIndices.add(indexName));

            const nextAliasToIndices = { ...existingCache.aliasToIndices };
            if (fetchedIndexNames.length > 0 && !fetchedIndexNames.includes(trimmedName)) {
              const combinedAliasTargets = new Set<string>(nextAliasToIndices[trimmedName] ?? []);
              fetchedIndexNames.forEach((indexName) => combinedAliasTargets.add(indexName));
              nextAliasToIndices[trimmedName] = [...combinedAliasTargets].sort((left, right) =>
                left.localeCompare(right, "zh-CN"),
              );
            }

            return {
              ...current,
              searchMetadata: {
                ...current.searchMetadata,
                [connection.id]: {
                  ...existingCache,
                  fields: [...nextFields].sort((left, right) => left.localeCompare(right, "zh-CN")),
                  fieldsByIndex: nextFieldsByIndex,
                  aliasToIndices: nextAliasToIndices,
                  indices: [...nextIndices].sort((left, right) => left.localeCompare(right, "zh-CN")),
                },
              },
            };
          });

          return [...merged].sort((left, right) => left.localeCompare(right, "zh-CN"));
        })();

        const tracked = run.finally(() => {
          inFlightMap.delete(cacheKey);
        });
        inFlightMap.set(cacheKey, tracked);
        return tracked;
      },
      recordExecution(connectionId, content, response) {
        const parsed = parseConsoleRequest(content);
        setState((current) => {
          const draft = current.drafts[connectionId] ?? createDefaultDraft(connectionId);
          const nextRequests = current.requests.map((request) =>
            request.id === draft.activeSavedRequestId
              ? {
                  ...request,
                  method: parsed.method,
                  path: parsed.path,
                  body: parsed.bodyText,
                  lastResponse: response,
                  lastStatus: response.status,
                  lastDurationMs: response.durationMs,
                  updatedAt: now(),
                }
              : request,
          );

          return {
            ...current,
            requests: nextRequests,
            drafts: {
              ...current.drafts,
              [connectionId]: {
                ...draft,
                content,
                response,
              },
            },
          };
        });
      },
      upsertRequestProject(connectionId, name, existingProjectId) {
        const timestamp = now();
        const previous = existingProjectId
          ? state.requestProjects.find((item) => item.id === existingProjectId) ?? null
          : null;
        const project = {
          id: previous?.id ?? crypto.randomUUID(),
          connectionId,
          name: name.trim() || "未命名项目",
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        } satisfies RequestProject;

        setState((current) =>
          normalizeState({
            ...current,
            requestProjects: [project, ...current.requestProjects.filter((item) => item.id !== project.id)],
          }),
        );

        return project;
      },
      upsertRequestModule(projectId, name, existingModuleId) {
        const timestamp = now();
        const previous = existingModuleId
          ? state.requestModules.find((item) => item.id === existingModuleId) ?? null
          : null;
        const targetProject = state.requestProjects.find((item) => item.id === projectId) ?? null;
        if (!targetProject) {
          throw new Error("所属请求项目不存在，请重新选择后再试。");
        }

        const module = {
          id: previous?.id ?? crypto.randomUUID(),
          projectId,
          name: name.trim() || "未命名模块",
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        } satisfies RequestModule;

        setState((current) =>
          normalizeState({
            ...current,
            requestProjects: current.requestProjects.map((project) =>
              project.id === projectId
                ? {
                    ...project,
                    updatedAt: timestamp,
                  }
                : project,
            ),
            requestModules: [module, ...current.requestModules.filter((item) => item.id !== module.id)],
            drafts: {
              ...current.drafts,
              [targetProject.connectionId]: {
                ...(current.drafts[targetProject.connectionId] ??
                  createDefaultDraft(targetProject.connectionId, module.id)),
                targetModuleId: module.id,
              },
            },
          }),
        );

        return module;
      },
      deleteRequestProject(projectId) {
        setState((current) => {
          const target = current.requestProjects.find((item) => item.id === projectId);
          if (!target) {
            return current;
          }

          const removedModuleIds = new Set(
            current.requestModules.filter((item) => item.projectId === projectId).map((item) => item.id),
          );
          const removedRequestIds = new Set(
            current.requests.filter((request) => request.moduleId && removedModuleIds.has(request.moduleId)).map((request) => request.id),
          );

          return cleanupRemovedRequests(
            {
              ...current,
              requestProjects: current.requestProjects.filter((item) => item.id !== projectId),
              requestModules: current.requestModules.filter((item) => item.projectId !== projectId),
            },
            removedRequestIds,
            removedModuleIds,
          );
        });
      },
      deleteRequestModule(moduleId) {
        setState((current) => {
          const removedRequestIds = new Set(
            current.requests.filter((request) => request.moduleId === moduleId).map((request) => request.id),
          );

          return cleanupRemovedRequests(
            {
              ...current,
              requestModules: current.requestModules.filter((item) => item.id !== moduleId),
            },
            removedRequestIds,
            new Set([moduleId]),
          );
        });
      },
      upsertProject(formValues, existingProjectId) {
        const timestamp = now();
        const previous = existingProjectId ? state.projects.find((item) => item.id === existingProjectId) ?? null : null;
        const project = {
          id: previous?.id ?? crypto.randomUUID(),
          name: formValues.name.trim() || "未命名项目",
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        } satisfies ProjectProfile;

        setState((current) => {
          const nextProjects = current.projects.filter((item) => item.id !== project.id);
          nextProjects.unshift(project);

          return normalizeState({
            ...current,
            projects: nextProjects,
          });
        });

        return project;
      },
      upsertModule(formValues, projectId, existingModuleId) {
        const timestamp = now();
        const parentProject = state.projects.find((item) => item.id === projectId) ?? null;
        if (!parentProject) {
          throw new Error("所属项目不存在，请重新选择后再试。");
        }

        const previous = existingModuleId ? state.modules.find((item) => item.id === existingModuleId) ?? null : null;
        const module = {
          id: previous?.id ?? crypto.randomUUID(),
          projectId,
          name: formValues.name.trim() || "未命名模块",
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        } satisfies ModuleProfile;

        setState((current) => {
          const nextModules = current.modules.filter((item) => item.id !== module.id);
          nextModules.unshift(module);

          return normalizeState({
            ...current,
            projects: current.projects.map((project) =>
              project.id === projectId
                ? {
                    ...project,
                    updatedAt: timestamp,
                  }
                : project,
            ),
            modules: nextModules,
          });
        });

        return module;
      },
      async upsertSshProfile(formValues, existingProfileId) {
        const timestamp = now();
        const tunnel = buildSshTunnelConfig(formValues);
        const previous = existingProfileId ? state.sshProfiles.find((item) => item.id === existingProfileId) ?? null : null;
        const profileId = previous?.id ?? crypto.randomUUID();
        const sshSecret = getSshSecretFromForm(formValues);

        if (sshSecret) {
          await saveConnectionSshSecret(profileId, sshSecret);
        } else {
          await deleteConnectionSshSecret(profileId);
        }

        const profile = {
          id: profileId,
          name: formValues.name.trim() || `${tunnel.username}@${tunnel.host}`,
          tunnel,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
          lastVerifiedAt: timestamp,
        } satisfies SshProfile;

        setState((current) => {
          const nextProfiles = current.sshProfiles.filter((item) => item.id !== profileId);
          nextProfiles.unshift(profile);
          const affectedConnectionIds = new Set(
            current.connections.filter((connection) => connection.sshProfileId === profileId).map((connection) => connection.id),
          );

          return {
            ...current,
            sshProfiles: nextProfiles,
            searchMetadata: Object.fromEntries(
              Object.entries(current.searchMetadata).filter(([connectionId]) => !affectedConnectionIds.has(connectionId)),
            ),
          };
        });

        return profile;
      },
      async upsertConnection(formValues, existingConnectionId) {
        const timestamp = now();
        const normalizedBaseUrl = normalizeBaseUrl(formValues.baseUrl);
        const previous = existingConnectionId
          ? state.connections.find((item) => item.id === existingConnectionId) ?? null
          : null;
        const connectionId = previous?.id ?? crypto.randomUUID();

        if (previous && previous.username !== formValues.username) {
          await deleteConnectionPassword(previous.id, previous.username);
        }

        await saveConnectionPassword(connectionId, formValues.username, formValues.password);

        const profile = {
          id: connectionId,
          name: formValues.name.trim() || normalizedBaseUrl,
          moduleId: null,
          baseUrl: normalizedBaseUrl,
          username: formValues.username.trim(),
          insecureTls: formValues.insecureTls,
          sshProfileId: formValues.sshProfileId.trim() || null,
          sshTunnel: null,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
          lastUsedAt: timestamp,
        } satisfies ConnectionProfile;

        setState((current) => {
          const nextConnections = current.connections.filter((item) => item.id !== connectionId);
          nextConnections.unshift(profile);
          const nextDrafts = {
            ...current.drafts,
            [connectionId]: current.drafts[connectionId] ?? createDefaultDraft(connectionId),
          };
          const nextSearchMetadata = { ...current.searchMetadata };
          delete nextSearchMetadata[connectionId];

          return normalizeState({
            ...current,
            connections: nextConnections,
            searchMetadata: nextSearchMetadata,
            drafts: nextDrafts,
            currentConnectionId: connectionId,
          });
        });

        return profile;
      },
      async deleteProject(projectId) {
        const target = state.projects.find((item) => item.id === projectId);
        if (!target) {
          return;
        }

        const moduleIds = new Set(state.modules.filter((item) => item.projectId === projectId).map((item) => item.id));
        const connectionsToDelete = state.connections.filter(
          (connection) => connection.moduleId && moduleIds.has(connection.moduleId),
        );

        await Promise.all(
          connectionsToDelete.map((connection) => deleteConnectionPassword(connection.id, connection.username)),
        );

        const connectionIds = new Set(connectionsToDelete.map((connection) => connection.id));

        setState((current) =>
          removeConnectionsFromState(
            {
              ...current,
              projects: current.projects.filter((item) => item.id !== projectId),
              modules: current.modules.filter((item) => item.projectId !== projectId),
            },
            connectionIds,
          ),
        );
      },
      async deleteModule(moduleId) {
        const target = state.modules.find((item) => item.id === moduleId);
        if (!target) {
          return;
        }

        const connectionsToDelete = state.connections.filter((connection) => connection.moduleId === moduleId);

        await Promise.all(
          connectionsToDelete.map((connection) => deleteConnectionPassword(connection.id, connection.username)),
        );

        const connectionIds = new Set(connectionsToDelete.map((connection) => connection.id));

        setState((current) =>
          removeConnectionsFromState(
            {
              ...current,
              modules: current.modules.filter((item) => item.id !== moduleId),
            },
            connectionIds,
          ),
        );
      },
      async deleteSshProfile(profileId) {
        const target = state.sshProfiles.find((item) => item.id === profileId);
        if (!target) {
          return;
        }

        await deleteConnectionSshSecret(profileId);

        setState((current) =>
          normalizeState({
            ...current,
            sshProfiles: current.sshProfiles.filter((item) => item.id !== profileId),
            searchMetadata: Object.fromEntries(
              Object.entries(current.searchMetadata).filter(
                ([connectionId]) =>
                  current.connections.find((connection) => connection.id === connectionId)?.sshProfileId !== profileId,
              ),
            ),
            connections: current.connections.map((connection) =>
              connection.sshProfileId === profileId
                ? {
                    ...connection,
                    sshProfileId: null,
                  }
                : connection,
            ),
          }),
        );
      },
      async deleteConnection(connectionId) {
        const target = state.connections.find((item) => item.id === connectionId);
        if (!target) {
          return;
        }

        await deleteConnectionPassword(target.id, target.username);

        setState((current) => removeConnectionsFromState(current, new Set([connectionId])));
      },
      async getPassword(connection) {
        return getConnectionPassword(connection.id, connection.username);
      },
      async getSshSecret(sshProfile) {
        if (!sshProfile) {
          return null;
        }
        return getConnectionSshSecret(sshProfile.id);
      },
    }),
    [currentConnection, currentDraft, ready, requestsForCurrentConnection, state],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return value;
}
