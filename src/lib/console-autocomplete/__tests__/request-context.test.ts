import { describe, expect, it } from "vitest";
import { parseConsoleRequestContext } from "../request-context";

describe("parseConsoleRequestContext", () => {
  it.each([
    ["POST /orders/_search\n{}", "search", "search-json"],
    ["POST /_search/scroll\n{}", "scroll", "scroll-json"],
    ["POST /orders/_count\n{}", "count", "count-json"],
    ["POST /_bulk\n", "bulk", "bulk-ndjson"],
    ["POST /orders/_msearch\n", "msearch", "msearch-ndjson"],
    ["PUT /orders\n{}", "create-index", "create-index-json"],
    ["POST /orders/_update/42\n{}", "update-document", "update-json"],
    ["POST /orders/_doc\n{}", "index-document", "document-json"],
  ] as const)("分类 %s", (content, endpoint, bodyMode) => {
    expect(parseConsoleRequestContext(content)).toMatchObject({ endpoint, bodyMode });
  });

  it("去掉查询串但保留原始路径", () => {
    expect(parseConsoleRequestContext("POST /_search/scroll?scroll=1m\n{}")).toMatchObject({
      rawPath: "/_search/scroll?scroll=1m",
      path: "/_search/scroll",
      pathSegments: ["_search", "scroll"],
    });
  });

  it("不完整请求头仍保留方法并使用根上下文", () => {
    expect(parseConsoleRequestContext("POST ")).toMatchObject({
      method: "POST",
      path: "/",
      endpoint: "root",
      bodyMode: "unknown",
    });
  });

  it("未知 API 不猜测正文模式", () => {
    expect(parseConsoleRequestContext("POST /orders/_made_up\n{}")).toMatchObject({
      endpoint: "unknown",
      bodyMode: "unknown",
    });
  });

  it.each([
    ["GET /_search", "search"],
    ["POST /orders/_search", "search"],
    ["GET /_search/scroll", "scroll"],
    ["GET /orders/_count", "count"],
    ["PUT /orders/_bulk", "bulk"],
    ["GET /_msearch", "msearch"],
    ["GET /_cat/indices", "cat"],
    ["PUT /orders/_mapping", "mapping"],
    ["GET /_settings", "settings"],
    ["GET /_tasks", "tasks"],
    ["GET /_snapshot", "snapshot"],
    ["DELETE /_snapshot/backups", "snapshot"],
    ["PUT /_snapshot/backups/nightly", "snapshot"],
    ["POST /_snapshot/backups/nightly/_restore", "snapshot"],
    ["POST /orders/_update/42", "update-document"],
    ["POST /orders/_doc", "index-document"],
    ["PUT /orders/_doc/42", "index-document"],
    ["PUT /orders", "create-index"],
  ] as const)("只识别静态 endpoint profile：%s", (content, endpoint) => {
    expect(parseConsoleRequestContext(content).endpoint).toBe(endpoint);
  });

  it.each([
    "DELETE /orders/_search",
    "GET /_bulk",
    "POST /_search/scroll/extra",
    "POST /orders/_doc/42/extra",
    "POST /foo/bar/_search",
    "POST /_cat/indices",
    "DELETE /orders/_mapping",
    "POST /_settings",
    "POST /_tasks",
    "GET /_tasks/42/extra",
    "GET /_snapshot/backups/nightly/extra",
    "GET /_snapshot/backups/nightly/_restore",
  ])("非法 method 或路径形态保持 unknown：%s", (content) => {
    expect(parseConsoleRequestContext(content)).toMatchObject({
      endpoint: "unknown",
      bodyMode: "unknown",
    });
  });

  it.each([
    "PUT /_all",
    "PUT /orders-*",
    "PUT /orders%3F",
    "PUT /orders,users",
    "PUT /_search",
    "POST /_all/_doc",
    "POST /orders-*/_doc/42",
    "PUT /orders,users/_doc/42",
    "POST /_all/_update/42",
    "POST /orders-*/_update/42",
    "POST /orders,users/_update/42",
  ])("写 endpoint 拒绝非单一具体 target：%s", (content) => {
    expect(parseConsoleRequestContext(content)).toMatchObject({
      endpoint: "unknown",
      bodyMode: "unknown",
    });
  });

  it.each([
    ["PUT /orders-write", "create-index"],
    ["POST /orders-write/_doc", "index-document"],
    ["PUT /orders-write/_doc/42", "index-document"],
    ["POST /orders-write/_update/42", "update-document"],
  ] as const)("写 endpoint 保留单一具体 index 或 alias：%s", (content, endpoint) => {
    expect(parseConsoleRequestContext(content).endpoint).toBe(endpoint);
  });
});
