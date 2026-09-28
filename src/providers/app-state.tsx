import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { flushSync } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { buildConsoleContent, parseConsoleRequest } from "../lib/console-parser";
import { clearTargetFields, hasFreshTargetFields, mergeTargetFields, normalizeFieldCache, resolveFieldTargets } from "../lib/search-metadata-cache";
import { createPersistQueue } from "../lib/persist-queue";
import { fetchConnectionSearchMetadata, fetchTargetMappingFields } from "../lib/http-client";
import {
  createDefaultDraft,
  createEmptyStorage,
  readAppStorage,
  writeAppStorage,
  type StoragePartition,
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
  getSshTunnelForProfile,
  normalizeConnectionProfileSecurity,
  normalizeSshProfileSecurity,
} from "../lib/connection-security";
import type { AiAnalysisSettings } from "../types/ai-settings";
import { DEFAULT_AI_ANALYSIS_SETTINGS, getAiCredentialScope } from "../types/ai-settings";
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
import { redactSensitiveList, redactSensitiveText, redactSensitiveValue } from "../lib/log-redaction";
import { buildSecretsMigrationHint } from "../lib/secrets-vault";
import { appendStatusHistorySnapshot } from "../lib/status-diagnostics";
import { normalizeBaseUrl } from "../lib/http-client";
import { normalizeClusterMetadata } from "../lib/console-autocomplete/capabilities";
import {
  buildConnectionExportPayload,
  buildConnectionImportPlan,
  type ConnectionExportPayload,
} from "../lib/connection-import-export";
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
import type { OperationsStatusSnapshot } from "../types/status";

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
  registerPendingDraftFlush: (flush: () => void) => () => void;
  flushAppState: (commit?: () => void) => Promise<void>;
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
  statusHistoryByConnection: Record<string, OperationsStatusSnapshot[]>;
  setCurrentConnection: (connectionId: string) => void;
  setErrorLoggingEnabled: (enabled: boolean) => void;
  setResponsePreviewBytes: (bytes: number) => void;
  updateAiSettings: (settings: AiAnalysisSettings) => Promise<void>;
  saveAiSettings: (payload: {
    settings: AiAnalysisSettings;
    apiKey: string | null;
    clearApiKey: boolean;
  }) => Promise<void>;
  getAiApiKey: (expectedScope?: string | null) => Promise<string | null>;
  recordAiAnalysisHistory: (payload: {
    connectionId: string | null;
    connectionName: string | null;
    requestContent: string;
    result: RequestAnalysisResult;
  }) => void;
  clearAiAnalysisHistory: () => void;
  clearErrorLogs: () => void;
  recordStatusSnapshot: (connectionId: string, snapshot: OperationsStatusSnapshot) => void;
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
  ensureTargetFields: (
    connection: ConnectionProfile,
    targets: string[],
    options?: { force?: boolean },
  ) => Promise<string[] | null>;
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
  exportConnections: () => Promise<ConnectionExportPayload>;
  importConnections: (payload: ConnectionExportPayload) => Promise<{
    connectionsImported: number;
    sshProfilesImported: number;
  }>;
};

export type AppStateView = Pick<AppStateContextValue,
  | "ready" | "connections" | "sshProfiles" | "searchMetadataByConnection"
  | "currentConnection" | "currentDraft" | "requestsForCurrentConnection"
  | "errorLoggingEnabled" | "responsePreviewBytes" | "aiSettings"
  | "aiApiKeyConfigured" | "aiAnalysisHistory" | "errorLogs"
  | "statusHistoryByConnection"
>;
export type AppStateActions = Omit<AppStateContextValue, keyof AppStateView>;

const viewKeys = [
  "ready", "connections", "sshProfiles", "searchMetadataByConnection", "currentConnection",
  "currentDraft", "requestsForCurrentConnection", "errorLoggingEnabled", "responsePreviewBytes",
  "aiSettings", "aiApiKeyConfigured", "aiAnalysisHistory", "errorLogs", "statusHistoryByConnection",
] as const satisfies readonly (keyof AppStateView)[];

