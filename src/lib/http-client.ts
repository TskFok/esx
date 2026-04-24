import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  DetailedError,
  extractUnknownErrorDiagnostics,
  extractUnknownErrorMessage,
  getResponseErrorMessage,
  isGenericFailureMessage,
} from "./errors";
import { buildResponseSnapshot } from "./response-snapshot";
import { ensureTrailingSlashless, toBase64 } from "./utils";
import { executeSshHttpRequest, type TauriHttpResponse } from "./tauri";
import type { ConnectionProfile, SshTunnelConfig } from "../types/connections";
import type { ParsedConsoleRequest } from "./console-parser";
import type { ResponseSnapshot } from "../types/requests";
import { flattenMappingFields, flattenMappingFieldsByIndex } from "./console-autocomplete";

type ConnectionProbe = {
  path: string;
  label: string;
  matches: (bodyText: string) => boolean;
};

type ProbeAttempt = {
  probe: ConnectionProbe;
  snapshot: ResponseSnapshot;
  bodyText: string;
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
  responsePreviewBytes?: number,
): ResponseSnapshot {
  return buildResponseSnapshot({
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    durationMs,
    executedAt,
    bodyText: result.bodyText,
    errorMessage: result.errorMessage,
    diagnostics: result.diagnostics ?? [],
  }, responsePreviewBytes);
}

function parseJsonRecord(bodyText: string) {
  const value = parseJsonValue(bodyText);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function parseJsonValue(bodyText: string) {
  if (!bodyText.trim()) {
    return null;
  }

  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return null;
  }
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

function extractServerMessage(snapshot: ResponseSnapshot, bodyText = snapshot.bodyPreview) {
  const responseMessage = getResponseErrorMessage(snapshot, "");
  if (responseMessage && !isGenericFailureMessage(responseMessage)) {
    return responseMessage;
  }

  const json = parseJsonRecord(bodyText);
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

  const inline = bodyText.replace(/\s+/g, " ").trim();
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

  if (attempts.some(({ bodyText }) => looksLikeHtml(bodyText))) {
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
    return extractServerMessage(firstNetworkFailure.snapshot, firstNetworkFailure.bodyText) ?? "无法连接到目标地址，请检查网络、地址和证书配置。";
  }

  const firstDetailedMessage = attempts
    .map(({ snapshot, bodyText }) => extractServerMessage(snapshot, bodyText))
    .find((message) => Boolean(message));

  if (firstDetailedMessage) {
    return `连接失败：${firstDetailedMessage}`;
  }

  return "无法验证当前地址是否为 Elasticsearch 接口，请检查地址、账号、密码和证书设置。";
}

function buildConnectionDiagnostics(attempts: ProbeAttempt[]) {
  return attempts.flatMap(({ probe, snapshot, bodyText }) => {
    const lines = [`探测 ${probe.label} ${probe.path} -> ${snapshot.status || "FAILED"} ${snapshot.statusText}`];
    const summary = getResponseErrorMessage(snapshot, "");
    if (summary && !isGenericFailureMessage(summary)) {
      lines.push(`错误摘要：${summary}`);
    }
    if (snapshot.diagnostics.length > 0) {
      lines.push(...snapshot.diagnostics);
    }
    if (bodyText.trim() && bodyText.trim() !== summary) {
      lines.push(`响应正文：${bodyText.trim()}`);
    }
    return lines;
  });
}

type SearchMetadataResult = {
  indices: string[];
  aliases: string[];
  fields: string[];
  fieldsByIndex: Record<string, string[]>;
  aliasToIndices: Record<string, string[]>;
};

type SearchMetadataProbe = {
  path: string;
  label: string;
};

type SearchMetadataAttempt = {
  probe: SearchMetadataProbe;
  snapshot: ResponseSnapshot;
  bodyText: string;
};

function deduplicateSorted(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "zh-CN"),
  );
}

