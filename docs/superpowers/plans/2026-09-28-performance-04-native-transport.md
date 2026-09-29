# 原生传输性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**实施状态（2026-09-29）：** 五项任务的代码与自动化测试已完成并提交；真实桌面及 SSH 性能验收保留未勾选，详见文末。

**Goal:** 减少重复建连和大响应跨 IPC 传输，让 AI 增量真实到达界面，并给 SSH 请求明确的资源上界。

**Architecture:** ES、AI 非流式和 SSH 保留现有 Tauri `spawn_blocking`；仅 AI SSE 改用异步 reqwest 与 Tokio 取消选择。新增原生传输模块分别承担 HTTP Client 缓存、响应读取、AI Channel 和 SSH 会话管理。Console 用显式预览模式，元数据、状态、治理及连接探测用完整模式；AI 流式命令与现有非流式命令并存。

**Tech Stack:** Rust、Tauri 2、reqwest blocking/async、Tokio、ssh2、TypeScript、React、Vitest。

**Spec:** [性能分析与优化方案](/Users/ushopal/workspace/myself/esx/docs/PERFORMANCE_ANALYSIS_2026-09-28.md) 的“复用原生 HTTP 客户端”“原生层限制预览缓冲”“真正的流式传输”“SSH 超时、取消与会话复用”。

## Global Constraints

- 所有命令均在仓库根目录 `/Users/ushopal/workspace/myself/esx` 执行；默认当前分支，不新建分支。
- 保留 keyring 凭据存储、SSH host key 校验、TLS 模式与 CA/指纹隔离；不将明文凭据写入缓存键、日志、文件或 Client 默认 header。
- 禁止在循环遍历中查询 SQL；本计划不涉及 SQL。
- 新前端行为补 Vitest，新 Rust 模块补模块测试；使用本地可控 HTTP/SSE/假 SSH 通道，不依赖真实账号或公网。
- 每任务先红后绿；提交格式为 `type: 中文描述`。原计划编写阶段的“只写计划”限制已由本轮实施请求取代。
- 与第 03 计划在 [http-client.ts](/Users/ushopal/workspace/myself/esx/src/lib/http-client.ts) 的元数据函数只通过 `full`/`preview` 模式接口协作；第 03 计划不改原生协议，合并时保留双方改动。
- 现有 `spawn_blocking`、URL 同源检查、无重定向策略及 HTTP 60/15 秒、AI 120/15 秒超时不得无意退化。
- 性能测试统计时排除 fixture 启动；只保留匿名时长、字节、计数，不写响应正文。

## Review Focus

1. CA 文件被同路径替换后必须重建相应 Client，且其他 TLS 模式、其他 CA 和凭据不得串用；Task 1 的轮换与隔离测试固定此行为。
2. UTF-8 多字节字符跨读取边界时，预览不能含损坏字符，`totalBytes` 必须是完整响应的真实字节数；Task 2 的分块测试固定此行为。
3. AI 取消必须让原生读取停止并释放注册项，不能只是界面忽略迟到事件；Task 3/4 的取消测试固定此行为。
4. SSH 远端 stderr 填满缓冲且 stdout 也有输出时不能互锁；Task 5 的假通道测试固定此行为。
5. SSH 写请求在断线、取消或复用会话失效后不能自动重放；Task 5 的调用次数测试固定此行为。

## 文件职责与现有调用链

