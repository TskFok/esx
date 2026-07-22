import * as monacoEditor from "monaco-editor";
import {
  BULK_ACTION_SNIPPETS,
  COUNT_ROOT_PROPERTY_SNIPPETS,
  CREATE_INDEX_ROOT_PROPERTY_SNIPPETS,
  HTTP_METHODS,
  MSEARCH_HEADER_SNIPPETS,
  ROOT_PROPERTY_SNIPPETS,
  SCROLL_ROOT_PROPERTY_SNIPPETS,
  UPDATE_ROOT_PROPERTY_SNIPPETS,
  type ApiSegment,
  type RawSnippet,
} from "./snippets";
import {
  analyzeJsonCursor,
  getPreviousMeaningfulCharacter,
  isInsideString,
} from "./json-path";
import {
  selectPropertySuggestions,
  selectValueSuggestions,
  shouldSuggestFieldsForKey,
  shouldSuggestFieldsForStringValue,
} from "./suggestions";
import {
  extractIndexNamesFromPath,
  resolveFieldNamesForTargets,
  type ConsoleAutocompleteContext,
} from "./context";
import {
  filterAvailableSnippets,
  selectApiSegments,
  selectQueryParameterSnippets,
  selectQueryParameterValueSnippets,
} from "./capabilities";
import {
  analyzeBodyCompletion,
  type BodyCompletionKind,
} from "./body-context";

export { buildConsoleAutocompleteContext, extractIndexNamesFromPath } from "./context";
export type { ConsoleAutocompleteContext } from "./context";
export { validateConsoleContent } from "./validator";
export type { ConsoleBodyDiagnostic } from "./validator";
export { analyzeBodyCompletion } from "./body-context";
export type { BodyCompletionContext, BodyCompletionKind } from "./body-context";
export { flattenMappingFields, flattenMappingFieldsByIndex } from "./metadata";
export { analyzeJsonCursor, isInsideString } from "./json-path";
export type { JsonPathSegment } from "./json-path";
export {
  selectPropertySuggestions,
  selectValueSuggestions,
  shouldSuggestFieldsForKey,
  shouldSuggestFieldsForStringValue,
} from "./suggestions";
export {
  DEFAULT_CLUSTER_METADATA,
  normalizeClusterMetadata,
  selectApiSegments,
  selectQueryParameterSnippets,
  selectQueryParameterValueSnippets,
} from "./capabilities";
export * from "./snippets";

function getMethodRange(
  monacoInstance: typeof monacoEditor,
  lineContent: string,
  column: number,
) {
  const safeColumn = Math.max(1, column);
  const cursorIndex = safeColumn - 1;
  let start = cursorIndex;
  let end = cursorIndex;

  while (start > 0 && /[A-Z]/i.test(lineContent[start - 1] ?? "")) {
    start -= 1;
  }
  while (end < lineContent.length && /[A-Z]/i.test(lineContent[end] ?? "")) {
    end += 1;
  }

  return new monacoInstance.Range(1, start + 1, 1, end + 1);
}

function getPathSegmentRange(
  monacoInstance: typeof monacoEditor,
  lineContent: string,
  column: number,
) {
  const safeColumn = Math.max(1, column);
  const cursorIndex = safeColumn - 1;
  let start = cursorIndex;
  let end = cursorIndex;

  while (start > 0) {
    const char = lineContent[start - 1] ?? "";
    if (char === "/" || /\s/.test(char) || char === "?") {
      break;
    }
    start -= 1;
  }

  while (end < lineContent.length) {
    const char = lineContent[end] ?? "";
    if (char === "/" || /\s/.test(char) || char === "?") {
      break;
    }
    end += 1;
  }

  return new monacoInstance.Range(1, start + 1, 1, end + 1);
}

