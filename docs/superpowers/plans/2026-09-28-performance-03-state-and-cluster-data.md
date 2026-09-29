# 状态持久化与集群数据读取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合并本地保存、限制状态订阅和集群数据规模，使长会话与大集群下的输入、列表和落盘成本保持可控。

**Architecture:** 先建立串行、可等待的保存队列，再将高频草稿与低频数据放进不同 Tauri Store 文件。保持现有 AppState 对外行为，用内建 React 订阅能力缩小更新范围；字段、治理资源按目标或功能区读取，列表采用分页。各任务独立交付和验证，不引入新状态库或数据库。

**Tech Stack:** React 19、TypeScript、TanStack Query 5、Tauri Store 2、Vitest、Testing Library。

**Spec:** [性能分析与优化方案](/Users/ushopal/workspace/myself/esx/docs/PERFORMANCE_ANALYSIS_2026-09-28.md)

## Global Constraints

- 默认在当前分支实施，不新建分支；每任务通过后按 `type: 中文描述` 提交。
- 不在循环遍历中查询 SQL；Elasticsearch 按目标批量请求，保留版本和权限回退。
- 密码、SSH 凭据和 AI API Key 继续只经 Tauri keyring，不进入 Store、日志或测试数据。
- 不删除任何已保存请求；裁剪旧响应预览时保留请求、状态和明确的“预览已清理”标记。
- 新功能补 Vitest；保持已有正文 600 ms 防抖、Status 30 秒 staleTime、元数据 TTL/请求去重、日志与历史条数上限。
- 与计划 01 的 Console 补全计算/校验/侧栏虚拟化、计划 02 的 Monaco 启动、计划 04 的原生 HTTP 响应协议分开实施；共享 `console-page.tsx`、`app-state.tsx`、`http-client.ts` 的改动串行合并。
- 性能预算均是**建议目标**，不是已测提升；记录相同机器和样本下的前后 p50/p95、DOM 数、请求/写入次数与字节数。
- 优先级：Task 1 为 P1；Task 2–5 为 P2，按真实数据规模与使用频率推进，无需等全部 P2 完成才执行其他计划的 P1。

## Review Focus

1. 保存进行中再次编辑或保存失败：最后版本保持 dirty，重试后落盘。Task 1 的队列测试覆盖。
2. V1→V2 迁移中第二个 Store 写失败：仍能读旧数据，不使用半份 V2 或过期旧数据。Task 2 的迁移测试覆盖。
3. 无关领域更新和连接切换：Console/Status 不多余重渲染，订阅不串连接。Task 3 的组件测试覆盖。
4. Alias 指向多个索引、旧版集群或部分无权限：字段合并正确，不能把空响应当成永久缓存。Task 4 的请求测试覆盖。
5. 筛选/排序后翻页及资源写入：页码回到有效范围，详情和列表缓存正确失效。Task 5 的组件测试覆盖。

## File Map

- Create `src/lib/persist-queue.ts` / `src/lib/__tests__/persist-queue.test.ts`：合并、串行、失败保留 dirty 与 flush。
- Modify `src/providers/app-state.tsx` / `src/providers/__tests__/app-state-security.test.tsx`：接入队列、关闭事件、稳定 actions 与领域订阅；保留 `useAppState` 兼容接口。
- Create `src/providers/__tests__/app-state-persistence.test.tsx`：本地草稿 flush、关闭失败与重复关闭行为。
- Modify `src/lib/storage.ts` / `src/lib/__tests__/storage.test.ts`：V2 冷热 Store 文件、迁移、分区写与脱敏。
- Create `src/lib/response-retention.ts` / `src/lib/__tests__/response-retention.test.ts`：持久化响应预览预算，不改保存请求实体。
- Modify `src/types/requests.ts`、`src/lib/response-snapshot.ts`、`src/pages/console-page.tsx`、`src/components/console/response-viewer.tsx`：预览清理标记的归一化和展示、请求名保存合并、按领域订阅。
- Create `src/components/console/__tests__/response-viewer.test.tsx`：已清理预览的可见提示。
- Modify `src/App.tsx`、`src/pages/root-redirect.tsx` 与现有对应测试：顶层仅订阅 `ready`。
- Modify `src/lib/http-client.ts`、`src/types/requests.ts`、`src/pages/console-page.tsx`、`src/lib/__tests__/search-cluster-metadata.test.ts`：轻量元数据、目标集合批量 mapping 与候选不完整提示。
- Create `src/providers/__tests__/app-state-metadata.test.tsx`：Provider 字段缓存与目标集合行为。
- Create `src/lib/search-metadata-cache.ts` / `src/lib/__tests__/search-metadata-cache.test.ts`：字段 TTL、容量、版本失效。
- Modify `src/components/console/admin-panel.tsx`、`src/components/console/status-indices-tab.tsx`、对应 `__tests__`：按区资源、选中详情、分页。
- Create `src/lib/paginate.ts` / `src/lib/__tests__/paginate.test.ts`：两类列表共用的纯分页函数。