const actionKeys = [
  "registerPendingDraftFlush", "flushAppState", "setCurrentConnection", "setErrorLoggingEnabled",
  "setResponsePreviewBytes", "updateAiSettings", "saveAiSettings", "getAiApiKey",
  "recordAiAnalysisHistory", "clearAiAnalysisHistory", "clearErrorLogs", "recordStatusSnapshot",
  "recordErrorLog", "recordAuditLog", "updateDraft", "createBlankDraft", "selectSavedRequest",
  "saveRequestFromDraft", "updateRequest", "bulkUpdateRequestTags", "deleteRequest", "duplicateRequest",
  "reorderConnectionRequests", "importConnectionRequests", "refreshSearchMetadata", "ensureTargetFields",
  "ensureIndexFields", "recordExecution", "upsertSshProfile", "upsertConnection", "deleteSshProfile",
  "deleteConnection", "getPassword", "getSshSecret", "getSshProfileForConnection",
  "exportConnections", "importConnections",
] as const satisfies readonly (keyof AppStateActions)[];

type AppStateStore = ReturnType<typeof createAppStateStore>;

function createAppStateStore(initialValue: AppStateContextValue) {
  let currentValue = initialValue;
  const listeners = new Set<() => void>();
  const fieldListeners = new Map<keyof AppStateView, Set<() => void>>();
  const actions = Object.fromEntries(actionKeys.map((key) => [key, (...args: unknown[]) => {
    if (key === "getAiApiKey") {
      const expectedScope = args[0] as string | null | undefined;
      if (!expectedScope || expectedScope !== getAiCredentialScope(currentValue.aiSettings)) return Promise.resolve(null);
    }
    return (currentValue[key] as (...parameters: unknown[]) => unknown)(...args);
  }])) as AppStateActions;

  return {
    getSnapshot: () => currentValue,
    getFieldSnapshot: <K extends keyof AppStateView>(key: K): AppStateView[K] => currentValue[key],
    getActions: () => actions,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    subscribeField: (key: keyof AppStateView, listener: () => void) => {
      let group = fieldListeners.get(key);
      if (!group) {
        group = new Set();
        fieldListeners.set(key, group);
      }
      group.add(listener);
      return () => { group.delete(listener); };
    },
    publish(nextValue: AppStateContextValue) {
      if (currentValue === nextValue) return;
      const previousValue = currentValue;
      currentValue = nextValue;
      for (const key of viewKeys) {
        if (!Object.is(previousValue[key], nextValue[key])) {
          fieldListeners.get(key)?.forEach((listener) => listener());
        }
      }
      listeners.forEach((listener) => listener());
    },
  };
}

