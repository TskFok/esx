# ESX 性能分析与优化方案

分析日期：2026-09-28。基于 `master` 分支、提交 `272b2b6`，应用版本 1.3.0。

最值得先做的是：缓存补全的稳定元数据、拆分启动加载、合并持久化写入、复用 HTTP 客户端。这四项都有直接代码证据，其中补全重建的开销已用生产函数微基准确认。大响应、AI 流式输出和 SSH 会话管理随后按使用频率推进。

本次仅审计和测量，没有修改业务代码。执行了前端生产构建、全部 Vitest 测试和纯函数微基准；没有连接真实 Elasticsearch、SSH 或 AI 服务，也没有运行桌面端性能录制、Rust 测试或完整 Tauri 打包。以下优化收益均为预期方向，不是已经实现的提升。

## 1. 架构与已有优化

| 层次 | 当前实现 | 性能关注点 |
| --- | --- | --- |
| 页面与编辑器 | React 19、Monaco、Console 集成多个面板 | 入口体积、逐键计算、列表渲染 |
| 应用状态 | 单个 AppStateProvider，TanStack Query 用于状态页 | 订阅更新范围、缓存粒度 |
| 持久化 | Tauri Store，单个 `app-state` 对象 | 全量序列化、IPC 和文件保存 |
| 请求 | 前端封装 → Tauri invoke → Rust reqwest / ssh2 | 建连复用、响应缓冲、超时和取消 |
| Elasticsearch 元数据 | 索引/别名/字段缓存，按索引补拉 | 全集群 mapping 成本、重复派生计算 |

已有措施应保留：正文草稿 600 ms 防抖；状态页按标签启用请求、30 秒 staleTime，关闭焦点/重连刷新；元数据 5 分钟 TTL、单索引请求进行中去重；默认 256 KiB 响应预览、超限响应跳过完整 JSON 美化；错误日志和状态历史有条数限制；keyring vault 有内存缓存；阻塞原生 I/O 已使用 `spawn_blocking`。

因此不建议泛化为“加缓存”“全部加 memo”“把所有 Rust 请求改异步”。应调整现有缓存、加载和数据传输边界。

## 2. 实测基线

### 构建与功能测试

| 项目 | 本次结果 |
| --- | --- |
| `pnpm build` | 通过；Vite 构建阶段 14.01 秒，出现大 chunk 提示 |
| 生产入口 JS | 4,041,186 bytes，约 4.04 MB；gzip 约 1.07 MB |
| 全部 JS 产物 | 86 个文件，合计 4,581,405 bytes |
| CSS 产物 | 167,365 bytes |
| `pnpm test` | 78 个测试文件、782 项测试通过；16.08 秒 |

构建与测试并行运行，耗时只记录本次执行，不作为隔离的速度基准。86 个 JS 文件包含动态语言模块，不代表启动时全部下载。桌面应用从本地加载资源，gzip 体积仅供包体比较；真实启动仍需测量 JS 解析、执行、Monaco 初始化与本地状态读取。

构建与测试日志：[/tmp/esx-performance-build.log](/tmp/esx-performance-build.log)、[/tmp/esx-performance-test.log](/tmp/esx-performance-test.log)。

### 补全与校验微基准

环境为 Apple M1 / arm64、macOS 26.5.2、Node v25.5.0。用现有 esbuild 打包生产 `context.ts` 和 `validator.ts`，数据构造与打包不计时；各组串行执行。补全与有效 JSON 组预热 5 次、采样 30 次；异常结构组预热 3 次、采样 20 次。

| 生产函数与合成数据 | 中位耗时 | p95 |
| --- | ---: | ---: |
| 补全：100 请求、100 索引、每索引 50 字段 | 3.88 ms | 4.66 ms |
| 补全：1,000 请求、1,000 索引、每索引 50 字段 | 37.44 ms | 39.59 ms |
| 补全：1,000 请求、1,000 索引、每索引 200 字段 | 94.29 ms | 116.71 ms |
| 校验：10 KiB 有效 JSON，主要内容为单个长字符串 | 0.05 ms | 0.42 ms |
| 校验：100 KiB 同类 JSON | 0.44 ms | 0.48 ms |
| 校验：500 KiB 同类 JSON | 2.24 ms | 2.39 ms |
| 校验：100 KiB 内容后追加 200 个未闭合 `[` | 49.86 ms | 51.84 ms |
| 校验：100 KiB 内容后追加 1,000 个未闭合 `[` | 248.07 ms | 256.74 ms |

