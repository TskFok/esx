# DSL 自动补全扩展设计

日期：2026-06-21

## 背景

Console 自动补全现在集中在 `src/lib/console-autocomplete`。路径、查询参数、JSON DSL 属性、字段名补全已经分层实现，但 Query DSL 词库覆盖不足：项目分析器已经识别 `match_phrase`、`simple_query_string`、`geo_distance` 等查询类型，自动补全却没有对应片段；上下文集合里也出现了 `multi_match`、`regexp`、`fuzzy`、`span_term` 等没有补全入口的类型。

这次目标是按官方 Query DSL 分类扩到更完整集合，而不是只补当前几个缺口。参考范围包括 Elasticsearch Query DSL 与 OpenSearch Query DSL 的常用分类：full-text、term-level、compound、geo、joining、span、specialized、vector，以及搜索请求体常见顶层属性。

## 目标

- 在现有 Monaco 自动补全架构上扩展 DSL 词库，不重写编辑器接入。
- 补齐常用 Query DSL 片段，并让 `query`、bool 子句、`post_filter`、`knn.filter` 等查询位置能拿到一致建议。
- 扩展搜索请求体顶层属性，包括常见分页、返回字段、运行时字段、性能分析和精确控制项。
- 扩展聚合补全，覆盖项目分析器已识别但词库缺失的聚合类型，并补充常用 bucket、metric、pipeline 聚合。
- 保留现有集群产品、版本、License 可用性过滤能力。
- 用测试先固定期望，再实现补全，避免大词库改动造成上下文回退。

## 非目标

- 不引入外部 schema 生成器或运行时下载官方 OpenAPI。
- 不在本次实现 ES|QL、SQL、Painless 脚本语言补全。
- 不做字段类型感知排序，例如只在数值字段上优先推荐 range 或 avg。
- 不改变请求执行、校验、历史保存、metadata 拉取逻辑。

## 方案

采用“分层静态词库 + 现有上下文选择器”的方案。

1. 在 `snippets.ts` 中把 Query DSL 片段按分类组织：
   - full-text：`match`、`match_bool_prefix`、`match_phrase`、`match_phrase_prefix`、`multi_match`、`combined_fields`、`query_string`、`simple_query_string`、`intervals`。
   - term-level：`term`、`terms`、`terms_set`、`range`、`exists`、`ids`、`prefix`、`wildcard`、`regexp`、`fuzzy`。
   - compound：`bool`、`boosting`、`constant_score`、`dis_max`、`function_score`。
   - geo / shape：`geo_distance`、`geo_bounding_box`、`geo_polygon`、`geo_shape`、`shape`。
   - joining：`nested`、`has_child`、`has_parent`、`parent_id`。
   - span：`span_term`、`span_near`、`span_or`、`span_not`、`span_first`、`span_multi`、`span_containing`、`span_within`、`span_field_masking`。
   - specialized / vector：`script`、`script_score`、`more_like_this`、`distance_feature`、`rank_feature`、`pinned`、`wrapper`、`knn`、`semantic`、`sparse_vector`。
2. 保持导出的 `QUERY_LEAF_PROPERTY_SNIPPETS` / `QUERY_LEAF_VALUE_SNIPPETS` 兼容现有调用方，内部可由分类数组组合生成。
3. 在 `suggestions.ts` 中扩展查询上下文识别：
   - `query`、bool 数组项、`post_filter`、`constant_score.filter`、`function_score.query`、`script_score.query`、`nested.query`、`has_child.query`、`has_parent.query` 推荐 Query DSL。
   - `knn.filter` 推荐 Query DSL。
   - 字段名补全继续在字段键、`field`、`path`、sort、highlight fields 中生效。
4. 在 `ROOT_PROPERTY_SNIPPETS` 补充搜索请求体顶层属性：
   - 返回与分页：`fields`、`docvalue_fields`、`stored_fields`、`script_fields`、`search_after`、`from`、`size`、`sort`。
   - 查询控制：`post_filter`、`min_score`、`terminate_after`、`track_scores`、`track_total_hits`、`profile`、`explain`、`version`、`seq_no_primary_term`。
   - 高级搜索：`runtime_mappings`、`pit`、`knn`、`collapse`、`highlight`。
5. 扩展聚合：
   - bucket：`filter`、`filters`、`nested`、`reverse_nested`、`global`、`missing`、`significant_terms`、`composite`、`sampler`。
   - metric：`extended_stats`、`percentiles`、`percentile_ranks`、`weighted_avg`、`top_hits`、`top_metrics`、`median_absolute_deviation`。
   - pipeline：`bucket_script`、`bucket_selector`、`bucket_sort`、`derivative`、`moving_fn`、`cumulative_sum`。
6. 对明显版本或产品相关的条目继续使用 `availability`，没有明确差异的通用 DSL 默认对 Elasticsearch 与 OpenSearch 都显示。

## 数据流

编辑器调用 `provideConsoleCompletionItems` 后仍按现有路径分流：

- 第一行：HTTP 方法、路径片段、查询参数补全。
- JSON body：`analyzeJsonCursor` 解析光标路径。
- `selectPropertySuggestions` 根据路径返回属性片段。
- `selectValueSuggestions` 在值位置返回查询对象值片段或字面量。
- `buildFieldSuggestions` 根据当前连接 metadata 补字段名。

本次只扩展后两层词库与路径判断，不改 Monaco 注册方式。

## 错误处理

补全片段本身不阻断输入，也不替代 JSON 校验。若 metadata 不存在，字段名补全为空，但静态 DSL 片段仍可用。若集群版本未知，带强版本约束的片段按现有策略隐藏，避免向用户推荐可能不可用的语法。

## 测试策略

先写失败测试，再实现：

- `snippets.test.ts`：验证官方分类中的代表性 DSL 片段存在，关键片段插入文本是可粘贴 JSON。
- `suggestions.test.ts`：验证 `query`、bool 子句、`post_filter`、`constant_score.filter`、`nested.query`、`knn.filter` 等位置推荐 Query DSL。
- `index.test.ts`：验证 Monaco 提供器在真实请求体位置返回新增标签。
- `capabilities.test.ts`：保留已有版本过滤测试，并补充新增版本相关 DSL 不误显。

## 验收标准

- 常用官方 Query DSL 类型能在合理上下文中出现补全。
- 搜索请求体常用顶层参数能在根对象出现补全。
- 字段名补全在查询字段、聚合字段、sort、highlight 中不退化。
- 现有测试通过，新增测试覆盖新增行为。
- 不引入循环遍历中的 SQL 查询。

## 自检

- 没有待定项或占位符。
- 范围聚焦在 Console DSL 自动补全，不包含请求执行和外部 schema 生成。
- 架构与现有 `console-autocomplete` 分层一致。
- 测试策略覆盖词库存在性、上下文选择和集群能力过滤。