| 文件 | 职责与改动边界 |
| --- | --- |
| 拟新增 `src-tauri/src/http_client_pool.rs` | 传输配置键、CA 内容校验、有界 blocking Client 复用，不持有认证 header。 |
| 拟新增 `src-tauri/src/http_response_reader.rs` | 直连响应的完整或有界预览读取、真实字节计数、UTF-8 边界。 |
| 拟新增 `src-tauri/src/ai_stream.rs` | 异步 SSE Channel、ACK 窗口、取消注册表与终态清理。 |
| 拟新增 `src-tauri/src/ssh_transport.rs` | SSH 连接期限、双流读取、会话租约与取消，不隐藏写请求重试。 |
| [lib.rs](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs) | 现有 Tauri 命令和 URL/证书/host key 验证；把具体传输工作接到模块。 |
| [tauri.ts](/Users/ushopal/workspace/myself/esx/src/lib/tauri.ts) | IPC payload/response 类型、AI Channel 与两个取消包装器。 |
| [http-client.ts](/Users/ushopal/workspace/myself/esx/src/lib/http-client.ts) | Console 预览与 metadata/status/admin/探测全量模式分发；第 03 计划只依赖这个边界。 |
| [response-snapshot.ts](/Users/ushopal/workspace/myself/esx/src/lib/response-snapshot.ts) | 用原生真实大小构造预览快照；截断内容不尝试完整 JSON 美化。 |
| [ai-analysis-client.ts](/Users/ushopal/workspace/myself/esx/src/lib/ai-analysis-client.ts)、[ai-generate-client.ts](/Users/ushopal/workspace/myself/esx/src/lib/ai-generate-client.ts)、[request-analysis.ts](/Users/ushopal/workspace/myself/esx/src/lib/request-analysis.ts) | 保持现有 SSE parser 和返回类型，传递取消信号；取消不触发本地分析兜底。 |
| [console-page.tsx](/Users/ushopal/workspace/myself/esx/src/pages/console-page.tsx) | AI delta 每帧合并更新，Console SSH 运行中的取消入口与生命周期。 |

**实施优先级：** Task 1 为 P1；Task 2 在大响应常见时按 P1 提前，否则按 P2；Task 3/4 在 AI 常用时按 P1 提前，否则按 P2；Task 5 通常为 P2，SSH 常用时提前。Task 1 可独立交付；Task 2 依赖 Task 1；Task 3→4 是一条连续交付链；Task 5 依赖 Task 2，可在 SSH 常用时先于 Task 3/4 实施，其依赖配置见该任务。

---

### Task 1: 有界 HTTP Client 复用与证书失效

**Files:**
- Create（拟新增）: `src-tauri/src/http_client_pool.rs`
- Modify: [lib.rs](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:679)
- Test（拟新增）: `src-tauri/src/http_client_pool.rs` 的 `#[cfg(test)]` 模块

**Interfaces:**
- Consumes: 现有 `ConnectionTlsConfig`、`ConnectionTlsMode`、`build_fingerprint_tls_config` 和 `es_http_client_builder`；AI 仍使用 120 秒总超时、15 秒连接超时，ES 仍使用 60/15 秒。
- Produces: `HttpClientPool::es_client(&self, tls: Option<&ConnectionTlsConfig>, insecure_tls: bool) -> Result<reqwest::blocking::Client, String>` 和 `ai_client(&self) -> Result<reqwest::blocking::Client, String>`；`static HTTP_CLIENT_POOL: LazyLock<HttpClientPool>`。缓存最多 8 个 ES 配置和 1 个 AI Client，LRU 驱逐；请求级 Authorization 留在 `RequestBuilder`。

