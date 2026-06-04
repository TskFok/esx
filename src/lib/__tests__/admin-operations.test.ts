import { describe, expect, it } from "vitest";
import {
  buildAdminRequestPreview,
  buildAliasSwitchOperation,
  buildAnalyzeOperation,
  buildIndexStateOperation,
  buildMappingDiff,
  buildReindexOperation,
  buildRolloverOperation,
  buildShrinkSplitOperation,
  buildUpdateIndexSettingsOperation,
  parseAnalyzeTokens,
} from "../admin-operations";

describe("admin operations", () => {
  it("builds encoded index state requests", () => {
    expect(buildAdminRequestPreview(buildIndexStateOperation("orders 2026", "close")).content).toBe(
      "POST /orders%202026/_close",
    );
    expect(buildAdminRequestPreview(buildIndexStateOperation("orders 2026", "delete")).content).toBe(
      "DELETE /orders%202026",
    );
  });

  it("builds dynamic settings update request from JSON", () => {
    const preview = buildAdminRequestPreview(
      buildUpdateIndexSettingsOperation({
        indexName: "orders",
        settingsJson: '{ "index": { "refresh_interval": "30s" } }',
      }),
    );

    expect(preview.content).toBe(`PUT /orders/_settings
{
  "index": {
    "refresh_interval": "30s"
  }
}`);
  });

  it("builds atomic alias switch request", () => {
    const preview = buildAdminRequestPreview(
      buildAliasSwitchOperation({
        aliasName: "orders-write",
        removeIndices: ["orders-v1"],
        addIndices: ["orders-v2"],
        writeIndex: "orders-v2",
      }),
    );

    expect(preview.content).toContain("POST /_aliases");
    expect(JSON.parse(preview.bodyText)).toEqual({
      actions: [
        { remove: { index: "orders-v1", alias: "orders-write" } },
        { add: { index: "orders-v2", alias: "orders-write", is_write_index: true } },
      ],
    });
  });

  it("builds rollover and reindex requests with safe defaults", () => {
    expect(buildAdminRequestPreview(buildRolloverOperation({
      aliasName: "logs-write",
      newIndexName: "logs-000002",
      conditionsJson: '{ "max_docs": 1000 }',
      dryRun: true,
    })).content).toContain("POST /logs-write/_rollover/logs-000002?dry_run=true");

    const reindex = buildAdminRequestPreview(buildReindexOperation({
      sourceIndex: "orders-v1",
      targetIndex: "orders-v2",
      queryJson: '{ "term": { "status": "paid" } }',
      slices: 2,
      refresh: true,
    }));
    expect(reindex.path).toBe("/_reindex?wait_for_completion=false");
    expect(JSON.parse(reindex.bodyText)).toEqual({
      source: { index: "orders-v1", query: { term: { status: "paid" } } },
      dest: { index: "orders-v2" },
      refresh: true,
      slices: 2,
    });
  });

  it("builds shrink and split requests as explicit step operations", () => {
    expect(buildAdminRequestPreview(buildShrinkSplitOperation({
      type: "shrink",
      sourceIndex: "logs-v1",
      targetIndex: "logs-v1-shrunk",
      targetShards: 1,
    })).content).toContain("PUT /logs-v1/_shrink/logs-v1-shrunk");

    expect(buildAdminRequestPreview(buildShrinkSplitOperation({
      type: "split",
      sourceIndex: "logs-v1",
      targetIndex: "logs-v1-split",
      targetShards: 8,
    })).bodyText).toContain('"index.number_of_shards": 8');
  });

  it("builds mapping diff for added, removed and changed fields", () => {
    const diff = buildMappingDiff({
      leftName: "orders-v1",
      rightName: "orders-v2",
      leftMapping: {
        "orders-v1": {
          mappings: {
            properties: {
              id: { type: "keyword" },
              amount: { type: "long" },
              obsolete: { type: "text" },
            },
          },
        },
      },
      rightMapping: {
        "orders-v2": {
          mappings: {
            properties: {
              id: { type: "keyword" },
              amount: { type: "double" },
              created_at: { type: "date" },
            },
          },
        },
      },
    });

    expect(diff.summary).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(diff.entries.map((entry) => `${entry.kind}:${entry.field}`)).toEqual([
      "changed:amount",
      "added:created_at",
      "unchanged:id",
      "removed:obsolete",
    ]);
  });

  it("builds analyze request and parses tokens", () => {
    const preview = buildAdminRequestPreview(buildAnalyzeOperation({
      indexName: "orders",
      analyzer: "standard",
      tokenizer: "",
      text: "Quick fox",
    }));

    expect(preview.content).toContain("POST /orders/_analyze");
    expect(JSON.parse(preview.bodyText)).toEqual({ analyzer: "standard", text: "Quick fox" });
    expect(parseAnalyzeTokens(JSON.stringify({
      tokens: [
        { token: "quick", start_offset: 0, end_offset: 5, type: "<ALPHANUM>", position: 0 },
      ],
    }))).toEqual([
      { token: "quick", startOffset: 0, endOffset: 5, type: "<ALPHANUM>", position: 0 },
    ]);
  });
});
