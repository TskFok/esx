import { describe, expect, it } from "vitest";
import { buildConnectionLogContextFromForm, buildRequestLogContext } from "../error-logs";
import type { ConnectionFormValues } from "../../types/connections";

describe("error log contexts", () => {
  it("redacts failed connection form URLs before they enter a log", () => {
    const form: ConnectionFormValues = {
      name: "https://form-user:form-pass@cluster.example/", baseUrl: "https://cluster.example/?api_key=form-key",
      authType: "basic", username: "explicit-user", password: "", apiKey: "", bearerToken: "",
      tlsMode: "default", tlsCaPath: "", tlsFingerprint: "", insecureTls: false, environment: "dev",
      readonly: false, allowInsecureProductionTls: false, sshProfileId: "",
    };

    expect(buildConnectionLogContextFromForm(form)).toMatchObject({
      name: "https://cluster.example/", baseUrl: "https://cluster.example/?api_key=[REDACTED]", username: "explicit-user",
    });
  });

  it("redacts request paths and bodies while retaining the logged operation", () => {
    expect(buildRequestLogContext('POST /_search?token=request-key\n{"password":"body-secret","size":1}')).toEqual({
      method: "POST", path: "/_search?token=[REDACTED]",
      content: 'POST /_search?token=[REDACTED]\n{"password":"[REDACTED]","size":1}',
    });
  });
});
