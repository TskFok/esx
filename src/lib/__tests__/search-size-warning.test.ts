import { describe, expect, it } from "vitest";
import { getSearchSizeWarning } from "../search-size-warning";

describe("search size warning", () => {
  it("warns for size 1000", () => {
    const warning = getSearchSizeWarning(`POST /logs/_search
{
  "size": 1000,
  "query": { "match_all": {} }
}`);

    expect(warning?.level).toBe("warning");
    expect(warning?.size).toBe(1000);
  });

  it("uses danger level for size 10000", () => {
    const warning = getSearchSizeWarning(`POST /logs/_search
{
  "size": 10000,
  "query": { "match_all": {} }
}`);

    expect(warning?.level).toBe("danger");
    expect(warning?.message).toContain("search_after");
  });

  it("finds nested size values", () => {
    const warning = getSearchSizeWarning(`GET /logs/_search
{
  "query": {
    "nested": {
      "inner_hits": { "size": 1200 }
    }
  }
}`);

    expect(warning?.level).toBe("warning");
    expect(warning?.size).toBe(1200);
  });

  it("detects loose size syntax for early feedback", () => {
    const warning = getSearchSizeWarning(`GET /logs/_search
{
  size: 10000
}`);

    expect(warning?.level).toBe("danger");
    expect(warning?.size).toBe(10000);
  });

  it("ignores non-search requests", () => {
    expect(getSearchSizeWarning(`GET /logs/_count
{
  "size": 10000
}`)).toBeNull();
  });
});
