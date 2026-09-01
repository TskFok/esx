# 连接页工作台布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把连接页改成与 Console 同款的左右工作台：启动默认进入连接列表，左侧管理已保存连接，右侧承载新建/编辑表单，SSH 增改走弹窗。

**Architecture:** `ConnectionsPage` 继续持有 mutation 与 `useAppState`。抽出纯函数处理表单完整性/脏检查/离开策略；抽出 `ConnectionsSidebarPanel`、`ConnectionEditorPanel`、`SshProfileDialog` 三个展示组件。页面状态从连接弹窗改为 `editorMode: "idle" | "create" | "edit"`。小屏复用 `ConsoleMobileDrawer`，左栏固定宽度、不实现拖拽与 `⌘B`。

**Tech Stack:** React 19、TypeScript、react-router-dom、TanStack Query、Vitest、Testing Library、现有 Dialog/Button/Input。

## Global Constraints

- 启动后 `RootRedirect` 始终进入 `/connections`，不再因 `currentConnection` 跳到 `/console`。
- 不抽公共 AppShell；不改 Console 请求列表、编辑器、快捷键或请求执行逻辑。
- 不新增独立 SSH 管理页或 SSH 路由；去掉页面级 SSH 卡片。
- 不改连接/SSH 的存储、密钥保管、校验与导入导出规则。
- 密钥、密码不得写入测试数据；测试凭据只用空字符串或 `"secret"` 这类占位符。
- 新增或修改的行为必须先有可复现的 Vitest 失败测试。
- 提交信息遵循 `docs/COMMIT_CONVENTION.md`：英文 type + 中文描述。

## File Map

- Create: `src/pages/root-redirect.tsx` — 启动跳转
- Create: `src/pages/__tests__/root-redirect.test.tsx`
- Create: `src/lib/connection-form.ts` — 默认表单、完整性、脏检查、离开策略
- Create: `src/lib/__tests__/connection-form.test.ts`
- Create: `src/components/connections/connections-sidebar-panel.tsx`
- Create: `src/components/connections/__tests__/connections-sidebar-panel.test.tsx`
- Create: `src/components/connections/ssh-profile-dialog.tsx`
- Create: `src/components/connections/__tests__/ssh-profile-dialog.test.tsx`
- Create: `src/components/connections/connection-editor-panel.tsx`
- Create: `src/components/connections/__tests__/connection-editor-panel.test.tsx`
- Create: `src/pages/__tests__/connections-page.test.tsx`
- Modify: `src/App.tsx` — 改用抽出的 `RootRedirect`
- Modify: `src/components/console/console-mobile-drawer.tsx` — 可选 `closeLabel`
- Modify: `src/pages/connections-page-content.tsx` — 工作台布局与状态机

---

### Task 1: 启动始终进入连接页

**Files:**
- Create: `src/pages/root-redirect.tsx`
- Create: `src/pages/__tests__/root-redirect.test.tsx`
- Modify: `src/App.tsx:12-24`

**Interfaces:**
- Consumes: `useAppState().ready`
- Produces: `RootRedirect` 组件；就绪后渲染 `<Navigate to="/connections" replace />`，忽略 `currentConnection` 与连接数量。

- [ ] **Step 1: 写入失败测试**

创建 `src/pages/__tests__/root-redirect.test.tsx`：

```tsx
/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../providers/app-state", () => ({
  useAppState: () => ({
    ready: true,
    currentConnection: { id: "conn-1", name: "生产集群" },
    connections: [{ id: "conn-1" }],
  }),
}));

import { RootRedirect } from "../root-redirect";

describe("RootRedirect", () => {
  it("已有当前连接时仍进入 /connections", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/connections" element={<div>connections-page</div>} />
          <Route path="/console" element={<div>console-page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("connections-page")).toBeInTheDocument();
    expect(screen.queryByText("console-page")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试，确认因模块不存在而失败**

Run: `pnpm test src/pages/__tests__/root-redirect.test.tsx`

Expected: FAIL；无法解析 `../root-redirect`。

- [ ] **Step 3: 抽出始终跳转连接页的 RootRedirect**

创建 `src/pages/root-redirect.tsx`：

```tsx
import { Navigate } from "react-router-dom";
import { useAppState } from "../providers/app-state";

