import { LazyStore } from "@tauri-apps/plugin-store";
import type { AiAnalysisSettings } from "../types/ai-settings";
import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../types/ai-settings";
import type { AiAnalysisHistoryEntry } from "../types/ai-analysis-history";
import type { ConnectionProfile, SshProfile } from "../types/connections";
import type { ErrorLogEntry, ErrorLogSettings } from "../types/logs";
import type { OperationsStatusSnapshot } from "../types/status";
import type { ConnectionSearchMetadata, ConsoleDraft, SavedRequest } from "../types/requests";
import { DEFAULT_ERROR_LOG_SETTINGS } from "./error-log-settings";
import { sanitizeStoredConnectionUrl } from "./connection-url";
import { redactSensitiveText, redactSensitiveValue } from "./log-redaction";
import { applyPersistedPreviewBudget } from "./response-retention";

export type AppStorageState = {
  connections: ConnectionProfile[];
  sshProfiles: SshProfile[];
  requests: SavedRequest[];
  searchMetadata: Record<string, ConnectionSearchMetadata>;
  drafts: Record<string, ConsoleDraft>;
  currentConnectionId: string | null;
  settings: ErrorLogSettings;
  aiSettings: AiAnalysisSettings;
  aiAnalysisHistory: AiAnalysisHistoryEntry[];
  errorLogs: ErrorLogEntry[];
  statusHistory: Record<string, OperationsStatusSnapshot[]>;
};

export type StoragePartition = "hot" | "cold";
type HotState = Pick<AppStorageState, "drafts" | "currentConnectionId">;
type ColdState = Omit<AppStorageState, keyof HotState> & { version: 2 };

const LEGACY_KEY = "app-state";
const COLD_KEY = "app-state-v2";
const HOT_KEY = "app-state-hot-v2";
const coldStore = new LazyStore("esx-store.json", { autoSave: false, defaults: {} });
const hotStore = new LazyStore("esx-hot.json", { autoSave: false, defaults: {} });
let saveQueue: Promise<void> = Promise.resolve();
let ignoreUncommittedV2 = false;
const pendingPartitions = new Set<StoragePartition>();
let pendingLegacySanitization = false;

function enqueueSave(work: () => Promise<void>) {
  const result = saveQueue.then(work);
  saveQueue = result.catch(() => {});
  return result;
}

export function createDefaultDraft(connectionId: string): ConsoleDraft {
  return { connectionId, name: "", content: "GET /_cluster/health", activeSavedRequestId: null, response: null };
}

export function createEmptyStorage(): AppStorageState {
  return {
    connections: [], sshProfiles: [], requests: [], searchMetadata: {}, drafts: {}, currentConnectionId: null,
    settings: { ...DEFAULT_ERROR_LOG_SETTINGS }, aiSettings: { ...DEFAULT_AI_ANALYSIS_SETTINGS },
    aiAnalysisHistory: [], errorLogs: [], statusHistory: {},
  };
}

function sanitizeStorage(state: AppStorageState): AppStorageState {
  return {
    ...state,
    connections: state.connections?.map((connection) => ({
      ...connection,
      baseUrl: typeof connection.baseUrl === "string" ? sanitizeStoredConnectionUrl(connection.baseUrl) : connection.baseUrl,
      name: typeof connection.name === "string" ? redactSensitiveText(connection.name) : connection.name,
    })),
    aiSettings: state.aiSettings ? { ...state.aiSettings, baseUrl: sanitizeStoredConnectionUrl(state.aiSettings.baseUrl) } : state.aiSettings,
    errorLogs: redactSensitiveValue(state.errorLogs),
  };
}

function partition(state: AppStorageState): { hot: HotState; cold: ColdState } {
  const { drafts, currentConnectionId, ...cold } = state;
  return { hot: { drafts, currentConnectionId }, cold: { ...cold, version: 2 } };
}

function reconcileHot(state: AppStorageState): AppStorageState {
  const connectionIds = new Set(state.connections.map((connection) => connection.id));
  const requestConnections = new Map(state.requests.map((request) => [request.id, request.connectionId]));
  const drafts = Object.fromEntries(Object.entries(state.drafts ?? {})
    .filter(([connectionId]) => connectionIds.has(connectionId))
    .map(([connectionId, draft]) => [connectionId, {
      ...draft,
      connectionId,
      activeSavedRequestId: draft.activeSavedRequestId && requestConnections.get(draft.activeSavedRequestId) === connectionId
        ? draft.activeSavedRequestId : null,
    }]));
  return {
    ...state,
    drafts,
    currentConnectionId: state.currentConnectionId && connectionIds.has(state.currentConnectionId)
      ? state.currentConnectionId : null,
  };
}

