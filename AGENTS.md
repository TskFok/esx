# ESX Agent 指令

本文件为 AI 编码助手的项目级指令，Cursor 等工具会自动读取。

项目简介与技术栈见 [README.md](README.md)。

## 提交规范

提交信息以英文 type 前缀开头，具体内容使用中文，保持简短明确。

### 格式

```text
<type>: <中文描述>
<type>(<scope>): <中文描述>
```

### Type

| Type | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 修 bug |
| `refactor` | 重构 |
| `chore` | 日常维护 |
| `ci` | GitHub Actions / 部署配置 |
| `build` | 依赖 / 构建变更 |
| `docs` | 文档 |
| `test` | 测试 |

### 示例

```text
feat: 添加连接导入导出
fix: 修复 SSH 重连失败
发布：v0.2.0
```

发布版本时执行 `pnpm release`（提交信息为 `发布：vX.Y.Z`）。完整发布流程见 [docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md)。

## 开发约定

### 架构与分层

- 新增功能时优先补充 `src/lib` 和 `src/providers` 的边界，不要把业务逻辑直接堆进页面组件。
- 新增 Console 请求语法能力时，同步更新解析、自动补全、格式化和错误展示逻辑（`src/lib/console-autocomplete/`、`console-parser` 等）。

### 敏感信息

- 连接密码、SSH 凭据、AI API Key 必须通过 Tauri 原生层（keyring）存取，不得明文写入配置文件或提交到仓库。
- 代码、文档、测试数据和日志中不得出现真实密钥、密码或私钥；使用环境变量或占位符配置。

### 测试

- 添加功能时必须补充 Vitest 单元测试。
- 修改现有逻辑时，确保相关测试通过。
- 测试文件放在 `src/**/__tests__/` 或 `scripts/**/*.test.mjs`；组件测试使用 jsdom 环境。
- 运行测试：`pnpm test`

### 代码风格

- 保持改动范围最小，只修改任务所需代码。
- 遵循现有命名、类型与抽象风格，避免过度封装。
- 注释仅用于解释非显而易见的业务或技术细节。

### 交流语言

- 与项目维护者沟通时使用简体中文。
