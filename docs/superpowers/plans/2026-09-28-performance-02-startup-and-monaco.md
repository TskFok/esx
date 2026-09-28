# 性能优化 02：启动加载与 Monaco 实施计划

> **实施状态（2026-09-28）：** 四项工程实现、回归测试与构建验收已完成。完整产品的冷启动/首次进入 Console 的 20 次采样、p50/p95 与 JS heap 仍待测；构建字节与隔离 WebView 的实测范围见 [验收记录](../../performance/startup-measurements.md)。

**目标（Goal）：** 连接页启动时不加载 Console 编辑器及低频面板，并在保留编辑功能的前提下减少 Monaco 包体与主线程工作。

**架构（Architecture）：** 用路由、编辑器和面板的动态 import 建立加载边界；Monaco 的 ESM 入口、贡献模块、worker 和 loader 初始化集中在一个模块。通过构建导入图检查首屏实际依赖，再用真实 Tauri WebView 验证启动与首次编辑体验。

**技术栈（Tech Stack）：** React 19、Vite 7、Monaco 0.52、Tauri 2、TypeScript、Vitest、Testing Library；沿用现有依赖版本。

**依据（Spec）：** [性能分析报告](/Users/ushopal/workspace/myself/esx/docs/PERFORMANCE_ANALYSIS_2026-09-28.md)，重点为“拆分启动加载与 Monaco 依赖”及构建基线。

**优先级：** 本计划为 P1。与其他计划之间无功能依赖；只需协调共享文件，优先完成路由与组件加载边界，再实施 Monaco 精简。

## 本轮执行结果

- 连接页初始 JS 静态闭包为 **515,542 字节**（gzip 157,945 字节），不含 Monaco；相对 4,041,186 字节基线减少约 **87.2%**，达到小于 1 MB 的试行预算。
- 延迟加载的编辑器 JS 为 2,892,016 字节，本地 worker 为独立产物。路由、面板和弹窗加载期间的等待、关闭、草稿更新与状态保留已补回归测试。
- 全量 Vitest **88 文件 / 854 项**通过；前端构建、Node 构建配置类型检查、依赖报告 CLI、最终 `pnpm exec tauri build --debug --no-bundle` 均通过。18 个 chunk 报告字节与最终文件逐项一致。
- 相同生产 CSP 的隔离 Tauri WebView 中，真实请求/响应编辑器、折叠、查找、补全、行删除、撤销重做、只读保护、诊断详情、快捷键及本地 worker 往返已验证。未启动访问真实钥匙串的完整产品实例，Windows/Linux 未测。
- `es-console` 缺少 Monaco 文档 formatter 是精简前后相同的既有状态；未改变现有 JSON 格式化逻辑。WebView 留有一条来源未严格定位的 `Canceled` 页面记录，worker 错误与 CSP 违规记录为空。
- 任务 4 的启动时间测量采用计划允许的“无可靠工具则明确待测”分支，**未执行 20 次完整应用采样**，不把构建耗时或字节降幅视作启动耗时提升。

| 任务 | 本地提交 |
| --- | --- |
| 1：路由加载 | `3df4eb3`、`7c7d5e6` |
| 2：编辑器、面板和弹窗 | `66b3158`、`c2cb967` |
| 3：Monaco runtime 与 worker | `52060e8` |
| 4：构建报告与验收记录 | `9b6e014` |

## 全局约束

- 默认在当前分支修改；未经用户明确要求不创建分支。交流与提交描述使用简体中文，提交格式为 `type: 中文描述`。
- 禁止在循环遍历中查询 SQL；不改变凭据通过 Tauri 原生 keyring 存取的边界。
- 改动保持最小；不升级框架、不换编辑器、不引入新的状态库。新增行为补 Vitest；组件测试使用 jsdom。
- 不修改 Console 请求语法、校验算法、响应截断语义或持久化策略，这些分别由计划 01、04、03 负责。
- 保留现有 CSP，worker 只加载本地构建产物；不引入 CDN 或放宽连接权限。
- 本轮基线入口 JS 为 4,041,186 bytes，gzip 约 1.07 MB。小于 1 MB 的连接页初始 JS 总量是试行目标，不是已有成果或跨机器耗时断言。
- 所有命令从仓库根目录运行；每项独立完成测试和中文提交，不提交 dist 或真实用户数据。

