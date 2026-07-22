import type { ConsoleEndpoint } from "./request-context";

export type SnippetKind =
  | "property"
  | "value"
  | "keyword";

export type SnippetAvailability = {
  products?: Array<"elasticsearch" | "opensearch">;
  minMajor?: number;
  maxMajor?: number;
  minVersion?: readonly [major: number, minor: number];
  maxVersion?: readonly [major: number, minor: number];
  licenseAtLeast?: "gold" | "platinum" | "enterprise";
};

export type RawSnippet = {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
  kind: SnippetKind;
  sortText?: string;
  availability?: SnippetAvailability;
};

export type QueryParameterSnippet = RawSnippet & {
  endpoints: Array<ConsoleEndpoint | "common">;
};

export type ApiSegment = {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
  availability?: SnippetAvailability;
  methods?: readonly string[];
};

function propertySnippet(
  label: string,
  detail: string,
  documentation: string,
  insertText: string,
  sortText: string,
  availability?: SnippetAvailability,
): RawSnippet {
  return {
    label,
    detail,
    documentation,
    insertText,
    kind: "property",
    sortText,
    availability,
  };
}

function caseInsensitivePropertySnippets(sortText: string): RawSnippet[] {
  return [
    propertySnippet(
      "case_insensitive",
      "忽略大小写",
      "对 ASCII 字符执行大小写不敏感匹配。",
      '"case_insensitive": ${1:true}',
      sortText,
      { products: ["elasticsearch"], minVersion: [7, 10] },
    ),
    propertySnippet(
      "case_insensitive",
      "忽略大小写",
      "对 ASCII 字符执行大小写不敏感匹配。",
      '"case_insensitive": ${1:true}',
      sortText,
      { products: ["opensearch"], minMajor: 1 },
    ),
  ];
}

export const TERM_VALUE_PROPERTY_SNIPPETS: RawSnippet[] = [
  propertySnippet("value", "精确值", "指定 term 查询值。", '"value": "${1:value}"', "000-value"),
  propertySnippet("boost", "权重", "设置 term 查询权重。", '"boost": ${1:1.0}', "001-boost"),
  ...caseInsensitivePropertySnippets("002-case-insensitive"),
];

export const RANGE_VALUE_PROPERTY_SNIPPETS: RawSnippet[] = [
  propertySnippet("gt", "大于", "匹配大于给定值的文档。", '"gt": "${1:value}"', "000-gt"),
  propertySnippet("gte", "大于等于", "匹配大于等于给定值的文档。", '"gte": "${1:value}"', "001-gte"),
  propertySnippet("lt", "小于", "匹配小于给定值的文档。", '"lt": "${1:value}"', "002-lt"),
  propertySnippet("lte", "小于等于", "匹配小于等于给定值的文档。", '"lte": "${1:value}"', "003-lte"),
  propertySnippet("format", "日期格式", "指定日期值格式。", '"format": "${1:strict_date_optional_time}"', "004-format"),
  propertySnippet("time_zone", "时区", "指定日期范围查询时区。", '"time_zone": "${1:+00:00}"', "005-time-zone"),
  propertySnippet("boost", "权重", "设置 range 查询权重。", '"boost": ${1:1.0}', "006-boost"),
];

export const FIELD_QUERY_VALUE_PROPERTY_SNIPPETS_BY_TYPE: Readonly<
  Record<string, ReadonlyArray<RawSnippet>>
> = {
  match: [
    propertySnippet("query", "查询值", "指定 match 查询文本。", '"query": "${1:value}"', "000-query"),
    propertySnippet("analyzer", "分析器", "指定查询分析器。", '"analyzer": "${1:standard}"', "001-analyzer"),
    propertySnippet("operator", "布尔运算符", "指定分词之间的运算符。", '"operator": "${1|or,and|}"', "002-operator"),
    propertySnippet("fuzziness", "模糊度", "指定允许的编辑距离。", '"fuzziness": "${1:AUTO}"', "003-fuzziness"),
    propertySnippet("boost", "权重", "设置查询权重。", '"boost": ${1:1.0}', "004-boost"),
  ],
  prefix: [
    propertySnippet("value", "前缀值", "指定前缀。", '"value": "${1:value}"', "000-value"),
    propertySnippet("rewrite", "重写方式", "指定 multi-term rewrite。", '"rewrite": "${1:constant_score}"', "001-rewrite"),
    ...caseInsensitivePropertySnippets("002-case-insensitive"),
    propertySnippet("boost", "权重", "设置查询权重。", '"boost": ${1:1.0}', "003-boost"),
  ],
  wildcard: [
    propertySnippet("value", "通配表达式", "指定通配符模式。", '"value": "${1:value*}"', "000-value"),
    propertySnippet("rewrite", "重写方式", "指定 multi-term rewrite。", '"rewrite": "${1:constant_score}"', "001-rewrite"),
    ...caseInsensitivePropertySnippets("002-case-insensitive"),
    propertySnippet("boost", "权重", "设置查询权重。", '"boost": ${1:1.0}', "003-boost"),
  ],
  regexp: [
    propertySnippet("value", "正则表达式", "指定正则模式。", '"value": "${1:pattern}"', "000-value"),
    propertySnippet("flags", "正则标志", "指定可选正则语法。", '"flags": "${1:ALL}"', "001-flags"),
    propertySnippet("max_determinized_states", "最大状态数", "限制自动机状态数。", '"max_determinized_states": ${1:10000}', "002-max-states"),
    propertySnippet("rewrite", "重写方式", "指定 multi-term rewrite。", '"rewrite": "${1:constant_score}"', "003-rewrite"),
    ...caseInsensitivePropertySnippets("004-case-insensitive"),
    propertySnippet("boost", "权重", "设置查询权重。", '"boost": ${1:1.0}', "005-boost"),
  ],
  fuzzy: [
    propertySnippet("value", "模糊查询值", "指定模糊查询文本。", '"value": "${1:value}"', "000-value"),
    propertySnippet("fuzziness", "模糊度", "指定允许的编辑距离。", '"fuzziness": "${1:AUTO}"', "001-fuzziness"),
    propertySnippet("prefix_length", "固定前缀长度", "指定不参与模糊匹配的前缀长度。", '"prefix_length": ${1:0}', "002-prefix-length"),
    propertySnippet("max_expansions", "最大扩展数", "限制模糊词项扩展数。", '"max_expansions": ${1:50}', "003-max-expansions"),
    propertySnippet("transpositions", "允许换位", "允许相邻字符换位。", '"transpositions": ${1:true}', "004-transpositions"),
    propertySnippet("rewrite", "重写方式", "指定 multi-term rewrite。", '"rewrite": "${1:constant_score}"', "005-rewrite"),
    propertySnippet("boost", "权重", "设置查询权重。", '"boost": ${1:1.0}', "006-boost"),
  ],
};

function queryValueSnippet(snippet: RawSnippet): RawSnippet {
  return {
    ...snippet,
    kind: "value",
    insertText: `{\n\t${snippet.insertText}\n}`,
  };
}

