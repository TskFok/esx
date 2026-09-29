# 原生传输本地实验度量

日期：2026-09-29。环境：macOS 26.5.2 arm64，Rust 1.93.1，Node v25.5.0。Rust 为现有 debug/test 构建，数字是单轮本机样本，不作为生产 SLA 或统计稳定性结论。所有网络均为 127.0.0.1，无账号、真实正文或公网请求。

## 实验入口与验证

新增 `src-tauri/src/transport_bench.rs` 三个 ignored 手动测试；`lib.rs` 仅追加 cfg(test) 模块；`http_client_pool.rs` 仅追加 cfg(test) build_count 读取访问器，用实际生产池构建计数，不估算命中次数。默认执行 transport_bench：0 passed、0 failed、3 ignored；大正文不会随默认 cargo test/pnpm test 执行。

编译一次，然后直接运行测试二进制，RSS 不包含 cargo/rustc：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib transport_bench --no-run
# 使用上一命令输出的 Executable 路径；以下为本次路径
bench_bin=src-tauri/target/debug/deps/esx_lib-2c76815ce77c5908
/usr/bin/time -l "$bench_bin" transport_bench::harness_baseline --exact --ignored --nocapture
/usr/bin/time -l "$bench_bin" transport_bench::sequential_clients --exact --ignored --nocapture
for mib in 1 10 100; do
  for mode in full preview; do
    BENCH_MIB="$mib" BENCH_MODE="$mode" /usr/bin/time -l "$bench_bin" transport_bench::response_memory --exact --ignored --nocapture
  done
