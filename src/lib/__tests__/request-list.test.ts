import { describe, expect, it } from "vitest";
import {
  assignMissingSortOrders,
  computeNextSortOrder,
  filterConnectionRequests,
  getConnectionRequests,
  reorderRequestIds,
} from "../request-list";
import type { SavedRequest } from "../../types/requests";

function createRequest(
  id: string,
  connectionId: string,
  name: string,
  updatedAt: string,
  overrides: Partial<SavedRequest> = {},
): SavedRequest {
  return {
    id,
    connectionId,
    name,
    method: "GET",
    path: "/_cluster/health",
    body: "",
    tags: [],
    sortOrder: 0,
    updatedAt,
    lastStatus: null,
    lastDurationMs: null,
    lastResponse: null,
    ...overrides,
  };
}

describe("getConnectionRequests", () => {
  it("returns only requests for the target connection sorted by sortOrder", () => {
    const requests = [
      createRequest("request-1", "conn-1", "较早请求", "2026-05-27T00:00:00.000Z", { sortOrder: 1000 }),
      createRequest("request-2", "conn-2", "其他连接", "2026-05-27T01:00:00.000Z", { sortOrder: 0 }),
      createRequest("request-3", "conn-1", "最新请求", "2026-05-27T02:00:00.000Z", { sortOrder: 0 }),
    ];

    expect(getConnectionRequests("conn-1", requests).map((item) => item.id)).toEqual([
      "request-3",
      "request-1",
    ]);
  });
});

describe("filterConnectionRequests", () => {
  const requests = [
    createRequest("request-1", "conn-1", "集群健康", "2026-05-27T00:00:00.000Z", {
      path: "/_cluster/health",
      tags: ["巡检"],
      sortOrder: 0,
    }),
    createRequest("request-2", "conn-1", "索引列表", "2026-05-27T01:00:00.000Z", {
      path: "/_cat/indices",
      tags: ["排障"],
      sortOrder: 1000,
    }),
  ];

  it("filters by search query", () => {
    expect(filterConnectionRequests(requests, { searchQuery: "health" }).map((item) => item.id)).toEqual([
      "request-1",
    ]);
  });

  it("filters by tag", () => {
    expect(filterConnectionRequests(requests, { tagFilter: "排障" }).map((item) => item.id)).toEqual(["request-2"]);
  });
});

describe("assignMissingSortOrders", () => {
  it("assigns sortOrder for legacy requests without sortOrder", () => {
    const requests = [
      createRequest("request-1", "conn-1", "A", "2026-05-27T00:00:00.000Z"),
      createRequest("request-2", "conn-1", "B", "2026-05-27T02:00:00.000Z"),
    ];

    const normalized = assignMissingSortOrders(
      requests.map((request) => ({ ...request, sortOrder: undefined as unknown as number })),
    );

    expect(normalized.map((item) => item.sortOrder)).toEqual([0, 1000]);
  });
});

describe("computeNextSortOrder", () => {
  it("returns step above current max sortOrder", () => {
    expect(
      computeNextSortOrder([
        createRequest("request-1", "conn-1", "A", "2026-05-27T00:00:00.000Z", { sortOrder: 2000 }),
      ]),
    ).toBe(3000);
  });
});

describe("reorderRequestIds", () => {
  it("moves dragged id before target id", () => {
    expect(reorderRequestIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });
});