---

### Task 1: 合并保存队列与可等待 flush

**Files:** Create `src/lib/persist-queue.ts`, `src/lib/__tests__/persist-queue.test.ts`, `src/providers/__tests__/app-state-persistence.test.tsx`; modify `src/providers/app-state.tsx:587-596`, `src/pages/console-page.tsx:738-775,1538-1543`。

**Interfaces:** `createPersistQueue<T>(options: { write: (value:T)=>Promise<void>; merge: (pending:T,newer:T)=>T; delayMs?:number }): { schedule(value:T):void; flush():Promise<void>; isDirty():boolean }`，默认 `delayMs=300`。Provider 增加 `registerPendingDraftFlush(flush:()=>void):()=>void` 和 `flushAppState(commit?:()=>void):Promise<void>`（可选回调用于把显式修改与本地缓冲一并提交后保存）；Task 2 将队列 payload 扩为 `{state: AppStateShape; dirty: ReadonlySet<"hot"|"cold">}`，`merge` 取最新 state 与 dirty 并集。

- [x] **Step 1: 写失败测试。** 使用受控 Promise：连续 `schedule(A/B/C)` 只保存最新 C；写 A 尚未完成时调度 B，`flush()` 等待 B；写入拒绝后 `isDirty()` 为 true，下一次 `flush()` 能保存 B。Provider 测试先触发未到期的正文/请求名本地缓冲再关闭，断言最后字符持久化；首次保存失败窗口不关闭且 dirty 保留，连续两次关闭只执行一次保存/关闭。禁止用固定毫秒断言业务正确性。
- [x] **Step 2: 验证红灯。** `pnpm test src/lib/__tests__/persist-queue.test.ts src/providers/__tests__/app-state-persistence.test.tsx`；预期因模块或断言缺失失败。
- [x] **Step 3: 实现队列并接入。** 单个 writer 串行工作；失败保留最新 payload，不自动无限重试；`flush()` 清除等待定时器，直到队列无新版本才 resolve。保存错误继续用现有 toast。请求名输入在页面本地短防抖后写 `updateDraft`，正文现有 600 ms 防抖保持不变。
- [x] **Step 4: 接入退出与显式保存。** Provider 持有已注册的本地输入 flush 回调；Tauri `onCloseRequested` 先 `preventDefault()` 防重入，`flushSync` 执行正文/请求名回调，使 `useLayoutEffect` 将最终已提交 state 入队，再检查 dirty、await `flushAppState()`，成功后 `destroy()`，失败留窗并提示重试。显式保存动作复用同一提交后 flush 路径，不在 `setState` 后直接 flush 旧快照；卸载时解除监听。异常退出只保留此前已完成的落盘，不承诺可靠 flush。
- [x] **Step 5: 验证绿灯并提交。** `pnpm test src/lib/__tests__/persist-queue.test.ts src/providers/__tests__/app-state-persistence.test.tsx src/providers/__tests__/app-state-security.test.tsx src/pages/__tests__/console-page.test.tsx`；预期通过。`git add` 上述改动，`git commit -m "refactor: 合并应用状态保存"`。建议目标：20 字连续输入远少于 20 次 `save()`；测最终落盘延迟、IPC 字节与文件写次数。

### Task 2: 冷热 Store、V2 迁移与响应预览预算

**Files:** Modify `src/lib/storage.ts:17-98`, `src/lib/__tests__/storage.test.ts`, `src/providers/app-state.tsx`, `src/types/requests.ts`, `src/lib/response-snapshot.ts:120-151`, `src/lib/__tests__/response-snapshot.test.ts`, `src/components/console/response-viewer.tsx`, `src/pages/console-page.tsx`; create `src/lib/response-retention.ts`, `src/lib/__tests__/response-retention.test.ts`, `src/components/console/__tests__/response-viewer.test.tsx`。

