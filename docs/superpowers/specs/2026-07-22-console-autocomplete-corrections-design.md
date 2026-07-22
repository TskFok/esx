# Console 自动补全错误修复设计

日期：2026-07-22

## 背景

Console 自动补全当前按首行路径和后续 JSON 正文进行粗粒度分流。路径候选主要根据非空路径段数量选择全局或索引级 API；正文候选主要根据 JSON path 选择 Search 根属性、Query DSL、聚合属性或字段名。

现有实现能够覆盖常见 Search 请求，但缺少方法、精确端点、正文格式和次版本信息，导致候选在错误上下文出现：例如 Bulk 正文提示 Search 属性、`size` 值位置提示 Query DSL、Scroll 提示 Search 查询参数、OpenSearch 插入 Elasticsearch k-NN 模板，以及嵌套聚合提示只能位于顶层的 `global`。

本次修复不仅移除错误候选，还在能够可靠识别的上下文补上对应的正确候选。

## 目标

- 路径候选与 HTTP 方法、当前路径层级匹配。
- 查询参数候选与精确端点匹配。
- 正文候选与端点正文格式匹配，包括 JSON、Bulk NDJSON 和 MSearch NDJSON。
- JSON 属性和值候选与当前 schema 位置匹配，不再使用无条件 Query DSL 回退。
- Elasticsearch、OpenSearch 及不同次版本只显示可用且语法正确的候选。
- 保留现有字段 metadata、产品、License 和版本过滤能力。
- 为所有已确认错误建立 Vitest 回归测试。

## 非目标

- 不引入外部 OpenAPI 下载、运行时 schema 服务或代码生成链路。
- 不追求覆盖 Elasticsearch/OpenSearch 的所有 API，只覆盖当前词库和本次修复涉及的端点。
- 不增加字段类型推断，例如按数值、日期、文本字段调整 Query DSL 排序。
- 不改变请求执行、解析、格式化、历史保存和 metadata 拉取逻辑。
- 不在未知端点猜测正文 schema；无法可靠判断时返回空候选或仅返回通用安全候选。

## 方案选择

采用“静态端点画像 + 精确上下文选择器”。

未采用的方案：

- 官方 OpenAPI/Schema 生成：覆盖更完整，但需要处理多产品、多版本生成和更新链路，超出当前项目范围。
- 在现有选择器中继续堆叠条件：短期改动少，但无法建立清晰的端点、方法和正文边界，容易继续产生错误回退。

## 架构

### 1. 请求上下文

新增纯函数请求上下文模块，从编辑器完整内容提取：

- `method`：标准化后的 HTTP 方法。
- `path`：去除查询字符串后的请求路径。
- `pathSegments`：解码前的非空路径段。
- `endpoint`：当前已识别端点类型。
- `bodyMode`：`search-json`、`create-index-json`、`update-json`、`document-json`、`bulk-ndjson`、`msearch-ndjson`、`unknown`。

请求上下文作为 `ConsoleAutocompleteContext` 的一部分由 `buildConsoleAutocompleteContext` 构建。Monaco provider 不自行重复解析业务规则，只消费上下文和当前光标信息。

首批端点类型包括：

- Search、Scroll、Count。
- Bulk、MSearch。
- Create Index、Update Document、Index Document。
- Mapping、Settings、Tasks、Snapshot、CAT。
- 当前静态路径词库中的全局和索引级 API。

### 2. 路径补全

路径补全按“当前路径节点”返回候选，不再只依赖非空段数量：

- 根路径 `/`：返回索引、alias、历史目标，以及当前方法允许的全局 API。
- 索引目标 `/orders/`：只返回当前方法允许的索引级 API，例如 `_search`、`_mapping`、`_refresh`。
- 已知全局前缀 `/_cat/`：返回相对子路径，例如 `indices`，选中后得到 `/_cat/indices`。
- 已进入 `_doc/{id}`、`_update/{id}` 等动态资源位置：不再返回索引名或无关 API。
- 索引、alias、历史目标只在需要目标名称的位置出现。