- [x] **Step 1: 写 HTTP 复用失败测试。** `same_config_reuses_keepalive_connection` 用本地 keep-alive 服务顺序接收两次 ES GET；断言服务仅 accept 一次，构建器仅调用一次。
- [x] **Step 2: 写 TLS 隔离失败测试。** `different_tls_modes_are_isolated` 覆盖 default、insecure、fingerprint、两条不同 CA 路径；断言各自独立，重复同配置命中。
- [x] **Step 3: 写轮换与凭据失败测试。** `ca_rotation_invalidates_only_its_client` 同路径以**相同长度与 mtime**替换 CA 后只重建受影响项；`different_credentials_do_not_share_authorization` 断言两请求头各自正确、Client 无默认 Authorization。证书和凭据均用测试 fixture。
- [x] **Step 4: 运行红测。** `cargo test --manifest-path src-tauri/Cargo.toml http_client_pool --lib`；预期 FAIL，缺少缓存模块或上述断言失败。
- [x] **Step 5: 实现缓存键与容量。** 将 TLS 模式、指纹、规范 CA 路径及 CA **内容 SHA-256** 纳入键；最多保留 8 个 ES 项和 1 个 AI 项，采用 LRU 驱逐。
- [x] **Step 6: 实现 CA 失效。** 每次 CA 模式请求都在锁外读取并哈希文件内容；摘要变化即重建对应 Client，因此同长度、同 mtime 替换也可检测。本轮优先证书轮换正确性，暂不承诺消除重复 CA 文件读取；已读内容仅用于首次建 Client，不重复读第二遍。
- [x] **Step 7: 接入调用方。** `perform_es_http_request` 与 `perform_ai_http_request` 从共享池取得 Client；验证三次探测由此复用。只在 `RequestBuilder` 设置 Authorization；证书读、Client 构建、请求 I/O 都在锁外。
- [x] **Step 8: 运行绿测。** `cargo test --manifest-path src-tauri/Cargo.toml http_client_pool --lib`；预期 PASS。
- [x] **Step 9: 记录度量与回滚条件。** 对本地同源顺序请求记录 accept 次数、Client 构建次数和 p50/p95；若 TLS 隔离、CA 轮换或凭据断言失败，恢复原构建路径。
- [x] **Step 10: 提交。** 已随原生提交 `1f31829` 完成（`refactor: 优化原生传输并限制资源占用`）。

### Task 2: Console 原生分块预览与完整读取边界

**Files:**
- Create（拟新增）: `src-tauri/src/http_response_reader.rs`
- Modify: [lib.rs](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:396)
- Modify: [tauri.ts](/Users/ushopal/workspace/myself/esx/src/lib/tauri.ts:79)
- Modify: [http-client.ts](/Users/ushopal/workspace/myself/esx/src/lib/http-client.ts:636)
- Modify: [response-snapshot.ts](/Users/ushopal/workspace/myself/esx/src/lib/response-snapshot.ts:10)
- Test（拟新增）: `src-tauri/src/http_response_reader.rs` 模块测试；`src/lib/__tests__/http-client-transport.test.ts`

**Interfaces:**
- Consumes: Task 1 的 ES Client；现有 `executeEsHttpRequest`、`executeSshHttpRequest`、`buildResponseSnapshot`。
- Produces: 两种请求 payload 均增加 `readMode?: "full" | "preview"`、`previewBytes?: number`；缺省为 `full` 以兼容旧调用。`TauriHttpResponse` 增加 `totalBytes?: number`、`truncated?: boolean`，旧返回缺少字段时前端按现有逻辑计算。`executeConsoleRequestRaw(..., readMode: "full" | "preview", previewBytes?: number)`；只有 `executeConsoleRequest` 传 `preview`，`executeAdminOperation`、`runServerStatusProbe`、`runSearchMetadataProbe`、`runConnectionProbe` 显式传 `full`。第 03 计划的元数据改动只调用该 `full` 接口。
- 边界: 本任务完成直连 ES 的有界预览；SSH 命令此时接受相同 payload 但先按完整模式读取，再由 Task 5 安全实现双流读取和尾部状态标记保留，不产生错误的截断承诺。

