import { describe, expect, it } from "vitest";
import {
  buildConsoleAutocompleteContext,
  buildConsoleAutocompleteContextForRequest,
  buildConsoleAutocompleteStaticContext,
  extractIndexNamesFromPath,
} from "../context";
import type { SavedRequest } from "../../../types/requests";

function buildSavedRequest(path: string): SavedRequest {
  return {
    id: "id",
    connectionId: "conn",
    name: "n",
    method: "GET",
    path,
    body: "",
    headers: {},
    tags: [],
    sortOrder: 0,
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
  it("includes cluster metadata when available", () => {
    const context = buildConsoleAutocompleteContext([], "", {
      connectionId: "conn",
      indices: [],
      aliases: [],
      fields: [],
      fieldsByIndex: {},
      aliasToIndices: {},
      cluster: {
        product: "opensearch",
        version: { number: "2.19.0", major: 2, minor: 19 },
        distribution: "opensearch",
        buildFlavor: null,
        license: { type: "apache-2.0", status: "active", source: "root" },
      },
      fetchedAt: "",
      expiresAt: "",
    });

    expect(context.cluster.product).toBe("opensearch");
    expect(context.cluster.version.major).toBe(2);
  });

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
    expect(context.request).toMatchObject({
      method: "POST",
      endpoint: "search",
      bodyMode: "search-json",
    });
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

  it("保留按索引和 alias 精确解析的只读字段 metadata", () => {
    const context = buildConsoleAutocompleteContext([], "POST /_bulk", {
      connectionId: "conn",
      indices: ["orders", "users"],
      aliases: ["all-data", "orders-read"],
      fields: ["order_id", "shared", "user_id"],
      fieldsByIndex: {
        orders: ["order_id", "shared"],
        users: ["user_id", "shared"],
      },
      aliasToIndices: {
        "all-data": ["orders", "users"],
        "orders-read": ["orders"],
      },
      fetchedAt: "",
      expiresAt: "",
    });

    expect(context.fieldNamesByTarget).toEqual({
      "all-data": ["order_id", "shared", "user_id"],
      orders: ["order_id", "shared"],
      "orders-read": ["order_id", "shared"],
      users: ["shared", "user_id"],
    });
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
    expect(context).toMatchObject({
      indexNames: [],
      aliasNames: [],
      fieldNames: [],
      historyTargetNames: [],
      cluster: {
        product: "unknown",
        version: { number: null, major: null, minor: null },
        license: { type: null, status: null, source: "unknown" },
      },
    });
  });
});

describe("静态补全上下文", () => {
  const metadata = {
    indices: ["orders", "users"],
    aliases: ["all-data", "orders-read"],
    fields: ["price", "shared", "user.name"],
    fieldsByIndex: {
      orders: ["shared", "price", "shared"],
      users: ["user.name", "shared"],
    },
    aliasToIndices: {
      "all-data": ["orders", "users"],
      "orders-read": ["orders"],
    },
  };

  it("同一静态对象在正文变化时复用字段映射，并按首行选择字段", () => {
    const stable = buildConsoleAutocompleteStaticContext([], metadata);
    const orders = buildConsoleAutocompleteContextForRequest(stable, "POST /orders/_search");
    const ordersWithBody = buildConsoleAutocompleteContextForRequest(
      stable,
      "POST /orders/_search\n{\"query\":{}}",
    );
    const users = buildConsoleAutocompleteContextForRequest(stable, "POST /users/_search");

    expect(orders.fieldNamesByTarget).toBe(stable.fieldNamesByTarget);
    expect(ordersWithBody.fieldNamesByTarget).toBe(stable.fieldNamesByTarget);
    expect(users.fieldNamesByTarget).toBe(stable.fieldNamesByTarget);
    expect(orders.fieldNames).toEqual(["price", "shared"]);
    expect(ordersWithBody.fieldNames).toEqual(["price", "shared"]);
    expect(users.fieldNames).toEqual(["shared", "user.name"]);
  });

  it("保存历史仅含已保存目标，当前目标在动态阶段加入", () => {
    const stable = buildConsoleAutocompleteStaticContext(
      [buildSavedRequest("/orders/_search"), buildSavedRequest("/custom/_search")],
      metadata,
    );

    expect(stable.savedHistoryTargetNames).toEqual(["custom"]);
    expect(buildConsoleAutocompleteContextForRequest(stable, "POST /draft/_search").historyTargetNames)
      .toEqual(["custom", "draft"]);
    expect(buildConsoleAutocompleteContextForRequest(stable, "POST /orders/_search").historyTargetNames)
      .toEqual(["custom"]);
  });

  it("合并 alias 与多索引字段并去重，未知和 wildcard 目标回退全部字段", () => {
    const stable = buildConsoleAutocompleteStaticContext([], metadata);

    expect(buildConsoleAutocompleteContextForRequest(stable, "POST /all-data/_search").fieldNames)
      .toEqual(["price", "shared", "user.name"]);
    expect(buildConsoleAutocompleteContextForRequest(stable, "POST /orders,users/_search").fieldNames)
      .toEqual(["price", "shared", "user.name"]);
    expect(buildConsoleAutocompleteContextForRequest(stable, "POST /missing/_search").fieldNames)
      .toEqual(["price", "shared", "user.name"]);
    expect(buildConsoleAutocompleteContextForRequest(stable, "POST /orders-*/_search").fieldNames)
      .toEqual(["price", "shared", "user.name"]);
    expect(buildConsoleAutocompleteContextForRequest(stable, "POST /orders-*/_search").historyTargetNames)
      .toEqual([]);
  });

  it("新连接和新 metadata 构建独立对象且不修改旧对象", () => {
    const first = buildConsoleAutocompleteStaticContext([buildSavedRequest("/old/_search")], metadata);
    const next = buildConsoleAutocompleteStaticContext(
      [buildSavedRequest("/next/_search")],
      { ...metadata, indices: ["next"], aliases: [], fields: ["next.field"], fieldsByIndex: { next: ["next.field"] }, aliasToIndices: {} },
    );

    expect(next).not.toBe(first);
    expect(next.fieldNamesByTarget).not.toBe(first.fieldNamesByTarget);
    expect(next.savedHistoryTargetNames).toEqual([]);
    expect(buildConsoleAutocompleteContextForRequest(next, "POST /next/_search").fieldNames)
      .toEqual(["next.field"]);
    expect(buildConsoleAutocompleteContextForRequest(first, "POST /orders/_search").fieldNames)
      .toEqual(["price", "shared"]);
    expect(first.savedHistoryTargetNames).toEqual(["old"]);
  });
});