export const GLOBAL_API_SEGMENTS: ReadonlyArray<ApiSegment> = [
  { label: "_cluster/health", detail: "集群健康状态", documentation: "查看集群健康状态。", insertText: "_cluster/health" },
  { label: "_cat/indices", detail: "列出索引", documentation: "查看索引列表。", insertText: "_cat/indices?v=true" },
  { label: "_search", detail: "全局搜索", documentation: "对所有索引执行搜索。", insertText: "_search" },
  { label: "_count", detail: "全局计数", documentation: "对所有索引执行计数。", insertText: "_count" },
  { label: "_mapping", detail: "查看映射", documentation: "查看所有索引映射。", insertText: "_mapping" },
  { label: "_settings", detail: "查看设置", documentation: "查看所有索引设置。", insertText: "_settings" },
  { label: "_aliases", detail: "查看别名", documentation: "查看当前集群全部别名。", insertText: "_aliases" },
  { label: "_bulk", detail: "批量写入", documentation: "执行 bulk 请求。", insertText: "_bulk" },
  { label: "_msearch", detail: "批量搜索", documentation: "执行 msearch 请求。", insertText: "_msearch" },
  { label: "_tasks", detail: "任务列表", documentation: "查看正在运行的任务。", insertText: "_tasks" },
  { label: "_nodes/stats", detail: "节点统计", documentation: "查看节点统计信息。", insertText: "_nodes/stats" },
];

export const INDEX_API_SEGMENTS: ReadonlyArray<ApiSegment> = [
  { label: "_search", detail: "索引搜索", documentation: "对当前索引执行搜索。", insertText: "_search" },
  { label: "_count", detail: "索引计数", documentation: "对当前索引执行计数。", insertText: "_count" },
  { label: "_mapping", detail: "索引映射", documentation: "查看当前索引映射。", insertText: "_mapping" },
  { label: "_settings", detail: "索引设置", documentation: "查看当前索引设置。", insertText: "_settings" },
  { label: "_refresh", detail: "刷新索引", documentation: "刷新当前索引。", insertText: "_refresh" },
  { label: "_doc", detail: "文档接口", documentation: "读取或写入单条文档。", insertText: "_doc/$1" },
  { label: "_bulk", detail: "索引 bulk", documentation: "对当前索引执行 bulk。", insertText: "_bulk" },
  { label: "_update_by_query", detail: "按查询更新", documentation: "对当前索引执行 update by query。", insertText: "_update_by_query" },
  { label: "_delete_by_query", detail: "按查询删除", documentation: "对当前索引执行 delete by query。", insertText: "_delete_by_query" },
];

export const CAT_API_SEGMENTS: ReadonlyArray<ApiSegment> = [
  { label: "indices", detail: "索引列表", documentation: "列出索引。", insertText: "indices?v=true" },
  { label: "aliases", detail: "别名列表", documentation: "列出 alias。", insertText: "aliases?v=true" },
  { label: "nodes", detail: "节点列表", documentation: "列出节点。", insertText: "nodes?v=true" },
  { label: "health", detail: "集群健康", documentation: "显示集群健康摘要。", insertText: "health?v=true" },
  { label: "shards", detail: "分片列表", documentation: "列出分片。", insertText: "shards?v=true" },
];

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] as const;

export const ROOT_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  {
    label: "query",
    detail: "查询入口",
    documentation: "DSL 查询入口。",
    insertText: '"query": {\n\t$0\n}',
    kind: "property",
    sortText: "000-query",
  },
  {
    label: "size",
    detail: "返回条数",
    documentation: "控制返回文档数量。",
    insertText: '"size": $0',
    kind: "property",
    sortText: "010-size",
  },
  {
    label: "from",
    detail: "分页偏移",
    documentation: "分页起始偏移量。",
    insertText: '"from": $0',
    kind: "property",
    sortText: "011-from",
  },
  {
    label: "_source",
    detail: "源字段",
    documentation: "控制返回的 source 字段。",
    insertText: '"_source": [\n\t"$0"\n]',
    kind: "property",
    sortText: "012-_source",
  },
  {
    label: "sort",
    detail: "排序",
    documentation: "排序配置。",
    insertText: '"sort": [\n\t{\n\t\t"$1": {\n\t\t\t"order": "desc"\n\t\t}\n\t}\n]',
    kind: "property",
    sortText: "013-sort",
  },
  {
    label: "search_after",
    detail: "深分页游标",
    documentation: "配合 sort 使用上一页最后一条 hit.sort 值继续分页。",
    insertText: '"search_after": [\n\t$0\n]',
    kind: "property",
    sortText: "014-search_after",
  },
  {
    label: "aggs",
    detail: "聚合入口",
    documentation: "聚合配置入口。",
    insertText: '"aggs": {\n\t"${1:agg_name}": {\n\t\t$0\n\t}\n}',
    kind: "property",
    sortText: "020-aggs",
  },
  propertySnippet(
    "post_filter",
    "后置过滤",
    "在聚合计算后过滤搜索命中。",
    '"post_filter": {\n\t$0\n}',
    "021-post_filter",
  ),
  {
    label: "highlight",
    detail: "高亮",
    documentation: "高亮配置。",
    insertText: '"highlight": {\n\t"fields": {\n\t\t"${1:field}": {}\n\t}\n}',
    kind: "property",
    sortText: "030-highlight",
  },
  {
    label: "collapse",
    detail: "字段折叠",
    documentation: "字段折叠配置。",
    insertText: '"collapse": {\n\t"field": "$0"\n}',
    kind: "property",
    sortText: "031-collapse",
  },
  propertySnippet(
    "fields",
    "返回字段",
    "返回 runtime fields 或 mapping 字段。",
    '"fields": [\n\t"$0"\n]',
    "032-fields",
  ),
  propertySnippet(
    "docvalue_fields",
    "Doc values 字段",
    "从 doc values 返回字段值。",
    '"docvalue_fields": [\n\t"$0"\n]',
    "033-docvalue_fields",
  ),
  propertySnippet(
    "stored_fields",
    "Stored fields",
    "返回显式 stored 的字段。",
    '"stored_fields": [\n\t"$0"\n]',
    "034-stored_fields",
  ),
  propertySnippet(
    "script_fields",
    "脚本字段",
    "在响应中返回脚本计算字段。",
    '"script_fields": {\n\t"${1:computed_field}": {\n\t\t"script": {\n\t\t\t"source": "$0"\n\t\t}\n\t}\n}',
    "035-script_fields",
  ),
  propertySnippet(
    "runtime_mappings",
    "运行时字段",
    "为当前搜索请求定义 runtime fields。",
    '"runtime_mappings": {\n\t"${1:field_name}": {\n\t\t"type": "${2:keyword}",\n\t\t"script": {\n\t\t\t"source": "$0"\n\t\t}\n\t}\n}',
    "036-runtime_mappings",
  ),
  {
    label: "track_total_hits",
    detail: "精确总数",
    documentation: "控制是否精确返回 total hits。",
    insertText: '"track_total_hits": ${1:true}',
    kind: "property",
    sortText: "040-track_total_hits",
  },
  propertySnippet("min_score", "最低分数", "过滤低于指定 _score 的命中。", '"min_score": ${1:0.1}', "041-min_score"),
  propertySnippet("terminate_after", "提前终止", "每个分片收集到指定文档数后提前终止。", '"terminate_after": ${1:10000}', "042-terminate_after"),
  propertySnippet("track_scores", "跟踪分数", "排序时仍计算并跟踪 _score。", '"track_scores": ${1:true}', "043-track_scores"),
  propertySnippet("profile", "性能分析", "开启搜索 profile 输出。", '"profile": ${1:true}', "044-profile"),
  propertySnippet("explain", "评分解释", "为每条命中返回评分解释。", '"explain": ${1:true}', "045-explain"),
  propertySnippet("version", "返回版本", "为命中文档返回版本号。", '"version": ${1:true}', "046-version"),
  propertySnippet("seq_no_primary_term", "返回序列号", "返回 seq_no 和 primary_term。", '"seq_no_primary_term": ${1:true}', "047-seq_no_primary_term"),
  propertySnippet(
    "pit",
    "Point in time",
    "使用 point in time 上下文搜索。",
    '"pit": {\n\t"id": "$1",\n\t"keep_alive": "${2:1m}"\n}',
    "048-pit",
  ),
  propertySnippet(
    "knn",
    "Elasticsearch 向量搜索",
    "在 Elasticsearch 搜索请求体中执行 kNN 向量检索。",
    '"knn": {\n\t"field": "$1",\n\t"query_vector": [\n\t\t$2\n\t],\n\t"k": ${3:10},\n\t"num_candidates": ${4:100}\n}',
    "049-knn",
    { products: ["elasticsearch"], minMajor: 8 },
  ),
];