export function RootRedirect() {
  const { ready } = useAppState();

  if (!ready) {
    return null;
  }

  return <Navigate to="/connections" replace />;
}
```

将 `src/App.tsx` 中的本地 `RootRedirect` 删除，改为：

```tsx
import { RootRedirect } from "./pages/root-redirect";
```

`App` 的 `Route path="/"` 继续使用 `<RootRedirect />`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test src/pages/__tests__/root-redirect.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/root-redirect.tsx src/pages/__tests__/root-redirect.test.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat: 启动始终进入连接页

EOF
)"
```

---

### Task 2: 连接表单纯函数

**Files:**
- Create: `src/lib/connection-form.ts`
- Create: `src/lib/__tests__/connection-form.test.ts`

**Interfaces:**
- Consumes: `ConnectionFormValues`、`SshProfileFormValues`（`src/types/connections.ts`）
- Produces:
  - `defaultConnectionForm: ConnectionFormValues`
  - `defaultSshForm: SshProfileFormValues`
  - `isConnectionFormIncomplete(values: ConnectionFormValues): boolean`
  - `isSshFormIncomplete(values: SshProfileFormValues): boolean`
  - `isConnectionFormDirty(current: ConnectionFormValues, snapshot: ConnectionFormValues): boolean`
  - `getConnectionEditorLeaveBehavior(options: { isDirty: boolean; savePending: boolean; reason: ConnectionEditorLeaveReason }): "block" | "confirm" | "allow"`
  - `type ConnectionEditorMode = "idle" | "create" | "edit"`
  - `type ConnectionEditorLeaveReason = "cancel" | "switch-editor" | "open-console"`

- [ ] **Step 1: 写入失败测试**

创建 `src/lib/__tests__/connection-form.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  defaultConnectionForm,
  getConnectionEditorLeaveBehavior,
  isConnectionFormDirty,
  isConnectionFormIncomplete,
  isSshFormIncomplete,
} from "../connection-form";

describe("isConnectionFormIncomplete", () => {
  it("缺少地址或凭据时视为不完整", () => {
    expect(isConnectionFormIncomplete(defaultConnectionForm)).toBe(true);
    expect(
      isConnectionFormIncomplete({
        ...defaultConnectionForm,
        baseUrl: "https://es.example.com:9200",
        username: "elastic",
        password: "secret",
      }),
    ).toBe(false);
  });

  it("API Key 模式要求填写 apiKey", () => {
    expect(
      isConnectionFormIncomplete({
        ...defaultConnectionForm,
        baseUrl: "https://es.example.com:9200",
        authType: "apiKey",
        apiKey: "",
      }),
    ).toBe(true);
  });
});

describe("isSshFormIncomplete", () => {
  it("密码认证缺少密码时不完整", () => {
    expect(
      isSshFormIncomplete({
        name: "bastion",
        sshHost: "bastion.example.com",
        sshPort: "22",
        sshUsername: "ubuntu",
        sshAuthMethod: "password",
        sshPassword: "",
        sshPrivateKeyPath: "",
        sshPassphrase: "",
      }),
    ).toBe(true);
  });
});

describe("isConnectionFormDirty", () => {
  it("任意字段变化即视为脏", () => {
    const snapshot = { ...defaultConnectionForm, name: "开发" };
    expect(isConnectionFormDirty(snapshot, snapshot)).toBe(false);
    expect(isConnectionFormDirty({ ...snapshot, name: "生产" }, snapshot)).toBe(true);
  });
});

describe("getConnectionEditorLeaveBehavior", () => {
  it("保存中禁止离开", () => {
    expect(
      getConnectionEditorLeaveBehavior({ isDirty: true, savePending: true, reason: "cancel" }),
    ).toBe("block");
  });

  it("脏表单取消或切换编辑时先确认", () => {
    expect(
      getConnectionEditorLeaveBehavior({ isDirty: true, savePending: false, reason: "cancel" }),
    ).toBe("confirm");
    expect(
      getConnectionEditorLeaveBehavior({ isDirty: true, savePending: false, reason: "switch-editor" }),
    ).toBe("confirm");
  });

  it("单击进入 Console 不拦截", () => {
    expect(
      getConnectionEditorLeaveBehavior({ isDirty: true, savePending: false, reason: "open-console" }),
    ).toBe("allow");
  });

  it("表单未改动时允许取消", () => {
    expect(
      getConnectionEditorLeaveBehavior({ isDirty: false, savePending: false, reason: "cancel" }),
    ).toBe("allow");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/lib/__tests__/connection-form.test.ts`

