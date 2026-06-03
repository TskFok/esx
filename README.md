# ESX

ESX 是一个面向 Elasticsearch 日常调试与运维场景的桌面客户端，使用 Tauri 2、React 19、TypeScript 和 Rust 构建。项目的目标不是替代 Kibana，而是提供一个更轻量、可本地保存连接与请求、支持 SSH 跳板机访问的 Dev Tools 工作台。

## 项目定位

这个项目适合以下场景：

- 需要频繁切换多个 Elasticsearch 环境进行排查或调试。
- Elasticsearch 只能通过内网或跳板机访问。
- 希望把连接、请求草稿、历史请求和响应快照都保存在本地，而不是散落在浏览器标签页里。
- 需要在连接失败或请求失败时保留足够详细的诊断信息，便于复现和定位问题。
- 希望借助 AI 辅助编写或理解 Console 请求，同时不依赖云端托管服务。

## 核心功能

### 1. 连接管理

- 支持保存多个 Elasticsearch 连接。
- 支持为连接保存名称、基础地址、用户名、密码和 TLS 容错选项。
- 连接保存前会先执行连通性校验，避免把不可用配置直接写入本地。
- 已保存连接支持单独测试、编辑、删除和切换。

### 2. SSH 通道复用

- SSH 通道独立于 Elasticsearch 连接保存，可以被多个连接复用。
- 支持两种 SSH 认证方式：
  - 密码认证
  - 私钥认证
- SSH 通道在保存前会先验证握手和认证是否成功。
- 连接在测试和实际执行请求时，都可以复用选定的 SSH 通道访问内网 Elasticsearch。

### 3. Console 请求工作台

- 提供 Kibana Dev Tools 风格的单请求编辑体验。
- 支持使用 `METHOD /path` + JSON 请求体的方式编写请求。
- 基于 Monaco Editor，内置语法高亮、格式校验与 JSON 格式化。
- 支持请求格式化、运行并保存，以及可拖拽调整的请求/响应分栏布局。
- 请求执行结果会保留状态码、耗时、响应体预览和时间戳；超大响应会自动截断显示。
- 对 `_search` 请求中的 `size` 参数提供风险提示，避免误拉取过大结果集。
- 内置快捷键（如 `⌘Enter` 运行并保存、`⌘⇧A` AI 分析、`⌘B` 切换侧边栏），小屏下支持抽屉式侧边栏。

### 4. Console 智能补全

- 自动补全 HTTP 方法、常见 Elasticsearch API 路径片段。
- 基于当前连接缓存的索引、别名与 mapping 字段，补全路径与 JSON 字段名。
- 结合历史请求目标索引，提升重复调试时的输入效率。
- 编辑器内实时标记请求格式问题，便于在发送前发现错误。

### 5. 按连接隔离的请求管理

- 每个连接都拥有独立的请求空间，不会互相污染。
- 请求直接挂在当前连接下，支持创建、编辑、复制、删除和手动拖拽排序。
- 支持为请求添加标签，并按名称/路径/标签搜索与筛选。
- 支持多选请求后批量追加或移除标签。
- 支持将当前连接的请求导出为 JSON（可选 AES-GCM 密码加密），或从 JSON 合并/替换导入到任意连接。
- 工具栏内置常用 Elasticsearch 请求模板，可一键插入编辑器。
- 草稿会随连接保存，切换连接后仍能恢复当前编辑状态。

### 6. AI 辅助（可选）

- **AI 分析**：分析当前 Console 请求格式是否正确，并解释含义或给出修正建议；优先调用配置的 AI 服务，失败时自动回退到本地规则分析。
- **AI 生成**：根据自然语言描述生成可直接执行的 Console 请求，可结合当前连接的索引/别名上下文。
- **AI 设置**：支持 OpenAI、DeepSeek、Kimi、Ollama 及自定义 OpenAI 兼容接口；API Key 通过系统钥匙串保存，不会写入普通配置文件。
- AI 功能默认关闭，且不会主动连接 Elasticsearch，仅处理请求文本本身。

### 7. 服务器状态页

