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
