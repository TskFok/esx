import { describe, expect, it } from "vitest";
import { paginate } from "../paginate";

describe("paginate", () => {
  it("每页最多返回 100 项并保留完整总数", () => {
    const items = Array.from({ length: 1000 }, (_, index) => index);
    expect(paginate(items, 2)).toEqual({ items: items.slice(100, 200), page: 2, pageCount: 10, total: 1000 });
  });

  it("筛选缩小后将过期页码限制到有效页", () => {
    expect(paginate(["a", "b"], 10)).toEqual({ items: ["a", "b"], page: 1, pageCount: 1, total: 2 });
    expect(paginate([], 10)).toEqual({ items: [], page: 1, pageCount: 1, total: 0 });
  });
});