**Interfaces:** `type StoragePartition = "hot" | "cold"`; `writeAppStorage(state: AppStorageState, dirty?: ReadonlySet<StoragePartition>): Promise<void>`；`readAppStorage(): Promise<AppStorageState>` 维持旧接口。`applyPersistedPreviewBudget(state: AppStorageState): AppStorageState` 仅裁剪响应预览，常量 `MAX_SINGLE_PERSISTED_PREVIEW_BYTES = 1 * 1024 * 1024`、`MAX_TOTAL_PERSISTED_PREVIEW_BYTES = 32 * 1024 * 1024`；`ResponseSnapshot.previewEvicted?: boolean`。

- [x] **Step 1: 写失败测试。** 旧 `app-state` 数据迁移后草稿仍可读；注入迁移 hot/cold 任一 save 失败，旧数据保持完整；V2 已提交后 hot 缺失必须报可恢复错误，不能回退过期 V1；仅草稿变化只调用 hot Store 的 `save()`；跨分区写在 cold 保存后 hot 失败时，重启仍保留新版请求并规范化草稿。预算测试用超限快照断言最旧预览清理、`previewEvicted=true`、请求 id/body/tags/status 不变；`normalizeResponseSnapshot` 保留标记，`ResponseViewer` 明示“历史预览已清理”。
- [x] **Step 2: 验证红灯。** `pnpm test src/lib/__tests__/storage.test.ts src/lib/__tests__/response-retention.test.ts`；预期新增断言失败。
- [x] **Step 3: 实现分区和迁移。** `esx-hot.json` 的 `app-state-hot-v2` 仅含 `drafts/currentConnectionId`；现有 `esx-store.json` 的 `app-state-v2` 含其余字段及 `version:2`。首次迁移先保存 hot，再保存 cold V2 提交标记；此前不删 V1。后续跨分区更新先保存 cold（请求等不可丢数据）再保存 hot；两文件无法原子提交，重启时用 `normalizeState` 清理不匹配连接的草稿，测试覆盖中途失败。已看到 V2 标记却缺 hot 时显示读取失败，不用旧 V1 覆盖后续数据。队列根据字段引用变化合并 dirty 分区；只拆同文件的 key 不算降低整文件落盘，此任务实际分文件。取消 `autoSave:100` 与显式 `save()` 的叠加策略，保留队列显式保存。
- [x] **Step 4: 实现容量与界面提示。** 只对持久化响应快照的 `bodyPreview/prettyPreview` 计 UTF-8 字节，先按单条 1 MiB，再按总量 32 MiB 清理最旧预览；不删除请求、正文或审计记录。清理后 `bodyPreview=""`、`prettyPreview=undefined`、`previewBytes=0`，保留响应状态/大小与 `previewEvicted`；`normalizeResponseSnapshot` 保留此标记，`ResponseViewer` 明确显示“历史预览已清理”，再次执行可生成新预览。迁移老快照也走同一策略。
- [x] **Step 5: 验证绿灯并提交。** `pnpm test src/lib/__tests__/storage.test.ts src/lib/__tests__/response-retention.test.ts src/lib/__tests__/response-snapshot.test.ts src/components/console/__tests__/response-viewer.test.tsx src/providers/__tests__/app-state-security.test.tsx`；预期通过。`git commit -m "refactor: 拆分冷热状态存储"`。记录新旧文件大小、草稿连续修改时两个文件各自写入次数；V2 提交后只能回滚到仍识别 V2 的实现，或先导出最新合并快照供恢复，绝不直接启用仅读 V1 的旧版本。

### Task 3: 领域订阅与稳定 actions

**Files:** Modify `src/providers/app-state.tsx:116-130,229,536-543,638-653,1340-1352`, `src/App.tsx:39-45`, `src/pages/root-redirect.tsx:4-7`, `src/pages/console-page.tsx:238-272`, `src/components/console/status-panel.tsx:56-62`, `src/components/console/admin-panel.tsx:402-410`, `src/components/console/error-logs-panel.tsx:92-98`, `src/pages/__tests__/root-redirect.test.tsx`; create `src/providers/__tests__/app-state-subscriptions.test.tsx`。

