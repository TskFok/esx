export type ResponseSnapshot = {
  ok: boolean;
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  executedAt: string;
  bodyPreview: string;
  prettyPreview?: string;
  truncated: boolean;
  previewBytes: number;
  isJson: boolean;
  errorMessage?: string;
  diagnostics: string[];
};

export type SavedRequest = {
  id: string;
  connectionId: string;
  name: string;
  method: string;
  path: string;
  body: string;
  headers?: Record<string, string>;
  tags: string[];
  sortOrder: number;
  lastResponse: ResponseSnapshot | null;
  lastStatus: number | null;
  lastDurationMs: number | null;
  updatedAt: string;
};

export type ConsoleDraft = {
  connectionId: string;
  name: string;
  content: string;
  activeSavedRequestId: string | null;
  response: ResponseSnapshot | null;
};

export type ConnectionSearchMetadata = {
  connectionId: string;
  indices: string[];
  aliases: string[];
  fields: string[];
  fieldsByIndex: Record<string, string[]>;
  aliasToIndices: Record<string, string[]>;
  fetchedAt: string;
  expiresAt: string;
};
