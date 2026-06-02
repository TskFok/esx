import { LazyStore } from "@tauri-apps/plugin-store";
import type { AiAnalysisSettings } from "../types/ai-settings";
import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../types/ai-settings";
import type { AiAnalysisHistoryEntry } from "../types/ai-analysis-history";
import type { ConnectionProfile, SshProfile } from "../types/connections";
import type { ErrorLogEntry, ErrorLogSettings } from "../types/logs";
import type {
  ConnectionSearchMetadata,
  ConsoleDraft,
  SavedRequest,
} from "../types/requests";
import { DEFAULT_ERROR_LOG_SETTINGS } from "./error-log-settings";

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
  };
}

export async function readAppStorage() {
  return (await store.get<AppStorageState>(STORE_KEY)) ?? createEmptyStorage();
}

export async function writeAppStorage(state: AppStorageState) {
  await store.set(STORE_KEY, state);
  await store.save();
}