function prepareForPersistence(state: AppStorageState) {
  return applyPersistedPreviewBudget(sanitizeStorage(state));
}

async function sanitizeLegacyAfterCommit() {
  const legacy = await coldStore.get<AppStorageState>(LEGACY_KEY);
  if (!legacy) return;
  const sanitized = sanitizeStorage(legacy);
  if (!pendingLegacySanitization && JSON.stringify(legacy) === JSON.stringify(sanitized)) return;
  pendingLegacySanitization = true;
  await coldStore.set(LEGACY_KEY, sanitized);
  await coldStore.save();
  pendingLegacySanitization = false;
}

async function commitInitial(state: AppStorageState) {
  const { hot, cold } = partition(state);
  pendingPartitions.add("hot");
  await hotStore.set(HOT_KEY, hot);
  await hotStore.save();
  pendingPartitions.delete("hot");
  pendingPartitions.add("cold");
  await coldStore.set(COLD_KEY, cold);
  try {
    await coldStore.save();
    ignoreUncommittedV2 = false;
    pendingPartitions.delete("cold");
  } catch (error) {
    ignoreUncommittedV2 = true;
    throw error;
  }
  try { await sanitizeLegacyAfterCommit(); }
  catch { console.warn("旧版存储脱敏暂未保存，将在后续读取时重试。"); }
}

export async function readAppStorage(): Promise<AppStorageState> {
  await saveQueue;
  const cold = ignoreUncommittedV2 ? null : await coldStore.get<ColdState>(COLD_KEY);
  if (cold) {
    if (cold.version !== 2) throw new Error("本地冷数据版本无效，需要恢复数据。");
    const hot = await hotStore.get<HotState>(HOT_KEY);
    if (!hot) throw new Error("本地热数据缺失，无法安全读取 V2 数据，请恢复热数据文件。");
    try { await sanitizeLegacyAfterCommit(); }
    catch { console.warn("旧版存储脱敏暂未保存，将在后续读取时重试。"); }
    const { version: _version, ...coldState } = cold;
    const stored = { ...coldState, ...hot } as AppStorageState;
    const prepared = reconcileHot(prepareForPersistence(stored));
    if (JSON.stringify(stored) !== JSON.stringify(prepared)) {
      const dirty = new Set<StoragePartition>();
      const oldParts = partition(stored);
      const newParts = partition(prepared);
      if (JSON.stringify(oldParts.cold) !== JSON.stringify(newParts.cold)) dirty.add("cold");
      if (JSON.stringify(oldParts.hot) !== JSON.stringify(newParts.hot)) dirty.add("hot");
      try { await writeAppStorage(prepared, dirty); }
      catch { console.warn("本地数据规范化暂未保存，将在后续存储更新时重试。"); }
    }
    return prepared;
  }

  const legacy = await coldStore.get<AppStorageState>(LEGACY_KEY);
  if (!legacy) return createEmptyStorage();
  const prepared = prepareForPersistence(legacy);
  try { await enqueueSave(() => commitInitial(prepared)); }
  catch { console.warn("本地数据迁移暂未保存，将在后续存储更新时重试。"); }
  return prepared;
}

export function writeAppStorage(state: AppStorageState, dirty?: ReadonlySet<StoragePartition>): Promise<void> {
  const sanitized = sanitizeStorage(state);
  const prepared = applyPersistedPreviewBudget(sanitized);
  const evictedColdPreview = prepared.requests !== sanitized.requests;
  const evictedHotPreview = prepared.drafts !== sanitized.drafts;
  return enqueueSave(async () => {
    const current = ignoreUncommittedV2 ? null : await coldStore.get<ColdState>(COLD_KEY);
    if (!current) {
      await commitInitial(prepared);
      return;
    }
    const parts = partition(prepared);
    const savedHot = await hotStore.get<HotState>(HOT_KEY);
    if (!savedHot) throw new Error("本地热数据缺失，无法安全写入 V2 数据，请恢复热数据文件。");
    const saveCold = !dirty || dirty.has("cold") || pendingPartitions.has("cold") || (evictedColdPreview &&
      JSON.stringify(current.requests) !== JSON.stringify(parts.cold.requests));
    const saveHot = !dirty || dirty.has("hot") || pendingPartitions.has("hot") || (evictedHotPreview &&
      JSON.stringify(savedHot.drafts) !== JSON.stringify(parts.hot.drafts));
    if (saveCold) {
      pendingPartitions.add("cold");
      await coldStore.set(COLD_KEY, parts.cold);
      await coldStore.save();
      pendingPartitions.delete("cold");
    }
    if (saveHot) {
      pendingPartitions.add("hot");
      await hotStore.set(HOT_KEY, parts.hot);
      await hotStore.save();
      pendingPartitions.delete("hot");
    }
  });
}
