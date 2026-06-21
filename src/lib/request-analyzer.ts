import { extractIndexNamesFromPath } from "./console-autocomplete/context";
import { GLOBAL_API_SEGMENTS, HTTP_METHODS, INDEX_API_SEGMENTS } from "./console-autocomplete/snippets";
import { parseConsoleRequest, type ParsedConsoleRequest } from "./console-parser";
import { validateConsoleContent } from "./console-autocomplete/validator";

export type RequestAnalysisSource = "local" | "ai";

export type RequestAnalysisResult =
  | {
      valid: true;
      meaning: string;
      details: string[];
      source: RequestAnalysisSource;
    }
  | {
      valid: false;
      issues: string[];
      suggestion: string | null;
      source: RequestAnalysisSource;
    };

const SUPPORTED_METHODS = new Set<string>(HTTP_METHODS);
const QUERY_TYPE_LABELS: Record<string, string> = {
  match_all: "匹配全部文档",
  match: "全文匹配",
  match_bool_prefix: "布尔前缀匹配",
  match_phrase: "短语匹配",
  match_phrase_prefix: "短语前缀匹配",
  multi_match: "多字段匹配",
  combined_fields: "组合字段匹配",
  query_string: "查询字符串",
  simple_query_string: "简易查询字符串",
  intervals: "Intervals 查询",
  term: "精确词项匹配",
  terms: "多词项匹配",
  terms_set: "多词项集合匹配",
  range: "范围查询",
  exists: "字段存在性查询",
  prefix: "前缀匹配",
  wildcard: "通配符匹配",
  regexp: "正则匹配",
  fuzzy: "模糊匹配",
  ids: "按文档 ID 查询",
  bool: "布尔组合查询",
  boosting: "Boosting 查询",
  constant_score: "常量评分查询",
  dis_max: "Disjunction max 查询",
  function_score: "函数评分查询",
  geo_distance: "地理距离查询",
  geo_bounding_box: "地理边界框查询",
  geo_polygon: "地理多边形查询",
  geo_shape: "地理形状查询",
  shape: "形状查询",
  nested: "嵌套对象查询",
  has_child: "子文档查询",
  has_parent: "父文档查询",
  parent_id: "父 ID 查询",
  span_term: "Span term 查询",
  span_near: "Span near 查询",
  span_or: "Span or 查询",
  span_not: "Span not 查询",
  span_first: "Span first 查询",
  span_multi: "Span multi-term 查询",
  span_containing: "Span containing 查询",
  span_within: "Span within 查询",
  span_field_masking: "Span field masking 查询",
  script: "脚本查询",
  script_score: "脚本评分查询",
  more_like_this: "相似文档查询",
  distance_feature: "距离特征查询",
  rank_feature: "排名特征查询",
  pinned: "置顶查询",
  wrapper: "Wrapper 查询",
  knn: "kNN 查询",
  semantic: "语义查询",
  sparse_vector: "稀疏向量查询",
};

const AGG_TYPE_LABELS: Record<string, string> = {
  terms: "词项聚合",
  date_histogram: "日期直方图聚合",
  histogram: "数值直方图聚合",
  avg: "平均值聚合",
  sum: "求和聚合",
  min: "最小值聚合",
  max: "最大值聚合",
  cardinality: "基数聚合",
  stats: "统计聚合",
  extended_stats: "扩展统计聚合",
  percentiles: "百分位聚合",
  percentile_ranks: "百分位排名聚合",
  weighted_avg: "加权平均聚合",
  value_count: "字段计数聚合",
  filter: "过滤聚合",
  filters: "多过滤器聚合",
  nested: "嵌套聚合",
  reverse_nested: "反向嵌套聚合",
  global: "全局聚合",
  missing: "缺失值聚合",
  significant_terms: "显著词项聚合",
  composite: "Composite 聚合",
  sampler: "Sampler 聚合",
  top_hits: "Top Hits 聚合",
  top_metrics: "Top Metrics 聚合",
  median_absolute_deviation: "中位绝对偏差聚合",
  bucket_script: "Bucket Script 聚合",
  bucket_selector: "Bucket Selector 聚合",
  bucket_sort: "Bucket Sort 聚合",
  derivative: "Derivative 聚合",
  moving_fn: "Moving Function 聚合",
  cumulative_sum: "Cumulative Sum 聚合",
};

