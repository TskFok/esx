# Console 交互性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 降低 Console 逐键补全与异常校验开销，并让长 NDJSON 和大量已保存请求保持可用的输入、补全与滚动体验。

**Architecture:** 把连接级补全元数据与当前请求行分离，校验扫描一次记录坐标并延后发布，NDJSON 按模型变更范围维护前序状态。侧栏只渲染视口附近的请求，保持搜索、多选和排序语义。各优化沿用现有函数边界，可逐项交付。

**Tech Stack:** React 19、TypeScript、Monaco、Vitest/jsdom；侧栏任务计划引入单一小型依赖 `@tanstack/react-virtual`。

**Spec:** [性能分析与优化方案](/Users/ushopal/workspace/myself/esx/docs/PERFORMANCE_ANALYSIS_2026-09-28.md)，尤其“补全与校验微基准”“P1：把稳定补全元数据移出逐键计算”“P2：缩小 React 更新范围并虚拟化大列表”“P2：优化校验异常路径和长 NDJSON 补全”。

**优先级与依赖：** Task 1 为 P1，可优先独立交付；Task 2–4 为 P2，长 DSL 或大量历史请求场景下提前。Task 3 消费 Task 1 的接口，Task 2/4 可分别验证。共享文件按本计划约束串行修改，不必先完成本计划全部 P2 工作才开始其他计划的 P1 工作。

## Global Constraints

- 默认在当前分支修改；不新建分支。提交信息使用英文 type 前缀和简体中文内容，如 `perf` 不在项目允许 type 内，应使用 `refactor: 优化补全上下文` 等允许值。
- 中文沟通；最小改动；新增功能补 Vitest，组件测试使用 jsdom；不得在循环中查询 SQL。
- 凭据仍只经 Tauri 原生 keyring 存取；不把真实密钥、密码、私钥放进代码、测试或日志。
- 不更换状态库，不做框架大升级；Monaco 导入、worker 与启动拆包归 plan02；全局 Context、持久化、集群元数据拉取、Status/Admin 列表归 plan03；Rust/network 归 plan04。
- `console-page.tsx`、`console-editor.tsx` 与 plan02/03 共享；各计划涉及这些文件时串行合并，执行前先复核当前代码和测试，不按旧行号盲改。
- 现有 600 ms 草稿保存防抖、元数据缓存、默认 256 KiB 响应预览继续保留。性能时间数字只作同机同版本基准目标，不写成机器相关的测试硬门槛。
- 报告的 Node 微基准在 Apple M1 / Node 25.5.0 测得：1000 请求、1000 索引、每索引 200 字段的上下文重建中位 94.29 ms、p95 116.71 ms；500 KiB **单长字符串有效 JSON 合成样本**校验中位 2.24 ms、p95 2.39 ms；100 KiB 且 200 个未闭合 `[` 的异常样本校验中位 49.86 ms、p95 51.84 ms。Node 数值不代表实际 DSL 或 WebView 交互延迟。

## File Map

