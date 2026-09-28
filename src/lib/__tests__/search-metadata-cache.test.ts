import { describe, expect, it } from "vitest";
import { mergeTargetFields, hasFreshTargetFields, normalizeFieldCache } from "../search-metadata-cache";
import { normalizeClusterMetadata } from "../console-autocomplete/capabilities";
import type { ConnectionSearchMetadata } from "../../types/requests";

function cache(): ConnectionSearchMetadata {
  return { connectionId: "c", indices: [], aliases: [], fields: [], fieldsByIndex: {}, aliasToIndices: {}, cluster: normalizeClusterMetadata(null), fetchedAt: "", expiresAt: "" };
}

describe("bounded target field cache", () => {
  it("replaces old mapping fields and expires after five minutes", () => {
    const first = mergeTargetFields(cache(), { requestedNames: ["a"], fieldsByIndex: { a: ["old"] } }, 1000);
    const next = mergeTargetFields(first, { requestedNames: ["a"], fieldsByIndex: { a: ["new"] } }, 2000);
    expect(next.fields).toEqual(["new"]);
    expect(hasFreshTargetFields(next, ["a"], 301999)).toBe(true);
    expect(hasFreshTargetFields(next, ["a"], 302000)).toBe(false);
    expect(hasFreshTargetFields(next, ["missing"], 2000)).toBe(false);
  });

  it("evicts the oldest entries with deterministic ties and bounds the derived field list", () => {
    const first = mergeTargetFields(cache(), { requestedNames: [], fieldsByIndex: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`index-${String(i).padStart(3, "0")}`, [`f${i}`]])) }, 1000);
    const next = mergeTargetFields(first, { requestedNames: ["new"], fieldsByIndex: { new: ["new-field"] } }, 2000);
    expect(Object.keys(next.fieldsByIndex)).toHaveLength(100);
    expect(next.fieldsByIndex["index-099"]).toBeUndefined();
    expect(next.fields).not.toContain("f99");
    expect(next.fieldsByIndex.new).toEqual(["new-field"]);
  });

  it("keeps the first 2000 sorted fields and preserves the truncation marker after normalization", () => {
    const fields = Array.from({ length: 2001 }, (_, i) => `f${String(i).padStart(4, "0")}`).reverse();
    const result = normalizeFieldCache(mergeTargetFields(cache(), { requestedNames: ["a"], fieldsByIndex: { a: fields } }, 1000));
    expect(result.fieldsByIndex.a).toHaveLength(2000);
    expect(result.fieldsByIndex.a[0]).toBe("f0000");
    expect(result.fieldsByIndex.a[1999]).toBe("f1999");
    expect(result.fieldsTruncatedByIndex?.a).toBe(true);
    expect(result.fieldsFetchedAtByIndex?.a).toBe("1970-01-01T00:00:01.000Z");
  });

  it("does not mark empty mapping results fresh and does not invent alias membership for multiple names", () => {
    const result = mergeTargetFields(cache(), { requestedNames: ["alias", "other"], fieldsByIndex: { a: ["field"], empty: [] } }, 1000);
    expect(hasFreshTargetFields(result, ["empty"], 1000)).toBe(false);
    expect(result.aliasToIndices).toEqual({});
  });

  it("marks an alias spanning more than 100 indices incomplete after persistence normalization", () => {
    const names = Array.from({ length: 101 }, (_, i) => `index-${i}`);
    const result = normalizeFieldCache(mergeTargetFields({ ...cache(), aliasToIndices: { alias: names } }, {
      requestedNames: ["alias"], fieldsByIndex: Object.fromEntries(names.map((name) => [name, [name]])),
    }, 1000));
    expect(Object.keys(result.fieldsByIndex)).toHaveLength(100);
    expect(result.fieldsCacheTruncated).toBe(true);
  });

  it("resolves known aliases to all concrete indices for freshness", () => {
    const base = { ...cache(), aliasToIndices: { alias: ["a", "b"] } };
    const first = mergeTargetFields(base, { requestedNames: ["alias"], fieldsByIndex: { a: ["field"] } }, 1000);
    expect(hasFreshTargetFields(first, ["alias"], 1000)).toBe(false);
    const second = mergeTargetFields(first, { requestedNames: ["b"], fieldsByIndex: { b: ["other"] } }, 1000);
    expect(hasFreshTargetFields(second, ["alias"], 1000)).toBe(true);
  });
});
