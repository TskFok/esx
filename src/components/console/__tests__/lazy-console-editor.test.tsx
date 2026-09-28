/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const { editorModuleLoaded, moduleGate } = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return {
    editorModuleLoaded: vi.fn(),
    moduleGate: { promise, resolve },
  };
});

vi.mock("../console-editor", async () => {
  await moduleGate.promise;
  editorModuleLoaded();
  return {
    ConsoleEditor: ({ value, readOnly }: { value: string; readOnly?: boolean }) => (
      <textarea aria-label={readOnly ? "响应" : "请求"} value={value} readOnly={readOnly} onChange={() => {}} />
    ),
  };
});

import { LazyConsoleEditor } from "../lazy-console-editor";

it("请求与响应共用一次编辑器加载，并在等待时接收最新草稿", async () => {
  const view = render(
    <>
      <LazyConsoleEditor value="旧草稿" height="240px" onChange={() => {}} />
      <LazyConsoleEditor readOnly value="旧响应" onChange={() => {}} />
    </>,
  );
  expect(editorModuleLoaded).not.toHaveBeenCalled();
  expect(screen.getAllByRole("status", { name: "正在加载编辑器" })[0]).toHaveStyle({ height: "240px" });

  view.rerender(<div>切换到其他面板</div>);
  expect(screen.queryByRole("status", { name: "正在加载编辑器" })).not.toBeInTheDocument();

  view.rerender(
    <>
      <LazyConsoleEditor value="最新草稿" height="240px" onChange={() => {}} />
      <LazyConsoleEditor readOnly value="最新响应" onChange={() => {}} />
    </>,
  );
  await act(async () => { moduleGate.resolve(); await moduleGate.promise; });

  expect(screen.getByRole("textbox", { name: "请求" })).toHaveValue("最新草稿");
  expect(screen.getByRole("textbox", { name: "响应" })).toHaveValue("最新响应");
  expect(editorModuleLoaded).toHaveBeenCalledTimes(1);
});