function splitContent(content: string) {
  const normalized = content.trim();
  if (!normalized) {
    return { firstLine: "", bodyText: "" };
  }

  const lines = normalized.split(/\r?\n/);
  const firstLine = lines.shift()?.trim() ?? "";
  const bodyText = lines.join("\n").trim();
  return { firstLine, bodyText };
}

function stripTrailingCommas(text: string) {
  return text.replace(/,\s*([}\]])/g, "$1");
}

function tryRepairJson(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return null;
  }

  const withoutTrailingCommas = stripTrailingCommas(trimmed);
  try {
    JSON.parse(withoutTrailingCommas);
    if (withoutTrailingCommas !== trimmed) {
      return withoutTrailingCommas;
    }
  } catch {
    // continue
  }

  const openBraces = (trimmed.match(/{/g) ?? []).length;
  const closeBraces = (trimmed.match(/}/g) ?? []).length;
  const openBrackets = (trimmed.match(/\[/g) ?? []).length;
  const closeBrackets = (trimmed.match(/]/g) ?? []).length;

  if (openBraces > closeBraces || openBrackets > closeBrackets) {
    let repaired = withoutTrailingCommas;
    for (let index = 0; index < openBrackets - closeBrackets; index += 1) {
      repaired += "\n]";
    }
    for (let index = 0; index < openBraces - closeBraces; index += 1) {
      repaired += "\n}";
    }
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      return null;
    }
  }

  return null;
}

function inferMethodFromPath(path: string) {
  const normalizedPath = path.split("?", 1)[0]?.toLowerCase() ?? "";
  if (/(^|\/)_search(\/|$)/.test(normalizedPath) || /(^|\/)_count(\/|$)/.test(normalizedPath)) {
    return "POST";
  }
  if (/(^|\/)_bulk(\/|$)/.test(normalizedPath) || /(^|\/)_msearch(\/|$)/.test(normalizedPath)) {
    return "POST";
  }
  if (/(^|\/)_update(\/|$)/.test(normalizedPath) || /(^|\/)_update_by_query(\/|$)/.test(normalizedPath)) {
    return "POST";
  }
  if (/(^|\/)_delete_by_query(\/|$)/.test(normalizedPath)) {
    return "POST";
  }
  if (/(^|\/)_doc(\/|$)/.test(normalizedPath)) {
    return "GET";
  }
  return "GET";
}

function inferPathFromBody(bodyText: string) {
  const trimmed = bodyText.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if ("query" in parsed || "aggs" in parsed || "aggregations" in parsed || "sort" in parsed) {
      return "POST /_search";
    }
    if ("mappings" in parsed || "settings" in parsed) {
      return "PUT /my-index";
    }
    if ("doc" in parsed || "script" in parsed) {
      return "POST /my-index/_update/1";
    }
  } catch {
    if (/"query"\s*:/.test(trimmed) || /"aggs"\s*:/.test(trimmed)) {
      return "POST /_search";
    }
  }

  return "POST /_search";
}

