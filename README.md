# ESX

ESX 是一个面向 Elasticsearch 日常调试与运维场景的桌面客户端，使用 Tauri 2、React 19、TypeScript 和 Rust 构建。项目的目标不是替代 Kibana，而是提供一个更轻量、可本地保存连接与请求、支持 SSH 跳板机访问的 Dev Tools 工作台。

## 项目定位

这个项目适合以下场景：

- 需要频繁切换多个 Elasticsearch 环境进行排查或调试。
- Elasticsearch 只能通过内网或跳板机访问。
- 希望把连接、请求草稿、历史请求和响应快照都保存在本地，而不是散落在浏览器标签页里。
- 需要在连接失败或请求失败时保留足够详细的诊断信息，便于复现和定位问题。

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
- 基于 Monaco Editor，内置简单语法高亮。
- 支持请求格式化。
- 支持快捷执行并保存，请求执行结果会保留最近一次状态码、耗时、响应体和时间戳。

### 4. 按连接隔离的请求树

- 每个连接都拥有独立的请求空间，不会互相污染。
- 请求以“项目 -> 模块 -> 请求”的树形结构管理。
- 支持创建、重命名、复制和删除项目、模块、请求。
- 草稿会随连接保存，切换连接后仍能恢复当前编辑状态。

### 5. 错误日志与诊断

- 错误日志默认关闭，需要手动开启采集。
- 开启后，连接测试失败、连接保存失败、请求执行失败都会记录到本地日志。
- 日志内容包含：
  - 连接上下文
  - SSH 信息
  - 请求上下文
  - 原始响应
  - 底层诊断链路
- 适合排查认证失败、地址填写错误、SSH 不通、内网不可达等问题。

### 6. 本地优先的数据保存

- 连接、项目、模块、请求、草稿和错误日志保存在本地 store 文件中。
- 连接密码和 SSH 密码 / 私钥口令通过系统钥匙串能力保存，不直接写入仓库或普通文本配置。
- 整体设计偏向本地单机使用，不依赖服务端。

## 技术栈

- 桌面框架：Tauri 2
- 前端：React 19、TypeScript、Vite
- UI：Tailwind CSS、Lucide、Sonner
- 编辑器：Monaco Editor
- 数据请求：Tauri HTTP Plugin
- 本地存储：Tauri Store Plugin
- 原生能力：Rust、keyring、ssh2、reqwest

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

- Vite 前端开发服务
- Tauri 桌面壳

启动后即可在桌面窗口里完成连接配置、请求调试和错误日志查看。

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

## 使用流程

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

1. 先创建请求项目。
2. 在项目下创建模块。
3. 在模块下创建请求。
4. 输入请求内容，例如：

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

执行后，当前请求会保存最近一次响应快照，便于后续回看。

### 4. 查看错误日志

当连接或请求失败时，可以进入“错误日志”页：

- 开启日志采集
- 复现问题
- 查看连接信息、请求内容和底层诊断输出

这对排查 SSH、认证、地址或网络问题很有帮助。

## 项目结构

```text
.
├── src/                  # React 前端
│   ├── components/       # UI 组件与 Console 编辑器
│   ├── lib/              # 请求、存储、错误处理、Tauri 调用封装
│   ├── pages/            # 连接页、Console 页、错误日志页
│   ├── providers/        # 应用级状态管理
│   └── types/            # TypeScript 类型定义
├── src-tauri/            # Tauri / Rust 原生层
├── scripts/              # 构建辅助脚本（如 DMG 打包）
├── public/               # 静态资源
└── build/                # 构建输出目录（忽略提交）
```

## 本地开发建议

- 前端结构和请求执行逻辑已经做了分层，新增功能时优先补充 `src/lib` 和 `src/providers` 的边界，而不是把逻辑直接堆进页面组件。
- 连接密码和 SSH 凭据应继续通过原生层存取，不要改成明文持久化。
- 如果新增请求语法能力，优先同步更新 Console 解析、格式化和错误展示逻辑。

## 当前版本

- 应用名：`ESX`
- 当前版本：`0.1.0`