function parseResolveIndexMetadata(bodyText: string) {
  const value = parseJsonValue(bodyText);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const indices = Array.isArray(record.indices)
    ? record.indices
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).name === "string"
            ? (item as Record<string, unknown>).name as string
            : null,
        )
        .filter((item): item is string => Boolean(item))
    : [];
  const aliases = Array.isArray(record.aliases)
    ? record.aliases
        .map((item) =>
          item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).name === "string"
            ? (item as Record<string, unknown>).name as string
            : null,
        )
        .filter((item): item is string => Boolean(item))
    : [];

  const aliasToIndices: Record<string, string[]> = {};
  if (Array.isArray(record.aliases)) {
    record.aliases.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return;
      }
      const aliasRecord = item as Record<string, unknown>;
      const aliasName = typeof aliasRecord.name === "string" ? aliasRecord.name : null;
      if (!aliasName) {
        return;
      }
      const targetIndices = Array.isArray(aliasRecord.indices)
        ? (aliasRecord.indices as unknown[]).filter(
            (entry): entry is string => typeof entry === "string" && entry.length > 0,
          )
        : [];
      if (targetIndices.length === 0) {
        return;
      }
      aliasToIndices[aliasName] = deduplicateSorted(targetIndices);
    });
  }

  return {
    indices: deduplicateSorted(indices),
    aliases: deduplicateSorted(aliases),
    fields: [],
    fieldsByIndex: {},
    aliasToIndices,
  } satisfies SearchMetadataResult;
}

function parseAliasesDocument(bodyText: string) {
  const value = parseJsonValue(bodyText);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const indices: string[] = [];
  const aliases: string[] = [];
  const aliasToIndicesSet: Record<string, Set<string>> = {};

  Object.entries(record).forEach(([indexName, entry]) => {
    if (!indexName.startsWith("_")) {
      indices.push(indexName);
    }

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }

    const aliasRecord = (entry as Record<string, unknown>).aliases;
    if (!aliasRecord || typeof aliasRecord !== "object" || Array.isArray(aliasRecord)) {
      return;
    }

    Object.keys(aliasRecord as Record<string, unknown>).forEach((aliasName) => {
      aliases.push(aliasName);
      if (!indexName.startsWith("_")) {
        (aliasToIndicesSet[aliasName] ??= new Set()).add(indexName);
      }
    });
  });

  const aliasToIndices: Record<string, string[]> = {};
  Object.entries(aliasToIndicesSet).forEach(([aliasName, set]) => {
    aliasToIndices[aliasName] = deduplicateSorted([...set]);
  });

  return {
    indices: deduplicateSorted(indices),
    aliases: deduplicateSorted(aliases),
    fields: [],
    fieldsByIndex: {},
    aliasToIndices,
  } satisfies SearchMetadataResult;
}

function parseMappingFields(bodyText: string) {
  const value = parseJsonValue(bodyText);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { fields: [] as string[], fieldsByIndex: {} as Record<string, string[]> };
  }
  return {
    fields: flattenMappingFields(value),
    fieldsByIndex: flattenMappingFieldsByIndex(value),
  };
}

function parseCatColumn(bodyText: string, columnName: string) {
  const value = parseJsonValue(bodyText);
  if (!Array.isArray(value)) {
    return null;
  }

  return deduplicateSorted(
    value
      .map((item) =>
        item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>)[columnName] === "string"
          ? ((item as Record<string, unknown>)[columnName] as string)
          : null,
      )
      .filter((item): item is string => Boolean(item)),
  );
}

function buildSearchMetadataError(attempts: SearchMetadataAttempt[]) {
  const firstForbidden = attempts.find(({ snapshot }) => snapshot.status === 403);
  if (firstForbidden) {
    return "当前账号没有读取索引元数据或 alias 元数据的权限。";
  }

  const firstUnauthorized = attempts.find(({ snapshot }) => snapshot.status === 401);
  if (firstUnauthorized) {
    return "读取索引元数据失败，当前连接认证已失效。";
  }

  const firstNetworkFailure = attempts.find(({ snapshot }) => snapshot.status === 0);
  if (firstNetworkFailure) {
    return extractServerMessage(firstNetworkFailure.snapshot, firstNetworkFailure.bodyText) ?? "读取索引元数据失败，请检查网络、地址和证书配置。";
  }

  const firstDetailedMessage = attempts
    .map(({ snapshot, bodyText }) => extractServerMessage(snapshot, bodyText))
    .find((message) => Boolean(message));

  if (firstDetailedMessage) {
    return `读取索引元数据失败：${firstDetailedMessage}`;
  }

  return "无法读取当前连接的索引元数据。";
}

