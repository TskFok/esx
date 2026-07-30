# Console 字段折叠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Console 请求内容和未截断返回内容的 JSON 字段提供始终可见的层级折叠入口。

**Architecture:** 请求编辑器和未截断返回内容查看器共用 `ConsoleEditor`。在该 Monaco 封装中配置原生代码折叠及始终显示的折叠控件，两个使用方即可获得一致行为，无需额外 UI 状态或组件接口。

**Tech Stack:** React、TypeScript、Monaco Editor、Vitest、Testing Library。

## Global Constraints

- 仅修改完成字段层级折叠所必需的文件，不改变请求执行、内容校验、补全、格式化或响应截断预览。
- 折叠控件必须始终显示在 Monaco 行号左侧，初始内容保持展开。
- 不为截断响应的纯文本预览新增字段折叠。
- 新增或修改的行为必须先有可复现的 Vitest 失败测试。

---

### Task 1: 配置共享 Monaco 编辑器的字段折叠

**Files:**
- Create: `src/components/console/__tests__/console-editor.test.tsx`
- Modify: `src/components/console/console-editor.tsx:211-253`

**Interfaces:**
- Consumes: `ConsoleEditorProps`（`value`、`onChange`、`readOnly`）。
- Produces: 传给 `@monaco-editor/react` 的 Monaco `options`，其中 `folding` 为 `true`、`showFoldingControls` 为 `"always"`。

- [x] **Step 1: 写入失败测试**

创建 `src/components/console/__tests__/console-editor.test.tsx`，mock `@monaco-editor/react` 的默认组件以记录 `options`，随后分别渲染可编辑与只读 `ConsoleEditor`：

```tsx
/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { editorMock } = vi.hoisted(() => ({ editorMock: vi.fn() }));

vi.mock("@monaco-editor/react", () => ({
  default: (props: { options: unknown }) => {
    editorMock(props);
    return <div data-testid="monaco-editor" />;
  },
  loader: { config: vi.fn() },
}));

import { ConsoleEditor } from "../console-editor";

describe("ConsoleEditor", () => {
  it.each([false, true])("为 readOnly=%s 的内容始终显示字段折叠控件", (readOnly) => {
    render(<ConsoleEditor readOnly={readOnly} value={'{\n  "query": {}\n}'} onChange={vi.fn()} />);

    expect(editorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ folding: true, showFoldingControls: "always" }),
      }),
    );
  });
});
```

- [x] **Step 2: 运行测试，确认因缺少配置而失败**

Run: `pnpm test src/components/console/__tests__/console-editor.test.tsx`

Expected: FAIL；断言显示 `showFoldingControls` 或 `folding` 未在 Monaco options 中定义。

- [x] **Step 3: 以最小改动启用 Monaco 原生折叠**

在 `src/components/console/console-editor.tsx` 的 `options` 对象中，在 `minimap` 后加入：

```ts
folding: true,
showFoldingControls: "always" as const,
```

保留既有 `readOnly`、语言配置和所有其他编辑器选项；不修改 `ResponseViewer`，因为它已通过 `ConsoleEditor readOnly` 复用这项配置。

- [x] **Step 4: 运行目标测试，确认通过**

Run: `pnpm test src/components/console/__tests__/console-editor.test.tsx`

Expected: PASS；两个 `readOnly` 参数化场景均通过。

- [x] **Step 5: 运行完整测试套件**

Run: `pnpm test`

Expected: PASS；无失败测试。

- [x] **Step 6: 提交实现**

```bash
git add src/components/console/console-editor.tsx src/components/console/__tests__/console-editor.test.tsx
git commit -m "feat: 支持 Console 字段折叠"
```