done
```

绑定本地端口需要当前沙箱外执行，已由自动审核允许。八次独立二进制运行全部返回 0；每个 response case 都断言 totalBytes 和保留正文长度。fixture 在计时前已创建监听并启动线程，不包含 fixture 启动时间。

## 20 次顺序 HTTP：每次构建与共享池

旧路径逐请求调用生产 es_http_client_builder 构建 Client，新路径调用生产 HttpClientPool；两个路径仅为本地测试禁用系统代理。服务端真实统计 accept；新池 builds 读取现有 AtomicUsize，旧 builds 是明确执行的 20 次构建。响应体都是两个字节，计时包含获取/构建客户端、完整 HTTP 请求、读取正文及本轮 Client drop，不含 fixture 启动。没有预热，p50/p95 为 20 个排序样本的第 10/19 个。

| 路径 | 请求 | accept | build | p50 μs | p95 μs |
| --- | ---: | ---: | ---: | ---: | ---: |
| build_each | 20 | 20 | 20 | 411 | 624 |
| pool | 20 | 1 | 1 | 153 | 304 |

## 真实本地 HTTP 正文：Full 与 256 KiB Preview

服务端分块写固定 ASCII fixture（64 KiB 缓冲），客户端使用生产池与 reader；每个场景单独启动测试二进制。读取计时从 response headers 已取得后开始，至读到 EOF 完成；Preview 同样完整排空，因此 totalBytes 是实际收到的原始正文总量。未预先分配完整服务端正文。

序列化调用 serde_json::to_vec，使用生产 HttpResponsePayload 类型，status=200、statusText=OK、errorMessage=null、diagnostics=[]。这是**拟发送响应 payload 的真实 JSON 序列化字节数**，不是抓到的 Tauri IPC wire/envelope 字节。实际调用包含不同 diagnostics 等字段时会变化。

| 正文 MiB | 模式 | totalBytes | 保留 bytes | JSON payload bytes | 读取 ms | 序列化 ms | 峰值 RSS bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | full | 1048576 | 1048576 | 1048708 | 3.474 | 46.394 | 20496384 |
| 1 | preview | 1048576 | 262144 | 262275 | 2.239 | 11.687 | 17776640 |
| 10 | full | 10485760 | 10485760 | 10485893 | 15.101 | 375.700 | 41762816 |
| 10 | preview | 10485760 | 262144 | 262276 | 8.563 | 11.194 | 18612224 |
| 100 | full | 104857600 | 104857600 | 104857734 | 158.006 | 3164.957 | 229228544 |
| 100 | preview | 104857600 | 262144 | 262277 | 34.914 | 7.778 | 18038784 |

最终 reader 使用 encoding_rs decoder 保留 Preview charset/BOM 后，已用最新现成测试二进制重新运行上述六组响应实验，全部通过。这里只刷新响应表与对应 RSS；20 请求连接实验、Node 代理表及以下 harness 基线保留此前样本，未重复运行，不能将跨轮差异全部归因于代码变化。

空 harness 基线 RSS：10,846,208 bytes；连接对比测试整体峰值 RSS：16,482,304 bytes。RSS 来源 macOS `/usr/bin/time -l` 的 maximum resident set size，包含测试框架、本地服务端线程、网络/runtime、正文和序列化 Vec 的峰值；未减基线，不声称为正文的独立内存分配值。Full 会同时保留正文与序列化输出，Preview 两者均有界。最终 reader 复测的 100 MiB Preview RSS 为 18,038,784 bytes，Full 为 229,228,544 bytes；未运行真实 UI，无法据此推断整应用 RSS。

## Node JSON.parse heap 代理实验

六个场景分别启动 Node --expose-gc，以相同字段/顺序构造等价序列化 payload；ASCII fixture 与原生实验一致，序列化字节数逐项吻合。先构建/扁平化输入、显式 GC，再记录 heapUsed；计时只包含 JSON.parse；保持输入和解析结果存活，再 GC 并记录增量。增量包含 V8 对象和少量计时代码开销，不是纯字符串长度。**这是 Node/V8 代理实验，不是 Tauri WebView JS heap。**

| 正文 MiB | 模式 | 序列化 bytes | parse ms | heapBefore bytes | heapAfter bytes | heapDelta bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | full | 1048708 | 0.630 | 5039000 | 6190832 | 1151832 |
| 1 | preview | 262275 | 0.142 | 3465664 | 3831520 | 365856 |
| 10 | full | 10485893 | 5.336 | 23913368 | 34502408 | 10589040 |
| 10 | preview | 262276 | 0.267 | 3465512 | 3831544 | 366032 |
| 100 | full | 104857734 | 70.186 | 212651016 | 317617928 | 104966912 |
| 100 | preview | 262277 | 0.130 | 3465712 | 3831784 | 366072 |

可复现命令（替换 `100 full` 为六种组合；正文不输出）：

```sh
node --expose-gc --input-type=module - 100 full <<'JS'
const [sizeArg, mode] = process.argv.slice(2);
const totalBytes = Number(sizeArg) * 1024 * 1024;
const retained = mode === 'full' ? totalBytes : 256 * 1024;
const input = JSON.stringify({ok:true,status:200,statusText:'OK',bodyText:'x'.repeat(retained),errorMessage:null,diagnostics:[],totalBytes,truncated:mode !== 'full'});
// 提前扁平化序列化输入，避免把 string flatten 计入解析正文的增量。
Buffer.byteLength(input); global.gc();
const before = process.memoryUsage().heapUsed;
const started = performance.now();
const parsed = JSON.parse(input);
const parseMs = performance.now() - started;
global.gc();
const after = process.memoryUsage().heapUsed;
console.log(JSON.stringify({mib:Number(sizeArg),mode,serializedBytes:Buffer.byteLength(input),heapBefore:before,heapAfter:after,heapDelta:after-before,parseMs,bodyLength:parsed.bodyText.length}));
JS
```

## 证据与未测边界

原始数字：`/tmp/esx-native-bench-results.json`；各二进制 stdout/stderr/time 输出：`/tmp/esx-bench-<test>-<mib>-<mode>.log`。复现源码已保存在仓库手动测试中，临时结果文件可能随系统清理消失。

本轮验证了本地连接/构建次数、响应原始总量、有界保留、实际序列化 payload 字节、读取/序列化时间及不含编译的测试进程 RSS。尚未测真实 Tauri IPC envelope、WebView 内存、页面首个可见时刻、真实 SSH 服务端性能、生产 TLS/代理或真实 AI 服务。Node 数据和本地 debug 数据不能冒充这些指标。

审查发现的 ES 慢滴流超时问题已修复，full/preview 短预算测试通过；详见同目录实施验收记录。性能数据没有替代安全/功能测试。