**Interfaces:** 从现有 `AppStateContextValue` 提取 `AppStateView = Pick<AppStateContextValue, "ready"|"connections"|"sshProfiles"|"searchMetadataByConnection"|"currentConnection"|"currentDraft"|"requestsForCurrentConnection"|"errorLoggingEnabled"|"responsePreviewBytes"|"aiSettings"|"aiApiKeyConfigured"|"aiAnalysisHistory"|"errorLogs"|"statusHistoryByConnection">`，`AppStateActions = Omit<AppStateContextValue, keyof AppStateView>`。`useAppStateField<K extends keyof AppStateView>(key:K): AppStateView[K]` 返回稳定字段快照；`useAppActions(): AppStateActions` 返回稳定方法对象。Context 本身只提供稳定 store 实例，内含 `getSnapshot/subscribe/getActions`；`useSyncExternalStore` 按字段订阅；`useAppState()` 保留完整视图供未迁移页面使用。派生字段仅在各自输入变动时更新引用。

- [x] **Step 1: 写失败组件测试。** `renderHook` 订阅 `errorLogs`、`statusHistoryByConnection` 和 `currentDraft`，追加状态快照时仅状态订阅计数增加；切连接后草稿订阅更新且不读到旧连接；`useAppActions()` 引用在日志更新后不变。App/RootRedirect 只取 `ready`，状态快照变化时顶层路由不重渲染。测试行为而非精确耗时。
- [x] **Step 2: 验证红灯。** `pnpm test src/providers/__tests__/app-state-subscriptions.test.tsx`；预期 hook 不存在或断言失败。
- [x] **Step 3: 实现与迁移。** provider 保存稳定订阅器和 actions，状态发布在 React commit 后；字段 snapshot 复用原值，避免返回新对象导致订阅循环。先把 `App`、`RootRedirect` 改为只订阅 `ready`，再把 Console、Status、Admin、错误日志面板改用所需字段及 actions；Console 的日志/状态变动不重建编辑器 props。现有业务 mutation 留在 `app-state.tsx`，不趁机重写逻辑。
- [x] **Step 4: 验证绿灯并提交。** `pnpm test src/providers/__tests__/app-state-subscriptions.test.tsx src/providers/__tests__/app-state-security.test.tsx src/pages/__tests__/root-redirect.test.tsx src/pages/__tests__/console-page.test.tsx src/components/console/__tests__/status-panel.test.tsx src/components/console/__tests__/admin-panel.test.tsx`；预期通过。`git commit -m "refactor: 缩小应用状态订阅范围"`。React Profiler 在 100/1000 请求场景记录无关面板 commit；建议目标是无关订阅 0 次更新，实际 UI 耗时待测。回滚可先让迁移组件恢复 `useAppState`，保留稳定 store 实现。

### Task 4: 按目标批量读取 mapping 并限制字段缓存

**Files:** Modify `src/lib/http-client.ts:256-263,883-1049,1057`, `src/providers/app-state.tsx:326-350,949-1105`, `src/pages/console-page.tsx:924-972,985-990`, `src/types/requests.ts:65-75`, `src/lib/__tests__/search-cluster-metadata.test.ts`, `src/pages/__tests__/console-page.test.tsx`; create `src/lib/search-metadata-cache.ts`, `src/lib/__tests__/search-metadata-cache.test.ts`, `src/providers/__tests__/app-state-metadata.test.tsx`。

**Interfaces:** `fetchConnectionSearchMetadata(...)` 返回现有 `SearchMetadataResult`（定义在 `http-client.ts:256`，不含时间戳），初次刷新不取 `/_mapping?expand_wildcards=open`。新增 `TargetMappingFieldsResult = {requestedNames:string[]; fieldsByIndex:Record<string,string[]>}` 与 `fetchTargetMappingFields(connection, credentials, targets: string[], sshTunnel?): Promise<TargetMappingFieldsResult>`；对去重目标每批至多 25 个拼一条 mapping 请求，批间并发上限 2。Provider 新增 `ensureTargetFields(connection: ConnectionProfile, targets: string[], options?: {force?:boolean}): Promise<string[] | null>`，保留旧 `ensureIndexFields` 兼容入口。`ConnectionSearchMetadata.fieldsFetchedAtByIndex?: Record<string,string>`、`fieldsTruncatedByIndex?: Record<string,boolean>`、`fieldsCacheTruncated?:boolean`（索引容量裁剪提示）；`mergeTargetFields(cache, result, nowMs): ConnectionSearchMetadata`，只保留最近取到的 100 个索引字段，每个索引按名称排序后最多保留 2000 字段，TTL 5 分钟；`normalizeStoredSearchMetadata` 必须保留新字段，索引/别名刷新与连接 `updatedAt` 变化使相关缓存失效。

