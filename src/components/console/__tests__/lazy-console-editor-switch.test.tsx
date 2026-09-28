/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const { editorModuleLoaded, moduleGate } = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { editorModuleLoaded: vi.fn(), moduleGate: { promise, resolve } };
});

vi.mock("../console-editor", async () => {
  await moduleGate.promise;
  editorModuleLoaded();
  return {
    ConsoleEditor: ({ value }: { value: string }) => <textarea aria-label="请求" value={value} onChange={() => {}} />,
  };
});

import { LazyConsoleEditor } from "../lazy-console-editor";

it("模块等待期间离开并返回工作区时使用最新草稿", async () => {
  const view = render(<LazyConsoleEditor value="旧草稿" onChange={() => {}} />);
  expect(screen.getByRole("status", { name: "正在加载编辑器" })).toBeInTheDocument();

  view.rerender(<div>状态面板</div>);
  expect(screen.queryByRole("status", { name: "正在加载编辑器" })).not.toBeInTheDocument();
  view.rerender(<LazyConsoleEditor value="最新草稿" onChange={() => {}} />);

  await act(async () => { moduleGate.resolve(); await moduleGate.promise; });
  expect(screen.getByRole("textbox", { name: "请求" })).toHaveValue("最新草稿");
  expect(editorModuleLoaded).toHaveBeenCalledTimes(1);
});
