# 启动加载与 Monaco 验收记录

测量日期：2026-09-28。环境：macOS 26.5.2、Apple M1（arm64）、Node 25.5.0、pnpm 10.28.2。构建入口为 `pnpm build`，依赖检查命令为 `node scripts/performance/startup-bundle.mjs dist`。`dist/.vite/manifest.json` 给出页面入口，`dist/performance-chunks.json` 给出最终 JS chunk 的 UTF-8 字节数、静态/动态依赖和相对项目根目录的模块标识。静态闭包只沿 `imports` 遍历并去重；gzip 是对各闭包文件分别 gzip 后求和的参考值。桌面应用从本地读取资源，gzip 不代表实际启动传输量。

| 指标 | 优化前基线 | 本轮构建 |
| --- | ---: | ---: |
| 连接页初始 JS 原始字节 | 4,041,186 | 515,542 |
| 连接页初始 JS gzip 参考值 | 约 1.07 MB | 157,941 字节 |
| 初始静态闭包 | 单一入口 JS | `assets/index-CHm1jRsu.js` |
| 初始闭包含 Monaco | 是 | 否 |
| 动态编辑器 JS | 未独立拆分 | `assets/console-editor-Cs5DSXGa.js`，2,925,783 字节，gzip 752,403 字节 |
| 试行预算：初始 JS 原始字节 < 1,000,000 | 未达到 | 达到 |

优化前数值来自 2026-09-28 的生产入口构建审计；本轮数据来自当前产物的依赖图及实际文件。构建报告中的 18 个 chunk 字节数已逐项与写盘文件大小核对，全部一致；模块标识未包含机器绝对路径。预算只针对初始 JS，不包含 CSS、字体、worker 或首次打开编辑器的动态加载。编辑器 worker 是独立构建资产 `assets/editor.worker-B4pQIWZD.js`，不属于首屏静态 JS 闭包。构建仍提示动态编辑器 chunk 大于 500 kB；未调整 Vite 的警告阈值。

最终审查补回 Monaco 的 `contextmenu.js` 与 `clipboard.js` 后，`node scripts/performance/monaco-contributions.mjs dist` 已从缺少两项的失败变为通过，并确认两项都在实际编辑器 chunk 的模块图内。相对补回前的 2,892,016 字节，动态编辑器增加 33,767 字节（gzip 增加 9,367 字节）；首屏原始字节保持 515,542，gzip 参考值减少 4 字节，入口文件哈希随动态引用更新。右键菜单及系统剪贴板另经下述真实 WebView 操作验收。

## Tauri 与 WebView 功能验收

最终代码提交 `a46dbaa` 补回右键菜单与剪贴板贡献后，产品 `pnpm exec tauri build --debug --no-bundle` 已退出码 0，生成 `src-tauri/target/debug/esx`。未启动访问真实 keyring 的完整产品实例。独立 ESX Monaco QA.app 在 `tauri://localhost` 使用与产品相同的生产 CSP、真实 `ConsoleEditor` 与 `ResponseViewer`，以合成数据运行，不访问 keyring、store 或 HTTP 命令；补回后的独立程序已重建并完成真实操作复验。

| 检查 | 精简前独立 WebView | 精简后独立 WebView |
| --- | --- | --- |
| 编辑器 worker | 0 个，0 条消息 | 1 个，收到 4 条消息；`wordRanges=ok` |
| worker/CSP 错误 | 无记录 | 均为空 |
| 编辑行为 | 折叠、查找、GET 补全、行删除、撤销/重做、只读拒绝输入通过 | 同项通过，另确认错误 marker、Hover 和 View Problem 详情 |
| 右键与剪贴板 | 原整包包含相关贡献模块 | 在与产品相同的原生右键拦截条件下，请求菜单剪切、粘贴通过；只读响应仅显示复制，复制结果可粘贴回请求 |
| 快捷键 | ⌘Enter、⌘⇧A 合成回调通过 | 同项通过，未发送请求 |
| `editor.action.formatDocument` | action 存在，`supported=false` | 相同；`es-console` 尚无文档 formatter |

最终复验中，请求菜单剪切使合成文本 `clipboard-smoke` 变空，菜单粘贴恢复原文；只读响应菜单没有剪切/粘贴入口，复制后可在请求中粘贴出完整 `hits` JSON。真实 ⌘Enter、⌘⇧A 各触发一次合成回调，未发送请求。worker 累计收到 5 条消息，`workerErrors`、`cspViolations`、`pageErrors` 均为空。

最终自动探针一次报告 `hover missing`；该探针改写模型后接受任意错误 marker，可能读到上次校验结果。随后通过真实输入及 ⌘K、⌘I 手工确认 Hover 显示 `JSON 解析失败：JSON Parse error: Unexpected identifier "nope"`，没有将自动探针写成全部通过。较早精简后验收曾记录一条 `Canceled: Canceled`，缺少事件类型与栈，来源未严格定位；最终复验未重现。完整 Console 的 JSON 格式化按钮由现有纯函数与组件测试覆盖，不把此项写成 Monaco formatter 已可用。

## 待测的完整应用启动指标

目前没有可靠的完整应用冷启动计时工具，因此未给出启动或首次编辑的 p50/p95，也未用构建耗时代替。后续需在同一机器和版本上，分别准备空数据与大量历史数据，每个场景至少采样 20 次，记录从进程启动到连接页可操作、首次进入 Console 到编辑器可输入的 p50/p95，同时记录 JS heap 和 worker 回退日志。Windows/Linux、真实连接数据及完整产品 WebView 的运行验收也未覆盖。
