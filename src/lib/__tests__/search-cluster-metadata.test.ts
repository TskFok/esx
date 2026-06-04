import { describe, expect, it } from "vitest";
import {
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