function snippetKindToMonaco(
  monacoInstance: typeof monacoEditor,
  kind: RawSnippet["kind"],
) {
  switch (kind) {
    case "property":
      return monacoInstance.languages.CompletionItemKind.Property;
    case "value":
      return monacoInstance.languages.CompletionItemKind.Snippet;
    case "keyword":
      return monacoInstance.languages.CompletionItemKind.Keyword;
    default:
      return monacoInstance.languages.CompletionItemKind.Text;
  }
}

function renderSnippet(
  monacoInstance: typeof monacoEditor,
  snippet: RawSnippet,
  replaceRange: monacoEditor.IRange,
  insideString: boolean,
): monacoEditor.languages.CompletionItem {
  const insertText = insideString ? snippet.label : snippet.insertText;
  return {
    label: snippet.label,
    kind: snippetKindToMonaco(monacoInstance, snippet.kind),
    detail: snippet.detail,
    documentation: snippet.documentation,
    insertText,
    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range: replaceRange,
    sortText: snippet.sortText ?? `500-${snippet.label}`,
  };
}

function buildFieldSuggestions(
  monacoInstance: typeof monacoEditor,
  fields: string[],
  replaceRange: monacoEditor.IRange,
  mode: "key" | "string-value",
): monacoEditor.languages.CompletionItem[] {
  return fields.map((fieldName, index) => ({
    label: fieldName,
    kind: monacoInstance.languages.CompletionItemKind.Field,
    detail: "索引字段",
    documentation: "来自当前连接拉取的 mapping 字段。",
    insertText: mode === "key" ? `"${fieldName}": $0` : fieldName,
    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range: replaceRange,
    sortText: `0${index.toString().padStart(4, "0")}-${fieldName}`,
  }));
}

function buildJsonSuggestions(
  monacoInstance: typeof monacoEditor,
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position,
  autocompleteContext: ConsoleAutocompleteContext,
  analysisPrefix: string,
  rootPropertySnippets: readonly RawSnippet[],
  allowRootFieldKeys = false,
): monacoEditor.languages.CompletionItem[] {
  const range = model.getWordUntilPosition(position);
  const replaceRange = new monacoInstance.Range(
    position.lineNumber,
    range.startColumn,
    position.lineNumber,
    range.endColumn,
  );
  const cursorInfo = analyzeJsonCursor(analysisPrefix);
  const insideStringFallback = isInsideString(analysisPrefix);
  const textBeforeCurrentWord = range.word ? analysisPrefix.slice(0, -range.word.length) : analysisPrefix;
  const previousCharacter = getPreviousMeaningfulCharacter(textBeforeCurrentWord);
  const preferValueSnippets = cursorInfo.expectingValue || previousCharacter === ":" || previousCharacter === "[";

  const path = cursorInfo.path;
  const suggestionsList: monacoEditor.languages.CompletionItem[] = [];
  const allowFields = allowRootFieldKeys && path.length === 0;
  const availableRootProperties = filterAvailableSnippets(
    rootPropertySnippets,
    autocompleteContext,
  );
  const pathHasAvailableRoot = typeof path[0] === "string" &&
    availableRootProperties.some((snippet) => snippet.label === path[0]);
  if (allowRootFieldKeys && path.length > 0) return [];

  if (cursorInfo.insideString || insideStringFallback) {
    if (cursorInfo.insideStringAsKey) {
      if (
        (allowFields || (pathHasAvailableRoot && shouldSuggestFieldsForKey(path))) &&
        autocompleteContext.fieldNames.length > 0
      ) {
        suggestionsList.push(
          ...buildFieldSuggestions(monacoInstance, autocompleteContext.fieldNames, replaceRange, "string-value"),
        );
      }
      return suggestionsList;
    }

    if (
      pathHasAvailableRoot &&
      shouldSuggestFieldsForStringValue(path) &&
      autocompleteContext.fieldNames.length > 0
    ) {
      suggestionsList.push(
        ...buildFieldSuggestions(monacoInstance, autocompleteContext.fieldNames, replaceRange, "string-value"),
      );
    }
    return suggestionsList;
  }

  if (!preferValueSnippets) {
    if (
      (allowFields || (pathHasAvailableRoot && shouldSuggestFieldsForKey(path))) &&
      autocompleteContext.fieldNames.length > 0
    ) {
      suggestionsList.push(
        ...buildFieldSuggestions(monacoInstance, autocompleteContext.fieldNames, replaceRange, "key"),
      );
    }

    const properties = path.length === 0
      ? availableRootProperties
      : selectPropertySuggestions(path, autocompleteContext, cursorInfo.objectFrames);
    for (const snippet of properties) {
      suggestionsList.push(renderSnippet(monacoInstance, snippet, replaceRange, false));
    }

    return suggestionsList;
  }

  const rootKey = path[0];
  if (
    typeof rootKey !== "string" ||
    !availableRootProperties.some((snippet) => snippet.label === rootKey)
  ) {
    return [];
  }

  const values = selectValueSuggestions(path, autocompleteContext);
  for (const snippet of values) {
    suggestionsList.push(renderSnippet(monacoInstance, snippet, replaceRange, false));
  }

  return suggestionsList;
}