Expected: FAIL；无法解析 `../connection-form`。

- [ ] **Step 3: 实现纯函数**

创建 `src/lib/connection-form.ts`：

```ts
import type { ConnectionFormValues, SshProfileFormValues } from "../types/connections";

export type ConnectionEditorMode = "idle" | "create" | "edit";

export type ConnectionEditorLeaveReason = "cancel" | "switch-editor" | "open-console";

export const defaultConnectionForm: ConnectionFormValues = {
  name: "",
  baseUrl: "",
  authType: "basic",
  username: "",
  password: "",
  apiKey: "",
  bearerToken: "",
  tlsMode: "default",
  tlsCaPath: "",
  tlsFingerprint: "",
  insecureTls: false,
  environment: "dev",
  readonly: false,
  allowInsecureProductionTls: false,
  sshProfileId: "",
};

export const defaultSshForm: SshProfileFormValues = {
  name: "",
  sshHost: "",
  sshPort: "22",
  sshUsername: "",
  sshAuthMethod: "password",
  sshPassword: "",
  sshPrivateKeyPath: "",
  sshPassphrase: "",
};

export function isConnectionFormIncomplete(values: ConnectionFormValues): boolean {
  return (
    !values.baseUrl.trim() ||
    (values.authType === "basic"
      ? !values.username.trim() || !values.password.trim()
      : values.authType === "apiKey"
        ? !values.apiKey.trim()
        : !values.bearerToken.trim()) ||
    (values.tlsMode === "caCertificate" && !values.tlsCaPath.trim()) ||
    (values.tlsMode === "certificateFingerprint" && !values.tlsFingerprint.trim())
  );
}

export function isSshFormIncomplete(values: SshProfileFormValues): boolean {
  return (
    !values.sshHost.trim() ||
    !values.sshPort.trim() ||
    !values.sshUsername.trim() ||
    (values.sshAuthMethod === "password" ? !values.sshPassword.trim() : !values.sshPrivateKeyPath.trim())
  );
}

export function isConnectionFormDirty(current: ConnectionFormValues, snapshot: ConnectionFormValues): boolean {
  return JSON.stringify(current) !== JSON.stringify(snapshot);
}

export function getConnectionEditorLeaveBehavior(options: {
  isDirty: boolean;
  savePending: boolean;
  reason: ConnectionEditorLeaveReason;
}): "block" | "confirm" | "allow" {
  if (options.savePending) {
    return "block";
  }
  if (options.reason === "open-console") {
    return "allow";
  }
  if (options.isDirty) {
    return "confirm";
  }
  return "allow";
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test src/lib/__tests__/connection-form.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/connection-form.ts src/lib/__tests__/connection-form.test.ts
git commit -m "$(cat <<'EOF'
feat: 抽出连接表单状态判断

EOF
)"
```

---

### Task 3: 连接页左侧栏

**Files:**
- Create: `src/components/connections/connections-sidebar-panel.tsx`
- Create: `src/components/connections/__tests__/connections-sidebar-panel.test.tsx`

