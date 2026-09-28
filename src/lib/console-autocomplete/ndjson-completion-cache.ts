import type { editor, Position } from "monaco-editor";
import {
  advanceNdjsonCompletionState,
  initialNdjsonCompletionState,
  type BodyCompletionContext,
  type NdjsonCompletionState,
} from "./body-context";
import type { ConsoleBodyMode, ConsoleRequestContext } from "./request-context";

interface Cache {
  mode: ConsoleBodyMode;
  states: NdjsonCompletionState[];
  processedThrough: number;
  changeSubscription?: { dispose(): void };
  disposeSubscription?: { dispose(): void };
}

const caches = new WeakMap<editor.ITextModel, Cache>();

function createCache(model: editor.ITextModel, mode: ConsoleBodyMode): Cache {
  const cache: Cache = {
    mode,
    states: [],
    processedThrough: 1,
  };
  cache.states[1] = initialNdjsonCompletionState(mode);
  cache.changeSubscription = model.onDidChangeContent?.((event) => {
    const firstChangedLine = Math.min(...event.changes.map((change) => change.range.startLineNumber));
    if (firstChangedLine <= 1) {
      cache.states = [];
      cache.states[1] = initialNdjsonCompletionState(cache.mode);
      cache.processedThrough = 1;
    } else if (firstChangedLine <= cache.processedThrough) {
      cache.states.length = firstChangedLine;
      cache.processedThrough = firstChangedLine - 1;
    }
  });
  cache.disposeSubscription = model.onWillDispose?.(() => {
    cache.changeSubscription?.dispose();
    cache.disposeSubscription?.dispose();
    caches.delete(model);
  });
  caches.set(model, cache);
  return cache;
}

export function getCachedNdjsonCompletion(
  model: editor.ITextModel,
  position: Position,
  request: ConsoleRequestContext,
): BodyCompletionContext {
  let cache = caches.get(model);
  if (!cache) cache = createCache(model, request.bodyMode);
  if (cache.mode !== request.bodyMode) {
    cache.mode = request.bodyMode;
    cache.states = [];
    cache.states[1] = initialNdjsonCompletionState(request.bodyMode);
    cache.processedThrough = 1;
  }

  const lastCompletedLine = Math.max(1, position.lineNumber - 1);
  for (let lineNumber = cache.processedThrough + 1; lineNumber <= lastCompletedLine; lineNumber += 1) {
    cache.states[lineNumber] = advanceNdjsonCompletionState(
      cache.states[lineNumber - 1]!,
      model.getLineContent(lineNumber),
      cache.mode,
    );
  }
  cache.processedThrough = Math.max(cache.processedThrough, lastCompletedLine);
  const state = cache.states[lastCompletedLine]!;
  return {
    kind: state.kind,
    currentLine: model.getLineContent(position.lineNumber).slice(0, position.column - 1),
    targetNames: state.targetNames,
  };
}
