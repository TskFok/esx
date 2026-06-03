import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "../log-redaction";

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
});
