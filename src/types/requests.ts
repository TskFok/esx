export type RequestProject = {
  id: string;
  connectionId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type RequestModule = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ResponseSnapshot = {
  ok: boolean;
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  executedAt: string;
  bodyText: string;
  bodyPretty: string;
  isJson: boolean;
  errorMessage?: string;
  diagnostics: string[];
};

export type SavedRequest = {
  id: string;
  connectionId: string;
  moduleId: string | null;
  name: string;
  method: string;
  path: string;
  body: string;
  headers?: Record<string, string>;
  lastResponse: ResponseSnapshot | null;
  lastStatus: number | null;
  lastDurationMs: number | null;
  updatedAt: string;
};

export type ConsoleDraft = {
  connectionId: string;
  targetModuleId: string | null;
  name: string;
  content: string;
  activeSavedRequestId: string | null;
  response: ResponseSnapshot | null;
};