export const CREATE_INDEX_ROOT_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("settings", "索引设置", "配置索引 settings。", '"settings": {\n\t$0\n}', "000-settings"),
  propertySnippet("mappings", "索引映射", "配置索引 mappings。", '"mappings": {\n\t$0\n}', "001-mappings"),
  propertySnippet("aliases", "索引别名", "配置索引 aliases。", '"aliases": {\n\t$0\n}', "002-aliases"),
];

export const COUNT_ROOT_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("query", "计数查询", "配置 Count API 查询。", '"query": {\n\t$0\n}', "000-query"),
  propertySnippet(
    "runtime_mappings",
    "运行时映射",
    "配置 Count API 运行时字段。",
    '"runtime_mappings": {\n\t$0\n}',
    "001-runtime-mappings",
  ),
];

export const SCROLL_ROOT_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("scroll", "滚动保留时间", "延长 Scroll 上下文。", '"scroll": "${1:1m}"', "000-scroll"),
  propertySnippet("scroll_id", "Scroll ID", "指定 Scroll 上下文。", '"scroll_id": "${1:id}"', "001-scroll-id"),
];

export const UPDATE_ROOT_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("doc", "局部文档", "提供需要合并的字段。", '"doc": {\n\t$0\n}', "000-doc"),
  propertySnippet("script", "更新脚本", "使用脚本更新文档。", '"script": {\n\t"source": "$0"\n}', "001-script"),
  propertySnippet("upsert", "不存在时写入", "提供 upsert 文档。", '"upsert": {\n\t$0\n}', "002-upsert"),
  propertySnippet("doc_as_upsert", "将 doc 用作 upsert", "文档不存在时使用 doc。", '"doc_as_upsert": ${1:true}', "003-doc-as-upsert"),
  propertySnippet("scripted_upsert", "脚本处理 upsert", "文档不存在时仍执行更新脚本。", '"scripted_upsert": ${1:true}', "004-scripted-upsert"),
  propertySnippet("detect_noop", "检测无变化更新", "字段未变化时跳过写入。", '"detect_noop": ${1:true}', "005-detect-noop"),
  propertySnippet("_source", "返回源字段", "控制更新响应中的 _source。", '"_source": ${1:true}', "006-source"),
];

function lineSnippet(
  label: string,
  detail: string,
  insertText: string,
  sortText: string,
): RawSnippet {
  return {
    label,
    detail,
    documentation: detail,
    insertText,
    kind: "keyword",
    sortText,
  };
}

export const BULK_ACTION_SNIPPETS: ReadonlyArray<RawSnippet> = [
  lineSnippet("index", "Bulk index 动作", '{"index":{"_index":"${1:index}","_id":"${2:id}"}}', "000-index"),
  lineSnippet("create", "Bulk create 动作", '{"create":{"_index":"${1:index}","_id":"${2:id}"}}', "001-create"),
  lineSnippet("update", "Bulk update 动作", '{"update":{"_index":"${1:index}","_id":"${2:id}"}}', "002-update"),
  lineSnippet("delete", "Bulk delete 动作", '{"delete":{"_index":"${1:index}","_id":"${2:id}"}}', "003-delete"),
];

export const MSEARCH_HEADER_SNIPPETS: ReadonlyArray<RawSnippet> = [
  lineSnippet("index", "MSearch 索引标头", '{"index":"${1:index}"}', "000-index"),
  lineSnippet("routing", "MSearch routing 标头", '{"routing":"${1:routing}"}', "001-routing"),
  lineSnippet("preference", "MSearch preference 标头", '{"preference":"${1:_local}"}', "002-preference"),
  lineSnippet("search_type", "MSearch 搜索类型标头", '{"search_type":"${1:query_then_fetch}"}', "003-search-type"),
  lineSnippet("request_cache", "MSearch 请求缓存标头", '{"request_cache":${1:true}}', "004-request-cache"),
  lineSnippet("empty header", "MSearch 空标头", "{}", "005-empty"),
];

const FULL_TEXT_QUERY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("match", "全文匹配", "match 查询。", '"match": {\n\t"${1:field}": "$0"\n}', "010-match"),
  propertySnippet("match_bool_prefix", "布尔前缀匹配", "将最后一个词作为 prefix 查询的 match 变体。", '"match_bool_prefix": {\n\t"${1:field}": "$0"\n}', "011-match_bool_prefix"),
  propertySnippet("match_phrase", "短语匹配", "match_phrase 查询。", '"match_phrase": {\n\t"${1:field}": "$0"\n}', "012-match_phrase"),
  propertySnippet("match_phrase_prefix", "短语前缀匹配", "match_phrase_prefix 查询。", '"match_phrase_prefix": {\n\t"${1:field}": "$0"\n}', "013-match_phrase_prefix"),
  propertySnippet("multi_match", "多字段匹配", "multi_match 查询。", '"multi_match": {\n\t"query": "$1",\n\t"fields": [\n\t\t"${2:field}"\n\t]\n}', "014-multi_match"),
  propertySnippet("combined_fields", "组合字段匹配", "combined_fields 查询。", '"combined_fields": {\n\t"query": "$1",\n\t"fields": [\n\t\t"${2:field}"\n\t]\n}', "015-combined_fields"),
  propertySnippet("query_string", "Lucene 语法", "query_string 查询。", '"query_string": {\n\t"query": "$0"\n}', "016-query_string"),
  propertySnippet("simple_query_string", "简易查询字符串", "simple_query_string 查询。", '"simple_query_string": {\n\t"query": "$1",\n\t"fields": [\n\t\t"${2:field}"\n\t]\n}', "017-simple_query_string"),
  propertySnippet("intervals", "Intervals 查询", "按词项顺序和距离匹配文本。", '"intervals": {\n\t"${1:field}": {\n\t\t"match": {\n\t\t\t"query": "$0"\n\t\t}\n\t}\n}', "018-intervals"),
];

