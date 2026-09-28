import { describe, expect, it } from "vitest";
import { createEmptyStorage } from "../storage";
import { applyPersistedPreviewBudget } from "../response-retention";
import type { ResponseSnapshot, SavedRequest } from "../../types/requests";

function request(id: string, executedAt: string, bodyPreview: string, prettyPreview?: string): SavedRequest {
  const response: ResponseSnapshot = {
    ok: true, status: 200, statusText: "OK", durationMs: 12, sizeBytes: 3_000_000,
    executedAt, bodyPreview, prettyPreview, previewBytes: new TextEncoder().encode(bodyPreview).length,
    truncated: true, isJson: Boolean(prettyPreview), diagnostics: [],
  };
  return {
    id, connectionId: "c", name: id, method: "POST", path: "/_search", body: '{"query":"keep"}',
    tags: ["keep"], sortOrder: 1, lastResponse: response, lastStatus: 200, lastDurationMs: 12,
    updatedAt: executedAt,
  };
}

describe("persisted response preview budget", () => {
  it("evicts an oversized UTF-8 preview and preserves request content and response status", () => {
    const state = createEmptyStorage();
    state.requests = [request("one", "2026-01-01", "中".repeat(350_000))];
    const original = structuredClone(state);

    const persisted = applyPersistedPreviewBudget(state);

    expect(persisted.requests[0]).toMatchObject({
      id: "one", body: '{"query":"keep"}', tags: ["keep"], lastStatus: 200,
      lastResponse: { status: 200, sizeBytes: 3_000_000, bodyPreview: "", previewBytes: 0, previewEvicted: true },
    });
    expect(persisted.requests[0].lastResponse?.prettyPreview).toBeUndefined();
    expect(state).toEqual(original);
  });

  it("counts body and pretty preview bytes together", () => {
    const state = createEmptyStorage();
    state.requests = [request("one", "2026-01-01", "a".repeat(600_000), "b".repeat(500_000))];
    expect(applyPersistedPreviewBudget(state).requests[0].lastResponse?.previewEvicted).toBe(true);
  });

  it("evicts oldest previews first when the total exceeds 32 MiB", () => {
    const state = createEmptyStorage();
    state.requests = Array.from({ length: 34 }, (_, index) =>
      request(String(index), `2026-01-${String(index + 1).padStart(2, "0")}`, "x".repeat(1024 * 1024)),
    );

    const persisted = applyPersistedPreviewBudget(state);

    expect(persisted.requests.slice(0, 2).map((item) => item.lastResponse?.previewEvicted)).toEqual([true, true]);
    expect(persisted.requests[2].lastResponse?.bodyPreview).toHaveLength(1024 * 1024);
    expect(persisted.requests).toHaveLength(34);
  });
});
