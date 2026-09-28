import { lazy, Suspense, type ReactElement } from "react";
import type { ConsoleEditorProps } from "./console-editor";

const ConsoleEditor = lazy(() => import("./console-editor").then(({ ConsoleEditor }) => ({ default: ConsoleEditor })));

export function LazyConsoleEditor(props: ConsoleEditorProps): ReactElement {
  return (
    <Suspense fallback={<div className="min-h-0 w-full" style={{ height: props.height ?? "100%" }} role="status" aria-label="正在加载编辑器" />}>
      <ConsoleEditor {...props} />
    </Suspense>
  );
}
