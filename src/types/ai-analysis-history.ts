import type { RequestAnalysisResult } from "../lib/request-analyzer";

export type AiAnalysisHistoryEntry = {
  id: string;
  createdAt: string;
  connectionId: string | null;
  connectionName: string | null;
  requestPreview: string;
  requestContent: string;
  result: RequestAnalysisResult;
  model: string;
  providerId: string | null;
};

export const MAX_AI_ANALYSIS_HISTORY = 30;
export const MAX_AI_ANALYSIS_HISTORY_CONTENT_LENGTH = 8000;

export function buildAiAnalysisRequestPreview(content: string) {
  const normalized = content.trim();
  if (!normalized) {
    return "空请求";
  }

  const firstLine = normalized.split(/\r?\n/, 1)[0]?.trim() ?? normalized;
  if (firstLine.length <= 120) {
    return firstLine;
  }

  return `${firstLine.slice(0, 117)}...`;
}

export function truncateAiAnalysisHistoryContent(content: string) {
  const normalized = content.trim();
  if (normalized.length <= MAX_AI_ANALYSIS_HISTORY_CONTENT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_AI_ANALYSIS_HISTORY_CONTENT_LENGTH)}\n... [内容已截断]`;
}

export function createAiAnalysisHistoryEntry(input: {
  connectionId: string | null;
  connectionName: string | null;
  requestContent: string;
  result: RequestAnalysisResult;
  model: string;
  providerId: string | null;
  createdAt?: string;
  id?: string;
}): AiAnalysisHistoryEntry {
  const requestContent = truncateAiAnalysisHistoryContent(input.requestContent);
  return {
    id: input.id ?? crypto.randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    connectionId: input.connectionId,
    connectionName: input.connectionName,
    requestPreview: buildAiAnalysisRequestPreview(requestContent),
    requestContent,
    result: input.result,
    model: input.model,
    providerId: input.providerId,
  };
}

export function prependAiAnalysisHistory(
  history: AiAnalysisHistoryEntry[],
  entry: AiAnalysisHistoryEntry,
  maxEntries = MAX_AI_ANALYSIS_HISTORY,
) {
  return [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, maxEntries);
}

export function filterAiAnalysisHistory(
  history: AiAnalysisHistoryEntry[],
  options: {
    connectionId: string | null;
    onlyCurrentConnection: boolean;
  },
) {
  if (!options.onlyCurrentConnection || !options.connectionId) {
    return history;
  }

  return history.filter((entry) => entry.connectionId === options.connectionId);
}

export function resolveHistoryCompareEntries(
  history: AiAnalysisHistoryEntry[],
  compareEntryIds: [string | null, string | null],
) {
  const left = compareEntryIds[0] ? history.find((item) => item.id === compareEntryIds[0]) ?? null : null;
  const right = compareEntryIds[1] ? history.find((item) => item.id === compareEntryIds[1]) ?? null : null;
  return { left, right };
}

export function toggleHistoryCompareSelection(
  current: [string | null, string | null],
  entryId: string,
): [string | null, string | null] {
  if (current[0] === entryId) {
    return [current[1], null];
  }

  if (current[1] === entryId) {
    return [current[0], null];
  }

  if (!current[0]) {
    return [entryId, current[1]];
  }

  if (!current[1]) {
    return [current[0], entryId];
  }

  return [current[0], entryId];
}
