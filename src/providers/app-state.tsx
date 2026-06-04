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
import {
  getAuthSecretFromForm,
  getAuthSecretKey,
  normalizeConnectionProfileSecurity,
  normalizeSshProfileSecurity,
} from "../lib/connection-security";
import type { AiAnalysisSettings } from "../types/ai-settings";
import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../types/ai-settings";
import type { AiAnalysisHistoryEntry } from "../types/ai-analysis-history";
import { createAiAnalysisHistoryEntry, prependAiAnalysisHistory } from "../types/ai-analysis-history";
import type { RequestAnalysisResult } from "../lib/request-analyzer";
import type { ErrorLogConnectionContext, ErrorLogEntry, ErrorLogRequestContext } from "../types/logs";
import {
  deleteAiApiKey,
  deleteConnectionSecret,
  deleteConnectionSshSecret,
  deleteConnectionPassword,
  getAiApiKey,
  getConnectionSecret,
  getConnectionSshSecret,
  getConnectionPassword,
  loadSecretsVault,
  saveAiApiKey,
  saveConnectionSecret,
  saveConnectionSshSecret,
  saveConnectionPassword,
} from "../lib/tauri";
import { removeConnectionsFromStorage } from "../lib/connection-state";
import { type RequestImportMode } from "../lib/request-import-export";
import {
  assignMissingSortOrders,
  buildSortOrdersFromIds,
  getConnectionRequests,
} from "../lib/request-list";
import {
  applyDuplicateRequest,
  applyImportConnectionRequests,
  applySaveRequestFromDraft,
} from "../lib/request-state-mutations";
import { mergeTagChanges, normalizeRequestTags } from "../lib/request-tags";
import { isErrorLoggingEnabled, normalizeErrorLogSettings } from "../lib/error-log-settings";
import { redactSensitiveList, redactSensitiveText } from "../lib/log-redaction";
import { buildSecretsMigrationHint } from "../lib/secrets-vault";
import { appendStatusHistorySnapshot } from "../lib/status-diagnostics";
import { normalizeBaseUrl } from "../lib/http-client";
import { normalizeClusterMetadata } from "../lib/console-autocomplete";
import type {
  ConnectionFormValues,
  ConnectionProfile,
  SshProfile,
  SshProfileFormValues,
} from "../types/connections";
import type {
  ConnectionSearchMetadata,
  ConsoleDraft,
  ResponseSnapshot,
  SavedRequest,
} from "../types/requests";
import type { ServerStatusSnapshot } from "../types/status";

type AppStateShape = ReturnType<typeof createEmptyStorage>;

type LegacyStoredDraft = ConsoleDraft & {
  targetModuleId?: string | null;
};

type LegacyStoredRequest = Partial<SavedRequest> & {
  id: string;
  connectionId: string;
  name: string;
  method: string;
  path: string;
  body: string;
  updatedAt: string;
  moduleId?: string | null;
};

type SaveRequestPayload = {
  connectionId: string;
  name: string;
  content: string;
  response: ResponseSnapshot | null;
  overwriteRequestId?: string | null;
};

