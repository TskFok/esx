/**
 * @vitest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { editorMock, setModelMarkers } = vi.hoisted(() => ({
  editorMock: vi.fn(),
  setModelMarkers: vi.fn(),
}));

type MockEditor = {
  getModel: () => MockModel;
  getDomNode: () => null;
  onDidDispose: (callback: () => void) => void;
  addCommand: () => void;
  addAction: () => void;
};

type MockModel = {
  getValue: () => string;
  getVersionId: () => number;
  onDidChangeContent: (callback: () => void) => { dispose: () => void };
  onWillDispose: (callback: () => void) => { dispose: () => void };
  change: (value: string) => void;
  dispose: () => void;
};

function createModel(initialValue = "POST /_search\n["): MockModel {
  let value = initialValue;
  let version = 1;
  const listeners = new Set<() => void>();
  const disposeListeners = new Set<() => void>();
  let disposed = false;
  return {
    getValue: () => {
      if (disposed) throw new Error("disposed model read");
      return value;
    },
    getVersionId: () => {
      if (disposed) throw new Error("disposed model read");
      return version;
    },
    onDidChangeContent(callback) {
      listeners.add(callback);
      return { dispose: () => listeners.delete(callback) };
    },
    onWillDispose(callback) {
      disposeListeners.add(callback);
      return { dispose: () => disposeListeners.delete(callback) };
    },
    change(nextValue) {
      value = nextValue;
      version += 1;
      listeners.forEach((listener) => listener());
    },
    dispose() {
      disposeListeners.forEach((listener) => listener());
      disposed = true;
    },
  };
}

let currentModel: MockModel;
let editorDisposers: Array<() => void>;

function createEditor(model: MockModel): MockEditor {
  return {
    getModel: () => model,
    getDomNode: () => null,
    onDidDispose: (callback) => editorDisposers.push(callback),
    addCommand: vi.fn(),
    addAction: vi.fn(),
  };
}

vi.mock("@monaco-editor/react", () => ({
  default: (props: { options: unknown; onMount?: (editor: MockEditor) => void }) => {
    editorMock(props);
    useEffect(() => {
      props.onMount?.(createEditor(currentModel));
      return () => editorDisposers.forEach((dispose) => dispose());
    }, []);
    return <div data-testid="monaco-editor" />;
  },
  loader: { config: vi.fn() },
}));

vi.mock("monaco-editor", () => ({
  editor: { setModelMarkers },
  MarkerSeverity: { Error: 8, Warning: 4 },
  KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 },
  KeyCode: { Enter: 3, KeyA: 31, KeyD: 33, KeyF: 35 },
}));

import { ConsoleEditor } from "../console-editor";

describe("ConsoleEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    editorMock.mockClear();
    setModelMarkers.mockClear();
    currentModel = createModel();
    editorDisposers = [];
  });

  afterEach(() => vi.useRealTimers());

  it.each([false, true])("为 readOnly=%s 的内容始终显示字段折叠控件", (readOnly) => {
    render(<ConsoleEditor readOnly={readOnly} value={'{\n  "query": {}\n}'} onChange={vi.fn()} />);

    expect(editorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ folding: true, showFoldingControls: "always" }),
      }),
    );
  });

  it("does not register validation for a read-only model", () => {
    render(<ConsoleEditor readOnly value={currentModel.getValue()} onChange={vi.fn()} />);
    currentModel.change("POST /_search\n]");
    act(() => vi.advanceTimersByTime(120));
    expect(setModelMarkers).not.toHaveBeenCalled();
  });

  it("publishes markers immediately on editable mount and debounces later edits", () => {
    render(<ConsoleEditor value={currentModel.getValue()} onChange={vi.fn()} />);
    expect(setModelMarkers).toHaveBeenCalledTimes(1);
    expect(setModelMarkers).toHaveBeenLastCalledWith(
      currentModel,
      "es-console-validator",
      [expect.objectContaining({ message: "未闭合的 [ 数组", startLineNumber: 2 })],
    );
    currentModel.change("POST /_search\n]");
    expect(setModelMarkers).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(120));
    expect(setModelMarkers).toHaveBeenCalledTimes(2);
    expect(setModelMarkers).toHaveBeenLastCalledWith(
      currentModel,
      "es-console-validator",
      [expect.objectContaining({ message: "多余的 ]", startLineNumber: 2 })],
    );
  });

  it("cancels pending markers on unmount", () => {
    const view = render(<ConsoleEditor value={currentModel.getValue()} onChange={vi.fn()} />);
    currentModel.change("POST /_search\n]");
    view.unmount();
    act(() => vi.advanceTimersByTime(120));
    expect(setModelMarkers).toHaveBeenCalledTimes(1);
  });

  it("stops validating when switched to read-only", () => {
    const view = render(<ConsoleEditor value={currentModel.getValue()} onChange={vi.fn()} />);
    currentModel.change("POST /_search\n]");
    view.rerender(<ConsoleEditor readOnly value={currentModel.getValue()} onChange={vi.fn()} />);
    act(() => vi.advanceTimersByTime(120));
    expect(setModelMarkers).toHaveBeenCalledTimes(1);
  });

  it("cancels the old model timer when Monaco releases that model", () => {
    render(<ConsoleEditor value={currentModel.getValue()} onChange={vi.fn()} />);
    currentModel.change("POST /_search\n]");
    currentModel.dispose();
    expect(() => act(() => vi.advanceTimersByTime(120))).not.toThrow();
    expect(setModelMarkers).toHaveBeenCalledTimes(1);
  });

  it("cancels the old model timer when another model mounts", () => {
    render(<ConsoleEditor value={currentModel.getValue()} onChange={vi.fn()} />);
    const oldModel = currentModel;
    oldModel.change("POST /_search\n]");
    currentModel = createModel("POST /_search\n{");
    const props = editorMock.mock.lastCall?.[0] as { onMount: (editor: MockEditor) => void };
    act(() => props.onMount(createEditor(currentModel)));
    act(() => vi.advanceTimersByTime(120));
    expect(setModelMarkers).toHaveBeenCalledTimes(2);
    expect(setModelMarkers).toHaveBeenLastCalledWith(
      currentModel,
      "es-console-validator",
      [expect.objectContaining({ message: "未闭合的 { 对象" })],
    );
  });
});