## 顺序与文件协调

本计划可单独实施；建议计划 01 的补全接口稳定后执行。与计划 01 共享 `console-page.tsx`、`console-editor.tsx`、补全入口，与计划 03 共享 provider 的纯函数导入；这些文件禁止多计划同时编辑。计划 04 修改响应查看器时继续使用本计划的懒加载编辑器接口。

四个任务按 1 → 2 → 3 → 4 执行。每个任务均应保持可构建、可回滚；可在任务 2 后先交付动态加载收益，再实施 Monaco 精简。

## 审查重点（Review Focus）

1. 无连接与有连接时直接打开 `/console`、`/status`、`/admin`、`/logs`，仍保持原有跳转行为（任务 1）。
2. 全局 provider 或纯函数导入不能把 Monaco 绕过懒加载边界带回首屏（任务 3、4）。
3. 快速切换面板、打开再关闭弹窗，不丢草稿、不重置原有弹窗状态、不重复执行初始化（任务 2）。
4. 多个编辑器实例共存及卸载重挂后，语言、补全和快捷键仍只按预期注册（任务 3）。
5. 生产 Tauri CSP 下 worker 可用；编辑与只读响应保留折叠、查找、补全和格式化等既有行为（任务 3、4）。

## 文件职责

| 文件 | 职责与变更 |
| --- | --- |
| [src/App.tsx](/Users/ushopal/workspace/myself/esx/src/App.tsx) | 路由加载边界与等待 UI |
| [console-page.tsx](/Users/ushopal/workspace/myself/esx/src/pages/console-page.tsx) | 按需挂载面板、编辑器、弹窗 |
| [console-editor.tsx](/Users/ushopal/workspace/myself/esx/src/components/console/console-editor.tsx) | 保留实际编辑器实现，使用集中初始化模块 |
| [response-viewer.tsx](/Users/ushopal/workspace/myself/esx/src/components/console/response-viewer.tsx) | 共用懒加载编辑器入口 |
| 拟新增 `src/components/console/lazy-console-editor.tsx` | 与现有编辑器相同 props 的懒加载包装 |
| 拟新增 `src/lib/monaco-runtime.ts` | Monaco ESM 贡献模块、core worker、loader 初始化 |
| [补全入口](/Users/ushopal/workspace/myself/esx/src/lib/console-autocomplete/index.ts)、[app-state.tsx](/Users/ushopal/workspace/myself/esx/src/providers/app-state.tsx) | 保证纯函数和类型导入不触发编辑器运行时加载 |
| [vite.config.ts](/Users/ushopal/workspace/myself/esx/vite.config.ts) | 输出 manifest 与可审计的 chunk 模块图 |
| 拟新增 `scripts/lib/startup-bundle.mjs`、`scripts/performance/startup-bundle.mjs` | 计算首屏静态依赖闭包、字节数和模块组成 |

### 任务 1：拆分路由加载

**文件：** 修改 `src/App.tsx`；拟新增 `src/__tests__/app-loading.test.tsx`；使用现有 `src/pages/__tests__/{root-redirect,status-page,admin-page,error-logs-page}.test.tsx` 回归。

**接口：** 路由路径和各页面现有具名导出保持不变。通过 `lazy(() => import(...).then(module => ({ default: module.ConsolePage })))` 适配；`App()` 仍返回应用路由与 Toaster。轻量的重定向组件可保留静态导入，避免只为切分而增加等待。