const TERM_LEVEL_QUERY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("term", "精确匹配", "term 查询。", '"term": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}', "030-term"),
  propertySnippet("terms", "多值匹配", "terms 查询。", '"terms": {\n\t"${1:field}": [\n\t\t"$0"\n\t]\n}', "031-terms"),
  propertySnippet("terms_set", "多值集合匹配", "terms_set 查询。", '"terms_set": {\n\t"${1:field}": {\n\t\t"terms": [\n\t\t\t"$2"\n\t\t],\n\t\t"minimum_should_match_script": {\n\t\t\t"source": "$0"\n\t\t}\n\t}\n}', "032-terms_set"),
  propertySnippet("range", "范围查询", "range 查询。", '"range": {\n\t"${1:field}": {\n\t\t"gte": $2,\n\t\t"lte": $0\n\t}\n}', "033-range"),
  propertySnippet("exists", "字段存在", "exists 查询。", '"exists": {\n\t"field": "$0"\n}', "034-exists"),
  propertySnippet("ids", "按 ID 查询", "ids 查询。", '"ids": {\n\t"values": [\n\t\t"$0"\n\t]\n}', "035-ids"),
  propertySnippet("prefix", "前缀查询", "prefix 查询。", '"prefix": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}', "036-prefix"),
  propertySnippet("wildcard", "通配符查询", "wildcard 查询。", '"wildcard": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}', "037-wildcard"),
  propertySnippet("regexp", "正则查询", "regexp 查询。", '"regexp": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}', "038-regexp"),
  propertySnippet("fuzzy", "模糊查询", "fuzzy 查询。", '"fuzzy": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}', "039-fuzzy"),
];

const COMPOUND_QUERY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("bool", "布尔查询", "布尔查询，支持 must / should / filter / must_not。", '"bool": {\n\t$0\n}', "001-bool"),
  propertySnippet("boosting", "Boosting 查询", "降低 negative 查询匹配文档的相关性。", '"boosting": {\n\t"positive": {\n\t\t$1\n\t},\n\t"negative": {\n\t\t$2\n\t},\n\t"negative_boost": ${3:0.5}\n}', "050-boosting"),
  propertySnippet("constant_score", "常量评分", "用固定分数包装 filter 查询。", '"constant_score": {\n\t"filter": {\n\t\t$0\n\t}\n}', "051-constant_score"),
  propertySnippet("dis_max", "Disjunction max", "取多个查询中的最佳评分。", '"dis_max": {\n\t"queries": [\n\t\t{\n\t\t\t$0\n\t\t}\n\t],\n\t"tie_breaker": ${1:0.0}\n}', "052-dis_max"),
  propertySnippet("function_score", "函数评分", "用函数修改查询评分。", '"function_score": {\n\t"query": {\n\t\t$1\n\t},\n\t"functions": [\n\t\t{\n\t\t\t"weight": ${2:1}\n\t\t}\n\t],\n\t"boost_mode": "${3:multiply}"\n}', "053-function_score"),
];

const GEO_QUERY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("geo_distance", "地理距离查询", "按地理点距离过滤。", '"geo_distance": {\n\t"distance": "${1:10km}",\n\t"${2:location}": "$0"\n}', "060-geo_distance"),
  propertySnippet("geo_bounding_box", "地理边界框查询", "按地理边界框过滤。", '"geo_bounding_box": {\n\t"${1:location}": {\n\t\t"top_left": "$2",\n\t\t"bottom_right": "$0"\n\t}\n}', "061-geo_bounding_box"),
  propertySnippet("geo_polygon", "地理多边形查询", "按地理多边形过滤。", '"geo_polygon": {\n\t"${1:location}": {\n\t\t"points": [\n\t\t\t"$0"\n\t\t]\n\t}\n}', "062-geo_polygon"),
  propertySnippet("geo_shape", "地理形状查询", "按 geo_shape 字段过滤。", '"geo_shape": {\n\t"${1:field}": {\n\t\t"shape": {\n\t\t\t"type": "${2:envelope}",\n\t\t\t"coordinates": [\n\t\t\t\t$0\n\t\t\t]\n\t\t},\n\t\t"relation": "${3:intersects}"\n\t}\n}', "063-geo_shape"),
  propertySnippet("shape", "形状查询", "按 shape 字段过滤。", '"shape": {\n\t"${1:field}": {\n\t\t"shape": {\n\t\t\t"type": "${2:envelope}",\n\t\t\t"coordinates": [\n\t\t\t\t$0\n\t\t\t]\n\t\t},\n\t\t"relation": "${3:intersects}"\n\t}\n}', "064-shape"),
];

const JOINING_QUERY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("nested", "嵌套查询", "nested 查询。", '"nested": {\n\t"path": "$1",\n\t"query": {\n\t\t$0\n\t}\n}', "070-nested"),
  propertySnippet("has_child", "子文档查询", "匹配拥有子文档命中的父文档。", '"has_child": {\n\t"type": "$1",\n\t"query": {\n\t\t$0\n\t}\n}', "071-has_child"),
  propertySnippet("has_parent", "父文档查询", "匹配父文档命中的子文档。", '"has_parent": {\n\t"parent_type": "$1",\n\t"query": {\n\t\t$0\n\t}\n}', "072-has_parent"),
  propertySnippet("parent_id", "父 ID 查询", "按父文档 ID 查询子文档。", '"parent_id": {\n\t"type": "$1",\n\t"id": "$0"\n}', "073-parent_id"),
];

const SPAN_QUERY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("span_term", "Span term", "低层级位置敏感词项查询。", '"span_term": {\n\t"${1:field}": "$0"\n}', "080-span_term"),
  propertySnippet("span_near", "Span near", "按词项距离和顺序匹配。", '"span_near": {\n\t"clauses": [\n\t\t{\n\t\t\t"span_term": {\n\t\t\t\t"${1:field}": "$2"\n\t\t\t}\n\t\t}\n\t],\n\t"slop": ${3:1},\n\t"in_order": ${4:true}\n}', "081-span_near"),
  propertySnippet("span_or", "Span or", "匹配任一 span 子句。", '"span_or": {\n\t"clauses": [\n\t\t{\n\t\t\t$0\n\t\t}\n\t]\n}', "082-span_or"),
  propertySnippet("span_not", "Span not", "排除指定 span 子句。", '"span_not": {\n\t"include": {\n\t\t$1\n\t},\n\t"exclude": {\n\t\t$0\n\t}\n}', "083-span_not"),
  propertySnippet("span_first", "Span first", "限制 span 匹配必须出现在字段开头区域。", '"span_first": {\n\t"match": {\n\t\t$1\n\t},\n\t"end": ${2:3}\n}', "084-span_first"),
  propertySnippet("span_multi", "Span multi-term", "包装 multi-term 查询供 span 使用。", '"span_multi": {\n\t"match": {\n\t\t$0\n\t}\n}', "085-span_multi"),
  propertySnippet("span_containing", "Span containing", "匹配包含 little span 的 big span。", '"span_containing": {\n\t"big": {\n\t\t$1\n\t},\n\t"little": {\n\t\t$0\n\t}\n}', "086-span_containing"),
  propertySnippet("span_within", "Span within", "匹配位于 big span 内的 little span。", '"span_within": {\n\t"little": {\n\t\t$1\n\t},\n\t"big": {\n\t\t$0\n\t}\n}', "087-span_within"),
  propertySnippet("span_field_masking", "Span field masking", "让不同字段的 span 查询可组合。", '"span_field_masking": {\n\t"query": {\n\t\t$1\n\t},\n\t"field": "$0"\n}', "088-span_field_masking"),
];