- [src/lib/console-autocomplete/context.ts](/Users/ushopal/workspace/myself/esx/src/lib/console-autocomplete/context.ts)：拆分连接级静态上下文和请求行动态上下文；保留现有入口兼容测试。
- [src/lib/console-autocomplete/index.ts](/Users/ushopal/workspace/myself/esx/src/lib/console-autocomplete/index.ts)：导出拆分接口，并让补全 provider 消费 NDJSON 缓存结果。
- [src/pages/console-page.tsx](/Users/ushopal/workspace/myself/esx/src/pages/console-page.tsx)：按请求列表和 metadata 引用缓存静态上下文，只在首行变化时派生动态上下文；稳定侧栏输入。
- [src/lib/console-autocomplete/validator.ts](/Users/ushopal/workspace/myself/esx/src/lib/console-autocomplete/validator.ts)：扫描时记录行列，移除每条异常对全文前缀的重复定位。
- [src/components/console/console-editor.tsx](/Users/ushopal/workspace/myself/esx/src/components/console/console-editor.tsx)：接入可取消校验调度器；保留初次打开即时诊断。
- **拟新增** `src/lib/console-autocomplete/validation-scheduler.ts`：与 Monaco 标记渲染分离的短防抖、版本检查和释放逻辑。
- [src/lib/console-autocomplete/body-context.ts](/Users/ushopal/workspace/myself/esx/src/lib/console-autocomplete/body-context.ts)：保持现有纯函数语义，抽出按行推进 NDJSON 状态的逻辑。
- **拟新增** `src/lib/console-autocomplete/ndjson-completion-cache.ts`：按 Monaco model 缓存已完成行状态，编辑中间行时从首个受影响行重算。
- [src/components/console/console-sidebar-panel.tsx](/Users/ushopal/workspace/myself/esx/src/components/console/console-sidebar-panel.tsx)：大量请求时虚拟化列表及局部渲染；少量请求保留现有结构。
- **拟新增** `src/components/console/console-request-list.tsx`：列表视口、行测量、滚动与拖拽排序职责；侧栏表单和导航仍在原组件。
- **拟新增** `scripts/performance/console-bench.mjs`：从现有 Vite 依赖解析 esbuild，打包生产纯函数并生成可复现合成样本；供任务 1、2 及集成验收复测。
- 测试改在现有 [src/lib/console-autocomplete/__tests__](/Users/ushopal/workspace/myself/esx/src/lib/console-autocomplete/__tests__)、[src/components/console/__tests__](/Users/ushopal/workspace/myself/esx/src/components/console/__tests__)、[src/pages/__tests__](/Users/ushopal/workspace/myself/esx/src/pages/__tests__)；新增测试文件在对应任务中标明。

## Review Focus

1. 切换连接或刷新 mapping 后，补全不得沿用上一连接的索引与字段；任务 1 的页面与纯函数测试覆盖。
2. alias、多索引、未知目标与 wildcard 的字段回退须维持现有语义；任务 1 的上下文测试覆盖。
3. 连续输入后立即切换/卸载编辑器，旧定时器不得给新模型写诊断；任务 2 的假定时器测试覆盖。
4. 在长 Bulk/MSearch 中编辑较早的 action/header 后，后续补全必须更新目标索引和错误保守状态；任务 3 的缓存失效测试覆盖。
5. 虚拟列表跨视口滚动后，搜索、多选、拖拽排序及键盘激活仍作用于正确请求；任务 4 的 jsdom 交互测试覆盖。

---

## 执行前基线

- [x] 读取当前 `AGENTS.md`、本 Spec、这份计划及现有同名测试；确认 plan02/03 是否已触及共享文件，再决定本计划的串行执行顺序。
- [x] 在当前分支记录 `git status --short --branch` 和提交 ID；保留其他计划尚未提交的文件，不覆盖它们。
- [x] 按报告记录原始基线；任务 1 新增仓库内复现脚本后，后续统一运行 `node scripts/performance/console-bench.mjs`。基线只用于比较，不作测试通过门槛。
- [x] 后续每个任务分别提交；失败时优先只回滚对应提交，不丢弃其它计划的工作。

### Task 1: 静态补全元数据与动态请求上下文

**Files:**
- Modify: `src/lib/console-autocomplete/context.ts`, `src/lib/console-autocomplete/index.ts`, `src/pages/console-page.tsx`
- Create: `scripts/performance/console-bench.mjs`
- Test: `src/lib/console-autocomplete/__tests__/context.test.ts`, `src/pages/__tests__/console-page.test.tsx`

**Interfaces:**
- Produce: `export type SearchMetadataInput = Partial<ConnectionSearchMetadata> & { fields?: string[]; fieldsByIndex?: Record<string, string[]>; aliasToIndices?: Record<string, string[]> }`；`export type ConsoleAutocompleteStaticContext = Pick<ConsoleAutocompleteContext, "indexNames" | "aliasNames" | "fieldNamesByTarget" | "cluster"> & { savedHistoryTargetNames: string[]; metadata: SearchMetadataInput | null }`。`savedHistoryTargetNames` 只含已保存请求目标，不混入当前请求。
- Produce: `buildConsoleAutocompleteStaticContext(requests: SavedRequest[], metadata?: SearchMetadataInput | null): ConsoleAutocompleteStaticContext`；字段映射和排序只在此函数构建。
- Produce: `buildConsoleAutocompleteContextForRequest(stable: ConsoleAutocompleteStaticContext, firstLine: string): ConsoleAutocompleteContext`；只解析首行、目标与相应字段，不重建全量映射。
- Keep: `buildConsoleAutocompleteContext(requests, currentContent, metadata): ConsoleAutocompleteContext` 作为兼容入口，委托上述两段；`provideConsoleCompletionItems` 的入参类型不变。