**Interfaces:**
- Consumes: `ConnectionProfile`、`SshProfile`
- Produces: `ConnectionsSidebarPanel(props: ConnectionsSidebarPanelProps)`
- `ConnectionsSidebarPanelProps`：
  - `connections: ConnectionProfile[]`
  - `currentConnectionId: string | null`
  - `testingConnectionId: string | null`
  - `getSshProfileForConnection: (connection: ConnectionProfile) => SshProfile | null`
  - `onNavigateStatus: () => void`
  - `onNavigateAdmin: () => void`
  - `onNavigateLogs: () => void`
  - `onCreateConnection: () => void`
  - `onExportClick: () => void`
  - `onImportFileSelected: (file: File) => void`
  - `onOpenConnection: (connectionId: string) => void`
  - `onTestConnection: (connection: ConnectionProfile) => void`
  - `onEditConnection: (connection: ConnectionProfile) => void`
  - `onDeleteConnection: (connection: ConnectionProfile) => void`
  - `onClose?: () => void`
  - `closeTitle?: string`
  - `className?: string`

视觉对齐 `ConsoleSidebarPanel`：深色栏、导航 ghost（`text-slate-200 hover:bg-white/10 hover:text-white`），当前「连接页」仅用 `bg-white/10 font-semibold`，不用 `secondary`。

- [ ] **Step 1: 写入失败测试**

创建 `src/components/connections/__tests__/connections-sidebar-panel.test.tsx`：

```tsx
/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../../types/connections";
import { ConnectionsSidebarPanel } from "../connections-sidebar-panel";

const SIDEBAR_NAV_GHOST_CLASSES = ["text-slate-200", "hover:bg-white/10", "hover:text-white"];

const connection: ConnectionProfile = {
  id: "conn-1",
  name: "开发集群",
  baseUrl: "https://es.example.com:9200",
  username: "elastic",
  auth: { type: "basic" },
  tls: { mode: "default" },
  environment: "dev",
  readonly: false,
  insecureTls: false,
  sshProfileId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastUsedAt: "2026-09-01T00:00:00.000Z",
};

function renderSidebar(overrides: Partial<Parameters<typeof ConnectionsSidebarPanel>[0]> = {}) {
  const props = {
    connections: [connection],
    currentConnectionId: "conn-1",
    testingConnectionId: null,
    getSshProfileForConnection: () => null,
    onNavigateStatus: vi.fn(),
    onNavigateAdmin: vi.fn(),
    onNavigateLogs: vi.fn(),
    onCreateConnection: vi.fn(),
    onExportClick: vi.fn(),
    onImportFileSelected: vi.fn(),
    onOpenConnection: vi.fn(),
    onTestConnection: vi.fn(),
    onEditConnection: vi.fn(),
    onDeleteConnection: vi.fn(),
    ...overrides,
  };
  const view = render(<ConnectionsSidebarPanel {...props} />);
  return { props, ...view };
}

describe("ConnectionsSidebarPanel", () => {
  it("导航按钮使用深色栏 ghost 样式，连接页不用 secondary", () => {
    renderSidebar();
    const connectionsButton = screen.getByRole("button", { name: "连接页" });
    expect(connectionsButton).not.toHaveClass("bg-secondary");
    expect(connectionsButton).toHaveClass(...SIDEBAR_NAV_GHOST_CLASSES);
    expect(screen.getByRole("button", { name: "状态" })).toHaveClass(...SIDEBAR_NAV_GHOST_CLASSES);
  });

  it("单击连接行进入 Console，编辑按钮不冒泡", () => {
    const { props } = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /开发集群/ }));
    expect(props.onOpenConnection).toHaveBeenCalledWith("conn-1");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(props.onEditConnection).toHaveBeenCalledWith(connection);
    expect(props.onOpenConnection).toHaveBeenCalledTimes(1);
  });

  it("无连接时展示空列表提示", () => {
    renderSidebar({ connections: [] });
    expect(screen.getByText("还没有任何连接")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/components/connections/__tests__/connections-sidebar-panel.test.tsx`

Expected: FAIL；无法解析 `connections-sidebar-panel`。

- [ ] **Step 3: 实现左侧栏**

创建 `src/components/connections/connections-sidebar-panel.tsx`。结构对齐 `src/components/console/console-sidebar-panel.tsx`：

