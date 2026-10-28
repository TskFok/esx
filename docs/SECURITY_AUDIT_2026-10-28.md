# 2026-10-28 依赖安全审计

本次复核 npm/pnpm 锁文件、Tauri 官方安全公告及 Rust/Cargo 锁文件。改动在当前分支完成，没有新增漏洞忽略规则，保留此前的 braces 安全补丁。

## 扫描结果

| 范围 | 修复前 | 修复后 |
| --- | --- | --- |
| npm 全量依赖 | 8 条漏洞：4 高危、4 中危 | 0 |
| npm 生产依赖 | 0 | 0 |
| Cargo 漏洞项（vulnerabilities） | 0 | 0 |
| Cargo 健全性及停维警告（warnings） | 8 | 7 |

上述结果仅代表本次依赖公告扫描；Cargo 的 7 条警告仍需保留跟进。

## 已修复

### undici 7.30.0 → 7.30.1

受影响路径为开发依赖 `jsdom → undici`。[上游 7.30.1 发布说明](https://github.com/nodejs/undici/releases/tag/v7.30.1)确认修复以下公告：

| 公告 | 严重程度 | 问题 |
| --- | --- | --- |
| GHSA-xjj6-f33q-929c | 高 | 过多 content-encoding 导致未处理错误及进程退出 |
| GHSA-4w7w-5xrc-9h26 | 高 | 跨源重定向导致缓存污染和跨用户数据泄露 |
| GHSA-2m5v-pch6-74hx | 高 | Agent 丢失自定义 TLS 校验回调 |
| GHSA-qrxm-fqhp-jwvm | 高 | TLS 1.2 证书变更重协商导致进程退出 |
| GHSA-4qv8-2p9j-2685 | 中 | EventSource 解析器内存增长失控 |
| GHSA-f72v-6w45-q472 | 中 | 非小写算法标识绕过资源完整性校验 |
| GHSA-9fm3-97px-rjf6 | 中 | WebSocket 自动 PONG 缓冲无界增长 |
| GHSA-55wc-3pg8-jfw6 | 中 | 解压拦截器未处理异常导致进程退出 |

将 `pnpm-workspace.yaml` 的安全版本下限提高到 7.30.1，并同步锁文件。继续限制 `<8`，保持 jsdom 29 对 undici 7 内部模块的兼容性。

新增 `scripts/undici-security.test.mjs`，通过 jsdom 实际解析到的 undici 验证小写、大写和混合大小写的 SHA-256 完整性校验。测试只使用 data URL，不访问外网。升级前，大写和混合大小写的两项篡改内容测试确实失败；升级后，6 项行为测试全部通过。现有安全版本约束测试同步更新。

### Tokio 1.52.1 → 1.53.3

[RUSTSEC-2026-0386](https://rustsec.org/advisories/RUSTSEC-2026-0386.html)列为 `unsound`：`AsyncFd` 的安全构造接口无法保证文件描述符有效性，可能造成释放后使用。1.53.3 属于官方修复版本。

将 `Cargo.toml` 的 Tokio 下限提高到 1.53.3，并只定向更新该包的锁定版本与校验和。

### Tauri 核对

当前锁定 Tauri 2.12.5，声明下限 2.11.6，已覆盖 [GHSA-w28w-mhc8-qvjv](https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv) 的修复下限。本次无需更改 Tauri 版本。Tauri JS API/CLI 及插件已纳入相应 npm/Cargo 锁文件扫描。

## 剩余 Rust 上游警告

| 依赖 | 公告 | 原因与限制 |
| --- | --- | --- |
| glib 0.18.5 | RUSTSEC-2024-0429，unsound | Tauri 的 Linux GTK3 链要求 glib 0.18；修复版 ≥0.20 无法直接作为兼容替换 |
| rand 0.7.3 | RUSTSEC-2026-0097，unsound | selectors → phf_codegen 构建依赖；当前未启用公告所需的 `log` feature |
| fxhash 0.2.1 | RUSTSEC-2025-0057，停维 | tauri-utils → kuchikiki → selectors 的传递依赖 |
| proc-macro-error 1.0.4 | RUSTSEC-2024-0370，停维 | GTK3 宏依赖 |
| zbus_names 4.3.1 | RUSTSEC-2026-0371，停维 | Tauri opener 的 zbus 5 依赖链 |
| zvariant 5.10.0 | RUSTSEC-2026-0370，停维 | 同上，迁移 zbus 6 需要上游适配 |
| zvariant_derive 5.10.0 | RUSTSEC-2026-0372，停维 | 同上 |

这些警告未被屏蔽，不能把 Cargo 的零漏洞项理解为所有安全问题均已消除。保留现有兼容版本，后续随 Tauri/GTK/DBus 上游迁移处理。

此前 2026-10-23 记录中的 braces/postcss-selector-parser 告警在本次 npm 审计中未再出现；保留原有安全补丁及回归测试，不改写历史扫描结果。

## 复核命令

```sh
pnpm install --frozen-lockfile
pnpm audit
pnpm audit --prod
pnpm test --maxWorkers=2
pnpm build
cargo audit --file src-tauri/Cargo.lock
CARGO_BUILD_JOBS=2 cargo check --manifest-path src-tauri/Cargo.toml --locked
CARGO_BUILD_JOBS=2 cargo test --manifest-path src-tauri/Cargo.toml --locked
git diff --check
```

## 验证结果

- `pnpm install --frozen-lockfile`：通过，锁文件与配置一致。
- `pnpm audit` / `pnpm audit --prod`：均退出 0，未发现已知漏洞。
- `pnpm test --maxWorkers=2`：102 个文件、997 项测试全部通过，包含原有 braces 补丁测试及新增的 6 项 undici 行为测试。
- `pnpm build`：通过，仍有原有的大 chunk 提示。
- `cargo audit`：退出 0，漏洞项 0；仍报告 5 条停维和 2 条健全性警告。RustSec 数据库更新于 2026-10-27，提交为 `99670cfc0bc574433034b75876a4b791ccaa2efb`。
- `cargo check --locked`：通过。
- `cargo test --locked`：74 项通过、0 失败，3 个原有手动性能基准保持忽略。
- `git diff --check`：通过。

本机验证平台为 macOS；未执行 Linux/Windows 构建或桌面安装包打包。
