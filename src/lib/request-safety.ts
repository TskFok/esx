import type { ParsedConsoleRequest } from "./console-parser";
import type { ConnectionProfile } from "../types/connections";

export type RequestSafetyLevel = "safe" | "write" | "destructive" | "clusterAdmin";

export type RequestSafetyResult = {
  level: RequestSafetyLevel;
  reasons: string[];
  requiresConfirmation: boolean;
  blocked: boolean;
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
    /\/_delete_by_query(?:\/|$)/.test(normalized) ||
    /^\/_snapshot\/[^/]+\/[^/]+/.test(normalized) && method === "DELETE" ||
    /^\/_index_template\//.test(normalized) && method === "DELETE" ||
    /^\/_template\//.test(normalized) && method === "DELETE" ||
    /\/_close(?:\/|$)/.test(normalized)
  );
}

function isClusterAdmin(method: string, path: string) {
  const normalized = pathWithoutQuery(path);
  return (
    /^\/_cluster\/settings(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_cluster\/reroute(?:\/|$)/.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_security\//.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_ilm\//.test(normalized) && WRITE_METHODS.has(method) ||
    /^\/_slm\//.test(normalized) && WRITE_METHODS.has(method)
  );
}

function isWrite(parsed: ParsedConsoleRequest) {
  const normalized = pathWithoutQuery(parsed.path);
  return (
    WRITE_METHODS.has(parsed.method) ||
    /\/_bulk(?:\/|$)/.test(normalized) ||
    /\/_update_by_query(?:\/|$)/.test(normalized)
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

  const blocked = connection.readonly && level !== "safe";
  if (blocked) {
    reasons.push("当前连接为只读模式，禁止执行写入或管理类请求。");
  }

  return {
    level,
    reasons,
    requiresConfirmation: !blocked && connection.environment === "prod" && (level === "destructive" || level === "clusterAdmin"),
    blocked,
  };
}