- 顶部：`ESX Console` / `连接管理`；若传入 `onClose` 则显示关闭按钮。
- 导航：连接页（当前，`bg-white/10`）、状态、治理、错误日志。
- 操作：导入、导出、新建连接。隐藏 file input，`accept="application/json,.json"`。
- 列表：当前项用 `border-white/30 bg-white text-slate-950`，其它用 `border-white/10 bg-white/5`。行 `role="button"`，Enter/Space 触发 `onOpenConnection`。行内「测试」「编辑」「删除」`stopPropagation`。`insecureTls` 显示「自签名 TLS」；有 SSH 显示「SSH 通道」。
- 空列表：`还没有任何连接` / `点击「新建连接」后，连接会直接出现在这里。`

导出按钮在 `connections.length === 0` 时 `disabled`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test src/components/connections/__tests__/connections-sidebar-panel.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/connections/connections-sidebar-panel.tsx src/components/connections/__tests__/connections-sidebar-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat: 新增连接页左侧栏

EOF
)"
```

---

### Task 4: SSH 通道弹窗组件

**Files:**
- Create: `src/components/connections/ssh-profile-dialog.tsx`
- Create: `src/components/connections/__tests__/ssh-profile-dialog.test.tsx`

**Interfaces:**
- Consumes: `Dialog`、`SshProfileFormValues`、`isSshFormIncomplete`（仅页面侧用来 disable；组件接收 `incomplete`/`saving`）
- Produces: `SshProfileDialog(props: SshProfileDialogProps)`
  - `open: boolean`
  - `title: string`
  - `values: SshProfileFormValues`
  - `saving: boolean`
  - `incomplete: boolean`
  - `onClose: () => void`
  - `onChange: (next: SshProfileFormValues) => void`
  - `onSave: () => void`

字段从 `connections-page-content.tsx` 现有 SSH Dialog 原样迁出（名称、主机、端口、用户名、密码/私钥）。保存中点击遮罩或取消不得调用 `onClose`。

- [ ] **Step 1: 写入失败测试**

创建 `src/components/connections/__tests__/ssh-profile-dialog.test.tsx`：

```tsx
/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultSshForm } from "../../../lib/connection-form";
import { SshProfileDialog } from "../ssh-profile-dialog";