- [x] **步骤 1：新增行为测试。** `connections_route_does_not_load_console` 用延迟模块 mock 记录 Console 模块工厂调用；`console_route_waits_for_module` 验证待加载提示及模块 resolve 后显示；直接入口测试覆盖审查重点 1。

  ```ts
  expect(consoleModuleLoaded).not.toHaveBeenCalled(); // /connections
  expect(screen.getByRole("status")).toBeVisible(); // 未 resolve 的 /console
  expect(await screen.findByTestId("console-page")).toBeVisible(); // resolve 后
  ```

- [x] **步骤 2：运行新增测试确认红灯。** `pnpm test src/__tests__/app-loading.test.tsx`；预期因当前静态导入或缺少等待 UI 而失败，不能以 mock/环境错误代替行为失败。
- [x] **步骤 3：实现路由懒加载与 Suspense。** 保持 `ready` 加载逻辑、HashRouter、GlobalGuards、Toaster 和默认重定向；等待 UI 使用 `role="status"` 和中文提示。若模块加载失败，给出可重试/重新打开页面入口，不让草稿数据操作依赖模块加载成功。
- [x] **步骤 4：运行目标与路由回归测试。** `pnpm test src/__tests__/app-loading.test.tsx src/pages/__tests__/root-redirect.test.tsx src/pages/__tests__/status-page.test.tsx src/pages/__tests__/admin-page.test.tsx src/pages/__tests__/error-logs-page.test.tsx`；预期全部通过。追加模块 reject 场景，验证错误 UI 可恢复。
- [x] **步骤 5：构建并提交。** `pnpm build` 应成功；核对 Console 产生动态入口后，用本任务精确文件清单提交 `build: 按需加载应用页面`。

### 任务 2：延迟加载编辑器、面板与低频弹窗

**文件：** 修改 `src/pages/console-page.tsx`、`src/components/console/{console-editor,response-viewer}.tsx`、`src/pages/__tests__/console-page.test.tsx`；拟新增 `src/components/console/lazy-console-editor.tsx` 与 `src/components/console/__tests__/lazy-console-editor.test.tsx`。

**接口：** 从实际编辑器模块导出原有 `ConsoleEditorProps` 类型；新增 `LazyConsoleEditor(props: ConsoleEditorProps): ReactElement`，类型导入使用 `import type`。包装只负责加载与占位，不接管 value、model 生命周期或草稿状态。状态/治理/日志面板继续遵循现有右侧模式互斥选择；弹窗首次开启前不挂载，首次开启后的状态保留方式沿用现有行为。

- [x] **步骤 1：新增失败测试。** 覆盖直接进入状态/治理面板时编辑器模块未加载；首次切入请求工作区才加载；只读响应与可编辑请求共用一个模块加载；AI 设置/分析/生成弹窗关闭时不首次加载。使用 deferred Promise 控制加载，不用任意真实 sleep。

  ```ts
  expect(editorModuleLoaded).toHaveBeenCalledTimes(0); // 仅状态面板
  expect(editorModuleLoaded).toHaveBeenCalledTimes(1); // 请求与响应同时出现
  expect(editorProps.value).toBe(latestDraft); // 加载期间编辑值被外部更新
  ```

- [x] **步骤 2：运行测试确认红灯。** `pnpm test src/components/console/__tests__/lazy-console-editor.test.tsx src/pages/__tests__/console-page.test.tsx`；预期新加载边界断言失败。
- [x] **步骤 3：实施动态边界。** 页面与响应查看器使用 `LazyConsoleEditor`；对 StatusPanel、AdminPanel、ErrorLogsPanel 和三个 AI 弹窗使用模块级 lazy 定义。弹窗的加载门控放在父层，首次打开后不因关闭而额外重置已有内部状态。Suspense fallback 保持面板尺寸，避免布局跳动。
- [x] **步骤 4：覆盖快速切换与回归。** 在 resolve 前后切换右侧模式，断言没有对已卸载组件更新、草稿和最后一次 value 未丢失；复用现有对话框、右侧面板、折叠组件测试。运行 `pnpm test src/pages/__tests__/console-page.test.tsx src/components/console/__tests__`，预期全部通过。
- [x] **步骤 5：构建并提交。** `pnpm build` 成功；提交 `build: 延迟加载编辑器和低频面板`。不在此任务增加自动预热；先保留干净的测量边界。

