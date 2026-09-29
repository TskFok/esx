# 原生传输优化实施与验收（2026-09-29）

对应计划：`docs/superpowers/plans/2026-09-28-performance-04-native-transport.md`。在现有 `master` 分支实施，没有创建分支或推送远端。

## 已实现行为

- HTTP：最多 8 个 ES 传输配置与 1 个非流式 AI Client。TLS 模式、指纹、规范 CA 路径及 CA 内容 SHA-256 隔离；同路径、同长度、同 mtime 换证书仍失效。凭据仅设置在单次请求中。
- 响应：Console 显式 `preview`，预览上限沿用用户设置（默认 256 KiB）；元数据、状态、治理和连接探测显式 `full`。继续排空响应以复用连接并计算真实总字节，UTF-8 末尾和非法字节替代后的输出都受上限约束；直连完整与预览模式均保留 charset/BOM 解码。
- AI：独立异步 reqwest Client，通过 Tauri Channel 按 headers/chunk/done/error 传递增量。每块最多 8 KiB、最多 8 个未 ACK 块；前端仅在 reader 消费时 ACK。取消覆盖等待响应、读取正文和等待窗口；正常和异常终态清理注册。120 秒总期限包含等待 ACK。
- 页面：分析与生成每帧合并 reasoning/content 更新；关闭、切换、卸载时取消并丢弃迟到输出。Console 运行中提供“取消运行”，停止后续批次和迟到保存；直连 ES 不新增原生取消承诺。首次保存引发的内部请求 ID 变化不会取消已完成请求的日志、审计和提示。
- SSH：DNS、TCP、握手、认证、远程 curl、本地总期限分别有明确边界；非阻塞交替排空 stdout/stderr，stderr 有界；预览保留末尾状态标记并排除标记字节。池最多 4 个活跃加空闲会话、等待最多 2 秒，闲置 60 秒后不可复用。凭据以随机进程 HMAC 标签比较，私钥内容参与校验；失败与取消丢弃连接，不自动重连或重放写请求。

ES、非流式 AI、SSH 保留 `spawn_blocking`。URL 同源、无重定向、host key 校验、TLS 指纹/CA 与 keyring 边界保持。ES 请求级 60 秒、AI 120 秒和连接 15 秒不因逐块读取/ACK 等待而失效。

## 审查中修复的回归

1. reqwest blocking Client 的默认 timeout 会在 `Read::read` 时重新使用；显式 RequestBuilder timeout 将总期限传入底层响应，慢滴流不再无限排空。
2. AI 窗口等待不轮询 HTTP body 时，仍由外层总期限终止。
3. 原生字节数可能小于解码后的 UTF-8 字符串长度；快照及持久化保留原生真实计数。
4. 首次保存草稿的内部 ID 变化与用户切换分开处理，避免漏报执行失败或成功审计。
5. Tauri invoke 完成可以早于最后 Channel 数据交付；成功 invoke 不再被当作缺少终态，前端等待 done/error 并排空待消费块。
6. 原生去除 BOM 后正文长度与原始字节数不同，前端尊重显式 truncated 标志，预览同样去除 UTF-8 BOM。
7. SSH 的 DNS 后台工作、特殊私钥文件和非阻塞 libssh2 析构均需按实际资源生命周期限制，不能仅依赖池计数。

## 验证与度量

所有 fixture 都使用本地合成数据，不需要真实 ES、AI、SSH 账号，不记录响应正文或凭据。

完整数据、复现命令和采样边界见 [本地基准报告](PERFORMANCE_NATIVE_TRANSPORT_BENCHMARK_2026-09-29.md)。单轮 debug/test 构建样本：

| 度量 | 原路径/完整模式 | 新路径/预览模式 |
| --- | ---: | ---: |
| 同源顺序 20 请求 accept / Client build | 20 / 20 | 1 / 1 |
| 请求 p50 / p95 | 411 / 624 μs | 153 / 304 μs |
| 100 MiB 正文的响应 JSON 序列化 | 104,857,734 bytes | 262,277 bytes |
| 同一场景测试进程峰值 RSS | 229,228,544 bytes | 18,038,784 bytes |
| Node 等价 payload JSON.parse heap 增量 | 104,966,912 bytes | 366,072 bytes |

RSS 包含测试框架和本地服务器，未减 10,846,208 bytes 空 harness 基线，不代表整个桌面应用。统计排除编译和 fixture 启动，不将这些单轮数据当作生产 SLA。

AI 本地 SSE 首段约 42–63 ms，在服务器结束前已交付；取消后服务端观察连接关闭约 0.2–0.6 ms。8 块窗口只在对应 ACK 后放行，重复 ACK 无额外额度。页面确定性测试验证同帧 20 个 delta 合并成 reasoning/content 各一次更新。

最终验证均通过：

- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：74 项通过，3 项手动基准默认忽略；手动基准已另行运行。
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`：通过，无警告。
- `pnpm test`：100 个测试文件、961 项测试通过。
- `pnpm build`：通过；保留已有的 Vite 大 chunk 提示。
- `git diff --check`：通过。

SSH 的阶段预算使用可控 `Instant` 输入测试，连接池和双流使用假连接器/通道，DNS 使用可控 resolver；没有构建完整的假 SSH 握手服务器。测试覆盖阶段剩余预算、实际后台工作容量、取消后的资源释放以及写请求不重放；真实服务器握手延迟和 p95 未测。

## 测量边界与回滚

自动化与本机 loopback 测试证明协议和资源边界，不等于真实桌面性能验收。Node 的 JSON 字节/heap 测量仅是 IPC 接收侧代理指标；真实 Tauri Channel IPC 开销、WebView JS heap、首段可见时间、React Profiler、生产 SSH 握手/黑洞故障和跨平台运行仍需在目标桌面环境采样。

本轮仅验证 macOS，Windows 未编译或实测；Windows 等非 Unix 平台使用文件私钥认证时暂不复用会话，避免私钥文件替换竞态导致身份混用。会话空闲 TTL 在下次 checkout 时清理，不是到 60 秒自动关闭 socket。

操作系统 DNS 和文件系统调用不能强行中止：DNS 实际未结束任务最多 4 个，SSH 实际阻塞任务最多 4 个；对调用方实施总截止并不代表内核工作已立即结束。私钥仅接受最大 1 MiB 的普通文件，但 NFS/内核阻塞或校验后被替换为特殊文件仍可能延后底层任务退出。

## 提交方式

在当前 `master` 按原生、前端、文档三个范围提交，未推送。原生提交为 `1f31829`（`refactor: 优化原生传输并限制资源占用`），前端提交为 `3fd4e98`（`feat: 接入响应预览与可取消流式输出`）；本文与计划状态单独提交。五个任务共享命令与响应协议，因此合并提交边界以保持中间版本接口兼容；任务级回滚应按下面的入口处理，不能直接把一个提交等同于计划中的一个任务。

若 TLS/CA/host key 隔离失败，暂停使用相关新入口。若完整 JSON 解析回归，将受影响调用方保持为 `full`；不要依赖预览前缀解析完整 JSON。AI 可临时切回原非流式命令；SSH 池回归时可禁用复用并保留已经验证的期限和取消。任何回滚后都必须重跑对应目标测试与完整读取/安全校验测试。