`ApiSegment` 增加允许方法和路径节点信息。候选在产品、版本、License 过滤后再进行方法过滤。

### 3. 查询参数补全

查询参数从模糊的路径包含判断改为端点画像选择：

- Search：保留 `size`、`from`、`allow_partial_search_results`、`routing`、`ignore_unavailable`、`expand_wildcards`。
- Scroll：增加 `scroll`、`scroll_id`、`rest_total_hits_as_int`，不返回 Search 专属参数。
- CAT、Mapping、Settings、Tasks、Snapshot、Bulk、MSearch 继续使用各自参数集。
- 通用参数 `pretty`、`human`、`error_trace`、`filter_path` 仅在端点允许查询字符串时保留。
- 已经出现在请求中的参数从候选中排除，避免重复参数。
- 光标位于 `name=` 后时不再提示其他参数名；仅在已知枚举/布尔值上提供值候选，否则不返回候选。

### 4. 正文模式

#### Search JSON

仅 Search 和明确复用 Search body 的上下文返回 Search 根属性及 Query DSL。Count 使用单独的受限根属性集合，只提示 `query` 和 `runtime_mappings`。

#### Create Index JSON

根对象提示 `settings`、`mappings`、`aliases`。不提示 `query`、`size`、`aggs` 等 Search 属性。

#### Update JSON

根对象提示 `doc`、`script`、`upsert`、`doc_as_upsert`、`scripted_upsert`、`detect_noop`、`_source`。

#### Document JSON

索引文档正文不使用固定系统属性；在对象键位置提示当前索引 mapping 字段。没有 metadata 时不猜测属性。

#### Bulk NDJSON

按光标所在 NDJSON 记录及上一条动作识别候选：

- 动作行提示 `index`、`create`、`update`、`delete` 动作模板。
- `index`、`create` 的 source 行提示当前目标索引 mapping 字段。
- `update` 数据行提示 `doc`、`upsert`、`script`、`doc_as_upsert` 等更新属性。
- `delete` 后不期待 source 行。

#### MSearch NDJSON

按 header/body 交替结构识别：

- Header 行提示 `index`、`routing`、`preference`、`search_type`、`request_cache`。
- Body 行使用 Search 根属性和 Query DSL。

NDJSON 判断只读取光标前的正文行，不改变现有请求发送格式。

### 5. JSON path 精确候选

移除未识别对象的“Search 根属性 + 全部 Query DSL”回退，改为显式规则：

- 查询容器如 `query`、`post_filter`、bool 子句返回 Query DSL。
- `size`、`from`、`terminate_after` 等数字位置返回数字模板。
- `profile`、`explain`、`version` 等布尔位置只返回 `true`、`false`。
- `term.<field>` 返回 `value`、`boost`、`case_insensitive`。
- `range.<field>` 返回 `gt`、`gte`、`lt`、`lte`、`format`、`time_zone`、`boost`。
- 其他已收录字段查询根据其官方长格式补充参数；没有可靠规则时不返回属性候选。
- Mapping 字段名只在查询字段键、排序字段键、字段引用值和文档属性键位置出现，不在查询字段的参数对象内重复出现。

值候选从统一数组改为按值类型选择。`null` 仅在明确允许时出现，不再作为任意值位置的通用候选。

### 6. Span 与聚合约束

- `span_not.include/exclude`、`span_first.match`、`span_containing.big/little`、`span_within.big/little` 和 Span clauses 只返回 Span 查询。
- `span_multi.match` 只返回其允许包装的 multi-term 查询。
- `global` 聚合只在顶层 `aggs.<name>` 出现。
- `reverse_nested` 只在 Nested 聚合的子聚合中出现。
- 其他聚合类型继续使用现有类型属性映射。

### 7. 产品和版本能力

`SnippetAvailability` 增加次版本边界，使用 major/minor 二元版本比较。版本未知时继续隐藏带强版本要求的候选。

