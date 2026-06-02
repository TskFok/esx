import { describe, expect, it } from "vitest";
import {
  applyDuplicateRequest,
  applyImportConnectionRequests,
  applySaveRequestFromDraft,
} from "../request-state-mutations";
import type { SavedRequest } from "../../types/requests";

function createRequest(overrides: Partial<SavedRequest> & Pick<SavedRequest, "id" | "connectionId">): SavedRequest {
  return {
    name: "测试请求",
    method: "GET",
    path: "/_cluster/health",
    body: "",
    tags: ["core"],
    sortOrder: 0,
    lastResponse: null,
    lastStatus: null,
    lastDurationMs: null,
    updatedAt: "2026-05-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("applySaveRequestFromDraft", () => {
  it("returns saved request synchronously without relying on setState side effects", () => {
    const { request, next } = applySaveRequestFromDraft(
      { requests: [], drafts: {} },
      {
        connectionId: "conn-1",
        name: "健康检查",
        content: "GET /_cluster/health",
        response: null,
      },
    );

    expect(request.name).toBe("健康检查");
    expect(request.method).toBe("GET");
    expect(next.requests).toHaveLength(1);
    expect(next.drafts["conn-1"]?.activeSavedRequestId).toBe(request.id);
  });

  it("preserves tags and sort order when overwriting an existing request", () => {
    const existing = createRequest({
      id: "req-1",
      connectionId: "conn-1",
      tags: ["prod", "monitor"],
      sortOrder: 2000,
    });

    const { request, next } = applySaveRequestFromDraft(
      {
        requests: [existing],
        drafts: {
          "conn-1": {
            connectionId: "conn-1",
            name: existing.name,
            content: "GET /_cluster/health",
            activeSavedRequestId: existing.id,
            response: null,
          },
        },
      },
      {
        connectionId: "conn-1",
        name: "更新后的请求",
        content: "POST /logs/_search\n{}",
        response: null,
        overwriteRequestId: existing.id,
      },
    );

    expect(request.id).toBe(existing.id);
    expect(request.tags).toEqual(["monitor", "prod"]);
    expect(request.sortOrder).toBe(2000);
    expect(request.method).toBe("POST");
    expect(next.requests).toHaveLength(1);
  });
});

describe("applyDuplicateRequest", () => {
  it("returns duplicated request synchronously", () => {
    const source = createRequest({ id: "req-1", connectionId: "conn-1", name: "原始请求" });

    const { duplicate, next } = applyDuplicateRequest({ requests: [source], drafts: {} }, source, "原始请求 副本");

    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.name).toBe("原始请求 副本");
    expect(next.requests).toHaveLength(2);
    expect(next.drafts["conn-1"]?.activeSavedRequestId).toBe(duplicate.id);
  });
});

describe("applyImportConnectionRequests", () => {
  it("returns imported requests synchronously", () => {
    const { importedRequests, next } = applyImportConnectionRequests(
      { requests: [], drafts: {} },
      "conn-1",
      [
        {
          name: "导入请求",
          method: "GET",
          path: "/_cat/indices",
          body: "",
          tags: [],
          sortOrder: 0,
        },
      ],
      "merge",
    );

    expect(importedRequests).toHaveLength(1);
    expect(importedRequests[0]?.name).toBe("导入请求");
    expect(next.requests).toHaveLength(1);
  });
});
