import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLUSTER_METADATA,
  selectApiSegments,
  selectQueryParameterSnippets,
} from "../capabilities";
import { selectPropertySuggestions } from "../suggestions";
import type { ConsoleAutocompleteContext } from "../context";
import { parseConsoleRequestContext } from "../request-context";
import type { ConnectionSearchClusterMetadata } from "../../../types/requests";

function labelsOf(list: readonly { label: string }[]) {
  return list.map((item) => item.label);
}

function cluster(overrides: Partial<ConnectionSearchClusterMetadata>): ConnectionSearchClusterMetadata {
  return {
    ...DEFAULT_CLUSTER_METADATA,
    ...overrides,
    version: {
      ...DEFAULT_CLUSTER_METADATA.version,
      ...overrides.version,
    },
    license: {
      ...DEFAULT_CLUSTER_METADATA.license,
      ...overrides.license,
    },
  };
}

function context(overrides: Partial<ConnectionSearchClusterMetadata>): ConsoleAutocompleteContext {
  return {
    indexNames: [],
    aliasNames: [],
    historyTargetNames: [],
    fieldNames: [],
    cluster: cluster(overrides),
    request: parseConsoleRequestContext("GET /"),
  };
}

describe("selectApiSegments", () => {
  it("keeps Elasticsearch and OpenSearch product-specific APIs separate", () => {
    const esLabels = labelsOf(selectApiSegments("global", context({
      product: "elasticsearch",
      version: { number: "8.12.1", major: 8, minor: 12 },
      license: { type: "basic", status: "active", source: "elastic-license" },
    })));
    const osLabels = labelsOf(selectApiSegments("global", context({
      product: "opensearch",
      version: { number: "2.19.0", major: 2, minor: 19 },
    })));

    expect(esLabels).toEqual(expect.arrayContaining(["_security/_authenticate", "_license"]));
    expect(esLabels).not.toEqual(expect.arrayContaining(["_plugins/_security/api/account"]));
    expect(osLabels).toEqual(expect.arrayContaining(["_plugins/_security/api/account", "_plugins/_ism/policies"]));
    expect(osLabels).not.toEqual(expect.arrayContaining(["_security/_authenticate", "_license"]));
  });

  it("hides paid Elasticsearch APIs for basic or unknown licenses", () => {
    const basicLabels = labelsOf(selectApiSegments("global", context({
      product: "elasticsearch",
      version: { number: "8.12.1", major: 8, minor: 12 },
      license: { type: "basic", status: "active", source: "elastic-license" },
    })));
    const platinumLabels = labelsOf(selectApiSegments("global", context({
      product: "elasticsearch",
      version: { number: "8.12.1", major: 8, minor: 12 },
      license: { type: "platinum", status: "active", source: "elastic-license" },
    })));

    expect(basicLabels).not.toEqual(expect.arrayContaining(["_ml/anomaly_detectors"]));
    expect(platinumLabels).toEqual(expect.arrayContaining(["_ml/anomaly_detectors"]));
  });

  it("uses conservative common APIs for unknown products", () => {
    const labels = labelsOf(selectApiSegments("global", context({ product: "unknown" })));

    expect(labels).toEqual(expect.arrayContaining(["_cluster/health", "_search"]));
    expect(labels).not.toEqual(expect.arrayContaining([
      "_security/_authenticate",
      "_plugins/_security/api/account",
      "_ml/anomaly_detectors",
    ]));
  });
});

describe("selectQueryParameterSnippets", () => {
  it("returns endpoint-specific query parameters", () => {
    const es8 = context({
      product: "elasticsearch",
      version: { number: "8.12.1", major: 8, minor: 12 },
    });

    expect(labelsOf(selectQueryParameterSnippets("/_search", es8))).toEqual(
      expect.arrayContaining(["pretty", "size", "allow_partial_search_results"]),
    );
    expect(labelsOf(selectQueryParameterSnippets("/_cat/indices", es8))).toEqual(
      expect.arrayContaining(["format", "h", "s", "v"]),
    );
  });

  it("filters versioned mapping query parameters", () => {
    const es7 = context({
      product: "elasticsearch",
      version: { number: "7.17.0", major: 7, minor: 17 },
    });
    const es8 = context({
      product: "elasticsearch",
      version: { number: "8.12.1", major: 8, minor: 12 },
    });

    expect(labelsOf(selectQueryParameterSnippets("/orders/_mapping", es7))).toContain("include_type_name");
    expect(labelsOf(selectQueryParameterSnippets("/orders/_mapping", es8))).not.toContain("include_type_name");
  });
});

describe("DSL capability filtering", () => {
  it("shows type query only for Elasticsearch 7", () => {
    const es7Labels = labelsOf(selectPropertySuggestions(["query"], context({
      product: "elasticsearch",
      version: { number: "7.17.0", major: 7, minor: 17 },
    })));
    const es8Labels = labelsOf(selectPropertySuggestions(["query"], context({
      product: "elasticsearch",
      version: { number: "8.12.1", major: 8, minor: 12 },
    })));
    const unknownLabels = labelsOf(selectPropertySuggestions(["query"], context({ product: "unknown" })));

    expect(es7Labels).toContain("type");
    expect(es8Labels).not.toContain("type");
    expect(unknownLabels).not.toContain("type");
  });

  it("Elasticsearch 8.11 does not suggest query knn, semantic, or sparse_vector", () => {
    const snippets = selectPropertySuggestions(["query"], context({
      product: "elasticsearch",
      version: { number: "8.11.3", major: 8, minor: 11 },
    }));

    expect(labelsOf(snippets)).not.toContain("knn");
    expect(labelsOf(snippets)).not.toContain("semantic");
    expect(labelsOf(snippets)).not.toContain("sparse_vector");
  });

  it("Elasticsearch 8.12 starts suggesting query knn", () => {
    expect(labelsOf(selectPropertySuggestions(["query"], context({
      product: "elasticsearch",
      version: { number: "8.12.0", major: 8, minor: 12 },
    })))).toContain("knn");
  });

  it("Elasticsearch 8.15 starts suggesting semantic and sparse_vector", () => {
    const result = labelsOf(selectPropertySuggestions(["query"], context({
      product: "elasticsearch",
      version: { number: "8.15.0", major: 8, minor: 15 },
    })));

    expect(result).toEqual(expect.arrayContaining(["semantic", "sparse_vector"]));
  });

  it("Elasticsearch 8.14 still hides semantic and sparse_vector", () => {
    const result = labelsOf(selectPropertySuggestions(["query"], context({
      product: "elasticsearch",
      version: { number: "8.14.3", major: 8, minor: 14 },
    })));

    expect(result).not.toEqual(expect.arrayContaining(["semantic", "sparse_vector"]));
  });

  it("unknown versions hide strongly version-constrained candidates", () => {
    const result = labelsOf(selectPropertySuggestions(["query"], context({
      product: "elasticsearch",
      version: { number: null, major: null, minor: null },
    })));

    expect(result).not.toEqual(expect.arrayContaining(["knn", "semantic", "sparse_vector"]));
  });

  it("OpenSearch knn uses a dynamic field and vector parameter", () => {
    const knn = selectPropertySuggestions(["query"], context({
      product: "opensearch",
      version: { number: "2.14.0", major: 2, minor: 14 },
    }))
      .find((snippet) => snippet.label === "knn");

    expect(knn?.insertText).toContain('"${1:field}"');
    expect(knn?.insertText).toContain('"vector"');
    expect(knn?.insertText).not.toContain('"query_vector"');
  });
});