type AppStateContextValue = {
  ready: boolean;
  connections: ConnectionProfile[];
  sshProfiles: SshProfile[];
  searchMetadataByConnection: Record<string, ConnectionSearchMetadata>;
  currentConnection: ConnectionProfile | null;
  currentDraft: ConsoleDraft | null;
  requestsForCurrentConnection: SavedRequest[];
  errorLoggingEnabled: boolean;
  responsePreviewBytes: number;
  aiSettings: AiAnalysisSettings;
  aiApiKeyConfigured: boolean;
  aiAnalysisHistory: AiAnalysisHistoryEntry[];
  errorLogs: ErrorLogEntry[];
  statusHistoryByConnection: Record<string, ServerStatusSnapshot[]>;
  setCurrentConnection: (connectionId: string) => void;
  setErrorLoggingEnabled: (enabled: boolean) => void;
  setResponsePreviewBytes: (bytes: number) => void;
  updateAiSettings: (settings: AiAnalysisSettings) => void;
  saveAiSettings: (payload: {
    settings: AiAnalysisSettings;
    apiKey: string | null;
    clearApiKey: boolean;
  }) => Promise<void>;
  getAiApiKey: () => Promise<string | null>;
  recordAiAnalysisHistory: (payload: {
    connectionId: string | null;
    connectionName: string | null;
    requestContent: string;
    result: RequestAnalysisResult;
  }) => void;
  clearAiAnalysisHistory: () => void;
  clearErrorLogs: () => void;
  recordStatusSnapshot: (connectionId: string, snapshot: ServerStatusSnapshot) => void;
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
  recordAuditLog: (payload: {
    scope: "request-audit";
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
  updateRequest: (requestId: string, payload: { name?: string; tags?: string[] }) => void;
  bulkUpdateRequestTags: (
    requestIds: string[],
    payload: { add?: string[]; remove?: string[] },
  ) => void;
  deleteRequest: (requestId: string) => void;
  duplicateRequest: (requestId: string, name: string) => SavedRequest;
  reorderConnectionRequests: (connectionId: string, orderedRequestIds: string[]) => void;
  importConnectionRequests: (
    connectionId: string,
    entries: Array<{
      name: string;
      method: string;
      path: string;
      body: string;
      tags: string[];
      sortOrder: number;
    }>,
    mode: RequestImportMode,
  ) => SavedRequest[];
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
  upsertSshProfile: (
    formValues: SshProfileFormValues,
    existingProfileId?: string,
    trustedHostKeySha256?: string | null,
  ) => Promise<SshProfile>;
  upsertConnection: (
    formValues: ConnectionFormValues,
    existingConnectionId?: string,
  ) => Promise<ConnectionProfile>;
  deleteSshProfile: (profileId: string) => Promise<void>;
  deleteConnection: (connectionId: string) => Promise<void>;
  getPassword: (connection: ConnectionProfile) => Promise<string | null>;
  getSshSecret: (sshProfile: SshProfile | null) => Promise<string | null>;
  getSshProfileForConnection: (connection: ConnectionProfile) => SshProfile | null;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);
const MAX_ERROR_LOGS = 200;
const SEARCH_METADATA_TTL_MS = 5 * 60 * 1000;

type LogPayload = {
  scope: ErrorLogEntry["scope"];
  title: string;
  summary: string;
  diagnostics?: string[];
  status?: number | null;
  rawResponse?: string;
  connection?: ErrorLogConnectionContext;
  request?: ErrorLogRequestContext;
};

function now() {
  return new Date().toISOString();
}

function buildLocalLogEntry(payload: LogPayload, responsePreviewBytes: number) {
  return {
    id: crypto.randomUUID(),
    createdAt: now(),
    scope: payload.scope,
    title: payload.title,
    summary: payload.summary,
    diagnostics: redactSensitiveList(payload.diagnostics ?? []).map((item) =>
      createTextPreview(item, responsePreviewBytes).text
    ),
    status: payload.status ?? null,
    rawResponse: payload.rawResponse
      ? createTextPreview(redactSensitiveText(payload.rawResponse), responsePreviewBytes).text
      : undefined,
    connection: payload.connection,
    request: payload.request
      ? {
          ...payload.request,
          content: payload.request.content ? redactSensitiveText(payload.request.content) : undefined,
        }
      : undefined,
  } satisfies ErrorLogEntry;
}

function appendLocalLogEntry(logs: ErrorLogEntry[], entry: ErrorLogEntry) {
  return [entry, ...logs].slice(0, MAX_ERROR_LOGS);
}

function normalizeStoredConnection(connection: ConnectionProfile) {
  return normalizeConnectionProfileSecurity({
    ...connection,
    sshProfileId: connection.sshProfileId ?? (connection.sshTunnel ? connection.id : null),
    sshTunnel: connection.sshTunnel ?? null,
  } satisfies ConnectionProfile);
}

function normalizeStoredDraft(draft: LegacyStoredDraft): ConsoleDraft {
  return {
    connectionId: draft.connectionId,
    name: draft.name ?? "",
    content: draft.content ?? "GET /_cluster/health",
    activeSavedRequestId: draft.activeSavedRequestId ?? null,
    response: draft.response ?? null,
  };
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
    cluster: normalizeClusterMetadata(cache.cluster),
    fetchedAt: cache.fetchedAt,
    expiresAt: cache.expiresAt,
  } satisfies ConnectionSearchMetadata;
}

function normalizeStoredSshProfile(profile: SshProfile) {
  return normalizeSshProfileSecurity({
    ...profile,
    name: profile.name.trim() || `${profile.tunnel.username}@${profile.tunnel.host}`,
  } satisfies SshProfile);
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
    hostKeyPolicy: "trustOnFirstUse",
    trustedHostKeySha256: null,
  } satisfies SshProfile;
}