- 展示当前连接对应集群的健康状态、节点与分片概览。
- 展示 CPU、heap、GC、磁盘水位、thread pool、breaker、segment、merge、refresh、search/indexing 等核心运维指标。
- 列出索引列表，支持搜索、系统索引过滤与多列排序。
- 进入页面后自动刷新一次，也可手动重新拉取。
- 适合快速查看集群是否健康、索引体量是否异常，而无需手写 `_cat` 或 `_cluster/health` 请求。

### 8. 错误日志与诊断

- 错误日志默认关闭，需要手动开启采集。
- 开启后，连接测试失败、连接保存失败、请求执行失败、状态读取失败都会记录到本地日志。
- 日志内容包含：
  - 连接上下文
  - SSH 信息
  - 请求上下文
  - 原始响应
  - 底层诊断链路
- 适合排查认证失败、地址填写错误、SSH 不通、内网不可达等问题。

### 9. 本地优先的数据保存

- 连接、请求、草稿、搜索元数据缓存和错误日志保存在本地 store 文件中。
- 连接密码、SSH 密码/私钥口令、AI API Key 通过系统钥匙串能力保存，不直接写入仓库或普通文本配置。
- 整体设计偏向本地单机使用，不依赖服务端。

## 技术栈

- 桌面框架：Tauri 2
- 前端：React 19、TypeScript、Vite 7、React Router 7
- UI：Tailwind CSS、Lucide、Sonner
- 状态与请求：TanStack React Query
- 编辑器：Monaco Editor
- 数据请求：Tauri HTTP Plugin
- 本地存储：Tauri Store Plugin
- 原生能力：Rust、keyring、ssh2、reqwest
- 测试：Vitest、Testing Library

## 安装与运行

### 环境要求

在本地开发或构建此项目前，建议先准备以下环境：

- Node.js 20 或更高版本
- pnpm 9 或更高版本
- Rust stable 工具链
- Tauri 2 构建所需系统依赖

如果你在 macOS 上开发，通常至少需要：

- Xcode Command Line Tools

如果你在 Linux 或 Windows 上开发，还需要先安装 Tauri 对应平台的系统依赖和 WebView 运行时。

### 克隆项目

```bash
git clone git@github.com:TskFok/esx.git
cd esx
```

### 安装依赖

```bash
pnpm install
```

### 启动开发环境

```bash
pnpm tauri dev
```

这个命令会同时启动：

- Vite 前端开发服务（默认 `http://localhost:1420`）
- Tauri 桌面壳

启动后即可在桌面窗口里完成连接配置、请求调试、状态查看和错误日志查看。

### 仅构建前端静态资源

```bash
pnpm build
```

这个命令会执行 TypeScript 检查，并输出前端构建产物到 `dist/`。

### 构建桌面应用

```bash
pnpm tauri build
```

构建成功后，Tauri 会生成平台对应的应用包。当前仓库另外提供了一个 macOS DMG 包装流程。

### 生成 macOS DMG

```bash
pnpm build:dmg
```

在当前项目中，`pnpm build:dmg` 会调用 Tauri 构建流程，并在 macOS 下自动执行 `scripts/build-dmg.sh`，把生成的 `.app` 打包成更适合分发的 `.dmg` 文件。

默认输出位置：

```text
build/ESX-<版本号>.dmg
```

如果你不希望构建完成后自动打开 DMG，可执行：

```bash
OPEN_DMG_AFTER_BUILD=0 pnpm build:dmg
```

### 运行测试

```bash
pnpm test
```

监听模式：

```bash
pnpm test:watch
```

测试覆盖 Console 解析、AI 客户端、自动补全、状态解析、响应快照等核心逻辑；组件测试使用 jsdom 环境。

### 清理构建产物

```bash
pnpm clean
```

会清理 `build/`、`dist/`、`node_modules/.vite` 和 `src-tauri/target/`。

## 使用流程

应用主要页面：

| 路由 | 说明 |
| --- | --- |
| `/connections` | 连接与 SSH 通道管理 |
| `/console` | Console 请求工作台 |
| `/status` | 当前连接的服务器状态 |
| `/logs` | 错误日志 |