function buildSearchMetadataDiagnostics(attempts: SearchMetadataAttempt[]) {
  return attempts.flatMap(({ probe, snapshot }) => {
    const lines = [`探测 ${probe.label} ${probe.path} -> ${snapshot.status || "FAILED"} ${snapshot.statusText}`];
    const summary = getResponseErrorMessage(snapshot, "");
    if (summary && !isGenericFailureMessage(summary)) {
      lines.push(`错误摘要：${summary}`);
    }
    if (snapshot.diagnostics.length > 0) {
      lines.push(...snapshot.diagnostics);
    }
    return lines;
  });
}

async function executeConsoleRequestRaw(
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

      return {
        response,
        durationMs: Math.round(performance.now() - startedAt),
        executedAt,
      };
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
    return {
      response: {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        bodyText,
      },
      durationMs: Math.round(performance.now() - startedAt),
      executedAt,
    };
  } catch (error) {
    const message = extractUnknownErrorMessage(error, "请求失败");
    return {
      response: {
        ok: false,
        status: 0,
        statusText: "REQUEST_FAILED",
        bodyText: message,
        errorMessage: message,
        diagnostics: extractUnknownErrorDiagnostics(error),
      },
      durationMs: Math.round(performance.now() - startedAt),
      executedAt,
    };
  }
}

export async function executeConsoleRequest(
  connection: ConnectionProfile,
  credentials: RequestCredentials,
  parsed: ParsedConsoleRequest,
  sshTunnelOverride?: SshTunnelConfig | null,
  options?: { responsePreviewBytes?: number },
) {
  const result = await executeConsoleRequestRaw(connection, credentials, parsed, sshTunnelOverride);
  return buildSnapshot(result.response, result.durationMs, result.executedAt, options?.responsePreviewBytes);
}

async function runSearchMetadataProbe(
  connection: ConnectionProfile,
  credentials: RequestCredentials,
  probe: SearchMetadataProbe,
  sshTunnelOverride?: SshTunnelConfig | null,
) {
  const result = await executeConsoleRequestRaw(
    connection,
    credentials,
    {
      method: "GET",
      path: probe.path,
      bodyText: "",
      bodyJson: null,
    },
    sshTunnelOverride,
  );
  const snapshot = buildSnapshot(result.response, result.durationMs, result.executedAt);

  return { probe, snapshot, bodyText: result.response.bodyText } satisfies SearchMetadataAttempt;
}

