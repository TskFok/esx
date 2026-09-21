import { describe, expect, it } from "vitest";
import { redactSensitiveText, redactSensitiveValue } from "../log-redaction";

describe("redactSensitiveText", () => {
  it("redacts authorization headers and sensitive json fields", () => {
    const redacted = redactSensitiveText(`Authorization: Bearer real-token
{
  "password": "secret",
  "api_key": "abc",
  "safe": "visible"
}`);

    expect(redacted).not.toContain("real-token");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("abc");
    expect(redacted).toContain("Authorization: [REDACTED]");
    expect(redacted).toContain('"password": "[REDACTED]"');
    expect(redacted).toContain('"safe": "visible"');
  });

  it("redacts URL credentials and encoded sensitive query keys without hiding ordinary query values", () => {
    const text = "GET https://legacy-user:legacy-pass@cluster.example/proxy/_search?%61pi%5Fkey=query-secret&pretty=true&accessToken=second-secret";

    expect(redactSensitiveText(text)).toBe(
      "GET https://cluster.example/proxy/_search?%61pi%5Fkey=[REDACTED]&pretty=true&accessToken=[REDACTED]",
    );
  });

  it("redacts sensitive fields inside JSON response strings while preserving normal response data", () => {
    const text = JSON.stringify({ result: { clientSecret: { value: "nested-secret" }, total: 12 }, hits: ["visible"] });

    expect(JSON.parse(redactSensitiveText(text))).toEqual({
      result: { clientSecret: "[REDACTED]", total: 12 },
      hits: ["visible"],
    });
  });

  it("preserves large integer response values while redacting nested secret values", () => {
    const text = '{"secret":{"value":"nested-secret"},"count":9223372036854775807}';

    expect(redactSensitiveText(text)).toBe('{"secret":"[REDACTED]","count":9223372036854775807}');
  });

  it("keeps fields after a URL query in a Console JSON body", () => {
    const text = 'POST /_search\n{"url":"https://cluster.example/?token=query-secret","visible":"keep"}';

    expect(redactSensitiveText(text)).toBe(
      'POST /_search\n{"url":"https://cluster.example/?token=[REDACTED]","visible":"keep"}',
    );
  });

  it.each(["p ass", "p\nass", 'p"ass', "p'ass"])("redacts unusual URL userinfo in text without removing surrounding diagnostics: %s", (password) => {
    expect(redactSensitiveText(`Failed https://alice:${password}@cluster.example/path while connecting`))
      .toBe("Failed https://cluster.example/path while connecting");
  });

  it("keeps separate ordinary URLs and email addresses in diagnostics", () => {
    const text = "Check https://cluster.example then contact support@example.org for help";

    expect(redactSensitiveText(text)).toBe(text);
  });

  it("removes every part of userinfo when its password contains a raw at sign", () => {
    expect(redactSensitiveText("Failed https://alice:part@rest@cluster.example/path while connecting"))
      .toBe("Failed https://cluster.example/path while connecting");
  });

  it.each(["part@re st", "part@re\nst", 'part@re"st', "part@re'st", 'part@re \n"st@last bit'])(
    "redacts the complete authority when userinfo combines at signs and whitespace or quotes: %s",
    (password) => {
      expect(redactSensitiveText(`Failed https://alice:${password}@cluster.example/path while connecting`))
        .toBe("Failed https://cluster.example/path while connecting");
    },
  );

  it.each([
    ['{"url":"https://cluster.example","email":"support@example.org"}', '{"url":"https://cluster.example","email":"support@example.org"}'],
    ['{"url":"https://alice:pass@cluster.example","email":"support@example.org"}', '{"url":"https://cluster.example","email":"support@example.org"}'],
    ["Check https://cluster.example:9200 then contact support@example.org", "Check https://cluster.example:9200 then contact support@example.org"],
    ["Check https://alice:pass@cluster.example then contact support@example.org", "Check https://cluster.example then contact support@example.org"],
  ])("keeps neighboring JSON fields and diagnostic prose when stripping URL credentials", (input, expected) => {
    expect(redactSensitiveText(input)).toBe(expected);
  });
});

describe("redactSensitiveValue", () => {
  it("uses URL authority boundaries for a historical baseUrl", () => {
    expect(redactSensitiveValue({ baseUrl: 'https://alice:p \n"ass@cluster.example/path' }))
      .toEqual({ baseUrl: "https://cluster.example/path" });
  });

  it("redacts every nested log field without mutating the input or dropping ordinary values", () => {
    const entry = {
      title: "Failed https://legacy-user:legacy-pass@cluster.example/",
      connection: { baseUrl: "https://cluster.example/?api_key=query-secret" },
      request: { content: 'POST /_search\n{"password":"body-secret","query":{"match_all":{}}}' },
      diagnostics: [{ sshSecret: "ssh-secret", response: { count: 7, enabled: false, empty: null } }],
    };
    const before = structuredClone(entry);

    expect(redactSensitiveValue(entry)).toEqual({
      title: "Failed https://cluster.example/",
      connection: { baseUrl: "https://cluster.example/?api_key=[REDACTED]" },
      request: { content: 'POST /_search\n{"password":"[REDACTED]","query":{"match_all":{}}}' },
      diagnostics: [{ sshSecret: "[REDACTED]", response: { count: 7, enabled: false, empty: null } }],
    });
    expect(entry).toEqual(before);
  });
});
