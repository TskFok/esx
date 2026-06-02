import { buildConsoleContent, parseConsoleRequest } from "./console-parser";
import { buildImportedRequests, type RequestImportMode } from "./request-import-export";
import { computeNextSortOrder } from "./request-list";
import { normalizeRequestTags } from "./request-tags";
import type { ConsoleDraft, ResponseSnapshot, SavedRequest } from "../types/requests";

export type RequestDraftState = {
  requests: SavedRequest[];
  drafts: Record<string, ConsoleDraft>;
};

export type SaveRequestFromDraftPayload = {
  connectionId: string;
  name: string;
  content: string;
  response: ResponseSnapshot | null;
  overwriteRequestId?: string | null;
};

export type RequestImportEntry = {
  name: string;
  method: string;
  path: string;
  body: string;
  tags: string[];
  sortOrder: number;
};

function timestamp() {
  return new Date().toISOString();
}

export function buildSavedRequest(
  connectionId: string,
  name: string,
  content: string,
  response: ResponseSnapshot | null,
  options?: {
    requestId?: string;
    tags?: string[];
    sortOrder?: number;
  },
) {
  const parsed = parseConsoleRequest(content);

  return {
    id: options?.requestId ?? crypto.randomUUID(),
    connectionId,
    name: name.trim(),
    method: parsed.method,
    path: parsed.path,
    body: parsed.bodyText,
    headers: {},
    tags: normalizeRequestTags(options?.tags),
    sortOrder: options?.sortOrder ?? 0,
    lastResponse: response,
    lastStatus: response?.status ?? null,
    lastDurationMs: response?.durationMs ?? null,
    updatedAt: timestamp(),
  } satisfies SavedRequest;
}

export function applySaveRequestFromDraft(
  current: RequestDraftState,
  payload: SaveRequestFromDraftPayload,
) {
  const connectionRequests = current.requests.filter((item) => item.connectionId === payload.connectionId);
  const existing = payload.overwriteRequestId
    ? current.requests.find((item) => item.id === payload.overwriteRequestId) ?? null
    : null;
  const request = buildSavedRequest(payload.connectionId, payload.name, payload.content, payload.response, {
    requestId: payload.overwriteRequestId ?? undefined,
    tags: existing?.tags ?? [],
    sortOrder: existing?.sortOrder ?? computeNextSortOrder(connectionRequests),
  });

  const existingIndex = current.requests.findIndex((item) => item.id === request.id);
  const nextRequests = [...current.requests];

  if (existingIndex >= 0) {
    nextRequests[existingIndex] = request;
  } else {
    nextRequests.push(request);
  }

  return {
    request,
    next: {
      requests: nextRequests,
      drafts: {
        ...current.drafts,
        [payload.connectionId]: {
          connectionId: payload.connectionId,
          name: request.name,
          content: payload.content,
          activeSavedRequestId: request.id,
          response: payload.response,
        },
      },
    },
  };
}

export function applyDuplicateRequest(current: RequestDraftState, source: SavedRequest, name: string) {
  const duplicate = {
    ...source,
    id: crypto.randomUUID(),
    name: name.trim(),
    sortOrder: computeNextSortOrder(
      current.requests.filter((item) => item.connectionId === source.connectionId),
    ),
    updatedAt: timestamp(),
  } satisfies SavedRequest;

  return {
    duplicate,
    next: {
      requests: [...current.requests, duplicate],
      drafts: {
        ...current.drafts,
        [duplicate.connectionId]: {
          connectionId: duplicate.connectionId,
          name: duplicate.name,
          content: buildConsoleContent(duplicate.method, duplicate.path, duplicate.body),
          activeSavedRequestId: duplicate.id,
          response: duplicate.lastResponse,
        },
      },
    },
  };
}

export function applyImportConnectionRequests(
  current: RequestDraftState,
  connectionId: string,
  entries: RequestImportEntry[],
  mode: RequestImportMode,
) {
  const beforeIds = new Set(
    current.requests.filter((request) => request.connectionId === connectionId).map((request) => request.id),
  );
  const nextRequests = buildImportedRequests(connectionId, entries, current.requests, mode);
  const importedRequests = nextRequests.filter(
    (request) => request.connectionId === connectionId && !beforeIds.has(request.id),
  );

  const nextDrafts = { ...current.drafts };
  if (mode === "replace") {
    const draft = nextDrafts[connectionId];
    if (draft?.activeSavedRequestId) {
      nextDrafts[connectionId] = {
        ...draft,
        activeSavedRequestId: null,
      };
    }
  }

  return {
    importedRequests,
    next: {
      requests: nextRequests,
      drafts: nextDrafts,
    },
  };
}