- [x] **Step 1: 写失败测试。** `search-cluster-metadata.test.ts` 断言首次元数据刷新不请求全量 mapping、alias 多目标合并为批量请求且结果含 `requestedNames`；Provider/Console 测试断言同目标并发复用 in-flight、过期/连接变更/空结果重试、请求路径的目标集合只触发一次批量入口；缓存测试断言超过 100 个条目时有确定淘汰、2001 字段时保留排序前 2000 个并标记截断，归一化后标记仍在；无权限时降级为无字段补全，不影响索引/别名。
- [x] **Step 2: 验证红灯。** `pnpm test src/lib/__tests__/search-cluster-metadata.test.ts src/lib/__tests__/search-metadata-cache.test.ts src/providers/__tests__/app-state-metadata.test.tsx src/pages/__tests__/console-page.test.tsx`；预期新增断言失败。
- [x] **Step 3: 实现。** 保留根信息、license、`_resolve/index/*` 与有条件的 `_aliases`/CAT 回退，移除初始化全量 mapping；Console 从请求路径提取目标集合，一次调用新的批量入口，复用现有 `ensureIndexFields` 缓存和 in-flight 去重语义。字段总表由受限 `fieldsByIndex` 派生，截断时在现有元数据状态文案提示字段候选不完整；持久化不保留无限增长的旧字段。通配目标仅显示已有名称候选，不展开成逐索引请求。
- [x] **Step 4: 验证绿灯并提交。** `pnpm test src/lib/__tests__/search-cluster-metadata.test.ts src/lib/__tests__/search-metadata-cache.test.ts src/providers/__tests__/app-state-metadata.test.tsx src/pages/__tests__/console-page.test.tsx src/lib/__tests__/status.test.ts`；预期通过。`git commit -m "refactor: 按目标读取索引字段"`。建议目标：1000/10000 索引样本的首次补全可用时间和 mapping 字节显著低于基线；测请求数、网络字节、解析时间和 Store 大小。若兼容性退化，回滚批量读取、保留轻量名称查询。

### Task 5: Admin 按区读取、详情分离与大列表分页

**Files:** Modify `src/components/console/admin-panel.tsx:166-233,456-472,583-638,769-807,1048-1055`, `src/components/console/status-indices-tab.tsx:61-71,137-179`, `src/components/console/__tests__/admin-panel.test.tsx`, `src/components/console/__tests__/status-panel.test.tsx`; create `src/lib/paginate.ts`, `src/lib/__tests__/paginate.test.ts`。

**Interfaces:** `paginate<T>(items: readonly T[], page: number, pageSize=100): {items:T[]; page:number; pageCount:number; total:number}`；Admin 资源 Query key 为 `["admin-resources", connection.id, connection.updatedAt, section]`，详情 key 再加 `resource.id`，`staleTime: 30_000`、`refetchOnWindowFocus:false`、`refetchOnReconnect:false`、`retry:false`。index/template 列表请求尽量用 `filter_path` 限定名称与卡片字段，选中后按单资源 endpoint 取完整定义；pipeline 列表端点若不能只返回名称，则只在对应功能区请求完整结果并立即投影为轻量列表，不假称网络字节已缩小。写操作成功只失效受影响资源与详情，Status 沿用已有标签 Query key、30 秒 staleTime。

- [x] **Step 1: 写失败测试。** `indices` 区刷新不请求模板/pipeline；切到 `templates` 才请求对应列表；选中后才取完整详情；写操作后关联 Query 失效；列表 1000 条只渲染当前 100 条，筛选/排序使页码回到有效范围并保持选择语义；Status 的统计仍针对完整筛选结果。
- [x] **Step 2: 验证红灯。** `pnpm test src/lib/__tests__/paginate.test.ts src/components/console/__tests__/admin-panel.test.tsx src/components/console/__tests__/status-panel.test.tsx`；预期新增断言失败。
- [x] **Step 3: 实现。** Admin 首次激活功能区时读取该区资源，刷新按钮只重拉当前区；使用 TanStack Query 短期缓存和连接版本隔离，列表与详情分离并保留权限失败提示。Status 的 `_cat/indices` 仍一次获取完整数据供汇总、筛选和排序，只分页呈现 DOM；Admin 资源列表与 mapping 差异表同样分页，默认每页 100 条。避免在本任务改原生响应协议或 Console 侧栏拖拽。
- [x] **Step 4: 验证绿灯并提交。** `pnpm test src/lib/__tests__/paginate.test.ts src/components/console/__tests__/admin-panel.test.tsx src/components/console/__tests__/status-panel.test.tsx src/lib/__tests__/status.test.ts`；预期通过。`git commit -m "refactor: 按区加载治理资源并分页展示"`。建议目标：1k/10k 索引时页面 DOM 行数不超过 100+固定表头，测网络 payload、筛选到绘制 p95 与滚动帧时间。若分页体验不佳，可回滚 UI 分页组件而保留服务端按区读取。

