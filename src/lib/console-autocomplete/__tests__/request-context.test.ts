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
});
