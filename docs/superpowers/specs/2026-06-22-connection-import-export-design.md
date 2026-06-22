# 连接导入导出设计

## 背景

连接管理页当前负责维护 Elasticsearch 连接和可复用 SSH 通道。连接基础配置保存在 Tauri store 中，Elasticsearch 密码、API Key、Bearer Token、SSH 密码和私钥口令保存在本地 secret vault 中。

用户需要在连接管理页增加导入导出能力：导出时根据输入密码加密完整内容，导入时必须使用同一密码解密后才能写入。本设计明确包含敏感凭据，导入后需要恢复到本地 secret vault。

## 目标

- 在连接管理页支持导出全部连接和 SSH 通道。
- 导出文件必须使用用户输入的密码加密，明文导出不作为本功能入口。
- 导出内容包含连接配置、连接凭据、SSH 通道配置和 SSH 凭据。
- 导入时读取加密 JSON 文件，输入密码解密，预览数量后确认导入。
- 导入以追加方式写入，生成新 ID，不覆盖本机已有连接或 SSH 通道。
- 导入成功后连接与 SSH 通道关联保持正确，敏感凭据重新写入本地 secret vault。

## 非目标

- 不导出已保存请求、草稿、搜索元数据、状态历史、错误日志和 AI 设置。
- 导入时不自动测试连接或 SSH 通道，避免批量导入被网络环境阻塞。
- 不提供覆盖现有连接的模式。
- 不迁移操作系统级 secret vault 的原始记录，只迁移解密后的应用级凭据。

## 用户体验

连接管理页的连接区域增加“导出”和“导入”按钮，与现有“错误日志”“新建连接”保持相同密度和样式。

导出流程：

1. 用户点击“导出”。
2. 弹窗展示将导出的连接数量和 SSH 通道数量。
3. 用户输入导出密码并再次确认。
4. 系统读取每个连接和 SSH 通道的凭据，构建 payload，使用密码加密并下载 `.encrypted.json` 文件。
5. 成功后提示已导出数量；失败时提示具体错误。

导入流程：

1. 用户点击“导入”并选择 JSON 文件。
2. 弹窗要求输入导出密码。
3. 用户点击“解析文件”，系统解密并校验文件格式。
4. 解密成功后展示连接数量、SSH 通道数量和导出时间。
5. 用户点击“开始导入”后，系统生成新 ID 并写入连接、SSH 通道和对应 secret。
6. 成功后提示已导入数量。

密码错误或文件损坏时，提示“密码错误或文件已损坏。”，不写入任何数据。

## 数据格式

新增连接导出 payload 版本 `1`：

```ts
type ConnectionExportPayload = {
  version: 1;
  exportedAt: string;
  connections: ConnectionExportEntry[];
  sshProfiles: SshProfileExportEntry[];
};
```

连接条目包含 `ConnectionProfile` 的必要字段和独立 secret：

```ts
type ConnectionExportEntry = {
  name: string;
  baseUrl: string;
  username: string;
  auth: ConnectionAuthConfig;
  tls: ConnectionTlsConfig;
  environment: ConnectionEnvironment;
  readonly: boolean;
  insecureTls: boolean;
  sshProfileId: string | null;
  secret: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
};
```

`secret` 是应用内部认证密钥值：Basic 连接保存为 `username:password`，API Key 和 Bearer 连接保存为原始 token。导入时按连接认证类型写回对应 secret key。

SSH 条目包含 `SshProfile` 的必要字段和独立 secret：

```ts
type SshProfileExportEntry = {
  id: string;
  name: string;
  tunnel: SshTunnelConfig;
  hostKeyPolicy: SshHostKeyPolicy;
  trustedHostKeySha256: string | null;
  secret: string | null;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string;
};
```

`sshProfileId` 使用导出文件内的原始 SSH ID 表达引用。导入时建立旧 ID 到新 ID 的映射，再写入连接的新 `sshProfileId`。

加密文件结构沿用现有请求导出思路，使用 `PBKDF2 + AES-GCM`：