const AppStateContext = createContext<AppStateStore | null>(null);
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
  payload = redactSensitiveValue(payload);
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
  log = redactSensitiveValue(log);
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
  connectionUpdatedAt?: string,
) {
  if (!connectionIds.has(cache.connectionId) || (cache.connectionUpdatedAt && cache.connectionUpdatedAt !== connectionUpdatedAt)) {
    return null;
  }

  return normalizeFieldCache({
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
    fieldsFetchedAtByIndex: cache.fieldsFetchedAtByIndex,
    fieldsTruncatedByIndex: cache.fieldsTruncatedByIndex,
    fieldsCacheTruncated: cache.fieldsCacheTruncated,
    connectionUpdatedAt: cache.connectionUpdatedAt,
    aliasToIndices: normalizeStringRecordOfLists(cache.aliasToIndices),
    cluster: normalizeClusterMetadata(cache.cluster),
    fetchedAt: cache.fetchedAt,
    expiresAt: cache.expiresAt,
  } satisfies ConnectionSearchMetadata);
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
  const connectionVersions = new Map(normalizedConnections.map((connection) => [connection.id, connection.updatedAt]));
  const normalizedSearchMetadata = Object.fromEntries(
    Object.entries(state.searchMetadata ?? {})
      .map(([connectionId, cache]) => [connectionId, normalizeStoredSearchMetadata(cache, connectionIds, connectionVersions.get(connectionId))] as const)
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
    const matchingActiveRequest = activeRequest?.connectionId === connection.id ? activeRequest : null;

    nextDrafts[connection.id] = currentDraftState
      ? normalizeStoredDraft({
          ...currentDraftState,
          connectionId: connection.id,
          activeSavedRequestId: matchingActiveRequest?.id ?? null,
          response: matchingActiveRequest?.lastResponse ?? normalizeResponseSnapshot(currentDraftState.response, responsePreviewBytes),
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
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [state, setState] = useState<AppStateShape>(createEmptyStorage());
  const [aiApiKeyConfigured, setAiApiKeyConfigured] = useState(false);
  const aiKeyScope = useRef<string | null>(null);
  const aiSettingsSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const indexFieldFetchInFlight = useRef(new Map<string, Promise<string[] | null>>());
  const metadataFetchInFlight = useRef(new Map<string, Promise<ConnectionSearchMetadata>>());
  const metadataGeneration = useRef(new Map<string, number>());
  const committedState = useRef(state);
  useLayoutEffect(() => { committedState.current = state; }, [state]);
  const pendingDraftFlushes = useRef(new Set<() => void>());
  const closing = useRef(false);
  const lastScheduledState = useRef<AppStateShape | null>(null);
  const persistQueue = useRef(createPersistQueue<{ state: AppStateShape; dirty: ReadonlySet<StoragePartition> }>({
    write: async (value) => {
      try {
        await writeAppStorage(value.state, value.dirty);
      } catch (error) {
        console.error(error);
        toast.error("本地数据保存失败。");
        throw error;
      }
    },
    merge: (pending, newer) => ({ state: newer.state, dirty: new Set([...pending.dirty, ...newer.dirty]) }),
  }));

  const registerPendingDraftFlush = useCallback((flush: () => void) => {
    pendingDraftFlushes.current.add(flush);
    return () => { pendingDraftFlushes.current.delete(flush); };
  }, []);

  const flushAppState = useCallback(async (commit?: () => void) => {
    flushSync(() => {
      for (const flush of pendingDraftFlushes.current) flush();
      commit?.();
    });
    await persistQueue.current.flush();
  }, []);

  useEffect(() => {
    let cancelled = false;

    readAppStorage()
      .then(async (loaded) => {
        if (cancelled) {
          return;
        }

        const normalized = normalizeState(loaded);
        setState(normalized);
        setStorageLoaded(true);
        try {
          const vaultStatus = await loadSecretsVault(
            buildSecretsMigrationHint({
              connections: normalized.connections,
              sshProfiles: normalized.sshProfiles,
              aiBaseUrl: normalized.aiSettings.baseUrl,
            }),
          );
          if (cancelled) return;
          aiKeyScope.current = vaultStatus.aiApiKeyConfigured ? getAiCredentialScope(normalized.aiSettings) : null;
          setAiApiKeyConfigured(vaultStatus.aiApiKeyConfigured);
        } catch {
          if (cancelled) return;
          aiKeyScope.current = null;
          setAiApiKeyConfigured(false);
          toast.error("系统钥匙串暂不可用，已保留本地数据，请解锁后重新启动。");
        }
        setReady(true);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setReady(true);
          toast.error(`本地数据读取失败，已保留磁盘数据：${error instanceof Error ? error.message : "请恢复本地数据后重新启动。"}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (!storageLoaded) return;
    const previous = lastScheduledState.current;
    const dirty = new Set<StoragePartition>();
    if (!previous || previous.drafts !== state.drafts || previous.currentConnectionId !== state.currentConnectionId) {
      dirty.add("hot");
    }
    if (!previous || (Object.keys(state) as Array<keyof AppStateShape>).some((key) =>
      key !== "drafts" && key !== "currentConnectionId" && previous[key] !== state[key])) {
      dirty.add("cold");
    }
    lastScheduledState.current = state;
    if (dirty.size) persistQueue.current.schedule({ state, dirty });
  }, [storageLoaded, state]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (closing.current) return;
      closing.current = true;
      try {
        await flushAppState();
        await getCurrentWindow().destroy();
      } catch (error) {
        console.error(error);
        toast.error("关闭前保存失败，请重试关闭窗口。");
        closing.current = false;
      }
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    }).catch((error) => console.error(error));
    return () => { active = false; unlisten?.(); };
  }, [flushAppState]);

  const currentConnection = useMemo(
    () => state.connections.find((item) => item.id === state.currentConnectionId) ?? null,
    [state.connections, state.currentConnectionId],
  );

  const currentDraft = useMemo(
    () => currentConnection
      ? state.drafts[currentConnection.id] ?? createDefaultDraft(currentConnection.id)
      : null,
    [currentConnection?.id, state.drafts],
  );

  const requestsForCurrentConnection = useMemo(
    () => (currentConnection ? getConnectionRequests(currentConnection.id, state.requests) : []),
    [currentConnection?.id, state.requests],
  );
  const responsePreviewBytes = normalizeResponsePreviewBytes(state.settings.responsePreviewBytes);

  function persistAiSettings(payload: Parameters<AppStateContextValue["saveAiSettings"]>[0]) {
    const task = aiSettingsSaveQueue.current.catch(() => undefined).then(async () => {
      const nextSettings = normalizeAiSettings({ ...payload.settings, baseUrl: normalizeBaseUrl(payload.settings.baseUrl) });
      const nextScope = getAiCredentialScope(nextSettings);
      if (!nextScope) throw new Error("AI 服务地址无效，不能保存凭据。");
      const replacement = payload.apiKey?.trim();
      const shouldClear = payload.clearApiKey || (!replacement && nextScope !== aiKeyScope.current);
      if (shouldClear || replacement) {
        // 解绑发生在钥匙串写入之前，避免旧回调读到另一个服务的密钥。
        aiKeyScope.current = null;
        setAiApiKeyConfigured(false);
        if (shouldClear) {
          await deleteAiApiKey();
        } else {
          await saveAiApiKey(replacement!, nextScope);
          aiKeyScope.current = nextScope;
          setAiApiKeyConfigured(true);
        }
      }
      setState((current) => normalizeState({ ...current, aiSettings: nextSettings }));
    });
    aiSettingsSaveQueue.current = task;
    return task;
  }

  async function ensureTargetFields(connection: ConnectionProfile, targets: string[], options?: { force?: boolean }): Promise<string[] | null> {
    const names = [...new Set(targets.map((name) => name.trim()).filter((name) => name && !name.startsWith("_") && !/[*?,/]/.test(name)))].sort();
    if (!names.length || !committedState.current.connections.some((item) => item.id === connection.id && item.updatedAt === connection.updatedAt)) return null;
    const storedCache = committedState.current.searchMetadata[connection.id] ?? null;
    const cache = storedCache?.connectionUpdatedAt === connection.updatedAt ? storedCache : null;
    const fieldsForTargets = (metadata: ConnectionSearchMetadata) => [...new Set(resolveFieldTargets(metadata, names).flatMap((name) => metadata.fieldsByIndex[name] ?? []))]
      .sort((left, right) => left.localeCompare(right, "zh-CN"));
    if (!options?.force && hasFreshTargetFields(cache, names, Date.now())) return fieldsForTargets(cache!);
    const generation = metadataGeneration.current.get(connection.id) ?? 0;
    const key = JSON.stringify([connection.id, connection.updatedAt, generation, names]);
    const existing = indexFieldFetchInFlight.current.get(key);
    if (existing) return existing;
    const valid = () => committedState.current.connections.some((item) => item.id === connection.id && item.updatedAt === connection.updatedAt)
      && (metadataGeneration.current.get(connection.id) ?? 0) === generation;
    const run = (async (): Promise<string[] | null> => {
      try {
        const sshProfile = committedState.current.sshProfiles.find((profile) => profile.id === connection.sshProfileId) ?? null;
        const [password, sshSecret] = await Promise.all([
          getConnectionPassword(connection.id, connection.username),
          sshProfile ? getConnectionSshSecret(sshProfile.id) : Promise.resolve(null),
        ]);
        if (!password || !valid()) return null;
        const result = await fetchTargetMappingFields(connection, { password, sshSecret }, names, getSshTunnelForProfile(sshProfile));
        if (!valid()) return null;
        const emptyCache = { ...buildSearchMetadataCache(connection.id, { indices: [], aliases: [], fields: [] }), expiresAt: new Date(0).toISOString(), connectionUpdatedAt: connection.updatedAt };
        const timestamp = Date.now();
        const merged = mergeTargetFields(clearTargetFields(cache ?? emptyCache, names), result, timestamp);
        setState((current) => {
          if (!current.connections.some((item) => item.id === connection.id && item.updatedAt === connection.updatedAt)
            || (metadataGeneration.current.get(connection.id) ?? 0) !== generation) return current;
          const latest = current.searchMetadata[connection.id];
          const next = mergeTargetFields(clearTargetFields(latest?.connectionUpdatedAt === connection.updatedAt ? latest : emptyCache, names), result, timestamp);
          return { ...current, searchMetadata: { ...current.searchMetadata, [connection.id]: next } };
        });
        return fieldsForTargets(merged);
      } catch {
        if (valid()) setState((current) => {
          const existingCache = current.searchMetadata[connection.id];
          if (!existingCache || existingCache.connectionUpdatedAt !== connection.updatedAt
            || (metadataGeneration.current.get(connection.id) ?? 0) !== generation) return current;
          return { ...current, searchMetadata: { ...current.searchMetadata, [connection.id]: clearTargetFields(existingCache, names) } };
        });
        return null;
      }
    })();
    const tracked = run.finally(() => {
      if (indexFieldFetchInFlight.current.get(key) === tracked) indexFieldFetchInFlight.current.delete(key);
    });
    indexFieldFetchInFlight.current.set(key, tracked);
    return tracked;
  }

  const value = useMemo<AppStateContextValue>(
    () => ({
      ready,
      registerPendingDraftFlush,
      flushAppState,
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
      async updateAiSettings(settings) {
        await persistAiSettings({ settings, apiKey: null, clearApiKey: false });
      },
      async saveAiSettings(payload) {
        await persistAiSettings(payload);
      },
      async getAiApiKey(expectedScope) {
        const scope = getAiCredentialScope(state.aiSettings);
        if (!scope || scope !== aiKeyScope.current || (expectedScope !== undefined && expectedScope !== scope)) return null;
        const key = await getAiApiKey(scope);
        return scope === aiKeyScope.current ? key : null;
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
        if (!options?.force && currentCache?.connectionUpdatedAt === connection.updatedAt && !isSearchMetadataExpired(currentCache)) {
          return currentCache;
        }
        const key = JSON.stringify([connection.id, connection.updatedAt]);
        const existing = metadataFetchInFlight.current.get(key);
        if (!options?.force && existing) return existing;
        const generation = (metadataGeneration.current.get(connection.id) ?? 0) + 1;
        metadataGeneration.current.set(connection.id, generation);
        const run = (async () => {
          const sshProfile = state.sshProfiles.find((profile) => profile.id === connection.sshProfileId) ?? null;
          const [password, sshSecret] = await Promise.all([
            getConnectionPassword(connection.id, connection.username),
            sshProfile ? getConnectionSshSecret(sshProfile.id) : Promise.resolve(null),
          ]);
          if (!password) throw new Error("当前连接未找到已保存密码，请回到连接页重新保存。");
          const metadata = await fetchConnectionSearchMetadata(connection, { password, sshSecret }, getSshTunnelForProfile(sshProfile));
          const cache = { ...buildSearchMetadataCache(connection.id, metadata), connectionUpdatedAt: connection.updatedAt };
          const completedGeneration = generation + 1;
          if (metadataGeneration.current.get(connection.id) !== generation) return cache;
          metadataGeneration.current.set(connection.id, completedGeneration);
          setState((current) => {
            if (!current.connections.some((item) => item.id === connection.id && item.updatedAt === connection.updatedAt)
              || metadataGeneration.current.get(connection.id) !== completedGeneration) return current;
            return { ...current, searchMetadata: { ...current.searchMetadata, [connection.id]: cache } };
          });
          return cache;
        })();
        const tracked = run.finally(() => {
          if (metadataFetchInFlight.current.get(key) === tracked) metadataFetchInFlight.current.delete(key);
        });
        metadataFetchInFlight.current.set(key, tracked);
        return tracked;
      },
      ensureTargetFields,
      ensureIndexFields(connection, indexOrAlias, options) {
        return ensureTargetFields(connection, [indexOrAlias], options);
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
      async exportConnections() {
        return buildConnectionExportPayload({
          connections: state.connections,
          sshProfiles: state.sshProfiles,
          getConnectionSecret: async (connection) =>
            getConnectionSecret(connection.id, getAuthSecretKey(connection.auth, connection.username)),
          getSshSecret: async (profile) => getConnectionSshSecret(profile.id),
        });
      },
      async importConnections(payload) {
        const importPlan = buildConnectionImportPlan(payload);

        await Promise.all([
          ...importPlan.connectionSecrets.map((secretPlan) =>
            saveConnectionSecret(
              secretPlan.connectionId,
              getAuthSecretKey(secretPlan.auth, secretPlan.username),
              secretPlan.secret,
            ),
          ),
          ...importPlan.sshSecrets.map((secretPlan) =>
            saveConnectionSshSecret(secretPlan.profileId, secretPlan.secret),
          ),
        ]);

        setState((current) =>
          normalizeState({
            ...current,
            connections: [...importPlan.connections, ...current.connections],
            sshProfiles: [...importPlan.sshProfiles, ...current.sshProfiles],
            currentConnectionId: importPlan.connections[0]?.id ?? current.currentConnectionId,
          }),
        );

        return {
          connectionsImported: importPlan.connections.length,
          sshProfilesImported: importPlan.sshProfiles.length,
        };
      },
    }),
    [aiApiKeyConfigured, currentConnection, currentDraft, flushAppState, ready, registerPendingDraftFlush, requestsForCurrentConnection, state],
  );

  const storeRef = useRef<AppStateStore | null>(null);
  if (!storeRef.current) storeRef.current = createAppStateStore(value);
  useLayoutEffect(() => { storeRef.current!.publish(value); }, [value]);

  return <AppStateContext.Provider value={storeRef.current}>{children}</AppStateContext.Provider>;
}

function useAppStateStore() {
  const store = useContext(AppStateContext);
  if (!store) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return store;
}

export function useAppStateField<K extends keyof AppStateView>(key: K): AppStateView[K] {
  const store = useAppStateStore();
  const subscribe = useCallback((listener: () => void) => store.subscribeField(key, listener), [store, key]);
  const getSnapshot = useCallback(() => store.getFieldSnapshot(key), [store, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAppActions(): AppStateActions {
  return useAppStateStore().getActions();
}

export function useAppState() {
  const store = useAppStateStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