describe("SshProfileDialog", () => {
  it("打开时展示新增标题，保存中不关闭", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(
      <SshProfileDialog
        open
        title="新增 SSH 通道"
        values={defaultSshForm}
        saving
        incomplete={false}
        onClose={onClose}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("heading", { name: "新增 SSH 通道" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("完整表单可触发保存", () => {
    const onSave = vi.fn();
    render(
      <SshProfileDialog
        open
        title="编辑 SSH 通道"
        values={{
          ...defaultSshForm,
          sshHost: "bastion.example.com",
          sshUsername: "ubuntu",
          sshPassword: "secret",
        }}
        saving={false}
        incomplete={false}
        onClose={vi.fn()}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "验证并保存 SSH 通道" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/components/connections/__tests__/ssh-profile-dialog.test.tsx`

Expected: FAIL；无法解析 `ssh-profile-dialog`。

- [ ] **Step 3: 抽出弹窗**

把 `connections-page-content.tsx` 中 `open={sshDialogOpen}` 的 Dialog JSX 迁到 `SshProfileDialog`。`onClose` 在 `saving` 时直接 return。取消按钮 `disabled={saving}`。保存按钮文案保持「验证并保存 SSH 通道」，`disabled={saving || incomplete}`。

description 保持：`这里只验证 SSH 主机本身是否可连通以及认证方式是否正确。保存成功后，ES 连接就可以复用这条已保存 SSH 通道。`

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test src/components/connections/__tests__/ssh-profile-dialog.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/connections/ssh-profile-dialog.tsx src/components/connections/__tests__/ssh-profile-dialog.test.tsx
git commit -m "$(cat <<'EOF'
feat: 抽出 SSH 通道弹窗

EOF
)"
```

---

### Task 5: 右侧连接编辑面板

**Files:**
- Create: `src/components/connections/connection-editor-panel.tsx`
- Create: `src/components/connections/__tests__/connection-editor-panel.test.tsx`

**Interfaces:**
- Consumes: `ConnectionFormValues`、`SshProfile`、`isConnectionFormIncomplete` 的结果由父组件传入 `incomplete`
- Produces: `ConnectionEditorPanel(props: ConnectionEditorPanelProps)`
  - `mode: ConnectionEditorMode`
  - `values: ConnectionFormValues`
  - `sshProfiles: SshProfile[]`
  - `selectedSshProfile: SshProfile | null`
  - `saving: boolean`
  - `incomplete: boolean`
  - `testingSshProfileId: string | null`
  - `onCreate: () => void`
  - `onCancel: () => void`
  - `onSave: () => void`
  - `onChange: (next: ConnectionFormValues) => void`
  - `onCreateSsh: () => void`
  - `onEditSsh: (profile: SshProfile) => void`
  - `onTestSsh: (profile: SshProfile) => void`
  - `onDeleteSsh: (profile: SshProfile) => void`

`mode === "idle"` 只渲染空状态，不渲染表单。空状态主文案：`选择左侧连接进入 Console，或新建一条连接。` 按钮「新建连接」调用 `onCreate`。

`create`/`edit` 把现有连接 Dialog 内字段迁到可滚动表单；底栏「取消」「验证并保存连接」。SSH 区块保留直连/列表选择/新建；选中后提供测试、编辑、清除、删除。不渲染页面级 SSH 卡片。

- [ ] **Step 1: 写入失败测试**

创建 `src/components/connections/__tests__/connection-editor-panel.test.tsx`：

```tsx
/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultConnectionForm } from "../../../lib/connection-form";
import type { SshProfile } from "../../../types/connections";
import { ConnectionEditorPanel } from "../connection-editor-panel";

const sshProfile: SshProfile = {
  id: "ssh-1",
  name: "跳板机",
  tunnel: {
    host: "bastion.example.com",
    port: 22,
    username: "ubuntu",
    authMethod: "password",
    privateKeyPath: "",
  },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastVerifiedAt: "2026-09-01T00:00:00.000Z",
  hostKeyPolicy: "trustOnFirstUse",
  trustedHostKeySha256: null,
};

function renderPanel(overrides: Partial<Parameters<typeof ConnectionEditorPanel>[0]> = {}) {
  const props = {
    mode: "idle" as const,
    values: defaultConnectionForm,
    sshProfiles: [] as SshProfile[],
    selectedSshProfile: null,
    saving: false,
    incomplete: true,
    testingSshProfileId: null,
    onCreate: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    onChange: vi.fn(),
    onCreateSsh: vi.fn(),
    onEditSsh: vi.fn(),
    onTestSsh: vi.fn(),
    onDeleteSsh: vi.fn(),
    ...overrides,
  };
  const view = render(<ConnectionEditorPanel {...props} />);
  return { props, ...view };
}

describe("ConnectionEditorPanel", () => {
  it("idle 展示空状态，不展示连接名称输入", () => {
    const { props } = renderPanel();
    expect(screen.getByText("选择左侧连接进入 Console，或新建一条连接。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建连接" }));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText("例如 生产 ES / 预发日志集群")).not.toBeInTheDocument();
  });

  it("create 展示表单，保存按钮在不完整时禁用", () => {
    renderPanel({ mode: "create" });
    expect(screen.getByPlaceholderText("例如 生产 ES / 预发日志集群")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "验证并保存连接" })).toBeDisabled();
  });

  it("选中 SSH 后可打开编辑弹窗回调", () => {
    const { props } = renderPanel({
      mode: "edit",
      values: { ...defaultConnectionForm, sshProfileId: "ssh-1" },
      sshProfiles: [sshProfile],
      selectedSshProfile: sshProfile,
    });
    fireEvent.click(screen.getByRole("button", { name: "编辑当前 SSH 通道" }));
    expect(props.onEditSsh).toHaveBeenCalledWith(sshProfile);
    fireEvent.click(screen.getByRole("button", { name: "新建 SSH 通道" }));
    expect(props.onCreateSsh).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/components/connections/__tests__/connection-editor-panel.test.tsx`

Expected: FAIL；无法解析 `connection-editor-panel`。

- [ ] **Step 3: 实现右侧面板**

`idle`：`Card` 居中空状态，主按钮「新建连接」。

非 idle：标题为「新增连接」或「编辑连接」，description「连接直接保存为独立项。SSH 通道可选填。」字段从现有连接 Dialog 迁出。SSH 区块：

- 「直连」把 `sshProfileId` 置 `""`
- 「新建 SSH 通道」调用 `onCreateSsh`
- 列表点击选中
- 选中后：测试（`onTestSsh`）、编辑、清除、删除（`onDeleteSsh`）

底栏取消在 `saving` 时 disabled。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test src/components/connections/__tests__/connection-editor-panel.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/connections/connection-editor-panel.tsx src/components/connections/__tests__/connection-editor-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat: 新增连接编辑右侧面板

EOF
)"
```

---

### Task 6: 连接页接上工作台并覆盖页面行为

**Files:**
- Modify: `src/components/console/console-mobile-drawer.tsx` — 增加可选 `closeLabel?: string`，默认仍为 `关闭连接与请求抽屉`
- Modify: `src/pages/connections-page-content.tsx`
- Create: `src/pages/__tests__/connections-page.test.tsx`

**Interfaces:**
- Consumes: Task 1–5 的组件与 `getConnectionEditorLeaveBehavior`、`defaultConnectionForm`、`defaultSshForm`、`isConnectionFormIncomplete`、`isSshFormIncomplete`、`isConnectionFormDirty`、`CONSOLE_SIDEBAR_WIDTH_DEFAULT`
- Produces: 连接页工作台。`editorMode: ConnectionEditorMode` 取代 `connectionDialogOpen`。单击连接走 `reason: "open-console"`（不确认）。取消/新建/改编另一条走 `cancel` 或 `switch-editor`。SSH 只通过 `SshProfileDialog`。删除正在编辑的连接后回到 `idle`。

页面骨架：

```tsx
<div className="h-dvh overflow-hidden p-4 sm:p-6">
  <div className="flex h-full min-h-0 gap-3 lg:flex-row">
    <aside
      className="hidden min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl bg-slate-950 px-3 py-3 text-slate-50 shadow-xl shadow-slate-900/25 lg:flex"
      style={{ width: CONSOLE_SIDEBAR_WIDTH_DEFAULT }}
    >
      {sidebarPanel}
    </aside>
    <ConsoleMobileDrawer open={mobileDrawerOpen && !isLgSplit} onClose={() => setMobileDrawerOpen(false)} closeLabel="关闭连接列表">
      {sidebarPanel}
    </ConsoleMobileDrawer>
    <main className="min-h-0 min-w-0 flex-1">
      {/* 小屏显示「连接列表」按钮后接 ConnectionEditorPanel */}
    </main>
  </div>
</div>
```

`isLgSplit` 用 `window.matchMedia("(min-width: 1024px)")`，与 Console 相同，但不做宽度拖拽、不读 sidebar 可见性存储。

删除：顶部统计横幅、连接卡片列表、独立 SSH 卡片、连接 Dialog。保留导入导出弹窗与删除确认框。

`saveMutation.onSuccess` 仍 `navigate("/console")`，并 `setEditorMode("idle")`。

离开确认 Dialog 标题「放弃未保存的更改？」；确认后执行 pending 动作（idle / create / 加载另一条编辑）。

- [ ] **Step 1: 写入失败的页面测试**

创建 `src/pages/__tests__/connections-page.test.tsx`。mock `react-router-dom` 的 `useNavigate`，mock `useAppState` 提供一条连接（无 SSH）。用 `QueryClientProvider` 渲染 `ConnectionsPage`。

覆盖：

1. 默认能看到空状态文案 `选择左侧连接进入 Console，或新建一条连接。`，且没有「已保存 SSH 通道」标题。
2. 点击连接名称调用 `setCurrentConnection` 且 `navigate("/console")`。
3. 点击「编辑」后出现连接名称输入，不出现 Dialog 标题「编辑连接」作为 `h3`（右侧面板可用 `h1`/`h2`）。
4. 点击「新建连接」出现空白表单。
5. 编辑表单改名后点「取消」，出现「放弃未保存的更改？」；此时 `navigate` 不应已被「取消」触发。
6. 右侧表单脏时单击左侧连接仍 `navigate("/console")`，不出现放弃确认。

第 5、6 条依赖 Task 2 的 leave behavior，在页面里用 `getConnectionEditorLeaveBehavior` 接线。

先写测试并运行，预期因页面仍是旧布局而失败（例如仍有「已保存 SSH 通道」，或「编辑连接」仍在 Dialog 里）。

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/pages/__tests__/connections-page.test.tsx`

Expected: FAIL；旧页面仍渲染 SSH 卡片或连接 Dialog。

- [ ] **Step 3: 改接线**

`console-mobile-drawer.tsx` 增加：

```tsx
closeLabel?: string;
```

默认 `"关闭连接与请求抽屉"`，赋给遮罩按钮 `aria-label`。

`connections-page-content.tsx`：

- 用 `defaultConnectionForm` / `defaultSshForm` 替换本地常量。
- `const [editorMode, setEditorMode] = useState<ConnectionEditorMode>("idle")`。
- `const [formSnapshot, setFormSnapshot] = useState(defaultConnectionForm)`。
- `const [pendingLeave, setPendingLeave] = useState<null | { reason: Exclude<ConnectionEditorLeaveReason, "open-console">; mode: ConnectionEditorMode; connection?: ConnectionProfile }>(null)`。
- `const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)`。
- `isLgSplit` 监听 `min-width: 1024px`。
- `openCreateConnection` / `openEditConnection` 先走 `getConnectionEditorLeaveBehavior`；`allow` 则切换，`confirm` 则写入 `pendingLeave`，`block` 则 return。
- `handleOpenConnection` 使用 `reason: "open-console"`，始终 `setCurrentConnection` + `navigate("/console")`。
- `submitDeleteConnectionDialog` 若删的是 `editingConnection`，则 `setEditorMode("idle")` 并重置表单。
- 渲染 `ConnectionsSidebarPanel`、`ConnectionEditorPanel`、`SshProfileDialog`。
- SSH 保存成功逻辑保持：写入 `sshProfileId`、关弹窗、toast。

小屏 `main` 顶部：

```tsx
{!isLgSplit ? (
  <Button variant="outline" className="mb-3 shrink-0 self-start" onClick={() => setMobileDrawerOpen(true)}>
    <PanelLeftOpen className="mr-2 h-4 w-4" />
    连接列表
  </Button>
) : null}
```

- [ ] **Step 4: 运行相关测试**

Run: `pnpm test src/pages/__tests__/connections-page.test.tsx src/components/connections/__tests__/connections-sidebar-panel.test.tsx src/components/connections/__tests__/connection-editor-panel.test.tsx src/components/connections/__tests__/ssh-profile-dialog.test.tsx src/components/connections/__tests__/connection-export-dialog.test.tsx src/lib/__tests__/connection-form.test.ts src/pages/__tests__/root-redirect.test.tsx src/lib/__tests__/delete-confirmations.test.ts src/components/console/__tests__/console-sidebar-panel.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/console/console-mobile-drawer.tsx src/pages/connections-page-content.tsx src/pages/__tests__/connections-page.test.tsx
git commit -m "$(cat <<'EOF'
feat: 连接页改为控制台同款工作台

EOF
)"
```

---

### Spec Coverage

| Spec 要求 | Task |
| --- | --- |
| 启动始终 `/connections` | 1 |
| 左侧 Console 同款连接列表；单击进 Console；编辑不冒泡 | 3, 6 |
| 右侧 idle / create / edit | 5, 6 |
| 去掉 SSH 卡片；SSH 增改弹窗 | 4, 5, 6 |
| 脏表单确认；单击进 Console 不拦截；保存中 block | 2, 6 |
| 小屏抽屉、固定左栏宽度 | 6 |
| 导入导出仍在左栏 | 3, 6 |
| 不抽 AppShell、不改 Console 请求逻辑、不改存储校验 | 全任务 |

无 TBD。类型名以 Task 2 的 `ConnectionEditorMode` / `ConnectionEditorLeaveReason` 为准，后续任务不得改名。