- [x] **Step 1: 写静态对象测试。** 在 `context.test.ts` 断言同一静态对象针对相同首行、不同 body，`fieldNamesByTarget` 引用严格相等；动态字段针对 `/orders/_search` 与 `/users/_search` 分别为对应字段。
- [x] **Step 2: 写失效和兼容测试。** 断言 alias 合并、多索引去重、未知目标回退全部字段、wildcard 不当作具体索引；不同连接或新 metadata 构建新静态对象，旧对象不被修改。
- [x] **Step 3: 写页面调用次数测试。** 扩展页面内 mocked `ConsoleEditor` 以调用 `onChange`；仅编辑 body 100 次，静态构建次数保持 1；切连接、替换 metadata 后分别加 1。
- [x] **Step 4: 运行红灯。** `pnpm exec vitest run src/lib/console-autocomplete/__tests__/context.test.ts src/pages/__tests__/console-page.test.tsx`；预期新接口缺失或调用次数断言失败。
- [x] **Step 5: 实现静态接口。** 在 `context.ts` 分离排序、字段映射和历史目标；历史排除索引/alias 用 `Set`；兼容入口委托新函数，保持现有回退与 cluster 语义。
- [x] **Step 6: 接入页面。** 静态计算仅依赖 `requestsForCurrentConnection`、`connectionSearchMetadata`；从 `editorContent` 提取首行作动态 `useMemo` 依赖，只改 body 时保持传给 Monaco 的上下文对象引用。
- [x] **Step 7: 新增复现脚本。** `scripts/performance/console-bench.mjs` 先用 `createRequire(import.meta.url)` 取得 `repoRequire`，再以 `createRequire(realpathSync(repoRequire.resolve("vite/package.json")))` 解析现有 esbuild；`write: false` 打包生产函数。合成数据、预热 5/3 次、采样 30/20 次、中位与 p95 及构造时间排除规则照 Spec，路径从脚本位置解析，不硬编码本机路径。
- [x] **Step 8: 运行绿灯及基准。** Step 4 命令再加 `src/lib/console-autocomplete/__tests__/index.test.ts`，预期全部 PASS；`node scripts/performance/console-bench.mjs` 输出环境、样本数和结果，耗时只作建议目标。
- [x] **Step 9: 提交本任务。** `git add scripts/performance/console-bench.mjs src/lib/console-autocomplete/context.ts src/lib/console-autocomplete/index.ts src/lib/console-autocomplete/__tests__/context.test.ts src/pages/console-page.tsx src/pages/__tests__/console-page.test.tsx && git commit -m "refactor: 缓存控制台补全元数据"`。

**验收与回滚:** 同一大样本连续编辑 body，静态构建次数为 0；动态阶段 p95 以报告建议的 5 ms 作试行目标，需在 WebView 校准。出现跨连接污染时回滚本任务提交并恢复原兼容入口路径。

### Task 2: 校验坐标单次扫描与可取消防抖

**Files:**
- Modify: `src/lib/console-autocomplete/validator.ts`, `src/components/console/console-editor.tsx`
- Create: `src/lib/console-autocomplete/validation-scheduler.ts`
- Test: `src/lib/console-autocomplete/__tests__/validator.test.ts`, **拟新增** `src/lib/console-autocomplete/__tests__/validation-scheduler.test.ts`, `src/components/console/__tests__/console-editor.test.tsx`