function resolveBodySuggestion(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return null;
  }

  const repaired = tryRepairJson(trimmed);
  if (repaired) {
    return repaired;
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

function buildSuggestion(content: string, issues: string[]): string | null {
  const trimmed = content.trim();
  const { firstLine, bodyText } = splitContent(content);

  if (!trimmed) {
    return "GET /_cluster/health";
  }

  if (trimmed.startsWith("{") || (firstLine.startsWith("{") && !looksLikeRequestHeader(firstLine))) {
    const inferredPath = inferPathFromBody(trimmed);
    if (inferredPath) {
      const bodySuggestion = resolveBodySuggestion(trimmed);
      return bodySuggestion ? `${inferredPath}\n${bodySuggestion}` : inferredPath;
    }
  }

  if (!firstLine && bodyText) {
    const inferredPath = inferPathFromBody(bodyText);
    if (inferredPath) {
      const bodySuggestion = resolveBodySuggestion(bodyText);
      return bodySuggestion ? `${inferredPath}\n${bodySuggestion}` : inferredPath;
    }
  }

  const looksLikePathOnly =
    firstLine.startsWith("/") ||
    (!firstLine.includes(" ") && !SUPPORTED_METHODS.has(firstLine.toUpperCase()) && !firstLine.startsWith("{"));

  if (looksLikePathOnly) {
    const path = firstLine.startsWith("/") ? firstLine : `/${firstLine}`;
    const method = inferMethodFromPath(path);
    const header = `${method} ${path}`;
    if (!bodyText) {
      return header;
    }
    const bodySuggestion = resolveBodySuggestion(bodyText);
    return bodySuggestion ? `${header}\n${bodySuggestion}` : header;
  }

  const [methodRaw, ...pathParts] = firstLine.split(/\s+/);
  const method = methodRaw.toUpperCase();
  const path = pathParts.join(" ").trim();

  if (SUPPORTED_METHODS.has(method) && path && bodyText) {
    const bodySuggestion = resolveBodySuggestion(bodyText);
    if (bodySuggestion) {
      return `${method} ${path}\n${bodySuggestion}`;
    }
  }

  if (!SUPPORTED_METHODS.has(method) && path) {
    const inferredMethod = inferMethodFromPath(path);
    const header = `${inferredMethod} ${path}`;
    if (!bodyText) {
      return header;
    }
    const bodySuggestion = resolveBodySuggestion(bodyText);
    return bodySuggestion ? `${header}\n${bodySuggestion}` : header;
  }

  if (SUPPORTED_METHODS.has(method) && !path && bodyText) {
    const inferredPath = inferPathFromBody(bodyText);
    if (inferredPath) {
      const bodySuggestion = resolveBodySuggestion(bodyText);
      const header = inferredPath.replace(/^POST /, `${method} `);
      return bodySuggestion ? `${header}\n${bodySuggestion}` : header;
    }
  }

  if (issues.some((issue) => issue.includes("JSON"))) {
    const bodySuggestion = resolveBodySuggestion(bodyText);
    if (bodySuggestion && path) {
      return `${SUPPORTED_METHODS.has(method) ? method : inferMethodFromPath(path)} ${path}\n${bodySuggestion}`;
    }
  }

  return null;
}

function collectFormatIssues(content: string): string[] {
  const issues: string[] = [];
  const trimmed = content.trim();
  const { firstLine, bodyText } = splitContent(content);

  if (trimmed.startsWith("{") || (firstLine.startsWith("{") && !looksLikeRequestHeader(firstLine))) {
    issues.push("缺少第一行请求头，应为 METHOD /path 格式。");
    try {
      JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "JSON 解析失败";
      issues.push(`请求体必须是合法的 JSON：${message}`);
    }
    return issues;
  }

  if (!firstLine) {
    issues.push("缺少第一行请求头，应为 METHOD /path 格式。");
    return issues;
  }

  const [methodRaw, ...pathParts] = firstLine.split(/\s+/);
  const method = methodRaw.toUpperCase();
  const path = pathParts.join(" ").trim();

  if (!SUPPORTED_METHODS.has(method)) {
    issues.push(`HTTP Method「${methodRaw}」不受支持，可使用：${HTTP_METHODS.join("、")}。`);
  }

  if (!path) {
    issues.push("请求路径不能为空。");
  }

  if (bodyText) {
    validateConsoleContent(`${methodRaw} ${path}\n${bodyText}`).forEach((diag) => {
      issues.push(diag.message);
    });

    if (!issues.some((issue) => issue.includes("JSON") || issue.includes("字符串") || issue.includes("未闭合") || issue.includes("多余"))) {
      try {
        JSON.parse(bodyText);
      } catch (error) {
        const message = error instanceof Error ? error.message : "JSON 解析失败";
        issues.push(`请求体必须是合法的 JSON：${message}`);
      }
    }
  }

  return issues;
}

function isIndexScopedPath(normalizedPath: string) {
  const firstSegment = normalizedPath.split("/").filter(Boolean)[0] ?? "";
  return firstSegment.length > 0 && !firstSegment.startsWith("_");
}

function looksLikeRequestHeader(firstLine: string) {
  const [methodRaw, ...pathParts] = firstLine.split(/\s+/);
  return SUPPORTED_METHODS.has(methodRaw.toUpperCase()) && pathParts.join(" ").trim().length > 0;
}

function resolveApiSegment(path: string) {
  const normalizedPath = path.split("?", 1)[0]?.replace(/^\/+/, "") ?? "";
  const indexScoped = isIndexScopedPath(normalizedPath);

  if (indexScoped) {
    const apiPart = normalizedPath.split("/").slice(1).find((segment) => segment.startsWith("_")) ?? "";
    return INDEX_API_SEGMENTS.find((item) => item.label === apiPart) ?? null;
  }

  return [...GLOBAL_API_SEGMENTS]
    .sort((left, right) => right.label.length - left.label.length)
    .find((item) => normalizedPath === item.label || normalizedPath.startsWith(`${item.label}`)) ?? null;
}

function describeQuery(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 4) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => describeQuery(item, depth + 1));
  }

  const record = value as Record<string, unknown>;
  const descriptions: string[] = [];

  Object.entries(record).forEach(([key, nested]) => {
    const label = QUERY_TYPE_LABELS[key];
    if (label) {
      descriptions.push(label);
    }

    if (key === "bool" && nested && typeof nested === "object" && !Array.isArray(nested)) {
      const boolRecord = nested as Record<string, unknown>;
      if (Array.isArray(boolRecord.must) && boolRecord.must.length > 0) {
        descriptions.push(`must 条件 ${boolRecord.must.length} 条`);
      }
      if (Array.isArray(boolRecord.filter) && boolRecord.filter.length > 0) {
        descriptions.push(`filter 条件 ${boolRecord.filter.length} 条`);
      }
      if (Array.isArray(boolRecord.should) && boolRecord.should.length > 0) {
        descriptions.push(`should 条件 ${boolRecord.should.length} 条`);
      }
      if (Array.isArray(boolRecord.must_not) && boolRecord.must_not.length > 0) {
        descriptions.push(`must_not 条件 ${boolRecord.must_not.length} 条`);
      }
    }

    descriptions.push(...describeQuery(nested, depth + 1));
  });

  return descriptions;
}