- [x] **Step 1: 写 Rust 读取失败测试。** 分块 `Read` fixture 返回 16 KiB 上限前后的中文与 emoji，断言 UTF-8 前缀有效、只留上限内字节、仍读到 EOF。
- [x] **Step 2: 写 Rust 计数失败测试。** 断言 `totalBytes` 等于完整响应字节数、`truncated` 只在超限时为真；非 2xx body 同样有界，读取错误明确返回错误。
- [x] **Step 3: 写前端模式失败测试。** mock Tauri 命令，断言 Console 发送 `preview` 与用户设定上限；元数据、状态、治理、连接探测传 `full`，完整 JSON 仍可解析。
- [x] **Step 4: 写快照兼容失败测试。** 原生 `totalBytes` 大于 `bodyText` 时，`sizeBytes` 取真实总量；即使预览前缀恰为可解析 JSON（如 `{}` 后仍有正文），`truncated` 也为真且不生成 `prettyPreview`。旧版缺少新字段时仍按现有逻辑工作。
- [x] **Step 5: 运行红测。** `cargo test --manifest-path src-tauri/Cargo.toml http_response_reader --lib` 与 `pnpm test src/lib/__tests__/http-client-transport.test.ts`；预期 FAIL。
- [x] **Step 6: 实现 `read_response<R: Read>(reader: R, mode: ReadMode) -> Result<ReadResult, io::Error>`。** `ReadMode::{Full, Preview { max_bytes }}`，`ReadResult { body_text: String, total_bytes: u64, truncated: bool }`；每块累计原始 byte 数，只保留有界前缀，读到 EOF 后裁到完整 UTF-8 边界；完整模式保持既有 body 语义。
- [x] **Step 7: 接入原生命令。** 直连 ES 使用新 reader；响应带 `u64` 总量和截断标志。转换到 JS number 前检查安全整数范围，超出时返回明确错误，不能静默丢精度。
- [x] **Step 8: 接入前端调用方。** `buildResponseSnapshot` 优先使用原生计数与截断；原生已截断时无条件跳过完整 JSON 美化，不把可解析前缀误当全文。第 03 计划修改元数据函数时只需保留 `full` 参数。
- [x] **Step 9: 运行绿测。** 步骤 5 两条命令；预期 PASS。
- [ ] **Step 10: 记录度量与回滚条件。** 本地 1/10/100 MB 响应记录 RSS、JS heap、IPC 字节与可见时间；若完整模式解析回归，只回滚受影响调用方到 `full`。
- [x] **Step 11: 提交。** 原生读取随 `1f31829`、前端协议与快照随 `3fd4e98` 提交。

### Task 3: 原生 AI Channel、SSE 增量与取消

**Files:**
- Create（拟新增）: `src-tauri/src/ai_stream.rs`
- Modify: [lib.rs](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:1078)
- Modify: [Cargo.toml](/Users/ushopal/workspace/myself/esx/src-tauri/Cargo.toml:17)
- Test（拟新增）: `src-tauri/src/ai_stream.rs` 模块测试

**Interfaces:**
- Consumes: 现有 `ExecuteAiHttpRequestPayload` 验证和请求头规则；非流式 `execute_ai_http_request` 继续使用 Task 1 的 blocking `ai_client()`。
- Produces: 异步 `execute_ai_http_request_stream(payload: ExecuteAiHttpRequestPayload, request_id: String, on_event: tauri::ipc::Channel<AiStreamEvent>) -> Result<(), String>`；`cancel_ai_http_request(request_id: String) -> Result<(), String>`；`ack_ai_stream_chunk(request_id: String, sequence: u64) -> Result<(), String>`。事件 `{ requestId, sequence, kind: "headers" | "chunk" | "done" | "error", status?, statusText?, text? }`；headers 先于 chunk，sequence 单调，终态唯一。
- 约束: 异步 Client 单例使用与非流式相同的 120/15 秒超时、禁重定向策略；每个 chunk 最多 8 KiB UTF-8 文本、最多 8 个未 ACK chunk。注册表持取消信号与窗口计数，终态清理；不声称 Tauri 自身队列天然有背压。

