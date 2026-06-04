import { describe, expect, it } from "vitest";
import { createEmptyStorage } from "../storage";
import { removeConnectionsFromStorage } from "../connection-state";
import type { ConnectionProfile } from "../../types/connections";

function createConnection(id: string, name: string): ConnectionProfile {
  const timestamp = "2026-05-27T00:00:00.000Z";
  return {
    id,
    name,
    baseUrl: `https://${id}.example.com`,
    username: "elastic",
    auth: { type: "basic" },
    tls: { mode: "default" },
    environment: "dev",
    readonly: false,
    insecureTls: false,
    sshProfileId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: timestamp,
  };
}

describe("removeConnectionsFromStorage", () => {
  it("returns null when no connection ids are provided", () => {
    const current = createEmptyStorage();
    current.connections = [createConnection("conn-1", "测试连接")];

    expect(removeConnectionsFromStorage(current, new Set())).toBeNull();
  });

  it("removes the connection and related request data", () => {
    const current = createEmptyStorage();
    const connection = createConnection("conn-1", "测试连接");
    const otherConnection = createConnection("conn-2", "保留连接");
    current.connections = [connection, otherConnection];
    current.currentConnectionId = connection.id;
    current.requests = [
      {
        id: "request-1",
        connectionId: connection.id,
        name: "健康检查",
        method: "GET",
        path: "/_cluster/health",
        body: "",
        tags: [],
        sortOrder: 0,
        updatedAt: connection.updatedAt,
        lastStatus: null,
        lastDurationMs: null,
        lastResponse: null,
      },
    ];
    current.drafts = {
      [connection.id]: {
        connectionId: connection.id,
        name: "",
        content: "GET /_cluster/health",
        activeSavedRequestId: null,
        response: null,
      },
    };
    current.searchMetadata = {
      [connection.id]: {
        connectionId: connection.id,
        indices: ["logs-*"],
        aliases: [],
        fields: ["message"],
        fieldsByIndex: {},
        aliasToIndices: {},
        cluster: {
          product: "unknown",
          version: { number: null, major: null, minor: null },
          distribution: null,
          buildFlavor: null,
          license: { type: null, status: null, source: "unknown" },
        },
        fetchedAt: connection.createdAt,
        expiresAt: connection.createdAt,
      },
    };

    const next = removeConnectionsFromStorage(current, new Set([connection.id]));

    expect(next).not.toBeNull();
    expect(next?.connections.map((item) => item.id)).toEqual(["conn-2"]);
    expect(next?.requests).toEqual([]);
    expect(next?.drafts).toEqual({});
    expect(next?.searchMetadata).toEqual({});
    expect(next?.currentConnectionId).toBe("conn-2");
  });
});