**Interfaces:**
- Keep: `validateConsoleContent(content: string): ConsoleBodyDiagnostic[]`，保留错误消息和 Monaco 1-based 行列契约。
- Produce: `createConsoleValidationScheduler(model: { getValue(): string; getVersionId(): number }, publish: (diagnostics: ConsoleBodyDiagnostic[]) => void, delayMs?: number): { schedule(): void; dispose(): void }`；默认延迟 120 ms，发布时确认版本仍为排程版本。

- [x] **Step 1: 写坐标测试。** `validator.test.ts` 对 200 个未闭合 `[` 的多行 body 断言首、末异常的精确 1-based 行列；分别断言尾逗号、跨行未闭合字符串、多余括号位置与旧行为一致。
- [x] **Step 2: 写调度测试。** `validation-scheduler.test.ts` 使用 `vi.useFakeTimers()`：第 119 ms 无发布，第 120 ms 仅发布最后一次 `getVersionId()` 对应内容；版本变了却未重新排程时不得发布。
- [x] **Step 3: 写生命周期测试。** `dispose()` 后推进时钟无发布；`console-editor.test.tsx` 断言只读模型不注册校验，非只读首次挂载即时设 marker，卸载后旧定时器不再设 marker。
- [x] **Step 4: 运行红灯。** `pnpm exec vitest run src/lib/console-autocomplete/__tests__/validator.test.ts src/lib/console-autocomplete/__tests__/validation-scheduler.test.ts src/components/console/__tests__/console-editor.test.tsx`；预期新调度器缺失或防抖断言失败。
- [x] **Step 5: 实现坐标优化。** 扫描 body 时维护行列，并在结构入栈时记录位置；移除逐诊断从头调用 `positionAt`，保留原消息和跨度。
- [x] **Step 6: 接入调度器。** 编辑器挂载时仍立即校验；后续内容事件调 `schedule()`，模型释放时 `dispose()`；`publish` 仅对当前模型调用 `setModelMarkers`。
- [x] **Step 7: 运行绿灯并复测。** Step 4 命令预期全部 PASS；同机运行 `node scripts/performance/console-bench.mjs`，只记录异常样本变化，不在 Vitest 中断言耗时。
- [x] **Step 8: 提交本任务。** `git add src/lib/console-autocomplete/validator.ts src/lib/console-autocomplete/validation-scheduler.ts src/lib/console-autocomplete/__tests__/validator.test.ts src/lib/console-autocomplete/__tests__/validation-scheduler.test.ts src/components/console/console-editor.tsx src/components/console/__tests__/console-editor.test.tsx && git commit -m "refactor: 降低控制台异常校验开销"`。

**验收与回滚:** 100 KiB/200 未闭合括号不再出现每个诊断重扫长前缀；500 KiB 单长字符串有效 JSON 合成样本原基线约 2.24 ms，不能外推到普通 DSL，避免为此引入 worker。若诊断错位或输入完成后丢失，回滚调度器接入与坐标改动。

### Task 3: 长 NDJSON 补全按行增量派生

**Files:**
- Modify: `src/lib/console-autocomplete/body-context.ts`, `src/lib/console-autocomplete/index.ts`
- Create: `src/lib/console-autocomplete/ndjson-completion-cache.ts`
- Test: `src/lib/console-autocomplete/__tests__/body-context.test.ts`, **拟新增** `src/lib/console-autocomplete/__tests__/ndjson-completion-cache.test.ts`, `src/lib/console-autocomplete/__tests__/index.test.ts`

**Interfaces:**
- Keep: `analyzeBodyCompletion(content: string, request: ConsoleRequestContext): BodyCompletionContext` 供现有调用与回归测试。
- Produce: `getCachedNdjsonCompletion(model: ITextModel, position: Position, request: ConsoleRequestContext): BodyCompletionContext`；模块内 `WeakMap<ITextModel, Cache>`，首次读取已完成行，之后由 `onDidChangeContent` 的最早变更行使后缀失效，模型释放时注销监听。
- Consume: Task 1 的 `ConsoleAutocompleteContext.request`；非 NDJSON 模式保持原补全路径。