### 1. 新建 SSH 通道（可选）

如果 Elasticsearch 只能通过跳板机访问，先在连接页创建 SSH 通道：

- 填写 SSH 主机、端口、用户名
- 选择密码认证或私钥认证
- 验证成功后保存

### 2. 新建 Elasticsearch 连接

在连接页填写：

- 连接名称
- Elasticsearch 地址，例如 `https://es.example.com:9200`
- 用户名
- 密码
- 是否跳过 TLS 校验
- 关联的 SSH 通道（可选）

连接在保存前会先进行测试，只有验证通过后才会持久化。

### 3. 进入 Console

进入 Console 后，建议按以下顺序使用：

1. 点击侧边栏「新建」创建请求，或直接编辑默认请求内容。
2. 输入请求内容，例如：

```http
GET /_cluster/health
```

或：

```http
POST /my-index/_search
{
  "query": {
    "match_all": {}
  }
}
```

5. 使用 `⌘Enter`（Windows/Linux 为 `Ctrl+Enter`）执行并保存。
6. 执行后，当前请求会保存最近一次响应快照，便于后续回看。
7. 可通过标签、搜索和拖拽排序管理请求；侧边栏「多选」支持批量编辑标签。
8. 使用「导出 / 导入」备份或迁移请求集合；导入时可选择目标连接与合并/替换方式，加密文件需输入导出密码。
9. 工具栏「模板」可快速插入集群健康、索引列表等常用请求。

如需 AI 辅助，可在工具栏打开「AI 设置」配置服务地址与模型，然后使用「AI 分析」或「AI 生成」。

### 4. 查看服务器状态

在 Console 侧边栏进入「服务器状态」，可查看：

- 集群健康（green / yellow / red）
- 索引数量、文档量、存储占用
- 分片分布与索引明细

适合日常巡检，无需手动编写状态查询请求。

### 5. 查看错误日志

当连接或请求失败时，可以进入「错误日志」页：

- 开启日志采集
- 复现问题
- 查看连接信息、请求内容和底层诊断输出

这对排查 SSH、认证、地址或网络问题很有帮助。

## 项目结构

```text
.
├── src/                          # React 前端
│   ├── components/
│   │   ├── console/              # Console 编辑器、AI 对话框、响应查看器等
│   │   └── ui/                   # 通用 UI 组件
│   ├── lib/
│   │   ├── console-autocomplete/ # Monaco 自动补全与校验
│   │   ├── ai-analysis-client.ts # AI 分析客户端
│   │   ├── ai-generate-client.ts # AI 生成客户端
│   │   ├── http-client.ts        # Elasticsearch 请求与元数据拉取
│   │   ├── request-analyzer.ts   # 本地请求规则分析
│   │   └── ...                   # 连接、存储、错误处理等
│   ├── pages/                    # 连接、Console、状态、错误日志页
│   ├── providers/                # 应用级状态管理
│   ├── types/                    # TypeScript 类型定义
│   └── test/                     # 测试 setup
├── src-tauri/                    # Tauri / Rust 原生层
│   └── src/lib.rs                # SSH 隧道、HTTP 代理、钥匙串命令
├── scripts/                      # 构建辅助脚本（Tauri 包装、DMG 打包）
├── public/                       # 静态资源
└── build/                        # 构建输出目录（忽略提交）
```

## 本地开发建议

- 前端结构和请求执行逻辑已经做了分层，新增功能时优先补充 `src/lib` 和 `src/providers` 的边界，而不是把逻辑直接堆进页面组件。
- 连接密码、SSH 凭据和 AI API Key 应继续通过原生层存取，不要改成明文持久化。
- 如果新增请求语法能力，优先同步更新 Console 解析、自动补全、格式化和错误展示逻辑。
- 添加功能时请同时补充 Vitest 单元测试；修改现有逻辑时，确保相关测试通过。

## 当前版本

- 应用名：`ESX`
- Bundle ID：`com.ushopal.esx`
- 当前版本：`0.1.0`
