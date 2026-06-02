import { describe, expect, it } from "vitest";
import {
  MIN_RESPONSE_PREVIEW_BYTES,
  RESPONSE_PREVIEW_BYTES,
  buildResponseSnapshot,
  normalizeResponsePreviewBytes,
  normalizeResponseSnapshot,
} from "../response-snapshot";

function buildSnapshot(bodyText: string) {
  return buildResponseSnapshot({
    ok: true,
    status: 200,
    statusText: "OK",
    durationMs: 12,
    executedAt: "2026-04-24T00:00:00.000Z",
    bodyText,
    diagnostics: [],
  });
}

describe("response snapshot previews", () => {
  it("keeps and prettifies small JSON responses", () => {
    const snapshot = buildSnapshot('{"ok":true,"hits":[1,2]}');

    expect(snapshot.truncated).toBe(false);
    expect(snapshot.isJson).toBe(true);
    expect(snapshot.bodyPreview).toBe('{"ok":true,"hits":[1,2]}');
    expect(snapshot.prettyPreview).toContain('"ok": true');
  });

  it("does not parse or persist pretty text for large responses", () => {
    const snapshot = buildSnapshot(`{"items":"${"a".repeat(RESPONSE_PREVIEW_BYTES)}"}`);

    expect(snapshot.truncated).toBe(true);
    expect(snapshot.isJson).toBe(false);
    expect(snapshot.prettyPreview).toBeUndefined();
    expect(snapshot.bodyPreview.length).toBeLessThan(snapshot.sizeBytes);
    expect(snapshot.previewBytes).toBeLessThanOrEqual(RESPONSE_PREVIEW_BYTES);
  });

  it("truncates large non-JSON responses", () => {
    const snapshot = buildSnapshot("x".repeat(RESPONSE_PREVIEW_BYTES + 20));

    expect(snapshot.truncated).toBe(true);
    expect(snapshot.isJson).toBe(false);
    expect(snapshot.bodyPreview).toHaveLength(RESPONSE_PREVIEW_BYTES);
    expect(snapshot.sizeBytes).toBe(RESPONSE_PREVIEW_BYTES + 20);
  });

  it("handles empty responses", () => {
    const snapshot = buildSnapshot("");

    expect(snapshot.truncated).toBe(false);
    expect(snapshot.isJson).toBe(false);
    expect(snapshot.bodyPreview).toBe("");
    expect(snapshot.previewBytes).toBe(0);
  });

  it("migrates legacy bodyText and bodyPretty into previews", () => {
    const legacy = normalizeResponseSnapshot({
      ok: true,
      status: 200,
      statusText: "OK",
      durationMs: 10,
      sizeBytes: RESPONSE_PREVIEW_BYTES + 50,
      executedAt: "2026-04-24T00:00:00.000Z",
      bodyText: "a".repeat(RESPONSE_PREVIEW_BYTES + 50),
      bodyPretty: "{\n  \"ok\": true\n}",
      isJson: true,
      diagnostics: ["done"],
    });

    expect(legacy).not.toBeNull();
    expect(legacy?.truncated).toBe(true);
    expect(legacy?.bodyPreview.length).toBe(RESPONSE_PREVIEW_BYTES);
    expect(legacy?.prettyPreview).toBe("{\n  \"ok\": true\n}");
    expect(legacy).not.toHaveProperty("bodyText");
    expect(legacy).not.toHaveProperty("bodyPretty");
  });

  it("uses a caller-provided preview size", () => {
    const snapshot = buildResponseSnapshot(
      {
        ok: true,
        status: 200,
        statusText: "OK",
        durationMs: 12,
        executedAt: "2026-04-24T00:00:00.000Z",
        bodyText: "x".repeat(64 * 1024 + 1),
        diagnostics: [],
      },
      64 * 1024,
    );

    expect(snapshot.truncated).toBe(true);
    expect(snapshot.previewBytes).toBe(64 * 1024);
  });

  it("does not mark responses truncated only because pretty JSON exceeds the limit", () => {
    const bodyText = `{"items":[${Array.from({ length: 1200 }, () => "{\"id\":1}").join(",")}]}`;
    const snapshot = buildResponseSnapshot(
      {
        ok: true,
        status: 200,
        statusText: "OK",
        durationMs: 12,
        executedAt: "2026-04-24T00:00:00.000Z",
        bodyText,
        diagnostics: [],
      },
      bodyText.length + 10,
    );

    expect(snapshot.truncated).toBe(false);
    expect(snapshot.isJson).toBe(true);
    expect(snapshot.prettyPreview).toBeUndefined();
    expect(snapshot.bodyPreview).toBe(bodyText);
  });

  it("repairs legacy snapshots falsely truncated by pretty JSON", () => {
    const bodyText = `{"items":[${Array.from({ length: 1200 }, () => "{\"id\":1}").join(",")}]}`;
    const legacy = normalizeResponseSnapshot(
      {
        ok: true,
        status: 200,
        statusText: "OK",
        durationMs: 10,
        sizeBytes: bodyText.length,
        executedAt: "2026-04-24T00:00:00.000Z",
        bodyPreview: bodyText,
        prettyPreview: JSON.stringify(JSON.parse(bodyText), null, 2),
        truncated: true,
        previewBytes: bodyText.length,
        isJson: true,
        diagnostics: [],
      },
      bodyText.length + 10,
    );

    expect(legacy?.truncated).toBe(false);
    expect(legacy?.prettyPreview).toBeUndefined();
  });

  it("keeps configured preview sizes open above the minimum", () => {
    expect(normalizeResponsePreviewBytes(1)).toBe(MIN_RESPONSE_PREVIEW_BYTES);
    expect(normalizeResponsePreviewBytes(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(normalizeResponsePreviewBytes(512 * 1024)).toBe(512 * 1024);
  });
});