export const SPAN_QUERY_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = SPAN_QUERY_SNIPPETS;

const SPECIALIZED_QUERY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  propertySnippet("script", "脚本查询", "用脚本判断文档是否匹配。", '"script": {\n\t"script": {\n\t\t"source": "$0"\n\t}\n}', "090-script"),
  propertySnippet("script_score", "脚本评分", "用脚本修改查询评分。", '"script_score": {\n\t"query": {\n\t\t$1\n\t},\n\t"script": {\n\t\t"source": "$0"\n\t}\n}', "091-script_score"),
  propertySnippet("more_like_this", "相似文档查询", "查找与给定文本或文档相似的文档。", '"more_like_this": {\n\t"fields": [\n\t\t"${1:field}"\n\t],\n\t"like": "$0"\n}', "092-more_like_this"),
  propertySnippet("distance_feature", "距离特征查询", "按日期或地理距离提升靠近 origin 的文档。", '"distance_feature": {\n\t"field": "$1",\n\t"origin": "$2",\n\t"pivot": "${3:7d}"\n}', "093-distance_feature"),
  propertySnippet("rank_feature", "排名特征查询", "按 rank_feature 字段提升文档。", '"rank_feature": {\n\t"field": "$0"\n}', "094-rank_feature"),
  propertySnippet("pinned", "置顶查询", "将指定文档固定在结果顶部。", '"pinned": {\n\t"ids": [\n\t\t"$1"\n\t],\n\t"organic": {\n\t\t$0\n\t}\n}', "095-pinned"),
  propertySnippet("wrapper", "Wrapper 查询", "使用 base64 编码查询。", '"wrapper": {\n\t"query": "$0"\n}', "096-wrapper"),
  propertySnippet(
    "knn",
    "Elasticsearch kNN 查询",
    "执行 Elasticsearch 向量相似度查询。",
    '"knn": {\n\t"field": "${1:field}",\n\t"query_vector": [${2:0.0}],\n\t"k": ${3:10},\n\t"num_candidates": ${4:100}\n}',
    "097-knn-elasticsearch",
    { products: ["elasticsearch"], minVersion: [8, 12] },
  ),
  propertySnippet(
    "knn",
    "OpenSearch k-NN 查询",
    "执行 OpenSearch k-NN 向量相似度查询。",
    '"knn": {\n\t"${1:field}": {\n\t\t"vector": [${2:0.0}],\n\t\t"k": ${3:10}\n\t}\n}',
    "097-knn-opensearch",
    { products: ["opensearch"], minMajor: 1 },
  ),
  propertySnippet(
    "semantic",
    "语义查询",
    "对 semantic_text 字段执行语义查询。",
    '"semantic": {\n\t"field": "$1",\n\t"query": "$0"\n}',
    "098-semantic",
    { products: ["elasticsearch"], minVersion: [8, 15] },
  ),
  propertySnippet(
    "sparse_vector",
    "稀疏向量查询",
    "执行 sparse_vector 查询。",
    '"sparse_vector": {\n\t"field": "$1",\n\t"inference_id": "$2",\n\t"query": "$0"\n}',
    "099-sparse_vector",
    { products: ["elasticsearch"], minVersion: [8, 15] },
  ),
];

export const QUERY_LEAF_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  ...COMPOUND_QUERY_SNIPPETS,
  propertySnippet("match_all", "匹配全部", "match_all 查询。", '"match_all": {}', "002-match_all"),
  ...FULL_TEXT_QUERY_SNIPPETS,
  ...TERM_LEVEL_QUERY_SNIPPETS,
  ...GEO_QUERY_SNIPPETS,
  ...JOINING_QUERY_SNIPPETS,
  ...SPAN_QUERY_SNIPPETS,
  ...SPECIALIZED_QUERY_SNIPPETS,
  propertySnippet(
    "type",
    "类型查询",
    "Elasticsearch 7 的类型查询兼容语法，Elasticsearch 8 起不再建议使用。",
    '"type": {\n\t"value": "${1:_doc}"\n}',
    "990-type",
    { products: ["elasticsearch"], minMajor: 7, maxMajor: 7 },
  ),
];

export const MULTI_TERM_QUERY_PROPERTY_SNIPPETS = QUERY_LEAF_PROPERTY_SNIPPETS.filter((snippet) =>
  ["fuzzy", "prefix", "range", "regexp", "wildcard"].includes(snippet.label)
);

export const BOOL_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  {
    label: "must",
    detail: "必须匹配",
    documentation: "布尔查询中的 must 条件。",
    insertText: '"must": [\n\t{\n\t\t$0\n\t}\n]',
    kind: "property",
    sortText: "001-must",
  },
  {
    label: "should",
    detail: "应该匹配",
    documentation: "布尔查询中的 should 条件。",
    insertText: '"should": [\n\t{\n\t\t$0\n\t}\n]',
    kind: "property",
    sortText: "002-should",
  },
  {
    label: "filter",
    detail: "过滤条件",
    documentation: "布尔查询中的 filter 条件。",
    insertText: '"filter": [\n\t{\n\t\t$0\n\t}\n]',
    kind: "property",
    sortText: "003-filter",
  },
  {
    label: "must_not",
    detail: "排除条件",
    documentation: "布尔查询中的 must_not 条件。",
    insertText: '"must_not": [\n\t{\n\t\t$0\n\t}\n]',
    kind: "property",
    sortText: "004-must_not",
  },
  {
    label: "minimum_should_match",
    detail: "最少满足",
    documentation: "bool 查询 should 最少满足条件数。",
    insertText: '"minimum_should_match": ${1:1}',
    kind: "property",
    sortText: "005-minimum_should_match",
  },
  {
    label: "boost",
    detail: "权重",
    documentation: "bool 查询的打分权重。",
    insertText: '"boost": ${1:1.0}',
    kind: "property",
    sortText: "006-boost",
  },
];