function removeConnectionsFromState(current: AppStateShape, connectionIds: Set<string>) {
  const next = removeConnectionsFromStorage(current, connectionIds);
  return next ? normalizeState(next) : current;
}

function normalizeAiSettings(settings: AiAnalysisSettings | null | undefined): AiAnalysisSettings {
  return {
    enabled: settings?.enabled ?? DEFAULT_AI_ANALYSIS_SETTINGS.enabled,
    baseUrl: settings?.baseUrl?.trim() || DEFAULT_AI_ANALYSIS_SETTINGS.baseUrl,
    model: settings?.model?.trim() || DEFAULT_AI_ANALYSIS_SETTINGS.model,
    providerId: settings?.providerId ?? DEFAULT_AI_ANALYSIS_SETTINGS.providerId,
    apiKeyRequired: settings?.apiKeyRequired ?? DEFAULT_AI_ANALYSIS_SETTINGS.apiKeyRequired,
    thinkingModeEnabled: settings?.thinkingModeEnabled ?? DEFAULT_AI_ANALYSIS_SETTINGS.thinkingModeEnabled,
  };
}

function normalizeAiAnalysisHistory(history: AiAnalysisHistoryEntry[] | null | undefined) {
  return [...(history ?? [])]
    .map((item) => ({
      ...item,
      connectionName: item.connectionName ?? null,
    }))
    .filter((item) => item && typeof item.id === "string" && typeof item.createdAt === "string")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function normalizeState(state: AppStateShape): AppStateShape {
  const responsePreviewBytes = normalizeResponsePreviewBytes(state.settings?.responsePreviewBytes);

  const normalizedConnections = [...(state.connections ?? [])]
    .map(normalizeStoredConnection)
    .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));

  const connectionIds = new Set(normalizedConnections.map((connection) => connection.id));
  const normalizedSearchMetadata = Object.fromEntries(
    Object.entries(state.searchMetadata ?? {})
      .map(([connectionId, cache]) => [connectionId, normalizeStoredSearchMetadata(cache, connectionIds)] as const)
      .filter((entry): entry is readonly [string, ConnectionSearchMetadata] => Boolean(entry[1])),
  );

  const normalizedSshProfiles = [...(state.sshProfiles ?? [])].map(normalizeStoredSshProfile);
  const sshProfilesById = new Map(normalizedSshProfiles.map((profile) => [profile.id, profile]));

  normalizedConnections.forEach((connection) => {
    const legacyProfile = buildLegacySshProfile(connection);
    if (legacyProfile && !sshProfilesById.has(legacyProfile.id)) {
      sshProfilesById.set(legacyProfile.id, legacyProfile);
    }
  });

  const nextRequests = assignMissingSortOrders(
    (state.requests ?? [])
      .filter((request) => connectionIds.has(request.connectionId))
      .map((request) => {
        const legacyRequest = request as LegacyStoredRequest;
        const lastResponse = normalizeResponseSnapshot(legacyRequest.lastResponse ?? null, responsePreviewBytes);
        return {
          id: legacyRequest.id,
          connectionId: legacyRequest.connectionId,
          name: legacyRequest.name,
          method: legacyRequest.method,
          path: legacyRequest.path,
          body: legacyRequest.body,
          headers: legacyRequest.headers,
          tags: normalizeRequestTags(legacyRequest.tags),
          sortOrder: legacyRequest.sortOrder ?? 0,
          lastResponse,
          lastStatus: lastResponse?.status ?? legacyRequest.lastStatus ?? null,
          lastDurationMs: lastResponse?.durationMs ?? legacyRequest.lastDurationMs ?? null,
          updatedAt: legacyRequest.updatedAt,
        } satisfies SavedRequest;
      }),
  );

  const requestsById = new Map(nextRequests.map((request) => [request.id, request]));
  const nextDrafts = Object.fromEntries(
    Object.entries(state.drafts ?? {}).filter(([connectionId]) => connectionIds.has(connectionId)),
  );

  normalizedConnections.forEach((connection) => {
    const currentDraftState = nextDrafts[connection.id] as LegacyStoredDraft | undefined;
    const activeRequest =
      currentDraftState?.activeSavedRequestId ? requestsById.get(currentDraftState.activeSavedRequestId) ?? null : null;

    nextDrafts[connection.id] = currentDraftState
      ? normalizeStoredDraft({
          ...currentDraftState,
          activeSavedRequestId: activeRequest?.id ?? null,
          response: activeRequest?.lastResponse ?? normalizeResponseSnapshot(currentDraftState.response, responsePreviewBytes),
        })
      : createDefaultDraft(connection.id);
  });

  return {
    connections: normalizedConnections,
    sshProfiles: [...sshProfilesById.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    requests: nextRequests,
    searchMetadata: normalizedSearchMetadata,
    drafts: nextDrafts,
    currentConnectionId:
      state.currentConnectionId && normalizedConnections.some((item) => item.id === state.currentConnectionId)
        ? state.currentConnectionId
        : normalizedConnections[0]?.id ?? null,
    settings: normalizeErrorLogSettings({
      ...state.settings,
      responsePreviewBytes,
    }),
    aiSettings: normalizeAiSettings(state.aiSettings),
    aiAnalysisHistory: normalizeAiAnalysisHistory(state.aiAnalysisHistory),
    errorLogs: [...(state.errorLogs ?? [])]
      .map((log) => normalizeStoredErrorLog(log, responsePreviewBytes))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    statusHistory: Object.fromEntries(
      Object.entries(state.statusHistory ?? {})
        .filter(([connectionId]) => connectionIds.has(connectionId))
        .map(([connectionId, history]) => [
          connectionId,
          [...(history ?? [])]
            .filter((item) => item && typeof item.fetchedAt === "string")
            .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))
            .slice(0, 200),
        ]),
    ),
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
    cluster?: ConnectionSearchMetadata["cluster"];
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
    cluster: normalizeClusterMetadata(metadata.cluster),
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
  const [aiApiKeyConfigured, setAiApiKeyConfigured] = useState(false);
  const indexFieldFetchInFlight = useRef(new Map<string, Promise<string[] | null>>());

  useEffect(() => {
    let cancelled = false;

    readAppStorage()
      .then(async (loaded) => {
        if (cancelled) {
          return;
        }

        const normalized = normalizeState(loaded);
        const vaultStatus = await loadSecretsVault(
          buildSecretsMigrationHint({
            connections: normalized.connections,
            sshProfiles: normalized.sshProfiles,
          }),
        );

        if (cancelled) {
          return;
        }

        setState(normalized);
        setAiApiKeyConfigured(vaultStatus.aiApiKeyConfigured);
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
    ? state.drafts[currentConnection.id] ?? createDefaultDraft(currentConnection.id)
    : null;

  const requestsForCurrentConnection = useMemo(
    () => (currentConnection ? getConnectionRequests(currentConnection.id, state.requests) : []),
    [currentConnection, state.requests],
  );
  const responsePreviewBytes = normalizeResponsePreviewBytes(state.settings.responsePreviewBytes);

  const value = useMemo<AppStateContextValue>(
    () => ({
      ready,
      connections: state.connections,
      sshProfiles: state.sshProfiles,
      searchMetadataByConnection: state.searchMetadata,
      currentConnection,
      currentDraft,
      requestsForCurrentConnection,
      errorLoggingEnabled: isErrorLoggingEnabled(state.settings),
      responsePreviewBytes,
      aiSettings: state.aiSettings,
      aiApiKeyConfigured,
      aiAnalysisHistory: state.aiAnalysisHistory,
      errorLogs: state.errorLogs,
      statusHistoryByConnection: state.statusHistory,
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
      updateAiSettings(settings) {
        setState((current) =>
          normalizeState({
            ...current,
            aiSettings: settings,
          }),
        );
      },
      async saveAiSettings(payload) {
        const nextSettings = normalizeAiSettings(payload.settings);
        if (payload.clearApiKey) {
          await deleteAiApiKey();
          setAiApiKeyConfigured(false);
        } else if (payload.apiKey) {
          await saveAiApiKey(payload.apiKey);
          setAiApiKeyConfigured(true);
        }

        setState((current) =>
          normalizeState({
            ...current,
            aiSettings: nextSettings,
          }),
        );
      },
      async getAiApiKey() {
        return getAiApiKey();
      },
      recordAiAnalysisHistory(payload) {
        setState((current) =>
          normalizeState({
            ...current,
            aiAnalysisHistory: prependAiAnalysisHistory(
              current.aiAnalysisHistory,
              createAiAnalysisHistoryEntry({
                connectionId: payload.connectionId,
                connectionName: payload.connectionName,
                requestContent: payload.requestContent,
                result: payload.result,
                model: current.aiSettings.model,
                providerId: current.aiSettings.providerId,
              }),
            ),
          }),
        );
      },
      clearAiAnalysisHistory() {
        setState((current) => ({
          ...current,
          aiAnalysisHistory: [],
        }));
      },
      clearErrorLogs() {
        setState((current) => ({
          ...current,
          errorLogs: [],
        }));
      },
      recordStatusSnapshot(connectionId, snapshot) {
        setState((current) => ({
          ...current,
          statusHistory: {
            ...current.statusHistory,
            [connectionId]: appendStatusHistorySnapshot(current.statusHistory[connectionId] ?? [], snapshot),
          },
        }));
      },
      recordErrorLog(payload) {
        setState((current) => {
          if (!isErrorLoggingEnabled(current.settings)) {
            return current;
          }

          return {
            ...current,
            errorLogs: appendLocalLogEntry(
              current.errorLogs,
              buildLocalLogEntry(payload, current.settings.responsePreviewBytes),
            ),
          };
        });
      },
      recordAuditLog(payload) {
        setState((current) => {
          return {
            ...current,
            errorLogs: appendLocalLogEntry(
              current.errorLogs,
              buildLocalLogEntry(payload, current.settings.responsePreviewBytes),
            ),
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
        setState((current) => ({
          ...current,
          drafts: {
            ...current.drafts,
            [connectionId]: createDefaultDraft(connectionId),
          },
        }));
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
        const { request, next } = applySaveRequestFromDraft(state, payload);

        setState((current) => ({
          ...current,
          ...next,
        }));

        return request;
      },
      updateRequest(requestId, payload) {
        setState((current) => {
          const target = current.requests.find((item) => item.id === requestId);
          if (!target) {
            return current;
          }

          const nextName = payload.name !== undefined ? payload.name.trim() || "未命名请求" : target.name;
          const nextTags = payload.tags !== undefined ? normalizeRequestTags(payload.tags) : target.tags;

          return {
            ...current,
            requests: current.requests.map((request) =>
              request.id === requestId
                ? {
                    ...request,
                    name: nextName,
                    tags: nextTags,
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
          };
        });
      },
      bulkUpdateRequestTags(requestIds, payload) {
        const ids = new Set(requestIds);
        if (ids.size === 0) {
          return;
        }

        setState((current) => ({
          ...current,
          requests: current.requests.map((request) =>
            ids.has(request.id)
              ? {
                  ...request,
                  tags: mergeTagChanges(request.tags, payload.add ?? [], payload.remove ?? []),
                  updatedAt: now(),
                }
              : request,
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

        const { duplicate, next } = applyDuplicateRequest(state, source, name);

        setState((current) => ({
          ...current,
          ...next,
        }));

        return duplicate;
      },
      reorderConnectionRequests(connectionId, orderedRequestIds) {
        const sortOrders = buildSortOrdersFromIds(orderedRequestIds);

        setState((current) => ({
          ...current,
          requests: current.requests.map((request) => {
            if (request.connectionId !== connectionId) {
              return request;
            }

            const nextSortOrder = sortOrders.get(request.id);
            if (nextSortOrder === undefined) {
              return request;
            }

            return {
              ...request,
              sortOrder: nextSortOrder,
            };
          }),
        }));
      },
      importConnectionRequests(connectionId, entries, mode) {
        const { importedRequests, next } = applyImportConnectionRequests(state, connectionId, entries, mode);

        setState((current) =>
          normalizeState({
            ...current,
            ...next,
          }),
        );

        return importedRequests;
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
      async upsertSshProfile(formValues, existingProfileId, trustedHostKeySha256) {
        const timestamp = now();
        const tunnel = buildSshTunnelConfig(formValues);
        const previous = existingProfileId ? state.sshProfiles.find((item) => item.id === existingProfileId) ?? null : null;
        const normalizedPrevious = previous ? normalizeSshProfileSecurity(previous) : null;
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
          hostKeyPolicy: normalizedPrevious?.hostKeyPolicy ?? "trustOnFirstUse",
          trustedHostKeySha256: trustedHostKeySha256 ?? normalizedPrevious?.trustedHostKeySha256 ?? null,
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
        const auth = { type: formValues.authType };
        const previous = existingConnectionId
          ? state.connections.find((item) => item.id === existingConnectionId) ?? null
          : null;
        const connectionId = previous?.id ?? crypto.randomUUID();

        if (previous) {
          await deleteConnectionSecret(previous.id, getAuthSecretKey(previous.auth, previous.username));
          if (previous.username !== formValues.username) {
            await deleteConnectionPassword(previous.id, previous.username);
          }
        }

        const authSecret = getAuthSecretFromForm(formValues);
        await saveConnectionSecret(connectionId, getAuthSecretKey(auth, formValues.username), authSecret);
        if (auth.type === "basic") {
          await saveConnectionPassword(connectionId, formValues.username, formValues.password);
        }

        const profile = {
          id: connectionId,
          name: formValues.name.trim() || normalizedBaseUrl,
          baseUrl: normalizedBaseUrl,
          username: formValues.username.trim(),
          auth,
          tls: {
            mode: formValues.tlsMode,
            caPath: formValues.tlsCaPath.trim() || undefined,
            fingerprint: formValues.tlsFingerprint.trim() || undefined,
          },
          environment: formValues.environment,
          readonly: formValues.readonly,
          insecureTls: formValues.tlsMode === "insecure" || formValues.insecureTls,
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
        await deleteConnectionSecret(target.id, getAuthSecretKey(target.auth, target.username));

        setState((current) => removeConnectionsFromState(current, new Set([connectionId])));
      },
      async getPassword(connection) {
        const normalized = normalizeConnectionProfileSecurity(connection);
        const authSecret = await getConnectionSecret(connection.id, getAuthSecretKey(normalized.auth, normalized.username));
        if (authSecret) {
          return normalized.auth.type === "basic" ? authSecret.split(":", 2)[1] ?? authSecret : authSecret;
        }
        return getConnectionPassword(connection.id, connection.username);
      },
      async getSshSecret(sshProfile) {
        if (!sshProfile) {
          return null;
        }
        return getConnectionSshSecret(sshProfile.id);
      },
    }),
    [aiApiKeyConfigured, currentConnection, currentDraft, ready, requestsForCurrentConnection, state],
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