- [x] **Step 1: 写首段与顺序失败测试。** 本地 loopback SSE 服务每隔 100 ms 发一段，断言首个 chunk 在服务关闭前到达、headers 在先、sequence 递增、终态唯一。
- [x] **Step 2: 写边界与错误失败测试。** 把中文/emoji 和 SSE `data:` 分跨 TCP chunk，断言重组原文；非 2xx 仍先发 headers，再交付错误 body 和 done，不吞掉错误。
- [x] **Step 3: 写取消失败测试。** 取消时服务端观察到连接关闭，原生不读/发后续 chunk，注册表清零；未知 requestId 不影响其他流。
- [x] **Step 4: 写窗口失败测试。** 不 ACK 时至多收到 8 个 chunk，ACK 某 sequence 后恰能再发送 1 个；重复 ACK 不额外放行，取消可唤醒等 ACK 的任务。
- [x] **Step 5: 运行红测。** `cargo test --manifest-path src-tauri/Cargo.toml ai_stream --lib`；预期 FAIL，缺少命令或窗口行为。
- [x] **Step 6: 配置依赖与 Client。** 在 `src-tauri/Cargo.toml` 增加 `tokio = { version = "1", features = ["macros", "sync", "time"] }`；流式路径用 `reqwest::Client` 异步单例，非流式仍走 blocking 池。
- [x] **Step 7: 实现发送与取消。** `tokio::select!` 覆盖 HTTP `send()`、`Response::chunk()`、窗口 permit 等待与取消信号；取消时 drop response 并释放注册项。不得靠可能不可恢复的 blocking read timeout 假装取消。
- [x] **Step 8: 实现窗口。** 原生最多持 8 个未 ACK 的 8 KiB 文本块；增量 UTF-8 解码跨网络 chunk 有状态，Channel 发送失败即终止。ACK 只释放对应尚未确认的 sequence。
- [x] **Step 9: 运行绿测。** `cargo test --manifest-path src-tauri/Cargo.toml ai_stream --lib`；预期 PASS。
- [x] **Step 10: 记录度量与回滚条件。** 记录首段接收至发送延迟、取消后连接关闭时间、未 ACK 峰值；若取消仍继续请求或终态丢失，流式入口暂退回非流式命令。
- [x] **Step 11: 提交。** 已随原生提交 `1f31829` 完成，包含依赖与已跟踪的 `Cargo.lock`。

### Task 4: 前端真正消费 Channel 并批量更新界面

**Files:**
- Modify: [tauri.ts](/Users/ushopal/workspace/myself/esx/src/lib/tauri.ts:119)
- Modify: [ai-analysis-client.ts](/Users/ushopal/workspace/myself/esx/src/lib/ai-analysis-client.ts:354)
- Modify: [ai-generate-client.ts](/Users/ushopal/workspace/myself/esx/src/lib/ai-generate-client.ts:110)
- Modify: [request-analysis.ts](/Users/ushopal/workspace/myself/esx/src/lib/request-analysis.ts:11)
- Modify: [console-page.tsx](/Users/ushopal/workspace/myself/esx/src/pages/console-page.tsx:527)
- Test（拟新增）: `src/lib/__tests__/ai-channel-stream.test.ts`；现有 [ai-sse-stream.test.ts](/Users/ushopal/workspace/myself/esx/src/lib/__tests__/ai-sse-stream.test.ts)、[console-page.test.tsx](/Users/ushopal/workspace/myself/esx/src/pages/__tests__/console-page.test.tsx)

**Interfaces:**
- Consumes: Task 3 的三个命令、事件结构与 8×8 KiB 窗口；现有 `readOpenAiSseStream` 与 `AiStreamDelta`。
- Produces: `openAiHttpStream(payload: ExecuteAiHttpRequestPayload, signal?: AbortSignal): Promise<Response>`，内部用 `Channel<AiStreamEvent>` 包装成可增量读的 `ReadableStream<Uint8Array>`；`postAiChatCompletion(..., stream, jsonResponse?, signal?)`；`analyzeRequestContentWithAiStream(request, onDelta, signal?)`、`generateRequestContentWithAiStream(request, onDelta, signal?)`。现有无 signal 调用兼容；非流式仍调用 `executeAiHttpRequest`。

