import type { AppStorageState } from "./storage";
import type { ResponseSnapshot } from "../types/requests";

export const MAX_SINGLE_PERSISTED_PREVIEW_BYTES = 1 * 1024 * 1024;
export const MAX_TOTAL_PERSISTED_PREVIEW_BYTES = 32 * 1024 * 1024;

const encoder = new TextEncoder();

type PreviewSlot = {
  response: ResponseSnapshot;
  bytes: number;
  evict: () => void;
};

function previewSize(response: ResponseSnapshot) {
  const legacy = response as ResponseSnapshot & { bodyText?: string; bodyPretty?: string };
  const body = response.bodyPreview ?? legacy.bodyText ?? "";
  const pretty = response.prettyPreview ?? legacy.bodyPretty ?? "";
  return encoder.encode(body).length + encoder.encode(pretty).length;
}

function evictedResponse(response: ResponseSnapshot): ResponseSnapshot {
  const { bodyText: _bodyText, bodyPretty: _bodyPretty, ...rest } = response as ResponseSnapshot & {
    bodyText?: string;
    bodyPretty?: string;
  };
  return { ...rest, bodyPreview: "", prettyPreview: undefined, previewBytes: 0, previewEvicted: true };
}

export function applyPersistedPreviewBudget(state: AppStorageState): AppStorageState {
  let requests = state.requests;
  let drafts = state.drafts;
  const slots: PreviewSlot[] = [];

  requests.forEach((request, index) => {
    if (!request.lastResponse) return;
    const response = request.lastResponse;
    slots.push({
      response,
      bytes: previewSize(response),
      evict: () => {
        if (requests === state.requests) requests = [...requests];
        requests[index] = { ...request, lastResponse: evictedResponse(response) };
      },
    });
  });
  Object.entries(drafts).forEach(([connectionId, draft]) => {
    if (!draft.response) return;
    const response = draft.response;
    slots.push({
      response,
      bytes: previewSize(response),
      evict: () => {
        if (drafts === state.drafts) drafts = { ...drafts };
        drafts[connectionId] = { ...draft, response: evictedResponse(response) };
      },
    });
  });

  let total = slots.reduce((sum, slot) => sum + slot.bytes, 0);
  const removed = new Set<PreviewSlot>();
  const evict = (slot: PreviewSlot) => {
    if (removed.has(slot) || slot.bytes === 0) return;
    slot.evict();
    removed.add(slot);
    total -= slot.bytes;
  };

  slots.filter((slot) => slot.bytes > MAX_SINGLE_PERSISTED_PREVIEW_BYTES).forEach(evict);
  if (total > MAX_TOTAL_PERSISTED_PREVIEW_BYTES) {
    const oldestFirst = [...slots].sort((left, right) => left.response.executedAt.localeCompare(right.response.executedAt));
    for (const slot of oldestFirst) {
      if (total <= MAX_TOTAL_PERSISTED_PREVIEW_BYTES) break;
      evict(slot);
    }
  }

  return removed.size ? { ...state, requests, drafts } : state;
}