## 整体验收与回滚

- [x] 五项分别通过对应测试后运行 `pnpm test` 和 `pnpm build`；预期测试全绿、TypeScript/Vite 构建通过。性能对比以同机同数据集记录，不将报告现有微基准当成优化后结果。
- [ ] 桌面端验证冷启动 V1 迁移、快速输入后关闭、保存失败重试、1k/10k 索引、alias 多目标和无权限回退；记录 Tauri Store 文件大小、`set/save` 次数、HTTP 字节、React commit 与列表 DOM 行数。异常退出只能依赖最近一次已完成保存，不能承诺等待 flush。
- [x] 各任务独立提交便于回滚；V1 `app-state` 保留到 V2 经真实用户数据验证后，再单独决定清理时机。合并计划 01/02/04 的共享文件改动时先运行相关测试并处理冲突，不扩大本计划范围。


## 执行结果（2026-09-29）

五项实现、回归测试和独立代码审查均已完成。任务步骤的勾选表示实现、红绿测试及提交已完成；其中的性能建议目标不代表已测达成。真实桌面与集群验收仍保留为上方未勾选项，受控测量和具体边界见 [验收记录](./2026-09-28-performance-03-validation.md)。

| 任务 | 完成内容 | 本地提交 |
| --- | --- | --- |
| Task 1 | 串行合并保存、失败重试、关闭前提交正文/名称、显式保存等待最终快照 | `02e2ed0` |
| Task 2 | 冷热文件分离、V2 迁移、分区失败恢复、响应预览字节预算与清理提示 | `e7bc0d9` |
| Task 3 | 稳定 actions、字段订阅、顶层与 Console/Status/Admin/日志面板迁移 | `7ff75fd` |
| Task 4 | 轻量名称初始化、目标批量 mapping、TTL/容量限制和截断提示 | `123d826`、`4591a8b` |
| Task 5 | 治理资源按区读取、选中详情、资源/差异/状态列表分页 | `840ed32` |
| 最终整合修复 | 保存请求仅合并本次涉及数据，保留同批其他连接最后输入与新请求 | `ce75047` |

为避免共享文件混合提交，实际提交顺序为 Task 1、2、4、5、3；始终在原 `master` 分支实施。原性能分析文档及计划 04 未改动。

最终验证：

- `pnpm test`：97 个测试文件、920 项测试通过。
- `pnpm build`：TypeScript 与 Vite 构建通过；仍有现有的单 chunk 超过 500 kB 提示。
- 各任务独立审查及最终整合审查通过。补充回归覆盖旧 V1 脱敏、失败分区重试、刷新中 mapping 过期、字段清空/裁剪提示、跨连接治理操作归属、同 alias 详情失效与跨连接草稿 flush。
- 代码审查发现的最后一项覆盖问题先用两项测试复现，再修复并完成独立复核；上述全量验证在该修复之后执行。

接口与恢复说明：

- `flushAppState` 接受可选 `commit` 回调；旧无参调用保持兼容，显式修改在提交后进入队列，避免保存旧快照。
- 稳定 actions 的 AI 凭据读取需要显式传入当前设置的 scope；保留旧 `useAppState` 回调的 scope 隔离，避免旧回调读取新服务密钥。
- 除单索引字段截断标记外，增加字段缓存容量裁剪标记，使 100 个索引上限触发时也明确提示候选不完整。
- V1 备份经过脱敏后保留；V2 提交后不得直接回滚到仅读 V1 的版本。需使用支持 V2 的实现，或先导出最新合并快照。
- 原生关闭/迁移、实际文件写入与 IPC、真实大集群 HTTP 字节及浏览器 Profiler 尚未实测，不能用单测或受控 Node 测量替代这些验收。