export async function fetchConnectionSearchMetadata(
  connection: ConnectionProfile,
  credentials: RequestCredentials,
  sshTunnelOverride?: SshTunnelConfig | null,
) {
  const indices = new Set<string>();
  const aliases = new Set<string>();
  const fields = new Set<string>();
  const fieldsByIndex: Record<string, string[]> = {};
  const aliasToIndices: Record<string, string[]> = {};
  const mergeAliasTargets = (entries: Record<string, string[]> | undefined) => {
    if (!entries) {
      return;
    }
    Object.entries(entries).forEach(([aliasName, targets]) => {
      const merged = new Set<string>(aliasToIndices[aliasName] ?? []);
      targets.forEach((item) => merged.add(item));
      aliasToIndices[aliasName] = deduplicateSorted([...merged]);
    });
  };
  const attempts: SearchMetadataAttempt[] = [];
  let successfulProbeCount = 0;

  const resolveAttempt = await runSearchMetadataProbe(
    connection,
    credentials,
    {
      path: "/_resolve/index/*?expand_wildcards=all&ignore_unavailable=true",
      label: "解析索引",
    },
    sshTunnelOverride,
  );
  attempts.push(resolveAttempt);
  if (resolveAttempt.snapshot.ok) {
    successfulProbeCount += 1;
    const resolved = parseResolveIndexMetadata(resolveAttempt.bodyText);
    resolved?.indices.forEach((item) => indices.add(item));
    resolved?.aliases.forEach((item) => aliases.add(item));
    mergeAliasTargets(resolved?.aliasToIndices);
  }

  if (indices.size === 0 || aliases.size === 0) {
    const aliasesAttempt = await runSearchMetadataProbe(
      connection,
      credentials,
      {
        path: "/_aliases",
        label: "别名文档",
      },
      sshTunnelOverride,
    );
    attempts.push(aliasesAttempt);
    if (aliasesAttempt.snapshot.ok) {
      successfulProbeCount += 1;
      const resolved = parseAliasesDocument(aliasesAttempt.bodyText);
      resolved?.indices.forEach((item) => indices.add(item));
      resolved?.aliases.forEach((item) => aliases.add(item));
      mergeAliasTargets(resolved?.aliasToIndices);
    }
  }

  if (indices.size === 0) {
    const indicesAttempt = await runSearchMetadataProbe(
      connection,
      credentials,
      {
        path: "/_cat/indices?format=json&h=index&expand_wildcards=all",
        label: "索引列表",
      },
      sshTunnelOverride,
    );
    attempts.push(indicesAttempt);
    if (indicesAttempt.snapshot.ok) {
      successfulProbeCount += 1;
      parseCatColumn(indicesAttempt.bodyText, "index")?.forEach((item) => indices.add(item));
    }
  }

  if (aliases.size === 0) {
    const catAliasesAttempt = await runSearchMetadataProbe(
      connection,
      credentials,
      {
        path: "/_cat/aliases?format=json&h=alias",
        label: "别名列表",
      },
      sshTunnelOverride,
    );
    attempts.push(catAliasesAttempt);
    if (catAliasesAttempt.snapshot.ok) {
      successfulProbeCount += 1;
      parseCatColumn(catAliasesAttempt.bodyText, "alias")?.forEach((item) => aliases.add(item));
    }
  }

  const mappingAttempt = await runSearchMetadataProbe(
    connection,
    credentials,
    {
      path: "/_mapping?expand_wildcards=open",
      label: "字段映射",
    },
    sshTunnelOverride,
  );
  attempts.push(mappingAttempt);
  if (mappingAttempt.snapshot.ok) {
    successfulProbeCount += 1;
    const parsedMapping = parseMappingFields(mappingAttempt.bodyText);
    parsedMapping.fields.forEach((item) => fields.add(item));
    Object.entries(parsedMapping.fieldsByIndex).forEach(([indexName, list]) => {
      if (list.length === 0) {
        return;
      }
      const merged = new Set<string>(fieldsByIndex[indexName] ?? []);
      list.forEach((item) => merged.add(item));
      fieldsByIndex[indexName] = [...merged].sort((left, right) => left.localeCompare(right, "zh-CN"));
    });
  }

  if (successfulProbeCount === 0) {
    throw new DetailedError(
      buildSearchMetadataError(attempts),
      buildSearchMetadataDiagnostics(attempts),
    );
  }

  return {
    indices: deduplicateSorted([...indices]),
    aliases: deduplicateSorted([...aliases]),
    fields: deduplicateSorted([...fields]),
    fieldsByIndex,
    aliasToIndices,
  } satisfies SearchMetadataResult;
}

export type IndexMappingFieldsResult = {
  requestedName: string;
  fieldsByIndex: Record<string, string[]>;
};

export async function fetchIndexMappingFields(
  connection: ConnectionProfile,
  credentials: RequestCredentials,
  indexOrAlias: string,
  sshTunnelOverride?: SshTunnelConfig | null,
): Promise<IndexMappingFieldsResult> {
  const trimmedName = indexOrAlias.trim();
  if (!trimmedName || trimmedName.startsWith("_") || trimmedName.includes("*")) {
    return { requestedName: trimmedName, fieldsByIndex: {} };
  }

  const encodedName = encodeURIComponent(trimmedName);
  const probe: SearchMetadataProbe = {
    path: `/${encodedName}/_mapping?ignore_unavailable=true&expand_wildcards=open`,
    label: `索引映射(${trimmedName})`,
  };
  const attempt = await runSearchMetadataProbe(connection, credentials, probe, sshTunnelOverride);

  if (!attempt.snapshot.ok) {
    throw new DetailedError(
      `拉取索引 ${trimmedName} 的 mapping 失败`,
      buildSearchMetadataDiagnostics([attempt]),
    );
  }

  const parsed = parseMappingFields(attempt.bodyText);
  return {
    requestedName: trimmedName,
    fieldsByIndex: parsed.fieldsByIndex,
  };
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

    if (attempt.snapshot.ok && probe.matches(attempt.bodyText)) {
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
  const result = await executeConsoleRequestRaw(connection, credentials, {
    method: "GET",
    path: probe.path,
    bodyText: "",
    bodyJson: null,
  });

  return {
    probe,
    snapshot: buildSnapshot(result.response, result.durationMs, result.executedAt),
    bodyText: result.response.bodyText,
  } satisfies ProbeAttempt;
}
