# 提交与发布规范

本项目采用 [Conventional Commits](https://www.conventionalcommits.org/) 约定。提交信息以**英文 type 前缀**开头，**具体内容使用中文**，保持简短明确。

## 提交格式

```text
<type>: <中文描述>
<type>(<scope>): <中文描述>
```

示例：

```text
feat: 添加连接导入导出
fix: 修复 SSH 隧道断开后重连失败
refactor(console): 拆分请求解析逻辑
chore: 发布 v0.2.0
```

## Type 说明

| Type | 用途 | Release Notes 分组 |
| --- | --- | --- |
| `feat` | 新功能 | 新功能 |
| `fix` | 修 bug | 修 bug |
| `refactor` | 重构 | 重构 |
| `chore` | 日常维护 | 日常维护 |
| `ci` | GitHub Actions / 部署配置 | GitHub Actions / 部署配置 |
| `build` | 依赖 / 构建变更 | 依赖 / 构建变更 |
| `docs` | 文档 | 文档 |
| `test` | 测试 | 测试 |

不在上表中的 type 不会出现在 Release Notes 中。

## 发布流程

1. 日常开发按上述规范提交到 `master`。
2. 在 `master` 分支执行 `pnpm release`（或 `--minor` / `--major`）升版并打 tag。
3. 推送 tag 后，GitHub Actions（`.github/workflows/release.yml`）自动构建并创建 Release。
4. Release Notes 由 `scripts/lib/changelog.mjs` 根据 tag 区间内符合规范的 commit 自动生成，并按 type 分组。

本地预览某次发布的 Release Notes：

```bash
node scripts/lib/changelog.mjs --tag v0.1.1
```

## 配置文件

- `.versionrc.json`：conventional-changelog 分组配置（与 Release Notes 分组一致）
- `.github/release-drafter.yml`：可选的 Release Drafter 配置；若团队改为 PR 合并流程，可启用 `.github/workflows/release-drafter.yml` 维护 Draft Release