export const AGG_TYPE_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  {
    label: "terms",
    detail: "terms 聚合",
    documentation: "按字段分桶。",
    insertText: '"terms": {\n\t"field": "$0"\n}',
    kind: "property",
    sortText: "001-terms",
  },
  {
    label: "date_histogram",
    detail: "日期直方图",
    documentation: "按日期区间分桶。",
    insertText: '"date_histogram": {\n\t"field": "$1",\n\t"calendar_interval": "${2:day}"\n}',
    kind: "property",
    sortText: "002-date_histogram",
  },
  {
    label: "histogram",
    detail: "直方图",
    documentation: "按数值区间分桶。",
    insertText: '"histogram": {\n\t"field": "$1",\n\t"interval": ${2:10}\n}',
    kind: "property",
    sortText: "003-histogram",
  },
  {
    label: "range",
    detail: "范围聚合",
    documentation: "按字段范围分桶。",
    insertText: '"range": {\n\t"field": "$1",\n\t"ranges": [\n\t\t{ "to": $2 },\n\t\t{ "from": $3, "to": $4 },\n\t\t{ "from": $5 }\n\t]\n}',
    kind: "property",
    sortText: "004-range",
  },
  {
    label: "filters",
    detail: "filters 聚合",
    documentation: "按一组过滤器分桶。",
    insertText: '"filters": {\n\t"filters": {\n\t\t"${1:bucket}": { $0 }\n\t}\n}',
    kind: "property",
    sortText: "005-filters",
  },
  propertySnippet(
    "filter",
    "filter 聚合",
    "按单个 Query DSL 过滤器分桶。",
    '"filter": {\n\t$0\n}',
    "006-filter",
  ),
  propertySnippet(
    "nested",
    "nested 聚合",
    "进入 nested 字段路径执行子聚合。",
    '"nested": {\n\t"path": "$0"\n}',
    "007-nested",
  ),
  propertySnippet(
    "reverse_nested",
    "reverse nested 聚合",
    "从 nested 聚合返回父文档层级。",
    '"reverse_nested": {}',
    "008-reverse_nested",
  ),
  propertySnippet(
    "global",
    "global 聚合",
    "在当前搜索上下文中忽略 query 进行全局聚合。",
    '"global": {}',
    "009-global",
  ),
  {
    label: "cardinality",
    detail: "基数",
    documentation: "字段基数聚合。",
    insertText: '"cardinality": {\n\t"field": "$0"\n}',
    kind: "property",
    sortText: "010-cardinality",
  },
  {
    label: "avg",
    detail: "平均值",
    documentation: "字段平均值聚合。",
    insertText: '"avg": {\n\t"field": "$0"\n}',
    kind: "property",
    sortText: "011-avg",
  },
  {
    label: "sum",
    detail: "求和",
    documentation: "字段求和聚合。",
    insertText: '"sum": {\n\t"field": "$0"\n}',
    kind: "property",
    sortText: "012-sum",
  },
  {
    label: "max",
    detail: "最大值",
    documentation: "字段最大值聚合。",
    insertText: '"max": {\n\t"field": "$0"\n}',
    kind: "property",
    sortText: "013-max",
  },
  {
    label: "min",
    detail: "最小值",
    documentation: "字段最小值聚合。",
    insertText: '"min": {\n\t"field": "$0"\n}',
    kind: "property",
    sortText: "014-min",
  },
  {
    label: "value_count",
    detail: "字段计数",
    documentation: "字段值数量聚合。",
    insertText: '"value_count": {\n\t"field": "$0"\n}',
    kind: "property",
    sortText: "015-value_count",
  },
  {
    label: "stats",
    detail: "统计",
    documentation: "字段基础统计聚合。",
    insertText: '"stats": {\n\t"field": "$0"\n}',
    kind: "property",
    sortText: "016-stats",
  },
  propertySnippet(
    "extended_stats",
    "扩展统计",
    "字段扩展统计聚合。",
    '"extended_stats": {\n\t"field": "$0"\n}',
    "017-extended_stats",
  ),
  propertySnippet(
    "percentiles",
    "百分位",
    "字段百分位聚合。",
    '"percentiles": {\n\t"field": "$0"\n}',
    "018-percentiles",
  ),
  propertySnippet(
    "percentile_ranks",
    "百分位排名",
    "字段 percentile ranks 聚合。",
    '"percentile_ranks": {\n\t"field": "$1",\n\t"values": [\n\t\t$0\n\t]\n}',
    "019-percentile_ranks",
  ),
  propertySnippet(
    "weighted_avg",
    "加权平均",
    "字段加权平均聚合。",
    '"weighted_avg": {\n\t"value": {\n\t\t"field": "$1"\n\t},\n\t"weight": {\n\t\t"field": "$0"\n\t}\n}',
    "020-weighted_avg",
  ),
  propertySnippet(
    "top_hits",
    "Top hits",
    "返回每个桶内的代表性命中。",
    '"top_hits": {\n\t"size": ${1:3}\n}',
    "021-top_hits",
  ),
  propertySnippet(
    "top_metrics",
    "Top metrics",
    "返回排序后文档上的指定指标字段。",
    '"top_metrics": {\n\t"metrics": {\n\t\t"field": "$1"\n\t},\n\t"sort": {\n\t\t"${2:field}": "${3:desc}"\n\t}\n}',
    "022-top_metrics",
  ),
  propertySnippet(
    "median_absolute_deviation",
    "中位绝对偏差",
    "字段 median absolute deviation 聚合。",
    '"median_absolute_deviation": {\n\t"field": "$0"\n}',
    "023-median_absolute_deviation",
  ),
  propertySnippet(
    "missing",
    "missing 聚合",
    "按缺失指定字段的文档分桶。",
    '"missing": {\n\t"field": "$0"\n}',
    "024-missing",
  ),
  propertySnippet(
    "significant_terms",
    "显著词项",
    "查找与背景集相比显著的词项。",
    '"significant_terms": {\n\t"field": "$0"\n}',
    "025-significant_terms",
  ),
  propertySnippet(
    "composite",
    "Composite 聚合",
    "组合多个 source 进行分页分桶。",
    '"composite": {\n\t"sources": [\n\t\t{\n\t\t\t"${1:name}": {\n\t\t\t\t"terms": {\n\t\t\t\t\t"field": "$0"\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t]\n}',
    "026-composite",
  ),
  propertySnippet(
    "sampler",
    "Sampler 聚合",
    "在每个分片抽样文档后执行子聚合。",
    '"sampler": {\n\t"shard_size": ${1:100}\n}',
    "027-sampler",
  ),
  propertySnippet(
    "bucket_script",
    "Bucket script",
    "用脚本计算 pipeline 聚合结果。",
    '"bucket_script": {\n\t"buckets_path": {\n\t\t"${1:metric}": "$2"\n\t},\n\t"script": "$0"\n}',
    "080-bucket_script",
  ),
  propertySnippet(
    "bucket_selector",
    "Bucket selector",
    "用脚本过滤 bucket。",
    '"bucket_selector": {\n\t"buckets_path": {\n\t\t"${1:metric}": "$2"\n\t},\n\t"script": "$0"\n}',
    "081-bucket_selector",
  ),
  propertySnippet(
    "bucket_sort",
    "Bucket sort",
    "对 bucket 进行排序和截断。",
    '"bucket_sort": {\n\t"sort": [\n\t\t{ "${1:_count}": { "order": "${2:desc}" } }\n\t],\n\t"size": ${3:10}\n}',
    "082-bucket_sort",
  ),
  propertySnippet(
    "derivative",
    "Derivative",
    "计算指标的一阶导数。",
    '"derivative": {\n\t"buckets_path": "$0"\n}',
    "083-derivative",
  ),
  propertySnippet(
    "moving_fn",
    "Moving function",
    "对窗口内指标执行移动函数。",
    '"moving_fn": {\n\t"buckets_path": "$1",\n\t"window": ${2:10},\n\t"script": "$0"\n}',
    "084-moving_fn",
  ),
  propertySnippet(
    "cumulative_sum",
    "Cumulative sum",
    "计算指标累计和。",
    '"cumulative_sum": {\n\t"buckets_path": "$0"\n}',
    "085-cumulative_sum",
  ),
  {
    label: "aggs",
    detail: "子聚合",
    documentation: "子聚合（嵌套）。",
    insertText: '"aggs": {\n\t"${1:sub_agg_name}": {\n\t\t$0\n\t}\n}',
    kind: "property",
    sortText: "100-aggs",
  },
];

