import type { ParsedConsoleRequest } from "./console-parser";
import type { ConnectionProfile } from "../types/connections";

export type RequestSafetyLevel = "safe" | "write" | "destructive" | "clusterAdmin";

export type RequestSafetyResult = {
  level: RequestSafetyLevel;
  reasons: string[];
  requiresConfirmation: boolean;
  auditOnSuccess: boolean;
  blocked: boolean;
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const READ_POST_PATH_PATTERNS = [
  /(^|\/)_search(?:\/|$)/,
  /(^|\/)_msearch(?:\/|$)/,
  /(^|\/)_count(?:\/|$)/,
  /(^|\/)_validate\/query(?:\/|$)/,
  /(^|\/)_explain(?:\/|$)/,
  /(^|\/)_field_caps(?:\/|$)/,
  /(^|\/)_terms_enum(?:\/|$)/,
  /^\/_sql(?:\/|$)/,
  /^\/_eql\/search(?:\/|$)/,
  /^\/_rank_eval(?:\/|$)/,
  /(^|\/)_search\/template(?:\/|$)/,
  /^\/_async_search(?:\/|$)/,
  /(^|\/)_analyze(?:\/|$)/,
  /^\/_ingest\/pipeline(?:\/[^/]+)?\/_simulate(?:\/|$)/,
  /^\/_index_template\/_simulate(?:\/|$)/,
];

function pathWithoutQuery(path: string) {
  return (path.split("?", 1)[0] ?? path).replace(/^\/+/, "/").toLowerCase();
}

function isWildcardDelete(method: string, path: string) {
  const normalized = pathWithoutQuery(path);
  return method === "DELETE" && (
    normalized === "/*" ||
    normalized === "/_all" ||
    normalized.includes("*") ||
    normalized.endsWith("/_all")
  );
}

function isDestructive(method: string, path: string) {
  const normalized = pathWithoutQuery(path);
  return (
    isWildcardDelete(method, path) ||
    method === "DELETE" && !/^\/_search\/scroll(?:\/|$)/.test(normalized) ||
    /\/_delete_by_query(?:\/|$)/.test(normalized) ||
    /^\/_snapshot\/[^/]+\/[^/]+/.test(normalized) && method === "DELETE" ||
    /^\/_index_template\//.test(normalized) && method === "DELETE" ||
    /^\/_template\//.test(normalized) && method === "DELETE" ||
    /\/_close(?:\/|$)/.test(normalized) ||
    /\/_forcemerge(?:\/|$)/.test(normalized)
  );
}

function isClusterAdmin(method: string, path: string) {
  const normalized = pathWithoutQuery(path);
  return (
    /^\/_cluster\/settings(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_cluster\/reroute(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_security\//.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_ilm\//.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_slm\//.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_snapshot\//.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_tasks\/[^/]+\/_cancel(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_license(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_watcher\//.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_aliases(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_index_template(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_component_template(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_ingest\/pipeline(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /\/_rollover(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /\/_settings(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /\/_open(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /\/_(shrink|split)(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method)
  );
}

function isReadRequest(parsed: ParsedConsoleRequest) {
  const normalized = pathWithoutQuery(parsed.path);
  if (READ_METHODS.has(parsed.method)) {
    return true;
  }

  return parsed.method === "POST" && READ_POST_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isWrite(parsed: ParsedConsoleRequest) {
  const normalized = pathWithoutQuery(parsed.path);
  return (
    !isReadRequest(parsed) && WRITE_METHODS.has(parsed.method) ||
    /\/_bulk(?:\/|$)/.test(normalized) ||
    /\/_update_by_query(?:\/|$)/.test(normalized) ||
    /^\/_reindex(?:\/|$)/.test(normalized)
  );
}

export function classifyRequestSafety(parsed: ParsedConsoleRequest, connection: ConnectionProfile): RequestSafetyResult {
  const reasons: string[] = [];
  let level: RequestSafetyLevel = "safe";

  if (isDestructive(parsed.method, parsed.path)) {
    level = "destructive";
  } else if (isClusterAdmin(parsed.method, parsed.path)) {
    level = "clusterAdmin";
  } else if (isWrite(parsed)) {
    level = "write";
  }

  if (isWildcardDelete(parsed.method, parsed.path)) {
    reasons.push("DELETE 通配符或 _all 会删除大量索引。");
  }
  if (level === "clusterAdmin") {
    reasons.push("该请求会修改集群级配置或安全配置。");
  }
  if (level === "destructive" && reasons.length === 0) {
    reasons.push("该请求可能删除或关闭重要资源。");
  }
  if (connection.environment === "prod" && level === "write") {
    reasons.push("生产环境写入请求需要确认。");
  }

  const blocked = connection.readonly && level !== "safe";
  if (blocked) {
    reasons.push("当前连接为只读模式，禁止执行写入或管理类请求。");
  }

  return {
    level,
    reasons,
    requiresConfirmation: !blocked && connection.environment === "prod" && level !== "safe",
    auditOnSuccess: level !== "safe",
    blocked,
  };
}