- [x] **Step 1: 写缓存命中测试。** 用假 Monaco model 与 `vi.spyOn(JSON, "parse")` 生成 1000 行 Bulk；首轮分析后，在末行连续补全两次，已完成旧行的新增解析次数为 0。
- [x] **Step 2: 写后缀失效测试。** 修改第 10 行并发出 `onDidChangeContent` 事件，断言第 1–9 行未重新解析、第 10 行以后重算，且目标索引来自新 action/header。
- [x] **Step 3: 写语义回归测试。** 删除/改写 Bulk action、MSearch header、无效 JSON、`delete` 无 body、首行在 Bulk/MSearch 间切换，逐项比较缓存与 `analyzeBodyCompletion` 的 `kind/targetNames`。
- [x] **Step 4: 运行红灯。** `pnpm exec vitest run src/lib/console-autocomplete/__tests__/body-context.test.ts src/lib/console-autocomplete/__tests__/ndjson-completion-cache.test.ts src/lib/console-autocomplete/__tests__/index.test.ts`；预期新缓存接口缺失或解析次数断言失败。
- [x] **Step 5: 抽出行状态推进。** `body-context.ts` 的 Bulk/MSearch 分支共用单行状态函数，原全量入口保持原返回值。
- [x] **Step 6: 接入缓存与 provider。** 缓存保存每个已完成行后的状态快照与最后有效目标；最早变更行起后缀失效，首行变化全部失效。NDJSON 分支直接读取 Monaco 行，JSON 光标分析只传当前行及必要虚拟首行；普通 JSON 路径不变。
- [x] **Step 7: 运行绿灯。** 同 Step 4 命令；预期全部 PASS，既有字段补全、无效行保守返回与 alias/wildcard 测试仍通过。
- [x] **Step 8: 提交本任务。** `git add src/lib/console-autocomplete/body-context.ts src/lib/console-autocomplete/ndjson-completion-cache.ts src/lib/console-autocomplete/index.ts src/lib/console-autocomplete/__tests__/body-context.test.ts src/lib/console-autocomplete/__tests__/ndjson-completion-cache.test.ts src/lib/console-autocomplete/__tests__/index.test.ts && git commit -m "refactor: 增量解析长请求补全上下文"`。

**验收与回滚:** 在 1000 行样本末行重复触发补全时，已完成旧行的解析次数为 0；WebView 记录补全 provider p95 和键入长任务，再决定时间目标。语义偏差时撤销缓存入口，保留全量纯函数作回退。

### Task 4: Console 已保存请求列表局部渲染

**Files:**
- Modify: `src/components/console/console-sidebar-panel.tsx`, `src/pages/console-page.tsx`, `package.json`, `pnpm-lock.yaml`
- Create: `src/components/console/console-request-list.tsx`
- Test: `src/components/console/__tests__/console-sidebar-panel.test.tsx`, **拟新增** `src/components/console/__tests__/console-request-list.test.tsx`, `src/pages/__tests__/console-page.test.tsx`

**Interfaces:**
- Produce: `type ConsoleRequestListProps = Pick<ConsoleSidebarPanelProps, "requests" | "activeSavedRequestId" | "selectionMode" | "selectedRequestIds" | "onSelectSavedRequest" | "onToggleRequestSelection" | "onEditRequest" | "onDuplicateRequest" | "onDeleteRequest" | "onReorderRequests"> & { canReorder: boolean }`；`ConsoleRequestList(props: ConsoleRequestListProps): ReactElement`，只复用原侧栏回调签名，不另造参数约定。
- Consume: `filterConnectionRequests` 的已排序结果；`onReorderRequests(orderedRequestIds: string[])` 仍接受完整请求顺序，不只提交可见窗口。

