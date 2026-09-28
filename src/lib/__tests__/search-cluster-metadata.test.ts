import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../types/connections";
import {
  fetchConnectionSearchMetadata,
  fetchTargetMappingFields,
  applyElasticLicenseInfo,
  parseElasticLicenseInfo,
  parseSearchClusterInfo,
} from "../http-client";

describe("search cluster metadata parsing", () => {
  it("parses Elasticsearch root info with version and build flavor", () => {
    const metadata = parseSearchClusterInfo(JSON.stringify({
      name: "es-node",
      cluster_name: "logs",
      version: {
        number: "8.12.1",
        build_flavor: "default",
        build_type: "docker",
      },
      tagline: "You Know, for Search",
    }));

    expect(metadata.product).toBe("elasticsearch");
    expect(metadata.version).toMatchObject({ number: "8.12.1", major: 8, minor: 12 });
    expect(metadata.buildFlavor).toBe("default");
    expect(metadata.distribution).toBeNull();
    expect(metadata.license).toMatchObject({ type: null, status: null, source: "unknown" });
  });

  it("detects Elasticsearch OSS build flavor from root info", () => {
    const metadata = parseSearchClusterInfo(JSON.stringify({
      version: {
        number: "7.10.2",
        build_flavor: "oss",
      },
      tagline: "You Know, for Search",
    }));

    expect(metadata.product).toBe("elasticsearch");
    expect(metadata.version).toMatchObject({ number: "7.10.2", major: 7, minor: 10 });
    expect(metadata.license).toMatchObject({ type: "oss", status: "active", source: "root" });
  });

  it("parses OpenSearch root info from distribution", () => {
    const metadata = parseSearchClusterInfo(JSON.stringify({
      name: "os-node",
      cluster_name: "logs",
      version: {
        distribution: "opensearch",
        number: "2.19.1",
        build_type: "tar",
      },
      tagline: "The OpenSearch Project: https://opensearch.org/",
    }));

    expect(metadata.product).toBe("opensearch");
    expect(metadata.version).toMatchObject({ number: "2.19.1", major: 2, minor: 19 });
    expect(metadata.distribution).toBe("opensearch");
    expect(metadata.license).toMatchObject({ type: "apache-2.0", status: "active", source: "root" });
  });

  it("applies Elasticsearch license info when available", () => {
    const base = parseSearchClusterInfo(JSON.stringify({
      version: { number: "9.0.0", build_flavor: "default" },
      tagline: "You Know, for Search",
    }));
    const license = parseElasticLicenseInfo(JSON.stringify({
      license: {
        type: "platinum",
        status: "active",
      },
    }));

    expect(applyElasticLicenseInfo(base, license).license).toEqual({
      type: "platinum",
      status: "active",
      source: "elastic-license",
    });
  });

  it("marks Elasticsearch license as unavailable when license probe is forbidden or missing", () => {
    const base = parseSearchClusterInfo(JSON.stringify({
      version: { number: "8.11.0", build_flavor: "default" },
      tagline: "You Know, for Search",
    }));

    expect(applyElasticLicenseInfo(base, null).license).toEqual({
      type: null,
      status: null,
      source: "unavailable",
    });
  });
});

const { executeEsHttpRequestMock } = vi.hoisted(() => ({ executeEsHttpRequestMock: vi.fn() }));
vi.mock("../tauri", () => ({ executeEsHttpRequest: executeEsHttpRequestMock, executeSshHttpRequest: vi.fn() }));

const connection = {
  id: "metadata-test", name: "测试", baseUrl: "https://example.invalid", username: "",
  auth: { type: "basic" }, tls: { mode: "default" }, environment: "dev", readonly: false,
  insecureTls: false, sshProfileId: null, createdAt: "", updatedAt: "", lastUsedAt: "",
} satisfies ConnectionProfile;
const ok = (body: unknown) => ({ ok: true, status: 200, statusText: "OK", bodyText: JSON.stringify(body) });