- [x] **Step 1: 写真实增量失败测试。** mock Channel 在 invoke Promise 完成前发 headers/chunk，断言 `readOpenAiSseStream` 立即触发 `onDelta`；拆开的 SSE `data:` 与跨 chunk UTF-8 正确合并。
- [x] **Step 2: 写 ACK 失败测试。** Channel 事件进入待消费队列时不 ACK；`ReadableStream.pull()` 把块交给 reader 后才调用 `ack_ai_stream_chunk(requestId, sequence)`，不会重复 ACK。
- [x] **Step 3: 写取消失败测试。** AbortSignal 触发后 `cancel_ai_http_request` 恰调用一次，reader 拒绝并释放 Channel 订阅；迟到事件不更新界面，非流式连接测试仍走旧命令。
- [x] **Step 4: 写 UI 更新失败测试。** 连续 20 个 delta 在同一帧只产生一次 reasoning/content state 更新；关闭分析/生成对话框后调用 abort；取消不触发本地分析 fallback。
- [x] **Step 5: 运行红测。** `pnpm test src/lib/__tests__/ai-channel-stream.test.ts src/lib/__tests__/ai-sse-stream.test.ts src/pages/__tests__/console-page.test.tsx`；预期 FAIL，缺少 Channel、ACK 和取消调用。
- [x] **Step 6: 实现 `openAiHttpStream`。** 用 `Channel<AiStreamEvent>` 将最多 8 个待交付块包装成 `ReadableStream<Uint8Array>`；headers 到达即可构造 `Response`，done/error 结束或拒绝 reader，异步 invoke 失败同样终结流。
- [x] **Step 7: 传递取消信号。** `postAiChatCompletion`、分析与生成两条 stream 路径传递可选 `AbortSignal`；`request-analysis.ts` 对 `AbortError` 继续抛出，不能回退本地分析。
- [x] **Step 8: 批量更新界面。** 分析、生成分别持 `AbortController`；对话框关闭、切换请求和卸载时 abort。delta 缓存在 ref，每动画帧最多各更新一次 reasoning/content，结束时 flush 并清掉待执行帧。
- [x] **Step 9: 运行绿测。** 步骤 5 命令及 `pnpm test src/lib/__tests__/ai-analysis-client.test.ts src/lib/__tests__/ai-generate-client.test.ts src/lib/__tests__/request-analysis.test.ts`；预期 PASS。
- [ ] **Step 10: 记录度量与回滚条件。** 本地数秒 SSE 测首段可见时间、React commit 次数、取消关闭时间；若仍到末段才显示，回滚前端流式入口。
- [x] **Step 11: 提交。** 已随前端提交 `3fd4e98` 完成（`feat: 接入响应预览与可取消流式输出`）。

### Task 5: SSH 超时、取消、双流读取与有界会话复用

**Files:**
- Create（拟新增）: `src-tauri/src/ssh_transport.rs`
- Modify: [lib.rs](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:770)
- Modify: [Cargo.toml](/Users/ushopal/workspace/myself/esx/src-tauri/Cargo.toml:17)
- Modify: [tauri.ts](/Users/ushopal/workspace/myself/esx/src/lib/tauri.ts:79)
- Modify: [http-client.ts](/Users/ushopal/workspace/myself/esx/src/lib/http-client.ts:636)
- Modify: [console-page.tsx](/Users/ushopal/workspace/myself/esx/src/pages/console-page.tsx:599)
- Test（拟新增）: `src-tauri/src/ssh_transport.rs` 模块测试；Task 2 的 `src/lib/__tests__/http-client-transport.test.ts`
- Test: [console-page.test.tsx](/Users/ushopal/workspace/myself/esx/src/pages/__tests__/console-page.test.tsx)

**Interfaces:**
- Consumes: Task 2 的 `readMode`/`previewBytes` 与响应计数；现有 SSH host key 与认证函数原样复用。
- Produces: SSH payload 增加可选 `requestId`，命令 `cancel_ssh_http_request(request_id: String) -> Result<(), String>`；前端 `executeSshHttpRequest(payload, signal?: AbortSignal)` 生成 requestId 并在 abort 时调用取消命令。`executeConsoleRequest(..., options?: { responsePreviewBytes?: number; signal?: AbortSignal })` 向下传递 signal；Console 页每次运行持 `AbortController`，点击取消、切换连接或卸载时 abort，并在多条命令间检查取消。
- Produces: `type CancellationToken = std::sync::Arc<std::sync::atomic::AtomicBool>`；`SshSessionPool::checkout(config: &SshTunnelConfig, secret: Option<&str>, cancel: &CancellationToken) -> Result<SshLease, String>`；池最多 4 个**总**会话（活跃加空闲），满时最多等 2 秒且可取消，空闲 TTL 60 秒。池键仅含非敏感连接/host-key/私钥文件版本；凭据一致性以进程内随机 HMAC 密钥算不可逆 tag，与池条目比较，绝不输出或落盘。写请求失败永不自动重试。
- 常量: DNS 5 秒，TCP connect 10 秒，握手与认证各 15 秒，远端 curl `connect-timeout=10`、`max-time=60` 秒，本地总截止 75 秒。已建通道取消轮询不超过 250 ms；握手中取消最多受单阶段 15 秒上界约束，不能宣称即时。