const ROOT_SNIPPETS_BY_KIND: Partial<Record<BodyCompletionKind, readonly RawSnippet[]>> = {
  "search-json": ROOT_PROPERTY_SNIPPETS,
  "msearch-body": ROOT_PROPERTY_SNIPPETS,
  "scroll-json": SCROLL_ROOT_PROPERTY_SNIPPETS,
  "count-json": COUNT_ROOT_PROPERTY_SNIPPETS,
  "create-index-json": CREATE_INDEX_ROOT_PROPERTY_SNIPPETS,
  "update-json": UPDATE_ROOT_PROPERTY_SNIPPETS,
  "bulk-update": UPDATE_ROOT_PROPERTY_SNIPPETS,
  "document-json": [],
  "bulk-source": [],
};

function buildBodySuggestions(
  monacoInstance: typeof monacoEditor,
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position,
  autocompleteContext: ConsoleAutocompleteContext,
): monacoEditor.languages.CompletionItem[] {
  const textBeforeCursor = model.getValueInRange(
    new monacoInstance.Range(1, 1, position.lineNumber, position.column),
  );
  const bodyContext = analyzeBodyCompletion(textBeforeCursor, autocompleteContext.request);
  const lineContent = model.getLineContent(position.lineNumber);
  const lineRange = new monacoInstance.Range(
    position.lineNumber,
    1,
    position.lineNumber,
    lineContent.length + 1,
  );

  if (bodyContext.kind === "bulk-action" || bodyContext.kind === "msearch-header") {
    const snippets = bodyContext.kind === "bulk-action"
      ? BULK_ACTION_SNIPPETS
      : MSEARCH_HEADER_SNIPPETS;
    return snippets.map((snippet) => renderSnippet(monacoInstance, snippet, lineRange, false));
  }
  if (bodyContext.kind === "unknown") return [];

  const rootSnippets = ROOT_SNIPPETS_BY_KIND[bodyContext.kind];
  if (!rootSnippets) return [];
  const analysisPrefix = bodyContext.kind === "msearch-body"
    ? `POST /_search\n${bodyContext.currentLine}`
    : textBeforeCursor;
  const allowRootFieldKeys = bodyContext.kind === "document-json" || bodyContext.kind === "bulk-source";
  const usesNdjsonTarget = bodyContext.kind === "bulk-source" ||
    bodyContext.kind === "bulk-update" ||
    bodyContext.kind === "msearch-body";
  const bodyAutocompleteContext = usesNdjsonTarget
    ? {
        ...autocompleteContext,
        fieldNames: resolveFieldNamesForTargets(
          bodyContext.targetNames ?? extractIndexNamesFromPath(autocompleteContext.request.path),
          autocompleteContext.fieldNamesByTarget,
        ),
      }
    : autocompleteContext;
  return buildJsonSuggestions(
    monacoInstance,
    model,
    position,
    bodyAutocompleteContext,
    analysisPrefix,
    rootSnippets,
    allowRootFieldKeys,
  );
}

