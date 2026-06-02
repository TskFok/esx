import { describe, expect, it } from "vitest";
import { getRequestTemplateById, REQUEST_TEMPLATES } from "../request-templates";

describe("request templates", () => {
  it("includes common elasticsearch templates", () => {
    expect(REQUEST_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(REQUEST_TEMPLATES.some((template) => template.id === "cluster-health")).toBe(true);
    expect(REQUEST_TEMPLATES.some((template) => template.id === "match-all-search")).toBe(true);
  });

  it("finds template by id", () => {
    const template = getRequestTemplateById("cat-indices");
    expect(template?.content).toContain("/_cat/indices");
  });
});
