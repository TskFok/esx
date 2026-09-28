import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController.js";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js";
import "monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations.js";
import "monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/esm/vs/editor/contrib/readOnlyMessage/browser/contribution.js";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/esm/vs/editor/contrib/gotoError/browser/gotoError.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";

let configured = false;
const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: import("monaco-editor/esm/vs/editor/editor.api").Environment;
};

export function configureMonaco(): void {
  if (configured) return;
  monacoGlobal.MonacoEnvironment = {
    ...monacoGlobal.MonacoEnvironment,
    getWorker(_moduleId: string, _label: string): Worker {
      return new EditorWorker();
    },
  };
  loader.config({ monaco });
  configured = true;
}

export { monaco };