type QueryParameterCursor = {
  mode: "name" | "value";
  key: string;
  usedKeys: string[];
  startColumn: number;
  endColumn: number;
};

function analyzeQueryParameterCursor(
  lineContent: string,
  column: number,
): QueryParameterCursor | null {
  const cursorIndex = Math.max(0, column - 1);
  const questionIndex = lineContent.lastIndexOf("?", cursorIndex);
  if (questionIndex < 0) return null;
  const ampersandIndex = lineContent.lastIndexOf("&", cursorIndex - 1);
  const currentStart = Math.max(questionIndex, ampersandIndex) + 1;
  const current = lineContent.slice(currentStart, cursorIndex);
  if (/\s/.test(current)) return null;
  const equalsOffset = current.indexOf("=");
  const completed = lineContent.slice(questionIndex + 1, currentStart);
  const usedKeys = completed
    .split("&")
    .map((part) => part.split("=", 1)[0]?.trim() ?? "")
    .filter(Boolean);
  let endIndex = cursorIndex;

  if (equalsOffset >= 0) {
    while (endIndex < lineContent.length && lineContent[endIndex] !== "&" && !/\s/.test(lineContent[endIndex] ?? "")) {
      endIndex += 1;
    }
    return {
      mode: "value",
      key: current.slice(0, equalsOffset).trim(),
      usedKeys,
      startColumn: currentStart + equalsOffset + 2,
      endColumn: endIndex + 1,
    };
  }

  while (
    endIndex < lineContent.length &&
    lineContent[endIndex] !== "=" &&
    lineContent[endIndex] !== "&" &&
    !/\s/.test(lineContent[endIndex] ?? "")
  ) {
    endIndex += 1;
  }
  return {
    mode: "name",
    key: current,
    usedKeys,
    startColumn: currentStart + 1,
    endColumn: endIndex + 1,
  };
}

function buildMethodSuggestions(
  monacoInstance: typeof monacoEditor,
  lineContent: string,
  column: number,
): monacoEditor.languages.CompletionItem[] {
  const range = getMethodRange(monacoInstance, lineContent, column);
  return HTTP_METHODS.map((method, index) => ({
    label: method,
    kind: monacoInstance.languages.CompletionItemKind.Keyword,
    detail: "HTTP 方法",
    documentation: `${method} 请求方法。`,
    insertText: method,
    range,
    sortText: `0${index}-${method}`,
  }));
}

function buildQueryParameterSuggestions(
  monacoInstance: typeof monacoEditor,
  lineContent: string,
  column: number,
  autocompleteContext: ConsoleAutocompleteContext,
): monacoEditor.languages.CompletionItem[] {
  const cursor = analyzeQueryParameterCursor(lineContent, column);
  if (!cursor) return [];
  const snippets = cursor.mode === "value"
    ? selectQueryParameterValueSnippets(
        autocompleteContext.request.endpoint,
        cursor.key,
        autocompleteContext,
      )
    : selectQueryParameterSnippets(
        autocompleteContext.request.endpoint,
        autocompleteContext,
        cursor.usedKeys,
      );
  const range = new monacoInstance.Range(1, cursor.startColumn, 1, cursor.endColumn);

  return snippets.map((snippet, index) => ({
    label: snippet.label,
    kind: monacoInstance.languages.CompletionItemKind.Keyword,
    detail: snippet.detail,
    documentation: snippet.documentation,
    insertText: snippet.insertText,
    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
    sortText: snippet.sortText ?? `2${index.toString().padStart(3, "0")}-${snippet.label}`,
  }));
}

type PathSuggestionScope = "root" | "index" | "cat" | "none";

