# 连接页工作台布局设计

## 背景

当前连接页是顶部统计横幅加两列卡片：左列已保存连接，右列已保存 SSH 通道。新建/编辑连接和 SSH 都走全屏弹窗。打开程序时，若已有当前连接会直接进入 Console。

目标是把连接页改成与 Console 相同的左右工作台：左侧深色栏放已保存连接，右侧放新建/编辑表单；SSH 通道不再占独立卡片，增改改为在右侧表单中用弹窗完成。

## 目标

- 打开程序默认进入 `/connections`，即使已有当前连接也不跳 Console。
- 连接页左侧与 Console 同款：深色圆角栏、导航、列表。
- 单击左侧连接进入 Console；「新建」「编辑」在右侧主区打开表单，不再用连接弹窗。
- 去掉页面级「已保存 SSH 通道」卡片；SSH 只在右侧连接表单内选择、测试、删除，新增/编辑用弹窗。
- 右侧默认空状态，引导新建或从左侧进入 Console。

## 非目标

- 不抽公共 AppShell（不把 Console 与连接页的左侧壳合并为一个组件）。
- 不改 Console 请求列表、编辑器、快捷键或请求执行逻辑。
- 不新增独立 SSH 管理页或 SSH 路由。
- 不改连接/SSH 的存储、密钥保管、校验与导入导出规则。

## 默认入口

`RootRedirect` 在应用就绪后始终导航到 `/connections`。

不再根据 `currentConnection` 或连接数量跳转到 `/console`。无连接时也进入连接页，由空状态引导新建。

从左侧单击连接、或保存连接成功后，仍进入 `/console`（现状保留）。

## 布局

连接页使用与 Console 相同的工作台骨架：全屏 `h-dvh`、左侧深色栏、右侧浅色主区。

```text
┌──────── 左栏 ConnectionsSidebarPanel ─────┬──── 右侧 ConnectionEditorPanel ────┐
│ ESX Console                               │ idle：空状态引导                   │
│ 连接页 / 状态 / 治理 / 错误日志            │ create：新建表单                   │
│ [导入] [导出] [新建连接]                   │ edit：编辑表单                     │
│ 已保存连接列表                             │ SSH 选择区；增改弹窗 SshProfileDialog │
│  单击整行 → Console                       │                                    │
│  行内 [测试][编辑][删除]                   │                                    │
└───────────────────────────────────────────┴────────────────────────────────────┘
```

小屏对齐 Console：左栏改为抽屉，右侧仍是空状态或表单。本轮不实现左栏宽度拖拽与 `⌘B` 折叠，固定可用宽度即可。

## 左侧栏

新增 `ConnectionsSidebarPanel`，视觉对齐 `ConsoleSidebarPanel`（`bg-slate-950`、圆角、导航 ghost 按钮、列表密度），但不复用请求列表逻辑。

内容：

- 标题与导航：连接页、状态、治理、错误日志。按钮视觉与 Console 一致（深色栏 ghost，不用 secondary 实心高亮）；当前页仅用弱背景或字重区分。
- 操作：导入、导出、新建连接。
- 列表：按现有排序（最近使用优先，其次中文名）。展示名称、地址、当前/SSH/TLS 标记。
- 当前连接高亮，与 Console 当前请求一致。
- 单击整行：`setCurrentConnection` 后 `navigate("/console")`。
- 行内按钮：测试、编辑、删除；点击不冒泡，不进入 Console。

无连接时左栏显示空列表提示，主操作仍是「新建连接」。

导入导出继续使用现有 `ConnectionExportDialog` / `ConnectionImportDialog`，仅按钮位置改到左栏。

## 右侧主区

新增 `ConnectionEditorPanel`，由页面状态机驱动：

| 状态 | 内容 |
| --- | --- |
| `idle` | 空状态：说明可点左侧连接进入 Console，或点「新建连接」。 |
| `create` | 空白连接表单（字段与现有新建弹窗相同）。 |
| `edit` | 填入该连接的表单（含从 keyring 读出的凭据）。 |

交互：

- 「新建连接」进入 `create`。
- 左栏「编辑」进入 `edit`。
- 「取消」回到 `idle`（若表单已脏，先确认，见下文）。
- 保存成功：toast、清空表单、进入 Console（与现状一致）。
- 正在编辑的连接被删除：回到 `idle`。

连接表单从现有 Dialog 原样迁出，校验与「验证并保存连接」逻辑不变。

## SSH 通道

去掉连接页上独立的 SSH 卡片列表。SSH 只出现在右侧连接表单的「访问方式」区块：

- 直连 / 选择已有通道 / 「新建 SSH 通道」。
- 选中后可：测试、编辑（弹窗）、清除选择、删除（确认框）。
- 无通道时展示引导，主操作是「新建 SSH 通道」。

新增 `SshProfileDialog`，承接现有 SSH 新增/编辑弹窗：

- 保存前仍先 `validateSshTunnel` 与主机指纹校验。
- 保存成功：关闭弹窗、toast、将该通道写入当前连接表单的 `sshProfileId`。
- 保存失败：toast + 错误日志，弹窗保持打开。
- 保存进行中禁止关闭弹窗。

删除仍用现有确认框；删除当前选中通道时清除表单中的 `sshProfileId`。

## 未保存离开

右侧表单相对进入 `create`/`edit` 时的快照判断是否脏。

- 脏数据时点「取消」、再点「新建」、或去编辑另一条连接：先确认「放弃未保存的更改？」。
- 单击左侧连接进入 Console：不拦截，草稿不保存。
- SSH 弹窗未保存关闭：直接关，不二次确认。
- 连接/SSH 保存请求进行中：不允许切状态或关弹窗。

## 错误处理

沿用现有 toast 与错误日志，不新增错误通道：

- 连接/SSH 保存或测试失败：toast + `recordErrorLog`，表单或弹窗不关闭、不跳转。
- 删除失败：toast，确认框可关闭。
- 生产环境跳过 TLS 等安全校验保持现有 `validateConnectionSecurity` 行为。

## 状态与数据流

页面仍由 `ConnectionsPage` 持有 mutation 与 `useAppState` 调用。连接、SSH、密钥、导入导出的数据边界不变。

状态从 `connectionDialogOpen` 改为 `editorMode: "idle" | "create" | "edit"`；`sshDialogOpen` 保留。组件只接收数据和回调，不直接写 store。

## 测试

新增/更新测试覆盖：

- `RootRedirect` 在已有当前连接时仍进入 `/connections`。
- 左栏单击连接会进入 Console；点「编辑」打开右侧表单而不是连接弹窗。
- 默认右侧为空状态；点「新建连接」渲染表单。
- SSH 新建/编辑打开 `SshProfileDialog`；保存成功后当前表单选中该通道。
- 脏表单取消会先确认；单击进 Console 不拦截。

相关现有测试（导入导出弹窗、删除文案、安全校验、SSH 保存）必须继续通过。不把密钥、密码写入测试数据。