```ts
type EncryptedConnectionExportFile = {
  version: 1;
  encrypted: true;
  exportedAt: string;
  kind: "connections";
  cipher: {
    kdf: "PBKDF2";
    iterations: number;
    salt: string;
    iv: string;
    ciphertext: string;
  };
};
```

## 模块设计

新增 `src/lib/export-crypto.ts`：

- 抽出请求导出已有的 base64、PBKDF2 派生和 AES-GCM 加解密逻辑。
- 提供通用 `encryptJsonPayload` 和 `decryptJsonPayload`。
- 请求导出加密逻辑可继续保持原文件 API，对内改为复用通用函数。
- 连接导出加密逻辑复用同一底层函数，避免两套密码学实现分叉。

新增 `src/lib/connection-import-export.ts`：

- `buildConnectionExportPayload`：接收连接、SSH 通道和凭据读取函数，生成可加密 payload。
- `parseConnectionImportPayload`：校验版本、字段类型和必要字段。
- `buildImportedConnectionState`：生成新连接、新 SSH 通道、旧新 ID 映射和需要写入的 secret 列表。
- `buildConnectionExportFilename`：生成 `esx-connections-YYYY-MM-DD.encrypted.json`。

扩展 `AppStateContext`：

- `exportConnections()`：从 state 和 secret vault 读取完整导出 payload。
- `importConnections(payload)`：追加写入连接和 SSH 通道，并保存所有连接 secret 和 SSH secret。
- 导入成功后清理受影响连接的搜索元数据，确保后续重新拉取。

连接页负责：

- 文件选择、弹窗状态、加载状态、错误消息和 toast。
- 调用导出加密、下载、导入解密和 app state 写入。
- 加密导入弹窗分为“待解析”和“已预览”两种状态；未解析成功前不允许最终导入。

## 导入写入顺序

导入必须尽量避免部分写入：

1. 先解析和校验 payload。
2. 在内存中生成新连接、新 SSH 通道和 secret 写入计划。
3. 先写入所有 secret vault 条目。
4. secret 写入成功后再更新 React state。
5. 若 secret 写入失败，不修改 app storage state，并向用户展示错误。

因为本地 secret vault 与 Tauri store 不支持跨存储事务，若第 3 步中途失败可能留下少量未引用 secret。后续导入重试会生成新 ID，不会引用这些残留项；这是本功能可接受的本地残留风险。

## 错误处理

- 空密码：提示“加密导出需要设置密码。”或“请输入导出密码。”。
- 两次导出密码不一致：禁用确认按钮并显示内联错误。
- 文件不是 JSON：提示“无法读取导入文件”。
- 文件不是连接导出格式：提示“不支持的连接导入文件。”。
- 密码错误、密文损坏或解密失败：提示“密码错误或文件已损坏。”。
- 缺少连接必要字段：指出第几条连接格式无效。
- 缺少 SSH 必要字段：指出第几条 SSH 通道格式无效。

## 测试计划

- `connection-import-export` 单元测试：
  - 构建并解析连接导出 payload。
  - 拒绝不支持的版本和缺失字段。
  - 导入时为连接和 SSH 通道生成新 ID。
  - 导入后连接引用新的 SSH 通道 ID。
  - 生成连接 secret 和 SSH secret 写入计划。
- `connection-export-crypto` 单元测试：
  - 使用密码加密并解密连接 payload。
  - 密码错误时报“密码错误或文件已损坏。”。
  - 识别连接加密文件格式。
  - 生成安全文件名。
- App state 或页面集成测试：
  - 导入成功后连接、SSH 通道和 secret 写入函数被调用。
  - 密码错误时不调用导入写入。

## UI 质量约束

- 按钮使用现有 `Button`、`Dialog`、`Input` 和 lucide 图标。
- 弹窗字段使用明确 label，不只依赖 placeholder。
- 导入和导出期间确认按钮需要显示进行中状态并防止重复提交；如果需要保持主按钮视觉，不要使用原生 `disabled` 表示忙碌状态，改用 `aria-disabled` 和点击处理中的状态 guard。
- 错误展示在相关弹窗内，同时保留 toast 反馈。
- 文件选择 input 接受 `application/json,.json`。
- 不使用 emoji 作为结构图标。