function describeAggregations(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const descriptions: string[] = [];
  Object.entries(value as Record<string, unknown>).forEach(([aggName, aggBody]) => {
    if (!aggBody || typeof aggBody !== "object" || Array.isArray(aggBody)) {
      return;
    }

    const aggRecord = aggBody as Record<string, unknown>;
    const aggType = Object.keys(aggRecord).find((key) => AGG_TYPE_LABELS[key]);
    if (aggType) {
      descriptions.push(`聚合「${aggName}」：${AGG_TYPE_LABELS[aggType]}`);
      return;
    }

    if ("aggs" in aggRecord || "aggregations" in aggRecord) {
      descriptions.push(`聚合「${aggName}」：嵌套聚合容器`);
    }
  });

  return descriptions;
}

function describeBody(parsed: ParsedConsoleRequest): string[] {
  const details: string[] = [];
  if (!parsed.bodyJson || typeof parsed.bodyJson !== "object" || Array.isArray(parsed.bodyJson)) {
    return details;
  }

  const body = parsed.bodyJson as Record<string, unknown>;

  if ("query" in body) {
    const queryDescriptions = describeQuery(body.query);
    if (queryDescriptions.length > 0) {
      details.push(`查询：${[...new Set(queryDescriptions)].join("；")}`);
    } else {
      details.push("包含 query 查询 DSL。");
    }
  }

  const aggs = body.aggs ?? body.aggregations;
  if (aggs) {
    const aggDescriptions = describeAggregations(aggs);
    if (aggDescriptions.length > 0) {
      details.push(...aggDescriptions);
    } else {
      details.push("包含聚合定义。");
    }
  }

  if (typeof body.size === "number") {
    details.push(`返回文档数 size=${body.size}`);
  }

  if (typeof body.from === "number") {
    details.push(`分页偏移 from=${body.from}`);
  }

  if ("sort" in body) {
    details.push("包含排序规则。");
  }

  if ("_source" in body) {
    details.push("指定了 _source 字段过滤。");
  }

  if ("script" in body || "doc" in body) {
    details.push("包含文档更新或脚本相关字段。");
  }

  if ("mappings" in body || "settings" in body) {
    details.push("包含索引 mappings 或 settings 定义。");
  }

  return details;
}