- [x] **Step 1: 写超时失败测试。** 用假 resolver、连接器与 clock，断言 DNS/TCP/握手认证/curl/本地总截止分别为上述上界；curl 配置脚本包含 `connect-timeout = 10` 与 `max-time = 60`。
- [x] **Step 2: 写取消失败测试。** 假通道持续给数据，取消后读取终止、租约丢弃且活动计数归零；池满等待中的请求取消立即退出，绝不启动远程 curl。
- [x] **Step 3: 写双流失败测试。** 假 channel 交替输出 stdout/stderr，其中 stderr 超过单侧缓冲；断言无互锁，stderr 诊断有界且 stdout 正确保留响应。实际状态尾标记为 [lib.rs:930](/Users/ushopal/workspace/myself/esx/src-tauri/src/lib.rs:930) 的 `\n__ESX_STATUS__:`；预览计数排除尾标记，能解析状态码。
- [x] **Step 4: 写池失败测试。** 同配置顺序 GET 仅握手一次；配置、host key、私钥文件版本或 SSH 密码改变后不复用旧会话；4 个活跃占满时第 5 个不新建连接，超时或取消退出。
- [x] **Step 5: 写写请求失败测试。** POST/PUT/PATCH/DELETE 在断线、取消与复用失效后，每种请求的远程 `channel.exec` 计数恒为 1；不自动重放。
- [x] **Step 6: 写前端失败测试。** `AbortSignal` 传至 SSH 包装器后只调用一次 `cancel_ssh_http_request`；Console 取消、切换连接和卸载会 abort，批量请求不执行下一条。直连 ES 行为保持现状。
- [x] **Step 7: 运行红测。** `cargo test --manifest-path src-tauri/Cargo.toml ssh_transport --lib`、`pnpm test src/lib/__tests__/http-client-transport.test.ts src/pages/__tests__/console-page.test.tsx`；预期 FAIL。
- [x] **Step 8: 加依赖与超时。** `src-tauri/Cargo.toml` 使用 `tokio = { version = "1", features = ["macros", "sync", "time", "net"] }`（若 Task 3 已实施则仅补 `net`）；将 `ring` 从 dev-dependencies 移至 dependencies，用随机进程密钥和 HMAC 作短期凭据 tag。DNS 用 `tokio::net::lookup_host` 加 5 秒 timeout，TCP 对已解析地址用 `TcpStream::connect_timeout` 且共用 10 秒预算；SSH 阻塞阶段用 socket timeout 与 `Session::set_timeout`。
- [x] **Step 9: 实现无互锁读取。** 握手认证后把 session 设非阻塞，短轮询交替排空 stdout/stderr，检查取消与 75 秒总 deadline；缓冲区满时仅累计大小/丢弃超额 stderr。stdout 预览保留有界前缀与末尾 64 字节尾缓冲，以识别 `\n__ESX_STATUS__:`，并只统计 body 字节；`full` 模式保持原文。
- [x] **Step 10: 实现会话池。** 4 是活跃+空闲总量上界；池锁只保护索引、容量和租约，不包住握手、认证或网络 I/O。每次 checkout 核对 host key 与凭据 tag；超时、取消、协议错误或失效会话一律丢弃，写请求不做重试。
- [x] **Step 11: 接入取消链。** `tauri.ts` 绑定 signal→requestId→原生取消；`http-client.ts` 从 Console options 下传；`console-page.tsx` 增加运行中取消操作并在关闭/切换时 abort，状态避免把取消当成功保存。SSH validation 也使用明确 DNS/TCP/握手认证上界。
- [x] **Step 12: 运行绿测。** 步骤 7 两条命令；预期 PASS。
- [ ] **Step 13: 记录度量与回滚条件。** 记录活动会话/阻塞任务数、握手次数、取消释放上界与 p95；若池导致互锁或遗留任务，先关闭池入口，保留已验证的超时修复。
- [x] **Step 14: 提交。** 原生期限与会话管理随 `1f31829`、前端取消链随 `3fd4e98` 提交。