const AGG_FIELD_PROPERTY_SNIPPET: RawSnippet = {
  label: "field",
  detail: "聚合字段",
  documentation: "聚合使用的字段。",
  insertText: '"field": "$0"',
  kind: "property",
  sortText: "001-field",
};

const AGG_MISSING_PROPERTY_SNIPPET: RawSnippet = {
  label: "missing",
  detail: "缺失值",
  documentation: "字段缺失时使用的替代值。",
  insertText: '"missing": "$0"',
  kind: "property",
  sortText: "090-missing",
};

const METRIC_AGG_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  AGG_FIELD_PROPERTY_SNIPPET,
  AGG_MISSING_PROPERTY_SNIPPET,
];

export const AGG_PROPERTY_SNIPPETS_BY_TYPE: Readonly<Record<string, ReadonlyArray<RawSnippet>>> = {
  terms: [
    AGG_FIELD_PROPERTY_SNIPPET,
    {
      label: "size",
      detail: "分桶数量",
      documentation: "控制 terms 聚合返回的分桶数量。",
      insertText: '"size": ${1:10}',
      kind: "property",
      sortText: "002-size",
    },
    {
      label: "shard_size",
      detail: "分片候选数",
      documentation: "控制每个分片返回的候选分桶数量。",
      insertText: '"shard_size": ${1:100}',
      kind: "property",
      sortText: "003-shard_size",
    },
    {
      label: "order",
      detail: "分桶排序",
      documentation: "控制 terms 聚合分桶排序。",
      insertText: '"order": {\n\t"_count": "${1:desc}"\n}',
      kind: "property",
      sortText: "004-order",
    },
    {
      label: "min_doc_count",
      detail: "最小文档数",
      documentation: "过滤文档数低于阈值的分桶。",
      insertText: '"min_doc_count": ${1:1}',
      kind: "property",
      sortText: "005-min_doc_count",
    },
    AGG_MISSING_PROPERTY_SNIPPET,
  ],
  date_histogram: [
    AGG_FIELD_PROPERTY_SNIPPET,
    {
      label: "calendar_interval",
      detail: "日历间隔",
      documentation: "按日历单位设置日期直方图间隔。",
      insertText: '"calendar_interval": "${1:day}"',
      kind: "property",
      sortText: "002-calendar_interval",
    },
    {
      label: "fixed_interval",
      detail: "固定间隔",
      documentation: "按固定时长设置日期直方图间隔。",
      insertText: '"fixed_interval": "${1:1h}"',
      kind: "property",
      sortText: "003-fixed_interval",
    },
    {
      label: "format",
      detail: "日期格式",
      documentation: "设置日期分桶 key 的格式。",
      insertText: '"format": "${1:yyyy-MM-dd}"',
      kind: "property",
      sortText: "004-format",
    },
    {
      label: "time_zone",
      detail: "时区",
      documentation: "设置日期直方图使用的时区。",
      insertText: '"time_zone": "${1:+08:00}"',
      kind: "property",
      sortText: "005-time_zone",
    },
    {
      label: "min_doc_count",
      detail: "最小文档数",
      documentation: "过滤文档数低于阈值的日期分桶。",
      insertText: '"min_doc_count": ${1:0}',
      kind: "property",
      sortText: "006-min_doc_count",
    },
    {
      label: "extended_bounds",
      detail: "扩展边界",
      documentation: "指定日期直方图输出的最小和最大边界。",
      insertText: '"extended_bounds": {\n\t"min": "$1",\n\t"max": "$0"\n}',
      kind: "property",
      sortText: "007-extended_bounds",
    },
    AGG_MISSING_PROPERTY_SNIPPET,
  ],
  histogram: [
    AGG_FIELD_PROPERTY_SNIPPET,
    {
      label: "interval",
      detail: "数值间隔",
      documentation: "设置直方图分桶间隔。",
      insertText: '"interval": ${1:10}',
      kind: "property",
      sortText: "002-interval",
    },
    {
      label: "min_doc_count",
      detail: "最小文档数",
      documentation: "过滤文档数低于阈值的直方图分桶。",
      insertText: '"min_doc_count": ${1:0}',
      kind: "property",
      sortText: "003-min_doc_count",
    },
    {
      label: "extended_bounds",
      detail: "扩展边界",
      documentation: "指定直方图输出的最小和最大边界。",
      insertText: '"extended_bounds": {\n\t"min": $1,\n\t"max": $0\n}',
      kind: "property",
      sortText: "004-extended_bounds",
    },
    AGG_MISSING_PROPERTY_SNIPPET,
  ],
  range: [
    AGG_FIELD_PROPERTY_SNIPPET,
    {
      label: "ranges",
      detail: "范围列表",
      documentation: "设置 range 聚合的分桶范围。",
      insertText: '"ranges": [\n\t{ "to": $1 },\n\t{ "from": $2, "to": $3 },\n\t{ "from": $0 }\n]',
      kind: "property",
      sortText: "002-ranges",
    },
    {
      label: "keyed",
      detail: "键值响应",
      documentation: "控制分桶结果是否以对象形式返回。",
      insertText: '"keyed": ${1:true}',
      kind: "property",
      sortText: "003-keyed",
    },
    AGG_MISSING_PROPERTY_SNIPPET,
  ],
  filters: [
    {
      label: "filters",
      detail: "过滤器集合",
      documentation: "设置 filters 聚合的过滤器集合。",
      insertText: '"filters": {\n\t"${1:bucket}": { $0 }\n}',
      kind: "property",
      sortText: "001-filters",
    },
    {
      label: "other_bucket",
      detail: "其他分桶",
      documentation: "控制是否返回未匹配任一过滤器的 other 分桶。",
      insertText: '"other_bucket": ${1:true}',
      kind: "property",
      sortText: "002-other_bucket",
    },
    {
      label: "other_bucket_key",
      detail: "其他分桶名称",
      documentation: "设置 other 分桶的 key。",
      insertText: '"other_bucket_key": "${1:other}"',
      kind: "property",
      sortText: "003-other_bucket_key",
    },
  ],
  cardinality: [
    AGG_FIELD_PROPERTY_SNIPPET,
    {
      label: "precision_threshold",
      detail: "精度阈值",
      documentation: "设置 cardinality 聚合的精度阈值。",
      insertText: '"precision_threshold": ${1:3000}',
      kind: "property",
      sortText: "002-precision_threshold",
    },
    AGG_MISSING_PROPERTY_SNIPPET,
  ],
  avg: METRIC_AGG_PROPERTY_SNIPPETS,
  sum: METRIC_AGG_PROPERTY_SNIPPETS,
  max: METRIC_AGG_PROPERTY_SNIPPETS,
  min: METRIC_AGG_PROPERTY_SNIPPETS,
  value_count: METRIC_AGG_PROPERTY_SNIPPETS,
  stats: METRIC_AGG_PROPERTY_SNIPPETS,
  extended_stats: METRIC_AGG_PROPERTY_SNIPPETS,
  percentiles: [
    AGG_FIELD_PROPERTY_SNIPPET,
    propertySnippet("percents", "百分位列表", "指定要返回的百分位。", '"percents": [\n\t${1:50},\n\t${2:95},\n\t${3:99}\n]', "002-percents"),
    AGG_MISSING_PROPERTY_SNIPPET,
  ],
  percentile_ranks: [
    AGG_FIELD_PROPERTY_SNIPPET,
    propertySnippet("values", "值列表", "指定要计算排名的值。", '"values": [\n\t$0\n]', "002-values"),
    AGG_MISSING_PROPERTY_SNIPPET,
  ],
  weighted_avg: [
    propertySnippet("value", "值字段", "设置加权平均的值字段。", '"value": {\n\t"field": "$0"\n}', "001-value"),
    propertySnippet("weight", "权重字段", "设置加权平均的权重字段。", '"weight": {\n\t"field": "$0"\n}', "002-weight"),
  ],
  top_hits: [
    propertySnippet("size", "命中数量", "top_hits 返回的命中数量。", '"size": ${1:3}', "001-size"),
    propertySnippet("sort", "命中排序", "top_hits 内部排序。", '"sort": [\n\t{\n\t\t"$1": {\n\t\t\t"order": "${2:desc}"\n\t\t}\n\t}\n]', "002-sort"),
    propertySnippet("_source", "源字段", "top_hits 返回的 source 字段。", '"_source": [\n\t"$0"\n]', "003-_source"),
  ],
  top_metrics: [
    propertySnippet("metrics", "指标字段", "设置 top_metrics 返回的指标字段。", '"metrics": {\n\t"field": "$0"\n}', "001-metrics"),
    propertySnippet("sort", "排序字段", "设置 top_metrics 选择文档的排序。", '"sort": {\n\t"$1": "${2:desc}"\n}', "002-sort"),
    propertySnippet("size", "返回数量", "设置 top_metrics 返回数量。", '"size": ${1:1}', "003-size"),
  ],
  median_absolute_deviation: METRIC_AGG_PROPERTY_SNIPPETS,
  filter: QUERY_LEAF_PROPERTY_SNIPPETS,
  nested: [
    propertySnippet("path", "嵌套路径", "nested 聚合路径。", '"path": "$0"', "001-path"),
  ],
  reverse_nested: [
    propertySnippet("path", "父级路径", "可选的 reverse_nested 目标路径。", '"path": "$0"', "001-path"),
  ],
  global: [],
  missing: [
    AGG_FIELD_PROPERTY_SNIPPET,
  ],
  significant_terms: [
    AGG_FIELD_PROPERTY_SNIPPET,
    propertySnippet("size", "分桶数量", "控制 significant_terms 返回的分桶数量。", '"size": ${1:10}', "002-size"),
  ],
  composite: [
    propertySnippet("sources", "来源列表", "设置 composite 聚合 sources。", '"sources": [\n\t{\n\t\t"${1:name}": {\n\t\t\t"terms": {\n\t\t\t\t"field": "$0"\n\t\t\t}\n\t\t}\n\t}\n]', "001-sources"),
    propertySnippet("size", "分页大小", "控制 composite 每页分桶数量。", '"size": ${1:100}', "002-size"),
    propertySnippet("after", "分页游标", "设置 composite after key。", '"after": {\n\t"${1:name}": "$0"\n}', "003-after"),
  ],
  sampler: [
    propertySnippet("shard_size", "分片采样数", "每个分片采样的文档数。", '"shard_size": ${1:100}', "001-shard_size"),
  ],
  bucket_script: [
    propertySnippet("buckets_path", "桶路径", "pipeline 聚合输入路径。", '"buckets_path": {\n\t"${1:metric}": "$2"\n}', "001-buckets_path"),
    propertySnippet("script", "脚本", "pipeline 聚合脚本。", '"script": "$0"', "002-script"),
  ],
  bucket_selector: [
    propertySnippet("buckets_path", "桶路径", "pipeline 聚合输入路径。", '"buckets_path": {\n\t"${1:metric}": "$2"\n}', "001-buckets_path"),
    propertySnippet("script", "脚本", "bucket_selector 过滤脚本。", '"script": "$0"', "002-script"),
  ],
  bucket_sort: [
    propertySnippet("sort", "排序", "设置 bucket 排序。", '"sort": [\n\t{ "${1:_count}": { "order": "${2:desc}" } }\n]', "001-sort"),
    propertySnippet("size", "返回数量", "返回的 bucket 数量。", '"size": ${1:10}', "002-size"),
    propertySnippet("from", "起始偏移", "bucket 起始偏移。", '"from": ${1:0}', "003-from"),
  ],
  derivative: [
    propertySnippet("buckets_path", "桶路径", "要计算导数的指标路径。", '"buckets_path": "$0"', "001-buckets_path"),
  ],
  moving_fn: [
    propertySnippet("buckets_path", "桶路径", "窗口函数输入指标路径。", '"buckets_path": "$1"', "001-buckets_path"),
    propertySnippet("window", "窗口大小", "移动窗口大小。", '"window": ${1:10}', "002-window"),
    propertySnippet("script", "脚本", "窗口函数脚本。", '"script": "$0"', "003-script"),
  ],
  cumulative_sum: [
    propertySnippet("buckets_path", "桶路径", "要累计求和的指标路径。", '"buckets_path": "$0"', "001-buckets_path"),
  ],
};

export const AGGS_CONTAINER_PROPERTY_SNIPPET: RawSnippet = {
  label: "<agg_name>",
  detail: "新建子聚合",
  documentation: "插入 <agg_name>: { terms: {...} } 结构。",
  insertText: '"${1:agg_name}": {\n\t"terms": {\n\t\t"field": "$0"\n\t}\n}',
  kind: "property",
  sortText: "000-agg_name",
};

export const QUERY_LEAF_VALUE_SNIPPETS: ReadonlyArray<RawSnippet> = QUERY_LEAF_PROPERTY_SNIPPETS
  .filter((snippet) => snippet.label !== "type")
  .map(queryValueSnippet);

export const LITERAL_VALUE_SNIPPETS: ReadonlyArray<RawSnippet> = [
  { label: "true", detail: "布尔值", documentation: "插入 true。", insertText: "true", kind: "keyword", sortText: "900-true" },
  { label: "false", detail: "布尔值", documentation: "插入 false。", insertText: "false", kind: "keyword", sortText: "901-false" },
  { label: "null", detail: "空值", documentation: "插入 null。", insertText: "null", kind: "keyword", sortText: "902-null" },
];