补全样本中，每个请求指向对应索引，字段名跨索引唯一，别名为空，当前请求是短 search JSON。异常校验样本是刻意构造的压力输入，不代表普通 DSL。Node 使用的运行时与桌面 WebView 不同，以上数据不包含 React、Monaco、布局和输入调度，不能直接当作用户交互延迟。

复现脚本：[/tmp/esx-performance-bench.cjs](/tmp/esx-performance-bench.cjs)；原始结果：[/tmp/esx-performance-bench-results.json](/tmp/esx-performance-bench-results.json)。这些为当前机器临时文件，可在清理临时目录前另行保存。执行 `node /tmp/esx-performance-bench.cjs` 可重跑；脚本记录了当前机器的仓库与 esbuild 路径，跨环境需调整。

## 3. 优化项与优先级

P1 表示建议首批实施或高频场景优先；P2 表示按真实数据规模和使用频率推进。优先级不是故障严重度。

### P1：把稳定补全元数据移出逐键计算

证据：[console-page.tsx:811](/Users/ushopal/workspace/myself/esx/src/pages/console-page.tsx:811) 的 `useMemo` 依赖 `editorContent`，每个字符变化都会调用上下文构建函数；[context.ts:151](/Users/ushopal/workspace/myself/esx/src/lib/console-autocomplete/context.ts:151) 随之扫描请求历史、排序索引/别名，并通过 [context.ts:98](/Users/ushopal/workspace/myself/esx/src/lib/console-autocomplete/context.ts:98) 重建所有索引与别名的字段表。

这让只修改 JSON body 的操作也承担全集群元数据处理。微基准中大样本的中位开销已达到 94 ms，是本次最明确的计算热点。

方案：

- 按 `metadata` 版本缓存 `fieldNamesByTarget`、索引集合与别名集合；按 requests 引用或版本缓存历史目标。
- 将当前请求内容相关的解析单独计算；只有目标索引变化时重新合并对应字段，不在每个字符上重排全体字段。
- 用 `Set` 做历史目标去重/存在判断；优先复用已有排序结果。
- 缓存以连接和元数据版本为边界，连接切换、别名变化、字段刷新时正确失效。

验收：连续仅编辑 body 100 次，稳定元数据构建次数为 0；同一大样本动态派生部分 p95 建议控制在 5 ms 内，最终以 WebView 录制校准。补全现有测试全部通过，并补充缓存失效与跨连接隔离测试。

### P1：拆分启动加载与 Monaco 依赖

证据：[App.tsx:5](/Users/ushopal/workspace/myself/esx/src/App.tsx:5) 静态导入页面；[console-page.tsx:18](/Users/ushopal/workspace/myself/esx/src/pages/console-page.tsx:18) 静态导入编辑器；[console-editor.tsx:2](/Users/ushopal/workspace/myself/esx/src/components/console/console-editor.tsx:2) 导入完整 Monaco 入口。生产 `index.html` 直接引用约 4.04 MB 的入口 JS。

方案：

- 页面和低频面板使用动态 import；Console 首次需要编辑器时加载 Monaco，必要时在连接选定后预热。
- 结合实际功能按需导入编辑器 API、折叠/查找/补全等贡献模块与所需语言，避免打包与 ES Console 无关的全部语言能力。
- 检查并显式配置 Monaco 的 worker；目前项目源码没有 `MonacoEnvironment/getWorker` 配置，但是否发生主线程回退需要运行时验证。
- 按功能边界切分后再考虑 vendor chunks；单纯改 chunk 名称或调高警告阈值不会减少首屏执行工作。