function resolvePathSuggestionScope(
  lineContent: string,
  segmentRange: monacoEditor.IRange,
): PathSuggestionScope {
  const prefix = lineContent.slice(0, segmentRange.startColumn - 1);
  const pathPrefix = prefix.trim().split(/\s+/, 2)[1]?.split("?", 1)[0] ?? "";
  const completed = pathPrefix.split("/").filter(Boolean);
  if (completed.length === 0) return "root";
  if (completed.length === 1 && completed[0] === "_cat") return "cat";
  if (completed.length === 1 && !completed[0]?.startsWith("_")) return "index";
  return "none";
}

function buildPathSuggestions(
  monacoInstance: typeof monacoEditor,
  lineContent: string,
  column: number,
  autocompleteContext: ConsoleAutocompleteContext,
): monacoEditor.languages.CompletionItem[] {
  const range = getPathSegmentRange(monacoInstance, lineContent, column);
  const scope = resolvePathSuggestionScope(lineContent, range);
  if (scope === "none") {
    return [];
  }

  const indexSuggestions = autocompleteContext.indexNames.map((indexName, index) => ({
    label: indexName,
    kind: monacoInstance.languages.CompletionItemKind.Field,
    detail: "索引名",
    documentation: "来自当前连接实时拉取并缓存的索引元数据。",
    insertText: indexName,
    range,
    sortText: `0${index.toString().padStart(3, "0")}-${indexName}`,
  }));
  const aliasSuggestions = autocompleteContext.aliasNames.map((aliasName, index) => ({
    label: aliasName,
    kind: monacoInstance.languages.CompletionItemKind.Reference,
    detail: "Alias",
    documentation: "来自当前连接实时拉取并缓存的 alias 元数据。",
    insertText: aliasName,
    range,
    sortText: `1${index.toString().padStart(3, "0")}-${aliasName}`,
  }));
  const historySuggestions = autocompleteContext.historyTargetNames.map((targetName, index) => ({
    label: targetName,
    kind: monacoInstance.languages.CompletionItemKind.Text,
    detail: "历史路径",
    documentation: "来自当前连接下已保存请求路径的历史目标名。",
    insertText: targetName,
    range,
    sortText: `2${index.toString().padStart(3, "0")}-${targetName}`,
  }));

  const apiScope = scope === "root" ? "global" : scope;
  const apiSegments: ReadonlyArray<ApiSegment> = selectApiSegments(
    apiScope,
    autocompleteContext,
    autocompleteContext.request.method,
  );

  const apiSuggestions = apiSegments.map((segment, index) => ({
    label: segment.label,
    kind: monacoInstance.languages.CompletionItemKind.Function,
    detail: segment.detail,
    documentation: segment.documentation,
    insertText: segment.insertText,
    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
    sortText: `3${index.toString().padStart(3, "0")}-${segment.label}`,
  }));

  const targetSuggestions = scope === "root"
    ? [...indexSuggestions, ...aliasSuggestions, ...historySuggestions]
    : [];
  return [...targetSuggestions, ...apiSuggestions];
}

export function provideConsoleCompletionItems(
  monacoInstance: typeof monacoEditor,
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position,
  autocompleteContext: ConsoleAutocompleteContext,
): monacoEditor.languages.CompletionItem[] {
  const lineContent = model.getLineContent(position.lineNumber);
  if (position.lineNumber === 1) {
    const leading = lineContent.slice(0, position.column - 1);
    if (!/\s/.test(leading)) {
      return buildMethodSuggestions(monacoInstance, lineContent, position.column);
    }

    if (leading.includes("?")) {
      return buildQueryParameterSuggestions(monacoInstance, lineContent, position.column, autocompleteContext);
    }

    return buildPathSuggestions(monacoInstance, lineContent, position.column, autocompleteContext);
  }

  return buildBodySuggestions(monacoInstance, model, position, autocompleteContext);
}
