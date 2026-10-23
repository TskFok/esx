# 2026-10-23 依赖安全审计

审计范围为 `pnpm-lock.yaml` 的 npm 依赖、`src-tauri/Cargo.lock` 的 Rust 依赖，以及 Tauri 官方安全公告。未添加漏洞忽略规则；版本扫描通过不代表应用不存在其他安全问题。

## 已更新的依赖

| 依赖 | 原版本 | 修复后版本 | 修复依据 |
| --- | --- | --- | --- |
| Tauri | 2.10.3 | 2.12.5 | [IPC 访问控制漏洞](https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv)，并覆盖 2.11.1 的来源判断修复 |
| Tauri JS API / CLI | 2.10.1 | 2.12.4 | 与原生层保持 2.12 系列兼容 |
| rustls | 0.23.38 | 0.23.46 | RUSTSEC-2026-0285、0346、0348、0349 |
| rustls-webpki | 0.103.13 | 0.103.16 | RUSTSEC-2026-0382 |
| h2 | 0.4.13 | 0.4.20 | RUSTSEC-2026-0258 |
| quick-xml | 0.38.4 | 0.42.0 | 通过 plist 升级，修复 RUSTSEC-2026-0194、0195 |
| anyhow / event-listener | 1.0.102 / 5.4.1 | 1.0.104 / 5.4.2 | 修复 RUSTSEC-2026-0190、0221 的健全性问题 |
| Vite | 7.3.5 | 7.3.7 | 修复开发服务器与编辑器启动相关的 5 条告警 |
| Vitest / @vitest/mocker | 4.1.11 | 4.1.12 | GHSA-qxg6-89mg-rqv8、GHSA-xp26-3454-mjgp |
| source-map-js | 1.2.1 | 1.2.2 | GHSA-68fv-2mgg-jv7q |
| postcss-selector-parser | 6.1.4 | 6.1.5 | GHSA-rj75-hqrm-r3gf 的 6.x 回补，保持 Tailwind 3 兼容 |

## 扫描中仍会显示的告警

### npm 开发依赖

- `postcss-selector-parser@6.1.5`：上游[安全公告](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf)已列出 6.1.5 为修复版，但本次 npm 审计数据库仍将所有 `<7.1.6` 判为受影响。保留告警，等待数据库同步。
- `braces@3.0.3`：[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 暂无已发布的上游修复。Tailwind 3 经 chokidar 和 fast-glob → micromatch 引入它；升级 chokidar 一条路径无法消除问题。采用本地补丁限制解析及 AST 遍历深度，版本仍为 3.0.3，因此版本审计仍会报告该项。补丁需随锁文件安装，上游发布修复后应移除本地补丁并重新验证。

这两项均位于开发工具链，`pnpm audit --prod` 为 0 条告警。

braces 补丁采用不可由调用方提高的 100 层深度上限，超限时抛出 `SyntaxError`；覆盖字符串的花括号/圆括号解析、直接 AST 的 compile/expand/stringify 以及 expand 的 parent 链。它针对该公告的深层嵌套问题，不是通用的展开数量限制。

### Rust 上游依赖

`cargo audit` 的漏洞项由 8 降至 0，维护/健全性警告由 14 降至 7：

| 依赖 | 警告 | 说明 |
| --- | --- | --- |
| glib 0.18.5 | RUSTSEC-2024-0429，unsound | Tauri 的 Linux GTK3 依赖；修复要求 glib ≥0.20，无法作为当前 GTK3 链的兼容替换 |
| rand 0.7.3 | RUSTSEC-2026-0097，unsound | 来自 selectors → phf_codegen 构建链；当前未启用公告所需的 `log` feature |
| fxhash 0.2.1 | RUSTSEC-2025-0057，停维 | 来自 tauri-utils → kuchikiki → selectors |
| proc-macro-error 1.0.4 | RUSTSEC-2024-0370，停维 | 来自 GTK3 宏依赖 |
| zbus_names 4.3.1 | RUSTSEC-2026-0371，停维 | Tauri opener 的 zbus 5 依赖链 |
| zvariant 5.10.0 | RUSTSEC-2026-0370，停维 | 同上 |
| zvariant_derive 5.10.0 | RUSTSEC-2026-0372，停维 | 同上 |

这些警告未被屏蔽，后续需随 Tauri/GTK/DBus 上游迁移继续处理。

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
```

完整 npm 审计仍因上述两项返回非零退出码，不能据此声称“全部告警清零”。

## 本次验证结果

- `pnpm test --maxWorkers=2`：101 个测试文件、991 项测试全部通过，包含 30 项新增 braces 回归测试。
- `pnpm build`：通过；升级前后两个 CSS 产物内容一致。仍有原有的大 chunk 提示。
- `cargo check --locked`：通过。
- `cargo test --locked`：74 项通过，3 个原有手动性能基准保持忽略。
- 独立临时目录的 `pnpm install --frozen-lockfile --ignore-scripts`：通过，两个 braces 消费路径均验证会拒绝深层嵌套。
- 独立审查的 4500 次 braces 正常输入差分：补丁前后输出一致。

最初默认并行测试在组件用例中触发 4 次超时；限制 worker 数后相关用例和全量测试均通过，未延长用例超时或修改业务逻辑。本机原生验证平台为 macOS，未执行 Linux/Windows 构建。