动态 import 与异步 chunk 加载由 [Vite 7 官方文档](https://v7.vite.dev/guide/features#dynamic-import) 支持；worker 接入参考 [Monaco 官方 ESM 集成文档](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md?plain=1)。

验收：打开连接页时不加载编辑器代码；记录进程启动到连接页可操作、Console 编辑器可输入的 p50/p95。可先将连接页初始 JS 未压缩总量小于 1 MB 作为试行预算，再按实测调整。首次进入 Console 的额外等待需一并评估。

### P1：合并持久化写入，降低全量状态传输

证据：[app-state.tsx:587](/Users/ushopal/workspace/myself/esx/src/providers/app-state.tsx:587) 在每次 state 变化后调用保存；[storage.ts:95](/Users/ushopal/workspace/myself/esx/src/lib/storage.ts:95) 将整个状态放入一个 key 并立即 `save()`；[console-page.tsx:1538](/Users/ushopal/workspace/myself/esx/src/pages/console-page.tsx:1538) 的请求名输入逐字更新草稿。正文已有 600 ms 防抖，不应描述成正文每个字符都写盘。

方案：

- 引入统一持久化队列：只保留尚未写出的最新版本，串行保存，合并短时间更新；失败保留 dirty 状态并可重试。
- 为请求名等高频更新增加短防抖；显式保存与应用退出前使用可等待的 flush，避免只靠网页 unload 异步保存。
- 明确选用应用层合并保存或插件 autoSave 策略；当前 `autoSave:100` 不能抵消每次显式 `save()`。未验证插件实现前不声称每次一定发生双写。
- 随数据增长把高频草稿与低频请求、历史、元数据分开持久化。只拆同一文件的 key 可以减少单次 set 负载，但不应据此承诺解决底层整文件保存成本；必要时分 store 文件。
- 大量响应快照应考虑总字节预算及按需加载，不仅限制单条预览大小。

验收：连续输入 20 个字符时不出现 20 次全量落盘；记录 set/save 次数、IPC bytes、实际文件写入量和最终落盘延迟。验证快速连续修改、保存失败重试、连接切换和退出 flush 均不丢最后一次编辑；保留现有脱敏与原生凭据存储边界。

### P1：复用原生 HTTP 客户端

证据：[lib.rs:957](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:957) 每次 ES 请求重新构建客户端；[lib.rs:1082](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:1082) 的 AI 请求同样如此；CA 模式还会在 [lib.rs:700](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:700) 读取证书文件。

方案：在 Tauri 原生层管理有界 Client 缓存，按 TLS/CA/指纹等传输配置隔离，连接或证书配置变化时失效。凭据仍按单次 request 设置，避免把某连接的 Authorization 作为共享默认 header。持有缓存锁时只做查找/插入，网络 I/O 在锁外执行。

reqwest 的 Client 自带连接池，官方建议重复使用以保留连接池收益；无需为了这一项先改成全异步 HTTP。[reqwest 官方 Client 文档](https://docs.rs/reqwest/latest/reqwest/struct.Client.html)

验收：本地支持 keep-alive 的测试服务上，对同源顺序请求比较连接建立次数和 p50/p95；重复请求不重复读取未变更 CA。测试 TLS 模式、证书轮换、不同凭据之间不串用配置。公网耗时由服务与网络共同决定，不能预先承诺固定降幅。

### P1（大响应场景）：在原生层限制预览缓冲与 IPC 大小

证据：[lib.rs:995](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:995) 用 `response.text()` 收取完整响应；[http-client.ts:716](/Users/ushopal/workspace/myself/esx/src/lib/http-client.ts:716) 在 invoke 返回后才构建预览；[response-snapshot.ts:66](/Users/ushopal/workspace/myself/esx/src/lib/response-snapshot.ts:66) 又将完整字符串编码为 UTF-8 后截断。

默认 256 KiB 预览限制了长期保留的响应大小，但没有限制原生缓冲、IPC 与 JS 接收阶段的峰值。SSH 的 stdout 也存在整包收集。

方案：Console 预览模式在 Rust 分块读取，只保留所需 UTF-8 前缀，并返回 `preview/totalBytes/truncated`。若要准确总大小且保留连接复用，继续消费并计数但不保留后续内容；若提前终止下载，只能报告已知大小或未知总量，不能伪造精确大小。完整下载可另存临时文件并按需访问。

元数据、状态和治理操作仍可能需要完整 JSON，必须使用明确的完整读取模式或各自限制，不能统一截断导致解析错误。前端用户可调预览上限目前只有最小值，应为超大文本提供分块/虚拟行显示或明确的大文本模式。

验收：1/10/100 MB 合成响应下测原生 RSS、JS heap、IPC payload、响应可见时间。默认预览模式下 IPC body 大小应近似固定在预览上限加元数据；验证跨 UTF-8 边界、错误响应、大小显示及完整数据路径。

### P1（AI 常用场景）：实现真正的流式传输

证据：[ai-analysis-client.ts:362](/Users/ushopal/workspace/myself/esx/src/lib/ai-analysis-client.ts:362) 请求 SSE，但 [lib.rs:1117](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:1117) 等 `response.text()` 完成后一次性返回；[ai-analysis-client.ts:293](/Users/ushopal/workspace/myself/esx/src/lib/ai-analysis-client.ts:293) 再将完整字符串包装成 Response。现有前端 SSE parser 无法弥补原生层的整包等待。

方案：使用 Tauri Channel 从原生层发送带 requestId 的有序增量，处理取消、结束与错误；前端以小批次或每帧合并更新，避免每个 token 重渲染整页。Channel 是 Tauri 官方为流式数据提供的机制。[Tauri 官方 Channels 文档](https://v2.tauri.app/develop/calling-frontend/#channels)

验收：用持续数秒的本地 SSE 测试流，首段内容必须在服务端结束前显示；记录原生收首段到 UI 显示的延迟、取消后原生请求是否停止、跨 chunk 的 UTF-8/SSE 帧处理。优化首段展示不等于缩短模型整体生成时间。

### P2：缩小元数据与治理资源读取范围

证据：[http-client.ts:907](/Users/ushopal/workspace/myself/esx/src/lib/http-client.ts:907) 起串行执行多项探测；[http-client.ts:1011](/Users/ushopal/workspace/myself/esx/src/lib/http-client.ts:1011) 在刷新时读取全量 `/_mapping`；[admin-panel.tsx:583](/Users/ushopal/workspace/myself/esx/src/components/console/admin-panel.tsx:583) 手动刷新一次并行读取索引、别名、两种模板和 pipeline。Admin 当前不是轮询，已有索引 CAT 请求也限制了返回列。

方案：初始化优先读取索引与别名，复用已有单索引字段加载与去重机制，按当前目标加载 mapping；为字段缓存增加容量和失效管理。仅对真正独立的探测进行有界并发，保留版本/权限兼容所需的条件回退。治理列表按当前功能区读取，详情选中后加载；缓存 key 包含连接配置版本，写操作后失效相关数据。

验收：在 1,000/10,000 索引样本上比较首次补全可用时间、请求数、mapping 总字节、解析耗时与 store 大小；验证 alias、wildcard、多索引请求、权限不足与旧 ES 版本下的降级行为。这里是 Elasticsearch HTTP API，应按目标批量取数，不引入循环逐条 SQL 查询。

### P2（SSH 常用场景提前）：超时、取消与会话复用

证据：[lib.rs:1171](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:1171) 每次创建 TCP、SSH 会话、握手和认证，然后新建 channel 执行远程 curl；该路径未设置明确的 socket/session/curl 时间上限。已有 `spawn_blocking` 让阻塞工作离开异步运行时线程，但不限制挂起任务占用时间。

方案：先补齐 TCP connect、SSH I/O、远程 curl 总时限与取消机制，再引入有界会话池、空闲 TTL、失败失效与配置变更失效。会话共享需评估 ssh2 的阻塞与通道调度，避免全局 Mutex 串行所有连接。保持 host key 校验，写请求连接中断后不盲目重试。

即使复用了 SSH Session，每次启动独立 curl 仍不能自动获得跨请求 HTTP 连接池；若此项仍是瓶颈，再评估长期转发隧道与本地 HTTP 客户端复用，作为单独工程项。

验收：同一 SSH 配置的连续请求减少握手；网络黑洞、远端卡住、取消和配置更新时都有可验证的退出行为；记录活动会话/任务数、握手次数及请求 p95。

### P2：缩小 React 更新范围并虚拟化大列表

证据：[app-state.tsx:1340](/Users/ushopal/workspace/myself/esx/src/providers/app-state.tsx:1340) 的 Context value 依赖整个 state，所有已挂载消费者都可能受任意领域更新影响；[console-sidebar-panel.tsx:355](/Users/ushopal/workspace/myself/esx/src/components/console/console-sidebar-panel.tsx:355) 和 [status-indices-tab.tsx:145](/Users/ushopal/workspace/myself/esx/src/components/console/status-indices-tab.tsx:145) 渲染全部筛选结果。

方案：先用 React Profiler 确认重渲染来源，稳定 action 引用，隔离编辑器、侧栏、日志和状态数据订阅；必要时拆领域 Context 或使用 selector。数千条请求/索引列表采用分页或虚拟化，保留排序、拖拽、批量选择与键盘导航语义。仅加 React.memo 不能解决组件自身订阅整个 Context 的更新。

验收：1,000/10,000 条列表下测 DOM 数、滚动掉帧、搜索与编辑器 commit 时长；正文编辑不触发无关面板计算，列表 DOM 规模由可视窗口决定。

### P2：优化校验异常路径和长 NDJSON 补全

证据：[console-editor.tsx:279](/Users/ushopal/workspace/myself/esx/src/components/console/console-editor.tsx:279) 同步校验每次内容变化；[validator.ts:167](/Users/ushopal/workspace/myself/esx/src/lib/console-autocomplete/validator.ts:167) 对每个未闭合结构调用从头扫描的 `positionAt`。这可能产生 O(文本长度 × 错误数) 工作。另有 [index.ts:272](/Users/ushopal/workspace/myself/esx/src/lib/console-autocomplete/index.ts:272) 提取光标前全文，供 NDJSON 上下文重新解析。

方案：扫描时直接保存行列或预建行起点索引，并限制一次诊断数量；采用按 model version 的短防抖，丢弃过期结果。NDJSON 按编辑范围缓存前序行状态，优先只解析受影响 action/header/body。是否引入 worker，应由复杂 DSL 和真实 WebView profiling 决定，不把单长字符串 JSON 样本外推为所有场景。

验收：上述异常样本不再随错误数量重复扫描全文；增加深层未闭合结构、大量行和多请求边界回归测试。已有解析、补全、格式化与错误位置展示应保持一致。

## 4. 实施顺序与验收方式

| 阶段 | 交付内容 | 主要验收 |
| --- | --- | --- |
| 第一步 | 保留本次基线，补少量可开关性能记录 | 分离网络、原生读取、IPC、JS 派生、React commit 与保存耗时；不记录真实凭据或响应内容 |
| 第二步 | 补全稳定缓存、启动拆包、保存合并、HTTP Client 复用 | 逐键不重建全量字段；连接页不加载 Monaco；减少全量保存和建连 |
| 第三步 | 原生预览模式、真实 AI 流式；按使用频率加入 SSH 超时/复用 | 大响应 IPC 有界；首段提前可见；SSH 故障可及时释放资源 |
| 第四步 | mapping 按需、治理按区加载、列表虚拟化、订阅拆分、校验异常路径 | 大集群和长时间会话下保持输入、滚动、内存稳定 |

每个优化独立提交并比较前后，不把所有重构放在一个改动中。沿用 `src/lib` / `src/providers` 边界，新增功能补 Vitest；原生连接池、截断、SSE 与 SSH 行为使用本地可控服务做 Rust/集成验证。已有单元测试通过证明当前功能基线稳定，并不代表桌面运行时性能达标。

建议固定测量集：空数据与大量历史的冷启动；100/1,000 保存请求；100/1,000 索引及 50/200 字段；10/100/500 KiB DSL；1/10/100 MB 响应；短/长 SSE；SSH 正常/慢/挂起场景。记录同机同版本 p50/p95、峰值内存、请求与写入次数，并明确启动、输入与长会话三类目标。

不建议本轮直接升级框架、更换状态库或引入新的数据库。这些变更尚无证据能优于先消除已经定位的重复计算、全量传输和逐请求建连。
