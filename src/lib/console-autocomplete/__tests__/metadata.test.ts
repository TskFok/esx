import { describe, expect, it } from "vitest";
import { flattenMappingFields, flattenMappingFieldsByIndex } from "../metadata";

describe("flattenMappingFields", () => {
  it("extracts top-level properties", () => {
    const mapping = {
      "my-index": {
        mappings: {
          properties: {
            title: { type: "text" },
            createdAt: { type: "date" },
          },
        },
      },
    };
    expect(flattenMappingFields(mapping)).toEqual(["createdAt", "title"]);
  });

  it("flattens nested object fields", () => {
    const mapping = {
      "logs-2026": {
        mappings: {
          properties: {
            user: {
              type: "object",
              properties: {
                id: { type: "keyword" },
                name: { type: "text" },
              },
            },
          },
        },
      },
    };
    expect(flattenMappingFields(mapping)).toEqual(["user", "user.id", "user.name"]);
  });

  it("captures multi-fields", () => {
    const mapping = {
      index: {
        mappings: {
          properties: {
            name: {
              type: "text",
              fields: {
                keyword: { type: "keyword" },
              },
            },
          },
        },
      },
    };
    expect(flattenMappingFields(mapping)).toEqual(["name", "name.keyword"]);
  });

  it("merges fields across indices", () => {
    const mapping = {
      a: { mappings: { properties: { foo: { type: "text" } } } },
      b: { mappings: { properties: { bar: { type: "text" } } } },
    };
    expect(flattenMappingFields(mapping)).toEqual(["bar", "foo"]);
  });

  it("returns empty array for invalid input", () => {
    expect(flattenMappingFields(null)).toEqual([]);
    expect(flattenMappingFields(undefined)).toEqual([]);
    expect(flattenMappingFields([1, 2, 3])).toEqual([]);
  });
});

describe("flattenMappingFieldsByIndex", () => {
  it("groups fields by index name", () => {
    const mapping = {
      orders: { mappings: { properties: { price: { type: "double" }, sku: { type: "keyword" } } } },
      users: { mappings: { properties: { name: { type: "text" } } } },
    };
    expect(flattenMappingFieldsByIndex(mapping)).toEqual({
      orders: ["price", "sku"],
      users: ["name"],
    });
  });

  it("skips indices without mappings", () => {
    const mapping = {
      nope: {},
      orders: { mappings: { properties: { price: { type: "double" } } } },
    };
    expect(flattenMappingFieldsByIndex(mapping)).toEqual({ orders: ["price"] });
  });

  it("returns empty object for invalid input", () => {
    expect(flattenMappingFieldsByIndex(null)).toEqual({});
    expect(flattenMappingFieldsByIndex(undefined)).toEqual({});
    expect(flattenMappingFieldsByIndex([1, 2])).toEqual({});
  });
});