function describeRequest(parsed: ParsedConsoleRequest): RequestAnalysisResult {
  const indexNames = extractIndexNamesFromPath(parsed.path);
  const apiSegment = resolveApiSegment(parsed.path);
  const pathWithoutQuery = parsed.path.split("?", 1)[0] ?? parsed.path;

  const actionParts: string[] = [];
  actionParts.push(`${parsed.method} 请求`);

  if (indexNames.length > 0) {
    actionParts.push(`目标索引：${indexNames.join("、")}`);
  } else if (pathWithoutQuery.startsWith("/_") || pathWithoutQuery.startsWith("_")) {
    actionParts.push("集群级 API");
  }

  if (apiSegment) {
    actionParts.push(apiSegment.detail);
  } else if (/_search(\?|$|\/)/.test(parsed.path)) {
    actionParts.push("执行搜索");
  } else if (/_count(\?|$|\/)/.test(parsed.path)) {
    actionParts.push("统计匹配文档数量");
  } else if (/_mapping(\?|$|\/)/.test(parsed.path)) {
    actionParts.push("查看字段映射");
  } else if (/_doc(\/|$)/.test(parsed.path)) {
    actionParts.push("访问单条文档");
  } else if (/_bulk(\?|$|\/)/.test(parsed.path)) {
    actionParts.push("批量写入或删除文档");
  } else if (/_cluster\/health(\?|$|\/)/.test(parsed.path)) {
    actionParts.push("查看集群健康状态");
  }

  const bodyDetails = describeBody(parsed);
  const meaning = actionParts.join("，") + "。";

  return {
    valid: true,
    meaning,
    details: bodyDetails,
    source: "local",
  };
}

export function analyzeRequestContentLocally(content: string): RequestAnalysisResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      valid: false,
      issues: ["请输入请求内容。"],
      suggestion: "GET /_cluster/health",
      source: "local",
    };
  }

  try {
    const parsed = parseConsoleRequest(content);
    const formatIssues = collectFormatIssues(content);
    if (formatIssues.length > 0) {
      return {
        valid: false,
        issues: formatIssues,
        suggestion: buildSuggestion(content, formatIssues),
        source: "local",
      };
    }
    return describeRequest(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求格式无效";
    const issues = collectFormatIssues(content);
    if (issues.length === 0) {
      issues.push(message);
    }
    return {
      valid: false,
      issues,
      suggestion: buildSuggestion(content, issues),
      source: "local",
    };
  }
}
