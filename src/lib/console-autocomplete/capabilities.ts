import type {
  ConnectionSearchClusterMetadata,
  SearchClusterProduct,
} from "../../types/requests";
import {
  GLOBAL_API_SEGMENTS,
  INDEX_API_SEGMENTS,
  type ApiSegment,
  type RawSnippet,
  type SnippetAvailability,
} from "./snippets";

export const DEFAULT_CLUSTER_METADATA: ConnectionSearchClusterMetadata = {
  product: "unknown",
  version: {
    number: null,
    major: null,
    minor: null,
  },
  distribution: null,
  buildFlavor: null,
  license: {
    type: null,
    status: null,
    source: "unknown",
  },
};

type CompletionCapabilityContext = {
  cluster?: ConnectionSearchClusterMetadata;
};

type QueryParameterSnippet = RawSnippet & {
  endpoints?: EndpointKind[];
};

type EndpointKind = "common" | "search" | "cat" | "mapping" | "settings" | "tasks" | "snapshot" | "bulk" | "msearch";

const LICENSE_ORDER = ["oss", "basic", "gold", "platinum", "enterprise", "trial"] as const;

function normalizeLicenseType(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizeClusterProduct(value: unknown): SearchClusterProduct {
  return value === "elasticsearch" || value === "opensearch" ? value : "unknown";
}

function normalizeNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNullableInteger(value: unknown) {
  return Number.isInteger(value) ? value as number : null;
}

export function normalizeClusterMetadata(
  value: Partial<ConnectionSearchClusterMetadata> | null | undefined,
): ConnectionSearchClusterMetadata {
  const version = value?.version ?? DEFAULT_CLUSTER_METADATA.version;
  const license = value?.license ?? DEFAULT_CLUSTER_METADATA.license;

  return {
    product: normalizeClusterProduct(value?.product),
    version: {
      number: normalizeNullableString(version.number),
      major: normalizeNullableInteger(version.major),
      minor: normalizeNullableInteger(version.minor),
    },
    distribution: normalizeNullableString(value?.distribution),
    buildFlavor: normalizeNullableString(value?.buildFlavor),
    license: {
      type: normalizeNullableString(license.type),
      status: normalizeNullableString(license.status),
      source: license.source ?? "unknown",
    },
  };
}

function resolveCluster(context?: CompletionCapabilityContext | null) {
  return normalizeClusterMetadata(context?.cluster);
}

function licenseSatisfies(cluster: ConnectionSearchClusterMetadata, required: NonNullable<SnippetAvailability["licenseAtLeast"]>) {
  if (cluster.product !== "elasticsearch") {
    return false;
  }

  const current = normalizeLicenseType(cluster.license.type);
  if (!current || cluster.license.status?.toLowerCase() === "expired") {
    return false;
  }

  const currentIndex = LICENSE_ORDER.indexOf(current as (typeof LICENSE_ORDER)[number]);
  const requiredIndex = LICENSE_ORDER.indexOf(required);
  if (currentIndex < 0 || requiredIndex < 0) {
    return false;
  }

  return currentIndex >= requiredIndex;
}

export function isAvailableForCluster(
  availability: SnippetAvailability | undefined,
  context?: CompletionCapabilityContext | null,
) {
  if (!availability) {
    return true;
  }

  const cluster = resolveCluster(context);
  if (
    availability.products &&
    (cluster.product === "unknown" || !availability.products.includes(cluster.product))
  ) {
    return false;
  }

  if ((availability.minMajor !== undefined || availability.maxMajor !== undefined) && cluster.version.major === null) {
    return false;
  }

  if (availability.minMajor !== undefined && (cluster.version.major ?? 0) < availability.minMajor) {
    return false;
  }

  if (availability.maxMajor !== undefined && (cluster.version.major ?? Number.MAX_SAFE_INTEGER) > availability.maxMajor) {
    return false;
  }

  if (availability.licenseAtLeast && !licenseSatisfies(cluster, availability.licenseAtLeast)) {
    return false;
  }

  return true;
}

export function filterAvailableSnippets<T extends { availability?: SnippetAvailability }>(
  snippets: readonly T[],
  context?: CompletionCapabilityContext | null,
) {
  return snippets.filter((snippet) => isAvailableForCluster(snippet.availability, context));
}

const PRODUCT_GLOBAL_API_SEGMENTS: ReadonlyArray<ApiSegment> = [
  {
    label: "_security/_authenticate",
    detail: "Elastic 认证信息",
    documentation: "查看当前 Elasticsearch 认证用户。",
    insertText: "_security/_authenticate",
    availability: { products: ["elasticsearch"], minMajor: 7 },
  },
  {
    label: "_license",
    detail: "Elastic License",
    documentation: "查看当前 Elasticsearch License 信息。",
    insertText: "_license",
    availability: { products: ["elasticsearch"], minMajor: 7 },
  },
  {
    label: "_ml/anomaly_detectors",
    detail: "Elastic ML 异常检测",
    documentation: "管理 Elasticsearch 机器学习异常检测任务，需要 Platinum 或更高 License。",
    insertText: "_ml/anomaly_detectors",
    availability: { products: ["elasticsearch"], minMajor: 7, licenseAtLeast: "platinum" },
  },
  {
    label: "_plugins/_security/api/account",
    detail: "OpenSearch 当前账号",
    documentation: "查看 OpenSearch Security 插件中的当前账号信息。",
    insertText: "_plugins/_security/api/account",
    availability: { products: ["opensearch"], minMajor: 1 },
  },
  {
    label: "_plugins/_security/authinfo",
    detail: "OpenSearch 认证信息",
    documentation: "查看 OpenSearch Security 插件认证和角色信息。",
    insertText: "_plugins/_security/authinfo",
    availability: { products: ["opensearch"], minMajor: 1 },
  },
  {
    label: "_plugins/_ism/policies",
    detail: "OpenSearch ISM 策略",
    documentation: "管理 OpenSearch Index State Management 策略。",
    insertText: "_plugins/_ism/policies",
    availability: { products: ["opensearch"], minMajor: 1 },
  },
  {
    label: "_plugins/_knn/stats",
    detail: "OpenSearch k-NN 统计",
    documentation: "查看 OpenSearch k-NN 插件统计信息。",
    insertText: "_plugins/_knn/stats",
    availability: { products: ["opensearch"], minMajor: 1 },
  },
];

function deduplicateByLabel<T extends { label: string }>(list: readonly T[]) {
  return list.filter((item, index, array) => array.findIndex((other) => other.label === item.label) === index);
}

export function selectApiSegments(scope: "global" | "index", context?: CompletionCapabilityContext | null): ApiSegment[] {
  const base = scope === "index" ? INDEX_API_SEGMENTS : GLOBAL_API_SEGMENTS;
  const productSpecific = scope === "global" ? PRODUCT_GLOBAL_API_SEGMENTS : [];
  return deduplicateByLabel(filterAvailableSnippets([...base, ...productSpecific], context));
}

const COMMON_QUERY_PARAMETERS: ReadonlyArray<QueryParameterSnippet> = [
  {
    label: "pretty",
    detail: "格式化响应",
    documentation: "让响应 JSON 更易读。",
    insertText: "pretty=true",
    kind: "keyword",
    sortText: "000-pretty",
    endpoints: ["common"],
  },
  {
    label: "human",
    detail: "可读单位",
    documentation: "用更易读的单位返回时间和字节数。",
    insertText: "human=true",
    kind: "keyword",
    sortText: "001-human",
    endpoints: ["common"],
  },
  {
    label: "error_trace",
    detail: "错误堆栈",
    documentation: "返回详细错误堆栈。",
    insertText: "error_trace=true",
    kind: "keyword",
    sortText: "002-error_trace",
    endpoints: ["common"],
  },
  {
    label: "filter_path",
    detail: "响应过滤",
    documentation: "只返回匹配路径的响应字段。",
    insertText: "filter_path=$0",
    kind: "keyword",
    sortText: "003-filter_path",
    endpoints: ["common"],
  },
];

const ENDPOINT_QUERY_PARAMETERS: ReadonlyArray<QueryParameterSnippet> = [
  {
    label: "size",
    detail: "返回条数",
    documentation: "Search API 返回的命中文档数量。",
    insertText: "size=${1:10}",
    kind: "keyword",
    sortText: "010-size",
    endpoints: ["search"],
  },
  {
    label: "from",
    detail: "分页偏移",
    documentation: "Search API 起始偏移量。",
    insertText: "from=${1:0}",
    kind: "keyword",
    sortText: "011-from",
    endpoints: ["search"],
  },
  {
    label: "allow_partial_search_results",
    detail: "允许部分结果",
    documentation: "当部分分片失败时是否允许返回部分搜索结果。",
    insertText: "allow_partial_search_results=${1:true}",
    kind: "keyword",
    sortText: "012-allow_partial_search_results",
    endpoints: ["search"],
  },
  {
    label: "routing",
    detail: "路由值",
    documentation: "限制请求只访问指定 routing 的分片。",
    insertText: "routing=$0",
    kind: "keyword",
    sortText: "013-routing",
    endpoints: ["search", "bulk", "msearch"],
  },
  {
    label: "format",
    detail: "CAT 输出格式",
    documentation: "CAT API 输出格式，常用 json。",
    insertText: "format=${1:json}",
    kind: "keyword",
    sortText: "010-format",
    endpoints: ["cat"],
  },
  {
    label: "h",
    detail: "CAT 列",
    documentation: "CAT API 返回的列名列表。",
    insertText: "h=$0",
    kind: "keyword",
    sortText: "011-h",
    endpoints: ["cat"],
  },
  {
    label: "s",
    detail: "CAT 排序",
    documentation: "CAT API 排序列。",
    insertText: "s=$0",
    kind: "keyword",
    sortText: "012-s",
    endpoints: ["cat"],
  },
  {
    label: "v",
    detail: "CAT 表头",
    documentation: "CAT API 返回表头。",
    insertText: "v=true",
    kind: "keyword",
    sortText: "013-v",
    endpoints: ["cat"],
  },
  {
    label: "ignore_unavailable",
    detail: "忽略不可用索引",
    documentation: "索引不存在或关闭时不让请求失败。",
    insertText: "ignore_unavailable=${1:true}",
    kind: "keyword",
    sortText: "010-ignore_unavailable",
    endpoints: ["mapping", "settings", "search"],
  },
  {
    label: "expand_wildcards",
    detail: "通配符展开",
    documentation: "控制 open、closed、hidden、all 等索引通配符展开范围。",
    insertText: "expand_wildcards=${1:open}",
    kind: "keyword",
    sortText: "011-expand_wildcards",
    endpoints: ["mapping", "settings", "search"],
  },
  {
    label: "include_type_name",
    detail: "包含类型名",
    documentation: "Elasticsearch 7 兼容参数，Elasticsearch 8 起移除。",
    insertText: "include_type_name=${1:false}",
    kind: "keyword",
    sortText: "012-include_type_name",
    endpoints: ["mapping"],
    availability: { products: ["elasticsearch"], minMajor: 7, maxMajor: 7 },
  },
  {
    label: "flat_settings",
    detail: "扁平 settings",
    documentation: "以扁平 key 返回索引 settings。",
    insertText: "flat_settings=${1:true}",
    kind: "keyword",
    sortText: "010-flat_settings",
    endpoints: ["settings"],
  },
  {
    label: "include_defaults",
    detail: "包含默认 settings",
    documentation: "返回默认索引 settings。",
    insertText: "include_defaults=${1:true}",
    kind: "keyword",
    sortText: "011-include_defaults",
    endpoints: ["settings"],
  },
  {
    label: "detailed",
    detail: "任务详情",
    documentation: "Tasks API 返回详细任务信息。",
    insertText: "detailed=${1:true}",
    kind: "keyword",
    sortText: "010-detailed",
    endpoints: ["tasks"],
  },
  {
    label: "actions",
    detail: "任务 action 过滤",
    documentation: "按 action 名称过滤 Tasks API。",
    insertText: "actions=$0",
    kind: "keyword",
    sortText: "011-actions",
    endpoints: ["tasks"],
  },
  {
    label: "master_timeout",
    detail: "主节点超时",
    documentation: "等待主节点响应的超时时间。",
    insertText: "master_timeout=${1:30s}",
    kind: "keyword",
    sortText: "010-master_timeout",
    endpoints: ["snapshot", "settings", "mapping"],
  },
  {
    label: "refresh",
    detail: "刷新策略",
    documentation: "写入类 API 完成后是否刷新。",
    insertText: "refresh=${1:false}",
    kind: "keyword",
    sortText: "010-refresh",
    endpoints: ["bulk"],
  },
  {
    label: "wait_for_active_shards",
    detail: "等待活跃分片",
    documentation: "写入前等待的活跃分片数量。",
    insertText: "wait_for_active_shards=${1:1}",
    kind: "keyword",
    sortText: "011-wait_for_active_shards",
    endpoints: ["bulk"],
  },
];

function endpointKindsForPath(path: string) {
  const normalized = path.trim().split("?", 1)[0]?.replace(/^\/+/, "") ?? "";
  const parts = normalized.split("/").filter(Boolean);
  const joined = `/${parts.join("/")}`;
  const kinds = new Set<EndpointKind>(["common"]);

  if (parts[0] === "_cat") {
    kinds.add("cat");
  }
  if (parts.includes("_search") || parts[0] === "_search") {
    kinds.add("search");
  }
  if (parts.includes("_mapping") || parts[0] === "_mapping") {
    kinds.add("mapping");
  }
  if (parts.includes("_settings") || parts[0] === "_settings") {
    kinds.add("settings");
  }
  if (parts[0] === "_tasks") {
    kinds.add("tasks");
  }
  if (parts[0] === "_snapshot") {
    kinds.add("snapshot");
  }
  if (parts.includes("_bulk") || joined.endsWith("/_bulk")) {
    kinds.add("bulk");
  }
  if (parts.includes("_msearch") || joined.endsWith("/_msearch")) {
    kinds.add("msearch");
  }

  return kinds;
}

export function selectQueryParameterSnippets(path: string, context?: CompletionCapabilityContext | null): RawSnippet[] {
  const kinds = endpointKindsForPath(path);
  const snippets = [...COMMON_QUERY_PARAMETERS, ...ENDPOINT_QUERY_PARAMETERS].filter((snippet) =>
    snippet.endpoints?.some((endpoint) => kinds.has(endpoint)),
  );

  return deduplicateByLabel(filterAvailableSnippets(snippets, context));
}
