import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  DetailedError,
  extractUnknownErrorDiagnostics,
  extractUnknownErrorMessage,
  getResponseErrorMessage,
  isGenericFailureMessage,
} from "./errors";
import { ensureTrailingSlashless, serializeJson, toBase64 } from "./utils";
import { executeSshHttpRequest, type TauriHttpResponse } from "./tauri";
import type { ConnectionProfile, SshTunnelConfig } from "../types/connections";
import type { ParsedConsoleRequest } from "./console-parser";
import type { ResponseSnapshot } from "../types/requests";

type ConnectionProbe = {
  path: string;
  label: string;
  matches: (bodyText: string) => boolean;
};

type ProbeAttempt = {
  probe: ConnectionProbe;
  snapshot: ResponseSnapshot;
};

type RequestCredentials = {
  password: string;
  sshSecret?: string | null;
};

export function normalizeBaseUrl(baseUrl: string) {
  const trimmed = ensureTrailingSlashless(baseUrl.trim());
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("地址必须以 http:// 或 https:// 开头。");
  }
  return trimmed;
}

function resolveRequestUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${ensureTrailingSlashless(baseUrl)}${normalizedPath}`;
}

function buildSnapshot(
  result: TauriHttpResponse,
  durationMs: number,
  executedAt: string,
): ResponseSnapshot {
  const sizeBytes = new TextEncoder().encode(result.bodyText).length;
  let isJson = false;
  let bodyPretty = result.bodyText;

  if (result.bodyText.trim()) {
    try {
      bodyPretty = serializeJson(JSON.parse(result.bodyText));
      isJson = true;
    } catch {
      bodyPretty = result.bodyText;
    }
  }

  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    durationMs,
    sizeBytes,
    executedAt,
    bodyText: result.bodyText,
    bodyPretty,
    isJson,
    errorMessage: result.errorMessage,
    diagnostics: result.diagnostics ?? [],
  };
}

function parseJsonRecord(bodyText: string) {
  if (!bodyText.trim()) {
    return null;
  }

  try {
    const value = JSON.parse(bodyText) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function isElasticsearchRootResponse(bodyText: string) {
  const json = parseJsonRecord(bodyText);
  if (!json) {
    return false;
  }

  return (
    typeof json.version === "object" &&
    (typeof json.tagline === "string" ||
      typeof json.cluster_name === "string" ||
      typeof json.cluster_uuid === "string" ||
      typeof json.name === "string")
  );
}

function isClusterHealthResponse(bodyText: string) {
  const json = parseJsonRecord(bodyText);
  if (!json) {
    return false;
  }

  return typeof json.cluster_name === "string" && typeof json.status === "string";
}

function isAuthenticateResponse(bodyText: string) {
  const json = parseJsonRecord(bodyText);
  if (!json) {
    return false;
  }

  return typeof json.username === "string";
}

function looksLikeHtml(bodyText: string) {
  return /<!doctype html|<html[\s>]/i.test(bodyText);
}

function extractServerMessage(snapshot: ResponseSnapshot) {
  const responseMessage = getResponseErrorMessage(snapshot, "");
  if (responseMessage && !isGenericFailureMessage(responseMessage)) {
    return responseMessage;
  }

  const json = parseJsonRecord(snapshot.bodyText);
  if (json) {
    if (typeof json.message === "string") {
      return json.message;
    }

    if (typeof json.error === "string") {
      return json.error;
    }

    if (json.error && typeof json.error === "object" && !Array.isArray(json.error)) {
      const error = json.error as Record<string, unknown>;
      if (typeof error.reason === "string") {
        return error.reason;
      }
      if (typeof error.type === "string") {
        return error.type;
      }
    }
  }

  const inline = snapshot.bodyText.replace(/\s+/g, " ").trim();
  if (inline && !isGenericFailureMessage(inline)) {
    return inline;
  }

  const diagnostic = [...snapshot.diagnostics].reverse().find((item) => item.trim() && !isGenericFailureMessage(item));
  return diagnostic?.trim() || inline || null;
}

function buildConnectionError(baseUrl: string, attempts: ProbeAttempt[]) {
  const firstAuthFailure = attempts.find(({ snapshot }) => snapshot.status === 401);
  if (firstAuthFailure) {
    return "认证失败，请检查用户名或密码是否正确。";
  }

  const firstForbidden = attempts.find(({ snapshot }) => snapshot.status === 403);
  if (firstForbidden) {
    return "认证已通过，但当前账号没有访问 Elasticsearch 接口的权限。";
  }

  if (attempts.some(({ snapshot }) => looksLikeHtml(snapshot.bodyText))) {
    return "当前地址返回的是网页页面，不是 Elasticsearch HTTP 接口。请填写 Elasticsearch 地址，例如 https://host:9200，而不是 Kibana 页面地址。";
  }

  const firstNotFound = attempts.find(({ snapshot }) => snapshot.status === 404);
  if (firstNotFound) {
    return `连接地址返回 404，无法识别 Elasticsearch 接口。请确认填写的是 Elasticsearch HTTP 地址，而不是 Kibana 页面地址或错误路径。`;
  }

  const firstBadGateway = attempts.find(({ snapshot }) => snapshot.status === 502);
  if (firstBadGateway) {
    return `当前目标地址 ${baseUrl} 返回 502 Bad Gateway。通常表示 Elasticsearch 地址填错了，或者 SSH 主机无法从内网访问这个地址。`;
  }

  const firstGatewayFailure = attempts.find(({ snapshot }) => snapshot.status >= 500 && snapshot.status < 600);
  if (firstGatewayFailure) {
    return `当前目标地址 ${baseUrl} 返回 ${firstGatewayFailure.snapshot.status} ${firstGatewayFailure.snapshot.statusText}。请检查 Elasticsearch 地址是否正确，以及 SSH 主机能否访问该内网地址。`;
  }

  const firstNetworkFailure = attempts.find(({ snapshot }) => snapshot.status === 0);
  if (firstNetworkFailure) {
    return extractServerMessage(firstNetworkFailure.snapshot) ?? "无法连接到目标地址，请检查网络、地址和证书配置。";
  }

  const firstDetailedMessage = attempts
    .map(({ snapshot }) => extractServerMessage(snapshot))
    .find((message) => Boolean(message));

  if (firstDetailedMessage) {
    return `连接失败：${firstDetailedMessage}`;
  }

  return "无法验证当前地址是否为 Elasticsearch 接口，请检查地址、账号、密码和证书设置。";
}

function buildConnectionDiagnostics(attempts: ProbeAttempt[]) {
  return attempts.flatMap(({ probe, snapshot }) => {
    const lines = [`探测 ${probe.label} ${probe.path} -> ${snapshot.status || "FAILED"} ${snapshot.statusText}`];
    const summary = getResponseErrorMessage(snapshot, "");
    if (summary && !isGenericFailureMessage(summary)) {
      lines.push(`错误摘要：${summary}`);
    }
    if (snapshot.diagnostics.length > 0) {
      lines.push(...snapshot.diagnostics);
    }
    if (snapshot.bodyText.trim() && snapshot.bodyText.trim() !== summary) {
      lines.push(`响应正文：${snapshot.bodyText.trim()}`);
    }
    return lines;
  });
}

export async function executeConsoleRequest(
  connection: ConnectionProfile,
  credentials: RequestCredentials,
  parsed: ParsedConsoleRequest,
  sshTunnelOverride?: SshTunnelConfig | null,
) {
  const startedAt = performance.now();
  const executedAt = new Date().toISOString();
  const sshTunnel = sshTunnelOverride ?? connection.sshTunnel ?? null;

  try {
    if (sshTunnel) {
      const response = await executeSshHttpRequest({
        url: resolveRequestUrl(connection.baseUrl, parsed.path),
        method: parsed.method,
        username: connection.username,
        password: credentials.password,
        bodyText: parsed.bodyText,
        insecureTls: connection.insecureTls,
        sshTunnel,
        sshSecret: credentials.sshSecret ?? null,
      });

      return buildSnapshot(response, Math.round(performance.now() - startedAt), executedAt);
    }

    const response = await tauriFetch(resolveRequestUrl(connection.baseUrl, parsed.path), {
      method: parsed.method,
      headers: {
        Accept: "application/json, text/plain, */*",
        Authorization: `Basic ${toBase64(`${connection.username}:${credentials.password}`)}`,
        ...(parsed.bodyText ? { "Content-Type": "application/json" } : {}),
      },
      body: parsed.bodyText || undefined,
      connectTimeout: 15000,
      danger: connection.insecureTls
        ? {
            acceptInvalidCerts: true,
            acceptInvalidHostnames: true,
          }
        : undefined,
    });

    const bodyText = await response.text();
    return buildSnapshot(
      {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        bodyText,
      },
      Math.round(performance.now() - startedAt),
      executedAt,
    );
  } catch (error) {
    const message = extractUnknownErrorMessage(error, "请求失败");
    return buildSnapshot(
      {
        ok: false,
        status: 0,
        statusText: "REQUEST_FAILED",
        bodyText: message,
        errorMessage: message,
        diagnostics: extractUnknownErrorDiagnostics(error),
      },
      Math.round(performance.now() - startedAt),
      executedAt,
    );
  }
}

export async function testConnection(
  profile: Pick<ConnectionProfile, "baseUrl" | "username" | "insecureTls">,
  password: string,
  sshSecret?: string | null,
  sshTunnel?: SshTunnelConfig | null,
) {
  const connection = {
    id: "temporary",
    name: "temporary",
    moduleId: null,
    baseUrl: normalizeBaseUrl(profile.baseUrl),
    username: profile.username,
    insecureTls: profile.insecureTls,
    sshProfileId: null,
    sshTunnel: sshTunnel ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  } satisfies ConnectionProfile;

  const probes: ConnectionProbe[] = [
    { path: "/", label: "根信息", matches: isElasticsearchRootResponse },
    { path: "/_cluster/health", label: "集群健康", matches: isClusterHealthResponse },
    { path: "/_security/_authenticate", label: "认证信息", matches: isAuthenticateResponse },
  ];

  const attempts: ProbeAttempt[] = [];

  for (const probe of probes) {
    const attempt = await runConnectionProbe(connection, { password, sshSecret }, probe);
    attempts.push(attempt);

    if (attempt.snapshot.ok && probe.matches(attempt.snapshot.bodyText)) {
      return attempt.snapshot;
    }
  }

  throw new DetailedError(buildConnectionError(connection.baseUrl, attempts), buildConnectionDiagnostics(attempts));
}

export function getSnapshotErrorDiagnostics(snapshot: ResponseSnapshot) {
  return snapshot.diagnostics;
}

export function getSnapshotErrorMessage(snapshot: ResponseSnapshot, fallback = "请求失败") {
  return getResponseErrorMessage(snapshot, fallback);
}

async function runConnectionProbe(
  connection: ConnectionProfile,
  credentials: RequestCredentials,
  probe: ConnectionProbe,
) {
  const snapshot = await executeConsoleRequest(connection, credentials, {
    method: "GET",
    path: probe.path,
    bodyText: "",
    bodyJson: null,
  });

  return { probe, snapshot } satisfies ProbeAttempt;
}