- [x] **Step 1: 写窗口测试。** 模拟 480 px 滚动容器和 10,000 个请求，断言初始挂载行数小于 80；滚到末端后首批行卸载、末端请求可访问。测试用 `ResizeObserver`/尺寸 mock，不依赖 jsdom 自然布局。
- [x] **Step 2: 写筛选与选择测试。** 输入搜索、切换标签后滚动位置有效；已选中但滚出视口的行仍保持选中；“全选当前”提交全部过滤后的 ID，而不是已挂载行 ID。
- [x] **Step 3: 写排序和键盘测试。** 大列表跨视口拖拽/边缘自动滚动后 `onReorderRequests` 收到完整、唯一且次序正确的 ID；在新视口按 Enter/Space 激活正确请求。
- [x] **Step 4: 运行红灯。** `pnpm exec vitest run src/components/console/__tests__/console-sidebar-panel.test.tsx src/components/console/__tests__/console-request-list.test.tsx src/pages/__tests__/console-page.test.tsx`；预期大列表 DOM 数或交互断言失败。
- [x] **Step 5: 安装依赖并拆出列表。** `pnpm add @tanstack/react-virtual`；按 [TanStack Virtual React 文档](https://tanstack.com/virtual/latest/docs/framework/react/react-virtual) 在拟新增组件使用 `useVirtualizer`、动态行高测量和 overscan 6，少于 200 项保留直接渲染。
- [x] **Step 6: 接入侧栏与页面。** 列表有独立滚动容器，侧栏导航/搜索仍在原组件；拖拽边缘自动滚动，用完整请求顺序计算目标。传入稳定回调/列表引用，避免正文编辑逐键触发行重渲染；不接入整个 AppState Context。
- [x] **Step 7: 运行绿灯与录制。** Step 4 命令预期全部 PASS；React Profiler 在 1000/10,000 请求上记录 DOM 数、滚动 FPS 和正文输入时侧栏 commit 次数，不写机器耗时硬断言。
- [x] **Step 8: 提交本任务。** `git add package.json pnpm-lock.yaml src/components/console/console-sidebar-panel.tsx src/components/console/console-request-list.tsx src/components/console/__tests__/console-sidebar-panel.test.tsx src/components/console/__tests__/console-request-list.test.tsx src/pages/console-page.tsx src/pages/__tests__/console-page.test.tsx && git commit -m "refactor: 虚拟化控制台请求列表"`。

**验收与回滚:** 10,000 条请求时挂载行数由视口和 overscan 决定，筛选/多选/跨窗口排序仍正确；若拖拽或可访问性退化，恢复原列表组件并回滚新增依赖。

## Integration Gate

- [x] 四项合并到当前分支后，复核与 plan02/03 共享文件的最终代码和测试；解决冲突后运行 `pnpm test`、`pnpm build`，预期全部通过。
- [ ] 同机同版本运行 `node scripts/performance/console-bench.mjs`，记录中位/p95、构建次数和解析行数；在 Tauri WebView 用 React Profiler/Performance 录制输入延迟、补全 p95、侧栏 commit/DOM 数及滚动 FPS。
- [ ] 在连接切换、metadata 刷新、复杂 DSL、长 Bulk/MSearch、1000/10,000 请求样本上完成交互验收；保留分任务提交，指标或行为退化时可逐项回滚。


## 执行结果（2026-09-28）

四项代码改造均已在当前 `master` 实现，plan02/03 的共享文件在本次开始时没有其它代码改动，页面与补全 provider 的修改按文件所有权串行合并。保留了原有 600 ms 草稿保存、元数据缓存及 256 KiB 响应预览。未推送远端。

### 提交

| 任务 | 提交 | 内容 |
| --- | --- | --- |
| Task 1 | `6a9097e`、`ab50347` | 静态补全上下文、首行派生、单目标数组复用、多目标有序归并、复用中文比较器及可复现基准 |
| Task 2 | `f8be0df`、`442876e` | 单次扫描坐标、120 ms 可取消校验、模型释放清理、只读切换清除旧诊断 |
| Task 3 | `b3b357e` | Bulk/MSearch 已完成行缓存、最早变更行后缀失效、当前行 JSON 光标分析 |
| Task 4 | `79a0fbd`、`5c9ef7f` | 请求列表虚拟化、稳定回调、跨视口拖拽和取消、空白释放不排序、数据刷新保持滚动 |

Task 3 的新增行状态回归集中在 `ndjson-completion-cache.test.ts`，既有 `body-context.test.ts` 保持不变并一起运行。审查补充修复独立提交，便于追踪和逐项回滚。

### 自动化验收

- `pnpm test`：81 个文件、836 项测试通过。
- `pnpm build`：TypeScript 和 Vite 构建成功；仍有既有的大 chunk 与动态/静态混合导入提示，拆包属于 plan02。
- `git diff --check`：通过。
- 四项任务审查与整体最终审查通过，审查发现的排序边界、旧诊断残留、无效拖拽和视口重置问题均已修复。
- 独立兼容性对照：5,000 组校验输入、500 组补全上下文、5,000 组 NDJSON 编辑/光标移动/首行模式切换与原 `272b2b6` 全量纯函数结果一致。
- 仅编辑正文 100 次，静态构建新增次数为 0，上下文引用保持；页面测试验证正文输入不触发请求列表重渲染。
- 1,000 行 Bulk 首次解析 1,000 行，末行重复补全新增旧行解析次数为 0；中间行修改、插入、删除、多处编辑、无效行、首行切换及模型释放均有覆盖。

### 同机 Node 微基准

命令：`node scripts/performance/console-bench.mjs`。Apple M1 / macOS arm64 / Node v25.5.0。构造、打包不计时；各组串行，预热与采样次数遵循原 Spec。下列为全量测试与构建结束后的复测，单位 ms。

| 场景 | 原基线中位 / p95 | 本次中位 / p95 |
| --- | ---: | ---: |
| 1,000 请求、1,000 索引、每索引 200 字段：兼容入口完整构建 | 94.288 / 116.706 | 38.341 / 38.931 |
| 同样数据：仅静态构建 | 未拆分 | 38.334 / 39.819 |
| 同样数据：单目标首行派生 | 未拆分 | 0.002 / 0.002 |
| 同样数据：10 个具体目标首行派生 | 未测 | 0.591 / 0.728 |
| 同样数据：100 个具体目标首行派生 | 未测 | 15.140 / 15.612 |
| 500 KiB 单长字符串有效 JSON 校验 | 2.237 / 2.387 | 2.073 / 2.094 |
| 100 KiB、200 个未闭合括号 | 49.863 / 51.836 | 0.382 / 0.439 |
| 100 KiB、1,000 个未闭合括号 | 248.066 / 256.735 | 0.411 / 0.418 |

单目标和 10 目标派生达到 5 ms 试行目标；100 目标的大字段集合仍有约 15.6 ms p95 成本，不能据单目标样本承诺所有首行编辑均低于 5 ms。只改正文时不运行这些派生。Node 数值不代表 WebView 输入延迟。

### 真实浏览器合成验收

Chromium 156 headless、Vite 开发模式、独立合成侧栏，列表视口 444 px，未读取真实连接或凭据。

| 请求数 | 初始挂载行 / 侧栏 DOM 元素 | 滚动时挂载行 | 滚动 FPS | p95 帧时长 |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 13 / 474 | 20 | 59.63 | 22.7 ms |
| 10,000 | 13 / 474 | 20 | 60.17 | 21.8 ms |

滚动样本为 120 帧、每帧前进 45 px，无机器耗时硬断言。末端请求 Enter 激活、过滤搜索均通过；数据刷新前后滚动位置分别保持 85,614 px 和 877,614 px。真实鼠标跨视口拖拽把首个请求移动到索引 65，返回完整且唯一的 1,000 个 ID；列表外取消、空白处释放不会提交排序，也不会遗留自动滚动。正文输入 100 次的外层 React Profiler actualDuration 中位/p95 均为 0 ms；外层 Profiler 的父级提交通知不能等同于列表实际重渲染次数。浏览器无 pageerror。

### 尚未完成的桌面验收

Integration Gate 中的两项完整桌面验收仍保留未勾选：尚未在 Tauri WebView 中录制输入延迟、真实 Monaco provider p95、React Profiler 与滚动 FPS，也未连接真实 Elasticsearch 执行交互验收。以上 Node、jsdom 和 Chromium 合成结果不能替代这部分证据。代码与自动化/浏览器合成验收已完成；原生桌面性能结论须在相同测试数据下补录。
