import { describe, expect, it } from "vitest";
import { analyzeRequestContentLocally } from "../request-analyzer";

describe("analyzeRequestContentLocally", () => {
  it("returns meaning for valid cluster health request", () => {
    const result = analyzeRequestContentLocally("GET /_cluster/health");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.meaning).toContain("GET 请求");
      expect(result.meaning).toContain("集群健康状态");
    }
  });

  it("returns meaning for valid search request with query body", () => {
    const result = analyzeRequestContentLocally(`POST /orders/_search
{
  "size": 10,
  "query": {
    "bool": {
      "must": [{ "match": { "status": "paid" } }]
    }
  },
  "aggs": {
    "by_status": {
      "terms": { "field": "status.keyword" }
    }
  }
}`);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.meaning).toContain("orders");
      expect(result.meaning).toContain("索引搜索");
      expect(result.details.some((item) => item.includes("布尔组合查询"))).toBe(true);
      expect(result.details.some((item) => item.includes("size=10"))).toBe(true);
      expect(result.details.some((item) => item.includes("by_status"))).toBe(true);
    }
  });

  it("reports invalid method and suggests correction", () => {
    const result = analyzeRequestContentLocally("FETCH /orders/_search");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((item) => item.includes("FETCH"))).toBe(true);
      expect(result.suggestion).toBe("POST /orders/_search");
    }
  });

  it("suggests header when only path is provided", () => {
    const result = analyzeRequestContentLocally("/orders/_search");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.suggestion).toBe("POST /orders/_search");
    }
  });

  it("suggests request header when only JSON body is provided", () => {
    const result = analyzeRequestContentLocally(`{
  "query": { "match_all": {} }
}`);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.suggestion).toBe(`POST /_search
{
  "query": { "match_all": {} }
}`);
    }
  });

  it("suggests repaired JSON for trailing comma", () => {
    const result = analyzeRequestContentLocally(`POST /orders/_search
{
  "size": 10,
}`);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.suggestion).toContain("POST /orders/_search");
      expect(result.suggestion).toContain('"size": 10');
      expect(result.suggestion).not.toContain(",");
    }
  });

  it("reports empty content with default suggestion", () => {
    const result = analyzeRequestContentLocally("   ");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toEqual(["请输入请求内容。"]);
      expect(result.suggestion).toBe("GET /_cluster/health");
    }
  });

  it("does not require body for GET requests", () => {
    const result = analyzeRequestContentLocally("GET /_cat/indices?v=true");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.meaning).toContain("列出索引");
    }
  });

  it("describes expanded query DSL types", () => {
    const result = analyzeRequestContentLocally(`POST /orders/_search
{
  "query": {
    "constant_score": {
      "filter": {
        "geo_distance": {
          "distance": "10km",
          "location": "40,-70"
        }
      }
    }
  }
}`);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.details.join("；")).toContain("常量评分查询");
      expect(result.details.join("；")).toContain("地理距离查询");
    }
  });

  it("describes expanded aggregation types", () => {
    const result = analyzeRequestContentLocally(`POST /orders/_search
{
  "aggs": {
    "nested_items": {
      "nested": {
        "path": "items"
      }
    },
    "price_stats": {
      "extended_stats": {
        "field": "price"
      }
    }
  }
}`);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.details).toEqual(expect.arrayContaining([
        "聚合「nested_items」：嵌套聚合",
        "聚合「price_stats」：扩展统计聚合",
      ]));
    }
  });
});
