import { LazyStore } from "@tauri-apps/plugin-store";
import type { AiAnalysisSettings } from "../types/ai-settings";
import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../types/ai-settings";
import type { AiAnalysisHistoryEntry } from "../types/ai-analysis-history";
import type { ConnectionProfile, SshProfile } from "../types/connections";
import type { ErrorLogEntry, ErrorLogSettings } from "../types/logs";
import type { OperationsStatusSnapshot } from "../types/status";
import type {
  ConnectionSearchMetadata,
  ConsoleDraft,
  SavedRequest,
} from "../types/requests";
import { DEFAULT_ERROR_LOG_SETTINGS } from "./error-log-settings";
import { sanitizeStoredConnectionUrl } from "./connection-url";
import { redactSensitiveText, redactSensitiveValue } from "./log-redaction";

type AppStorageState = {
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

const STORE_KEY = "app-state";
const store = new LazyStore("esx-store.json", {
  autoSave: 100,
  defaults: {},
});

export function createDefaultDraft(connectionId: string): ConsoleDraft {
  return {
    connectionId,
    name: "",
    content: "GET /_cluster/health",
    activeSavedRequestId: null,
    response: null,
  };
}

export function createEmptyStorage(): AppStorageState {
  return {
    connections: [],
    sshProfiles: [],
    requests: [],
    searchMetadata: {},
    drafts: {},
    currentConnectionId: null,
    settings: { ...DEFAULT_ERROR_LOG_SETTINGS },
    aiSettings: { ...DEFAULT_AI_ANALYSIS_SETTINGS },
    aiAnalysisHistory: [],
    errorLogs: [],
    statusHistory: {},
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
    aiSettings: state.aiSettings ? {
      ...state.aiSettings,
      baseUrl: sanitizeStoredConnectionUrl(state.aiSettings.baseUrl),
    } : state.aiSettings,
    errorLogs: redactSensitiveValue(state.errorLogs),
  };
}

export async function readAppStorage() {
  const stored = await store.get<AppStorageState>(STORE_KEY);
  if (!stored) {
    return createEmptyStorage();
  }
  const sanitized = sanitizeStorage(stored);
  if (JSON.stringify(stored) !== JSON.stringify(sanitized)) {
    try {
      await writeAppStorage(sanitized);
    } catch {
      console.warn("敏感数据迁移暂未保存，将在后续存储更新时重试。");
    }
  }
  return sanitized;
}

export async function writeAppStorage(state: AppStorageState) {
  await store.set(STORE_KEY, sanitizeStorage(state));
  await store.save();
}
