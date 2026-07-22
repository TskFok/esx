import type {
  ConnectionSearchClusterMetadata,
  SearchClusterProduct,
} from "../../types/requests";
import {
  CAT_API_SEGMENTS,
  GLOBAL_API_SEGMENTS,
  INDEX_API_SEGMENTS,
  type ApiSegment,
  type QueryParameterSnippet,
  type RawSnippet,
  type SnippetAvailability,
} from "./snippets";
import type { ConsoleEndpoint } from "./request-context";

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

function compareVersion(
  left: readonly [number, number],
  right: readonly [number, number],
) {
  return left[0] === right[0] ? left[1] - right[1] : left[0] - right[0];
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

  const currentVersion = cluster.version.major === null
    ? null
    : [cluster.version.major, cluster.version.minor ?? 0] as const;
  if ((availability.minVersion || availability.maxVersion) && !currentVersion) {
    return false;
  }

  if (availability.minVersion && compareVersion(currentVersion!, availability.minVersion) < 0) {
    return false;
  }

  if (availability.maxVersion && compareVersion(currentVersion!, availability.maxVersion) > 0) {
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

const GLOBAL_API_METHODS: Record<string, readonly string[]> = {
  "_cluster/health": ["GET"],
  "_cat/indices": ["GET"],
  "_search": ["GET", "POST"],
  "_count": ["GET", "POST"],
  "_mapping": ["GET"],
  "_settings": ["GET"],
  "_aliases": ["GET"],
  "_bulk": ["POST", "PUT"],
  "_msearch": ["GET", "POST"],
  "_tasks": ["GET"],
  "_nodes/stats": ["GET"],
  "_security/_authenticate": ["GET"],
  "_license": ["GET"],
  "_ml/anomaly_detectors": ["GET"],
  "_plugins/_security/api/account": ["GET"],
  "_plugins/_security/authinfo": ["GET"],
  "_plugins/_ism/policies": ["GET"],
  "_plugins/_knn/stats": ["GET"],
};

const INDEX_API_METHODS: Record<string, readonly string[]> = {
  "_search": ["GET", "POST"],
  "_count": ["GET", "POST"],
  "_mapping": ["GET", "PUT"],
  "_settings": ["GET", "PUT"],
  "_refresh": ["GET", "POST"],
  "_doc": ["GET", "POST", "PUT", "DELETE", "HEAD"],
  "_bulk": ["POST", "PUT"],
  "_update_by_query": ["POST"],
  "_delete_by_query": ["POST"],
};

const CAT_API_METHODS: Record<string, readonly string[]> = Object.fromEntries(
  CAT_API_SEGMENTS.map((segment) => [segment.label, ["GET"] as const]),
);

export function selectApiSegments(
  scope: "global" | "index" | "cat",
  context: CompletionCapabilityContext | null | undefined,
  method: string,
): ApiSegment[] {
  const base = scope === "index"
    ? INDEX_API_SEGMENTS
    : scope === "cat"
      ? CAT_API_SEGMENTS
      : GLOBAL_API_SEGMENTS;
  const productSpecific = scope === "global" ? PRODUCT_GLOBAL_API_SEGMENTS : [];
  const methods = scope === "index"
    ? INDEX_API_METHODS
    : scope === "cat"
      ? CAT_API_METHODS
      : GLOBAL_API_METHODS;

  return deduplicateByLabel(filterAvailableSnippets([...base, ...productSpecific], context))
    .filter((segment) => methods[segment.label]?.includes(method) === true)
    .map((segment) => ({ ...segment, methods: methods[segment.label] }));
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
    label: "sort",
    detail: "搜索排序",
    documentation: "指定 Search API 的排序字段和方向。",
    insertText: "sort=$0",
    kind: "keyword",
    sortText: "013-sort",
    endpoints: ["search"],
  },
  {
    label: "search_type",
    detail: "搜索类型",
    documentation: "指定分布式搜索执行方式。",
    insertText: "search_type=${1:query_then_fetch}",
    kind: "keyword",
    sortText: "014-search_type",
    endpoints: ["search"],
  },
  {
    label: "routing",
    detail: "路由值",
    documentation: "限制请求只访问指定 routing 的分片。",
    insertText: "routing=$0",
    kind: "keyword",
    sortText: "015-routing",
    endpoints: ["search", "count", "bulk", "msearch"],
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
    endpoints: ["mapping", "settings", "search", "count"],
  },
  {
    label: "expand_wildcards",
    detail: "通配符展开",
    documentation: "控制 open、closed、hidden、all 等索引通配符展开范围。",
    insertText: "expand_wildcards=${1:open}",
    kind: "keyword",
    sortText: "011-expand_wildcards",
    endpoints: ["mapping", "settings", "search", "count"],
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

const SCROLL_QUERY_PARAMETER_SNIPPETS: QueryParameterSnippet[] = [
  {
    label: "scroll",
    detail: "保留滚动上下文",
    documentation: "延长 Scroll 搜索上下文的有效期。",
    insertText: "scroll=${1:1m}",
    kind: "keyword",
    endpoints: ["scroll"],
  },
  {
    label: "scroll_id",
    detail: "Scroll ID",
    documentation: "指定需要继续读取的 Scroll 上下文。",
    insertText: "scroll_id=${1:id}",
    kind: "keyword",
    endpoints: ["scroll"],
  },
  {
    label: "rest_total_hits_as_int",
    detail: "整数命中总数",
    documentation: "以整数形式返回 hits.total。",
    insertText: "rest_total_hits_as_int=${1:true}",
    kind: "keyword",
    endpoints: ["scroll"],
  },
];

const QUERY_PARAMETER_ENDPOINTS = new Set<ConsoleEndpoint>([
  "search",
  "scroll",
  "count",
  "bulk",
  "msearch",
  "mapping",
  "settings",
  "tasks",
  "snapshot",
  "cat",
]);

const BOOLEAN_QUERY_PARAMETER_KEYS = new Set([
  "pretty",
  "human",
  "error_trace",
  "rest_total_hits_as_int",
  "allow_partial_search_results",
]);

const BOOLEAN_QUERY_PARAMETER_VALUES: RawSnippet[] = [
  { label: "true", detail: "启用", documentation: "使用 true。", insertText: "true", kind: "keyword" },
  { label: "false", detail: "禁用", documentation: "使用 false。", insertText: "false", kind: "keyword" },
];

const SEARCH_TYPE_VALUES: RawSnippet[] = [
  {
    label: "query_then_fetch",
    detail: "默认搜索类型",
    documentation: "先查询再拉取。",
    insertText: "query_then_fetch",
    kind: "keyword",
  },
  {
    label: "dfs_query_then_fetch",
    detail: "全局词频搜索",
    documentation: "先收集全局词频再查询。",
    insertText: "dfs_query_then_fetch",
    kind: "keyword",
  },
];

export function selectQueryParameterSnippets(
  endpoint: ConsoleEndpoint,
  context?: CompletionCapabilityContext | null,
  usedKeys: readonly string[] = [],
): QueryParameterSnippet[] {
  if (!QUERY_PARAMETER_ENDPOINTS.has(endpoint)) return [];
  const used = new Set(usedKeys);
  const snippets = filterAvailableSnippets(
    [...COMMON_QUERY_PARAMETERS, ...ENDPOINT_QUERY_PARAMETERS, ...SCROLL_QUERY_PARAMETER_SNIPPETS],
    context,
  ).filter((snippet) =>
    !used.has(snippet.label) &&
    (snippet.endpoints.includes("common") || snippet.endpoints.includes(endpoint)),
  );

  return deduplicateByLabel(snippets);
}

export function selectQueryParameterValueSnippets(
  endpoint: ConsoleEndpoint,
  key: string,
  context?: CompletionCapabilityContext | null,
): RawSnippet[] {
  const allowed = selectQueryParameterSnippets(endpoint, context).some((item) => item.label === key);
  if (!allowed) return [];
  if (BOOLEAN_QUERY_PARAMETER_KEYS.has(key)) return BOOLEAN_QUERY_PARAMETER_VALUES;
  if (key === "search_type") return SEARCH_TYPE_VALUES;
  return [];
}
