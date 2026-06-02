import { describe, expect, it } from "vitest";
import { buildSecretsMigrationHint } from "../secrets-vault";

describe("buildSecretsMigrationHint", () => {
  it("maps connection and ssh profile identifiers for legacy migration", () => {
    expect(
      buildSecretsMigrationHint({
        connections: [
          { id: "conn-1", username: "elastic" },
          { id: "conn-2", username: "admin" },
        ],
        sshProfiles: [{ id: "ssh-1" }, { id: "ssh-2" }],
      }),
    ).toEqual({
      connections: [
        { connectionId: "conn-1", username: "elastic" },
        { connectionId: "conn-2", username: "admin" },
      ],
      sshProfileIds: ["ssh-1", "ssh-2"],
    });
  });

  it("returns empty hints when no saved profiles exist", () => {
    expect(
      buildSecretsMigrationHint({
        connections: [],
        sshProfiles: [],
      }),
    ).toEqual({
      connections: [],
      sshProfileIds: [],
    });
  });
});