## 集成验收与回滚

- [x] 按上述任务依赖执行；每任务只跑目标红绿测试，最后运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib`、`pnpm test`、`pnpm build`，预期全部 PASS。ES、非流式 AI 与 SSH 保留 `spawn_blocking`；AI SSE 按 Task 3 使用 async。
- [ ] 同机用本地服务对比改动前后：HTTP keep-alive accept 次数和 p50/p95；1/10/100 MB 时 RSS、JS heap、IPC bytes；数秒 SSE 首段可见时间与取消释放时间；SSH 握手次数、活动任务数和黑洞/卡住场景退出上界。只记时长和字节，不采集凭据或响应内容。
- [x] 已记录回滚策略：先恢复受影响入口的旧路径，保留已验证的安全边界；必须重新跑该任务目标测试。完整模式的元数据、状态、治理解析正确性与 host key/TLS 隔离是发布门槛。共享协议采用原生、前端、文档三个提交，任务入口回滚方式见验收记录。


## 2026-09-29 实施记录

五项任务的实现、目标回归测试及独立审查已完成。最终 `cargo test --lib` 为 74 项通过、3 项手动基准默认忽略，`pnpm test` 为 100 个文件、961 项通过；`cargo check --lib` 与 `pnpm build` 通过。手动基准已单独运行，完整命令、测试边界与回滚入口见 [实施验收记录](../../PERFORMANCE_NATIVE_TRANSPORT_2026-09-29.md)，数据与复现方式见 [本地基准报告](../../PERFORMANCE_NATIVE_TRANSPORT_BENCHMARK_2026-09-29.md)。

执行时补充修复了逐块读取重置超时、ACK 等待总期限、原生字节数与 BOM/charset 解码差异、Channel 尾部晚于 invoke 交付、首次保存引发错误自取消，以及 SSH 实际后台资源与连接析构问题。

| 原步骤 | 已验证证据 | 保留的待验收项 |
| --- | --- | --- |
| Task 2 Step 10 | 1/10/100 MiB 生产 reader 与响应类型的序列化字节、读取/序列化耗时、测试进程 RSS，Node JSON.parse heap 代理 | 真实 WebView heap、Tauri IPC envelope 和页面可见时间 |
| Task 4 Step 10 | loopback SSE 提前交付、取消关闭连接、8 块窗口；每帧 20 个 delta 合并为各一次状态更新 | 桌面首段可见时间、React Profiler commit 次数 |
| Task 5 Step 1 | 可控阶段时钟输入、resolver、连接器/通道覆盖预算和总期限；curl 脚本常量断言 | 没有搭建完整假 SSH 协议服务；目标服务器阶段黑洞故障仍需实测 |
| Task 5 Step 13 | 池总容量 4、实际阻塞任务 4、DNS 实际任务 4；3 次 checkout 仅创建 1 次连接；取消和池等待上界 | 真实 SSH 握手次数、p95 与目标系统资源释放采样 |
| 集成性能验收 | 本地 HTTP keep-alive 20 次请求 accept/build 从 20/20 降为 1/1；基准与功能测试通过 | 上述桌面与真实 SSH 指标，以及 Windows 编译/实机验证 |

未完成的性能验收项保持未勾选，不用 Node 或 debug 单轮数据替代真实桌面结果。非 Unix 文件私钥认证暂不复用会话；空闲 TTL 为 checkout 时惰性淘汰；OS DNS/文件系统不可强制取消等限制详见验收记录。
