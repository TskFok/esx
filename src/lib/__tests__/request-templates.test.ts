import { describe, expect, it } from "vitest";
import { getRequestTemplateById, REQUEST_TEMPLATES } from "../request-templates";

describe("request templates", () => {
  it("includes common elasticsearch templates", () => {
    expect(REQUEST_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(REQUEST_TEMPLATES.some((template) => template.id === "cluster-health")).toBe(true);
    expect(REQUEST_TEMPLATES.some((template) => template.id === "match-all-search")).toBe(true);
  });

  it("includes admin governance and template system templates", () => {
    expect(REQUEST_TEMPLATES.map((template) => template.id)).toEqual(
      expect.arrayContaining([
        "create-index",
        "alias-switch",
        "reindex-async",
        "rollover-dry-run",
        "index-template-put",
        "component-template-put",
        "ingest-pipeline-simulate",
        "analyze-standard",
      ]),
    );
  });

  it("finds template by id", () => {
    const template = getRequestTemplateById("cat-indices");
    expect(template?.content).toContain("/_cat/indices");
  });
});
