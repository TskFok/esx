import { describe, expect, it } from "vitest";
import { buildConsoleAutocompleteContext, extractIndexNamesFromPath } from "../context";
import type { SavedRequest } from "../../../types/requests";

function buildSavedRequest(path: string): SavedRequest {
  return {
    id: "id",
    connectionId: "conn",
    moduleId: null,
    name: "n",
    method: "GET",
    path,
    body: "",
    headers: {},
    lastResponse: null,
    lastStatus: null,
    lastDurationMs: null,
    updatedAt: "",
  };
}

describe("extractIndexNamesFromPath", () => {
  it("returns empty for global API", () => {
    expect(extractIndexNamesFromPath("/_search")).toEqual([]);
  });

  it("splits comma-separated indices", () => {
    expect(extractIndexNamesFromPath("/orders,users/_search")).toEqual(["orders", "users"]);
  });

  it("ignores wildcards and underscores", () => {
    expect(extractIndexNamesFromPath("/_all/_search")).toEqual([]);
    expect(extractIndexNamesFromPath("/logs-*/_search")).toEqual([]);
  });

  it("works for paths without leading slash", () => {
    expect(extractIndexNamesFromPath("orders/_search")).toEqual(["orders"]);
    expect(extractIndexNamesFromPath("orders,users/_search")).toEqual(["orders", "users"]);
    expect(extractIndexNamesFromPath("_search")).toEqual([]);
    expect(extractIndexNamesFromPath("my-index")).toEqual(["my-index"]);
  });

  it("tolerates multiple leading slashes and query strings", () => {
    expect(extractIndexNamesFromPath("//orders/_search?pretty")).toEqual(["orders"]);
    expect(extractIndexNamesFromPath("orders?pretty")).toEqual(["orders"]);
  });
});

describe("buildConsoleAutocompleteContext", () => {
  it("merges index/alias/field metadata", () => {
    const context = buildConsoleAutocompleteContext(
      [buildSavedRequest("/orders/_search")],
      "POST /users/_search",
      {
        connectionId: "conn",
        indices: ["orders"],
        aliases: ["daily"],
        fields: ["user.name", "user.id"],
        fieldsByIndex: {},
        aliasToIndices: {},
        fetchedAt: "",
        expiresAt: "",
      },
    );

    expect(context.indexNames).toEqual(["orders"]);
    expect(context.aliasNames).toEqual(["daily"]);
    expect(context.fieldNames).toEqual(["user.id", "user.name"]);
    expect(context.historyTargetNames).toEqual(["users"]);
  });

  it("filters field names to the index referenced by current path", () => {
    const context = buildConsoleAutocompleteContext(
      [],
      "POST /orders/_search",
      {
        connectionId: "conn",
        indices: ["orders", "users"],
        aliases: [],
        fields: ["price", "sku", "user.name"],
        fieldsByIndex: {
          orders: ["price", "sku"],
          users: ["user.name"],
        },
        aliasToIndices: {},
        fetchedAt: "",
        expiresAt: "",
      },
    );

    expect(context.fieldNames).toEqual(["price", "sku"]);
  });

  it("resolves alias to underlying index fields", () => {
    const context = buildConsoleAutocompleteContext(
      [],
      "POST /daily/_search",
      {
        connectionId: "conn",
        indices: ["orders"],
        aliases: ["daily"],
        fields: ["price", "sku"],
        fieldsByIndex: { orders: ["price", "sku"] },
        aliasToIndices: { daily: ["orders"] },
        fetchedAt: "",
        expiresAt: "",
      },
    );

    expect(context.fieldNames).toEqual(["price", "sku"]);
  });

  it("falls back to all fields when the current target is unknown", () => {
    const context = buildConsoleAutocompleteContext(
      [],
      "POST /unknown/_search",
      {
        connectionId: "conn",
        indices: ["orders"],
        aliases: [],
        fields: ["price", "sku"],
        fieldsByIndex: { orders: ["price", "sku"] },
        aliasToIndices: {},
        fetchedAt: "",
        expiresAt: "",
      },
    );

    expect(context.fieldNames).toEqual(["price", "sku"]);
  });

  it("filters out history entries already present as indices or aliases", () => {
    const context = buildConsoleAutocompleteContext(
      [buildSavedRequest("/orders/_search")],
      "",
      {
        connectionId: "conn",
        indices: ["orders"],
        aliases: [],
        fields: [],
        fieldsByIndex: {},
        aliasToIndices: {},
        fetchedAt: "",
        expiresAt: "",
      },
    );
    expect(context.historyTargetNames).toEqual([]);
  });

  it("handles missing metadata", () => {
    const context = buildConsoleAutocompleteContext([], "", null);
    expect(context).toEqual({ indexNames: [], aliasNames: [], fieldNames: [], historyTargetNames: [] });
  });
});
