export type SnippetKind =
  | "property"
  | "value"
  | "keyword";

export type SnippetAvailability = {
  products?: Array<"elasticsearch" | "opensearch">;
  minMajor?: number;
  maxMajor?: number;
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

export type ApiSegment = {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
  availability?: SnippetAvailability;
};

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
    label: "aggs",
    detail: "聚合入口",
    documentation: "聚合配置入口。",
    insertText: '"aggs": {\n\t"${1:agg_name}": {\n\t\t$0\n\t}\n}',
    kind: "property",
    sortText: "020-aggs",
  },
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
  {
    label: "track_total_hits",
    detail: "精确总数",
    documentation: "控制是否精确返回 total hits。",
    insertText: '"track_total_hits": ${1:true}',
    kind: "property",
    sortText: "040-track_total_hits",
  },
];

export const QUERY_LEAF_PROPERTY_SNIPPETS: ReadonlyArray<RawSnippet> = [
  {
    label: "bool",
    detail: "布尔查询",
    documentation: "布尔查询，支持 must / should / filter / must_not。",
    insertText: '"bool": {\n\t$0\n}',
    kind: "property",
    sortText: "001-bool",
  },
  {
    label: "match",
    detail: "全文匹配",
    documentation: "match 查询。",
    insertText: '"match": {\n\t"${1:field}": "$0"\n}',
    kind: "property",
    sortText: "010-match",
  },
  {
    label: "match_all",
    detail: "匹配全部",
    documentation: "match_all 查询。",
    insertText: '"match_all": {}',
    kind: "property",
    sortText: "011-match_all",
  },
  {
    label: "term",
    detail: "精确匹配",
    documentation: "term 查询。",
    insertText: '"term": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}',
    kind: "property",
    sortText: "012-term",
  },
  {
    label: "terms",
    detail: "多值匹配",
    documentation: "terms 查询。",
    insertText: '"terms": {\n\t"${1:field}": [\n\t\t"$0"\n\t]\n}',
    kind: "property",
    sortText: "013-terms",
  },
  {
    label: "range",
    detail: "范围查询",
    documentation: "range 查询。",
    insertText: '"range": {\n\t"${1:field}": {\n\t\t"gte": $2,\n\t\t"lte": $0\n\t}\n}',
    kind: "property",
    sortText: "014-range",
  },
  {
    label: "exists",
    detail: "字段存在",
    documentation: "exists 查询。",
    insertText: '"exists": {\n\t"field": "$0"\n}',
    kind: "property",
    sortText: "015-exists",
  },
  {
    label: "nested",
    detail: "嵌套查询",
    documentation: "nested 查询。",
    insertText: '"nested": {\n\t"path": "$1",\n\t"query": {\n\t\t$0\n\t}\n}',
    kind: "property",
    sortText: "016-nested",
  },
  {
    label: "wildcard",
    detail: "通配符查询",
    documentation: "wildcard 查询。",
    insertText: '"wildcard": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}',
    kind: "property",
    sortText: "017-wildcard",
  },
  {
    label: "prefix",
    detail: "前缀查询",
    documentation: "prefix 查询。",
    insertText: '"prefix": {\n\t"${1:field}": {\n\t\t"value": "$0"\n\t}\n}',
    kind: "property",
    sortText: "018-prefix",
  },
  {
    label: "ids",
    detail: "按 ID 查询",
    documentation: "ids 查询。",
    insertText: '"ids": {\n\t"values": [\n\t\t"$0"\n\t]\n}',
    kind: "property",
    sortText: "019-ids",
  },
  {
    label: "query_string",
    detail: "Lucene 语法",
    documentation: "query_string 查询。",
    insertText: '"query_string": {\n\t"query": "$0"\n}',
    kind: "property",
    sortText: "020-query_string",
  },
  {
    label: "type",
    detail: "类型查询",
    documentation: "Elasticsearch 7 的类型查询兼容语法，Elasticsearch 8 起不再建议使用。",
    insertText: '"type": {\n\t"value": "${1:_doc}"\n}',
    kind: "property",
    sortText: "021-type",
    availability: { products: ["elasticsearch"], minMajor: 7, maxMajor: 7 },
  },
];

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
};

export const AGGS_CONTAINER_PROPERTY_SNIPPET: RawSnippet = {
  label: "<agg_name>",
  detail: "新建子聚合",
  documentation: "插入 <agg_name>: { terms: {...} } 结构。",
  insertText: '"${1:agg_name}": {\n\t"terms": {\n\t\t"field": "$0"\n\t}\n}',
  kind: "property",
  sortText: "000-agg_name",
};

export const QUERY_LEAF_VALUE_SNIPPETS: ReadonlyArray<RawSnippet> = [
  {
    label: "bool",
    detail: "布尔查询值",
    documentation: "插入 bool 查询对象。",
    insertText: '{\n\t"bool": {\n\t\t$0\n\t}\n}',
    kind: "value",
    sortText: "000-bool",
  },
  {
    label: "match",
    detail: "match 查询值",
    documentation: "插入 match 查询对象。",
    insertText: '{\n\t"match": {\n\t\t"${1:field}": "$0"\n\t}\n}',
    kind: "value",
    sortText: "010-match",
  },
  {
    label: "match_all",
    detail: "匹配全部值",
    documentation: "插入 match_all 查询对象。",
    insertText: '{\n\t"match_all": {}\n}',
    kind: "value",
    sortText: "011-match_all",
  },
  {
    label: "term",
    detail: "term 查询值",
    documentation: "插入 term 查询对象。",
    insertText: '{\n\t"term": {\n\t\t"${1:field}": { "value": "$0" }\n\t}\n}',
    kind: "value",
    sortText: "012-term",
  },
  {
    label: "terms",
    detail: "terms 查询值",
    documentation: "插入 terms 查询对象。",
    insertText: '{\n\t"terms": {\n\t\t"${1:field}": [ "$0" ]\n\t}\n}',
    kind: "value",
    sortText: "013-terms",
  },
  {
    label: "range",
    detail: "range 查询值",
    documentation: "插入 range 查询对象。",
    insertText: '{\n\t"range": {\n\t\t"${1:field}": { "gte": $2, "lte": $0 }\n\t}\n}',
    kind: "value",
    sortText: "014-range",
  },
  {
    label: "exists",
    detail: "exists 查询值",
    documentation: "插入 exists 查询对象。",
    insertText: '{\n\t"exists": {\n\t\t"field": "$0"\n\t}\n}',
    kind: "value",
    sortText: "015-exists",
  },
  {
    label: "wildcard",
    detail: "wildcard 查询值",
    documentation: "插入 wildcard 查询对象。",
    insertText: '{\n\t"wildcard": {\n\t\t"${1:field}": { "value": "$0" }\n\t}\n}',
    kind: "value",
    sortText: "017-wildcard",
  },
  {
    label: "prefix",
    detail: "prefix 查询值",
    documentation: "插入 prefix 查询对象。",
    insertText: '{\n\t"prefix": {\n\t\t"${1:field}": { "value": "$0" }\n\t}\n}',
    kind: "value",
    sortText: "018-prefix",
  },
];

export const LITERAL_VALUE_SNIPPETS: ReadonlyArray<RawSnippet> = [
  { label: "true", detail: "布尔值", documentation: "插入 true。", insertText: "true", kind: "keyword", sortText: "900-true" },
  { label: "false", detail: "布尔值", documentation: "插入 false。", insertText: "false", kind: "keyword", sortText: "901-false" },
  { label: "null", detail: "空值", documentation: "插入 null。", insertText: "null", kind: "keyword", sortText: "902-null" },
];
