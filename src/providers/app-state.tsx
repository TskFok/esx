import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { toast } from "sonner";
import { buildConsoleContent, parseConsoleRequest } from "../lib/console-parser";
import {
  createDefaultDraft,
  createEmptyStorage,
  readAppStorage,
  writeAppStorage,
} from "../lib/storage";
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
  currentConnection: ConnectionProfile | null;
  currentDraft: ConsoleDraft | null;
  requestsForCurrentConnection: SavedRequest[];
  errorLoggingEnabled: boolean;
  errorLogs: ErrorLogEntry[];
  setCurrentConnection: (connectionId: string) => void;
  setErrorLoggingEnabled: (enabled: boolean) => void;
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
    drafts: nextDrafts,
    currentConnectionId:
      current.currentConnectionId && connectionIds.has(current.currentConnectionId)
        ? nextConnections[0]?.id ?? null
        : current.currentConnectionId,
  });
}

function normalizeState(state: AppStateShape): AppStateShape {
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
      if (request.moduleId && requestModuleIds.has(request.moduleId)) {
        return request;
      }

      return {
        ...request,
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
    drafts: nextDrafts,
    currentConnectionId:
      state.currentConnectionId && normalizedConnections.some((item) => item.id === state.currentConnectionId)
        ? state.currentConnectionId
        : normalizedConnections[0]?.id ?? null,
    settings: {
      enabled: state.settings?.enabled ?? false,
    },
    errorLogs: [...(state.errorLogs ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
}

export function AppStateProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AppStateShape>(createEmptyStorage());

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

  const value = useMemo<AppStateContextValue>(
    () => ({
      ready,
      projects: state.projects,
      modules: state.modules,
      connections: state.connections,
      sshProfiles: state.sshProfiles,
      requestProjects: state.requestProjects,
      requestModules: state.requestModules,
      currentConnection,
      currentDraft,
      requestsForCurrentConnection,
      errorLoggingEnabled: state.settings.enabled,
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
            diagnostics: payload.diagnostics ?? [],
            status: payload.status ?? null,
            rawResponse: payload.rawResponse,
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

          return {
            ...current,
            sshProfiles: nextProfiles,
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

          return normalizeState({
            ...current,
            connections: nextConnections,
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
