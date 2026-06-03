import { describe, expect, it } from "vitest";
import {
  formatConsoleRequest,
  parseConsoleRequest,
  parseConsoleRequests,
} from "../console-parser";

describe("parseConsoleRequest", () => {
  it("parses json request bodies with json content type", () => {
    const parsed = parseConsoleRequest(`POST /orders/_search
{
  "query": { "match_all": {} }
}`);

    expect(parsed.bodyKind).toBe("json");
    expect(parsed.contentType).toBe("application/json");
    expect(parsed.bodyJson).toEqual({ query: { match_all: {} } });
  });

  it("parses bulk ndjson without requiring a single json document", () => {
    const parsed = parseConsoleRequest(`POST /orders/_bulk
{"index":{"_id":"1"}}
{"status":"paid"}
`);

    expect(parsed.bodyKind).toBe("ndjson");
    expect(parsed.contentType).toBe("application/x-ndjson");
    expect(parsed.bodyJson).toBeNull();
    expect(parsed.bodyText).toContain('"status":"paid"');
  });

  it("parses sql text request bodies", () => {
    const parsed = parseConsoleRequest(`POST /_sql
SELECT * FROM orders LIMIT 10`);

    expect(parsed.bodyKind).toBe("text");
    expect(parsed.contentType).toBe("text/plain");
    expect(parsed.bodyText).toBe("SELECT * FROM orders LIMIT 10");
  });

  it("keeps ndjson formatting unchanged", () => {
    const content = `POST /_msearch
{"index":"orders"}
{"query":{"match_all":{}}}`;

    expect(formatConsoleRequest(content)).toBe(content);
  });
});

describe("parseConsoleRequests", () => {
  it("splits Kibana style multi requests", () => {
    const parsed = parseConsoleRequests(`GET /_cluster/health

POST /orders/_search
{
  "size": 1
}`);

    expect(parsed.map((item) => `${item.method} ${item.path}`)).toEqual([
      "GET /_cluster/health",
      "POST /orders/_search",
    ]);
  });
});