### 任务 3：集中 Monaco 按需导入和 worker 初始化

**文件：** 拟新增 `src/lib/monaco-runtime.ts`、`src/lib/__tests__/monaco-runtime.test.ts`；修改 `src/components/console/console-editor.tsx`、`src/lib/console-autocomplete/index.ts`、`src/providers/app-state.tsx`、`vitest.config.ts`、`src/test/mocks/monaco-editor.ts`、`src/components/console/__tests__/console-editor.test.tsx`。

**接口：** `monaco-runtime.ts` 导出 `monaco`（类型为 `typeof import("monaco-editor/esm/vs/editor/editor.api")`）与幂等的 `configureMonaco(): void`。编辑器运行时从这里读取，纯补全类型改用 `import type`；provider 的 `normalizeClusterMetadata` 直接导入 capabilities 模块。新增 `MonacoEnvironment.getWorker(_moduleId: string, _label: string): Worker`，当前仅自定义 `es-console` 使用 core editor worker。

- [x] **步骤 1：新增失败测试。** `configure_once_for_multiple_editors` 断言反复调用 `configureMonaco()` 仅配置 loader 一次；记录模型销毁后补全/语言注册无重复，保留可编辑/只读模式的折叠断言。worker constructor mock 验证本地 worker 被创建。测试配置需精确匹配完整包名、ESM API 和 worker mock，避免现有宽泛 alias 把所有子路径改写成不存在的 mock 路径。

  ```ts
  configureMonaco(); configureMonaco();
  expect(loader.config).toHaveBeenCalledTimes(1);
  expect(options).toMatchObject({ folding: true, showFoldingControls: "always" });
  ```

- [x] **步骤 2：运行测试确认红灯。** `pnpm test src/lib/__tests__/monaco-runtime.test.ts src/components/console/__tests__/console-editor.test.tsx`；预期新初始化接口或幂等行为尚未满足。
- [x] **步骤 3：使用 ESM API 与显式贡献模块。** 从 `editor.api` 加载核心，按现有功能显式引入 `contrib/folding/browser/folding.js`、`find/browser/findController.js`、`suggest/browser/suggestController.js`、`snippet/browser/snippetController2.js`、`format/browser/formatActions.js`、`linesOperations/browser/linesOperations.js`、`bracketMatching/browser/bracketMatching.js`、`wordOperations/browser/wordOperations.js`、`multicursor/browser/multicursor.js`、`readOnlyMessage/browser/contribution.js`（后九项同在 `editor/contrib/` 下）。括号着色属于核心能力，保留其选项并验证，不假定存在同名贡献模块。保留撤销重做、行删除和自定义语言能力；不用 `editor.main`、`editor.all` 或无关 CSS/HTML/TS 语言整包替代。使用 Vite `?worker` 加载 `monaco-editor/esm/vs/editor/editor.worker.js`，在 loader 初始化前配置 worker 工厂。
- [x] **步骤 4：验证单元与真实编辑行为。** `pnpm test src/lib/__tests__/monaco-runtime.test.ts src/components/console/__tests__/console-editor.test.tsx src/lib/console-autocomplete/__tests__` 应通过；`pnpm build` 应成功。真实 WebView 检查折叠、查找、补全、格式化、撤销/重做、行删除、执行/分析快捷键及只读响应；mock 测试不能替代贡献模块是否实际生效的验证。
- [x] **步骤 5：提交独立改动。** 提交 `build: 精简 Monaco 依赖并配置本地 worker`。若出现功能退化，补回对应贡献模块；不要通过删除功能来满足体积目标。

