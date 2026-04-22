import { LazyStore } from "@tauri-apps/plugin-store";
import type {
  ConnectionProfile,
  ModuleProfile,
  ProjectProfile,
  SshProfile,
} from "../types/connections";
import type { ErrorLogEntry, ErrorLogSettings } from "../types/logs";
import type { ConsoleDraft, RequestModule, RequestProject, SavedRequest } from "../types/requests";

type AppStorageState = {
  projects: ProjectProfile[];
  modules: ModuleProfile[];
  connections: ConnectionProfile[];
  sshProfiles: SshProfile[];
  requestProjects: RequestProject[];
  requestModules: RequestModule[];
  requests: SavedRequest[];
  drafts: Record<string, ConsoleDraft>;
  currentConnectionId: string | null;
  settings: ErrorLogSettings;
  errorLogs: ErrorLogEntry[];
};

const STORE_KEY = "app-state";
const store = new LazyStore("esx-store.json", {
  autoSave: 100,
  defaults: {},
});

export function createDefaultDraft(connectionId: string, targetModuleId: string | null = null): ConsoleDraft {
  return {
    connectionId,
    targetModuleId,
    name: "",
    content: "GET /_cluster/health",
    activeSavedRequestId: null,
    response: null,
  };
}

export function createEmptyStorage(): AppStorageState {
  return {
    projects: [],
    modules: [],
    connections: [],
    sshProfiles: [],
    requestProjects: [],
    requestModules: [],
    requests: [],
    drafts: {},
    currentConnectionId: null,
    settings: {
      enabled: false,
    },
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