首批规则：

- Elasticsearch Query DSL `knn`：8.12 及以上。
- Elasticsearch `semantic`、`sparse_vector` query：8.15 及以上。
- Elasticsearch 顶层 `knn`：8.0 及以上，并使用独立于 Query DSL `knn` 的可用性规则。
- OpenSearch `knn` 使用动态向量字段键以及 `vector`、`k` 模板。
- Elasticsearch 模板不在 OpenSearch 上出现，OpenSearch 模板不在 Elasticsearch 上出现。

相同 label 的产品专属片段在能力过滤后去重，确保每个上下文只保留正确模板。

## 数据流

1. 页面调用 `buildConsoleAutocompleteContext`，从请求内容和连接 metadata 构建字段、目标、集群和请求上下文。
2. Monaco provider 根据首行或正文位置分流。
3. 路径和查询参数候选读取端点、方法和路径节点。
4. 正文候选先按 `bodyMode` 选择正文处理器，再按 JSON path 或 NDJSON 记录位置细化。
5. 所有静态片段经过产品、版本、License 过滤后渲染为 Monaco completion item。

## 错误处理与保守策略

- 请求头不完整时仍提供 HTTP 方法和根路径候选。
- 未知方法、未知端点、无法解析的 NDJSON 记录不返回端点专属候选。
- 不因为自动补全无法判断而阻止用户输入或执行请求。
- metadata 缺失只影响动态索引和字段候选，不影响确定可用的静态候选。
- JSON 尚未闭合时继续使用现有容错路径分析，但不跨越到无关 schema。

## 测试策略

所有行为按 TDD 分组实现。

### 请求上下文测试

- 精确识别 Search、Scroll、Bulk、MSearch、Create Index、Update 和 Index Document。
- 不完整请求头和未知路径返回安全上下文。

### 路径与方法测试

- `GET /orders/` 不包含全局 API。
- `GET /_cat/` 返回 `indices`，不返回 `_cat/indices` 或索引名。
- `POST /` 不返回只允许 GET 的 `_cluster/health`。
- 根路径仍返回当前方法允许的索引和 API。

### 查询参数测试

- Scroll 只返回 Scroll 和通用参数。
- 已使用参数不重复出现。
- 参数值位置不返回参数名。

### 正文模式测试

- Bulk 动作、source、update 数据行返回各自候选。
- MSearch header/body 行返回各自候选。
- Create Index、Update、Document 正文不返回 Search 根属性，并返回对应正确属性。
- Search 现有根属性和 Query DSL 不退化。

### JSON path 测试

- `size` 不返回 Query DSL 或布尔/null。
- `term.<field>`、`range.<field>` 返回正确参数且不重复提示 mapping 字段。
- 未识别对象不回退到 Search 根属性和 Query DSL。
- Span 子句和聚合层级约束生效。

### 产品版本测试

- Elasticsearch 8.11 不显示 Query DSL `knn`，8.12 显示。
- Elasticsearch 8.14 不显示 `semantic`、`sparse_vector`，8.15 显示。
- OpenSearch 只得到 OpenSearch k-NN 模板。
- 未知版本不显示强版本约束候选。

### 完整验证

- `pnpm test`
- `pnpm run build`
- 检查工作区改动仅包含自动补全实现、测试、设计和实施计划。

## 验收标准

- 上一轮列出的十类错误候选均有失败测试并被修复。
- 每类错误上下文均补上可可靠确定的正确候选。
- Search、字段 metadata 和现有版本/License 补全能力不退化。
- 未知上下文不再通过宽泛回退产生误导候选。
- 完整测试和构建通过。
- 不在循环遍历中查询 SQL。

## 自检

- 设计内容完整且没有占位内容。
- 端点画像、路径层级、正文模式、JSON path 和版本能力边界一致。
- 范围只涉及 Console 自动补全及对应测试。
- 每项验收要求都有对应测试类别。