describe("targeted search metadata requests", () => {
  beforeEach(() => { executeEsHttpRequestMock.mockReset(); });

  it("loads names without requesting cluster-wide mappings", async () => {
    executeEsHttpRequestMock.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith("/")) return ok({ version: { number: "8.12.1" }, tagline: "You Know, for Search" });
      if (url.includes("/_resolve/")) return ok({ indices: [{ name: "orders" }], aliases: [{ name: "sales", indices: ["orders"] }] });
      return ok({});
    });
    const result = await fetchConnectionSearchMetadata(connection, { password: "" });
    expect(result.indices).toEqual(["orders"]);
    expect(result.aliasToIndices).toEqual({ sales: ["orders"] });
    expect(result.fieldsByIndex).toEqual({});
    expect(executeEsHttpRequestMock.mock.calls.some(([p]) => p.url.includes("_mapping"))).toBe(false);
  });

  it("batches aliases and indices into one mapping request and merges concrete indices", async () => {
    executeEsHttpRequestMock.mockResolvedValue(ok({
      "orders-1": { mappings: { properties: { price: { type: "long" } } } },
      "orders-2": { mappings: { properties: { buyer: { type: "keyword" } } } },
    }));
    const result = await fetchTargetMappingFields(connection, { password: "" }, ["sales", "orders-2", "sales", "*"]);
    expect(result.requestedNames).toEqual(["orders-2", "sales"]);
    expect(result.fieldsByIndex).toEqual({ "orders-1": ["price"], "orders-2": ["buyer"] });
    expect(executeEsHttpRequestMock).toHaveBeenCalledTimes(1);
    expect(executeEsHttpRequestMock.mock.calls[0][0].url).toBe("https://example.invalid/orders-2,sales/_mapping?ignore_unavailable=true&expand_wildcards=open");
  });

  it("keeps legacy name fallbacks when resolve is unavailable", async () => {
    executeEsHttpRequestMock.mockImplementation(async ({ url }: { url: string }) => {
      if (url.includes("/_cat/indices")) return ok([{ index: "legacy" }]);
      if (url.includes("/_cat/aliases")) return ok([{ alias: "legacy-alias" }]);
      return { ok: false, status: 403, statusText: "Forbidden", bodyText: "{}" };
    });
    const result = await fetchConnectionSearchMetadata(connection, { password: "" });
    expect(result.indices).toEqual(["legacy"]);
    expect(result.aliases).toEqual(["legacy-alias"]);
    expect(result.fields).toEqual([]);
  });

  it("rejects forbidden mapping without treating it as an empty permanent cache", async () => {
    executeEsHttpRequestMock.mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden", bodyText: "{}" });
    await expect(fetchTargetMappingFields(connection, { password: "" }, ["denied"])).rejects.toThrow("mapping");
    expect(await fetchTargetMappingFields(connection, { password: "" }, ["*", "logs-?", "_all", ""])).toEqual({ requestedNames: [], fieldsByIndex: {} });
    expect(executeEsHttpRequestMock).toHaveBeenCalledTimes(1);
  });

  it("limits mapping batches to 25 targets and at most two requests in flight", async () => {
    const pending: Array<() => void> = [];
    let active = 0;
    let maximum = 0;
    executeEsHttpRequestMock.mockImplementation(() => new Promise((resolve) => {
      active += 1;
      maximum = Math.max(maximum, active);
      pending.push(() => { active -= 1; resolve(ok({})); });
    }));
    const result = fetchTargetMappingFields(connection, { password: "" }, Array.from({ length: 60 }, (_, i) => `index-${i}`));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(executeEsHttpRequestMock.mock.calls[0][0].url.split("/")[3].split(",")).toHaveLength(25);
    pending.shift()!();
    await vi.waitFor(() => expect(executeEsHttpRequestMock).toHaveBeenCalledTimes(3));
    pending.splice(0).forEach((resolve) => resolve());
    await result;
    expect(maximum).toBe(2);
  });

  it("returns allowed batch fields when another batch is forbidden", async () => {
    executeEsHttpRequestMock.mockImplementation(async ({ url }: { url: string }) => url.includes("allowed")
      ? ok({ allowed: { mappings: { properties: { message: { type: "text" } } } } })
      : { ok: false, status: 403, statusText: "Forbidden", bodyText: "{}" });
    const result = await fetchTargetMappingFields(connection, { password: "" }, ["allowed", ...Array.from({ length: 25 }, (_, i) => `denied-${i}`)]);
    expect(result.fieldsByIndex).toEqual({ allowed: ["message"] });
  });
});
