import { describe, expect, it } from "vitest";
import { normalizeConnectionBaseUrl, sanitizeStoredConnectionUrl } from "../connection-url";

describe("normalizeConnectionBaseUrl", () => {
  it.each([
    ["  https://cluster.example/proxy/  ", "https://cluster.example/proxy/"],
    ["http://localhost:9200", "http://localhost:9200"],
    ["https://[::1]:9200/prefix", "https://[::1]:9200/prefix"],
  ])("preserves a valid endpoint and path prefix: %s", (input, expected) => {
    expect(normalizeConnectionBaseUrl(input)).toBe(expected);
  });

  it.each([
    "https://legacy-user:legacy-pass@cluster.example",
    "https://legacy-user@cluster.example",
    "https://@cluster.example",
    "https://cluster.example/?api_key=query-secret",
    "https://cluster.example/#fragment-secret",
    "https://cluster.example/?",
    "https://cluster.example/#",
    "file:///private/example",
    "http:/cluster.example",
    "https://cluster.example\\other",
    "https://cluster.example/path\nsecret",
    "https://cluster.example:invalid-port",
    "https://cluster.example/%invalid",
    "invalid-secret",
    "",
  ])("rejects unsafe or malformed endpoints without echoing their content", (input) => {
    let error: unknown;
    try {
      normalizeConnectionBaseUrl(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/legacy-user|legacy-pass|query-secret|fragment-secret|invalid-secret/);
  });
});

describe("sanitizeStoredConnectionUrl", () => {
  it.each(["p ass", "p\nass", 'p"ass', "p'ass"])("removes unusual historical userinfo accepted by URL parsing: %s", (password) => {
    expect(sanitizeStoredConnectionUrl(`https://alice:${password}@cluster.example/prefix/`))
      .toBe("https://cluster.example/prefix/");
  });

  it("removes historical credentials and sensitive query entries while preserving safe URL spelling", () => {
    expect(sanitizeStoredConnectionUrl("https://old-user:old-pass@cluster.example/prefix/?%61pi_key=old-key&pretty=true&accessToken=old-token#section"))
      .toBe("https://cluster.example/prefix/?pretty=true#section");
    expect(sanitizeStoredConnectionUrl("https://cluster.example/prefix/"))
      .toBe("https://cluster.example/prefix/");
  });
});