### 任务 4：加入构建依赖检查和启动验收记录

**文件：** 修改 `vite.config.ts`；拟新增 `scripts/lib/startup-bundle.mjs`、`scripts/lib/startup-bundle.test.mjs`、`scripts/performance/startup-bundle.mjs`、`docs/performance/startup-measurements.md`。

**接口：** Vite 输出 manifest，并在 `generateBundle` 阶段输出 `dist/performance-chunks.json`，每项包含 `{ file: string, bytes: number, imports: string[], dynamicImports: string[], modules: string[] }`，`bytes` 为最终 chunk 代码的 UTF-8 字节数，模块标识相对项目根目录，不含机器绝对路径。`summarizeStartupBundle(chunks, entryFiles): { initialFiles: string[]; initialBytes: number; containsMonaco: boolean }` 只遍历静态 imports、去重计数；动态 imports 单列，不计入初始闭包。CLI 接受构建目录，缺失产物明确报错。

- [x] **步骤 1：为导入图算法编写失败测试。** 使用固定小图覆盖共享依赖只计一次、循环依赖可结束、动态 editor 不计首屏、Monaco 意外进入静态共享块被检测，以及不存在的 chunk 给出错误。

  ```js
  expect(summary.initialFiles).not.toContain("editor.js");
  expect(summary.initialBytes).toBe(300); // fixture 中两个不同文件为 100 + 200
  expect(summary.containsMonaco).toBe(false);
  ```

- [x] **步骤 2：运行测试确认红灯。** `pnpm test scripts/lib/startup-bundle.test.mjs`；预期接口尚不存在或图统计行为不满足。
- [x] **步骤 3：实现构建报告与 CLI。** 使用 Node 内置 fs/path 和现有 Vite 插件 API，不新增分析依赖；CLI 输出首屏 JS 原始字节、gzip 参考值、静态闭包和动态 editor 文件。连接页初始闭包包含 Monaco 时退出非零；1 MB 为报告中的试行预算，超出时定位依赖并记录，不用调高 chunk 警告来掩盖。
- [x] **步骤 4：验证产物和功能基线。** 运行 `pnpm test scripts/lib/startup-bundle.test.mjs`、`pnpm build`、`node scripts/performance/startup-bundle.mjs dist`；预期图统计正确、初始闭包无 Monaco。最后运行 `pnpm test`，所有测试通过。使用 `pnpm exec tauri build --debug --no-bundle` 检查生产资源路径（直接调用 CLI，避免项目 wrapper 自动执行 DMG 打包），并在实际 Tauri 中确认 worker 加载没有 CSP/找不到资源错误；跨平台未验证项明确记录。
- [x] **步骤 5：记录前后实测并提交。** 同机同版本分别测空数据/大量历史的冷启动与首次进入 Console，每场景至少 20 次，记录 p50/p95、JS heap、worker 回退日志；若无可靠启动计时工具，保留待测状态，不能用构建耗时替代。提交 `test: 增加启动依赖与性能验收记录`。

## 完成标准与回滚

- [x] 连接页初始依赖闭包没有 Monaco；总量与 4.04 MB 基线可比较，首次进入 Console 的等待没有被隐藏在启动指标之外。
- [x] 页面重定向、弹窗状态、编辑器功能和本地 CSP/worker 行为均完成验证；未测平台和未达到的预算已明确记录。
- [x] 所有新增行为测试、现有 Vitest 和前端构建通过；性能数据区分构建字节与 WebView 实测。
- [x] 回滚按任务提交逆序进行：贡献模块精简可单独撤回而保留路由/组件懒加载；本计划不改存储格式，无数据迁移回滚要求。

以上工程改动已在原 `master` 分支提交，未新建分支或推送远端。未完成的完整产品性能采样与跨平台运行验收在验收记录中明确保留为待测。
