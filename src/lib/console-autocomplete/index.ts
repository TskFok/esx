import * as monacoEditor from "monaco-editor";
import {
  GLOBAL_API_SEGMENTS,
  HTTP_METHODS,
  INDEX_API_SEGMENTS,
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
import type { ConsoleAutocompleteContext } from "./context";

export { buildConsoleAutocompleteContext, extractIndexNamesFromPath } from "./context";
export type { ConsoleAutocompleteContext } from "./context";
export { validateConsoleContent } from "./validator";
export type { ConsoleBodyDiagnostic } from "./validator";
export { flattenMappingFields, flattenMappingFieldsByIndex } from "./metadata";
export { analyzeJsonCursor, isInsideString } from "./json-path";
export type { JsonPathSegment } from "./json-path";
export {
  selectPropertySuggestions,
  selectValueSuggestions,
  shouldSuggestFieldsForKey,
  shouldSuggestFieldsForStringValue,
} from "./suggestions";
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
): monacoEditor.languages.CompletionItem[] {
  const range = model.getWordUntilPosition(position);
  const replaceRange = new monacoInstance.Range(
    position.lineNumber,
    range.startColumn,
    position.lineNumber,
    range.endColumn,
  );
  const textBeforeCursor = model.getValueInRange(
    new monacoInstance.Range(1, 1, position.lineNumber, position.column),
  );
  const cursorInfo = analyzeJsonCursor(textBeforeCursor);
  const insideStringFallback = isInsideString(textBeforeCursor);
  const textBeforeCurrentWord = range.word ? textBeforeCursor.slice(0, -range.word.length) : textBeforeCursor;
  const previousCharacter = getPreviousMeaningfulCharacter(textBeforeCurrentWord);
  const preferValueSnippets = cursorInfo.expectingValue || previousCharacter === ":" || previousCharacter === "[";

  const path = cursorInfo.path;
  const suggestionsList: monacoEditor.languages.CompletionItem[] = [];

  if (cursorInfo.insideString || insideStringFallback) {
    if (cursorInfo.insideStringAsKey) {
      if (shouldSuggestFieldsForKey(path) && autocompleteContext.fieldNames.length > 0) {
        suggestionsList.push(
          ...buildFieldSuggestions(monacoInstance, autocompleteContext.fieldNames, replaceRange, "string-value"),
        );
      }
      return suggestionsList;
    }

    if (shouldSuggestFieldsForStringValue(path) && autocompleteContext.fieldNames.length > 0) {
      suggestionsList.push(
        ...buildFieldSuggestions(monacoInstance, autocompleteContext.fieldNames, replaceRange, "string-value"),
      );
    }
    return suggestionsList;
  }

  if (!preferValueSnippets) {
    if (shouldSuggestFieldsForKey(path) && autocompleteContext.fieldNames.length > 0) {
      suggestionsList.push(
        ...buildFieldSuggestions(monacoInstance, autocompleteContext.fieldNames, replaceRange, "key"),
      );
    }

    const properties = selectPropertySuggestions(path);
    for (const snippet of properties) {
      suggestionsList.push(renderSnippet(monacoInstance, snippet, replaceRange, false));
    }

    return suggestionsList;
  }

  const values = selectValueSuggestions(path);
  for (const snippet of values) {
    suggestionsList.push(renderSnippet(monacoInstance, snippet, replaceRange, false));
  }

  return suggestionsList;
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

function buildPathSuggestions(
  monacoInstance: typeof monacoEditor,
  lineContent: string,
  column: number,
  autocompleteContext: ConsoleAutocompleteContext,
): monacoEditor.languages.CompletionItem[] {
  const range = getPathSegmentRange(monacoInstance, lineContent, column);
  const trimmedLine = lineContent.trim();
  const parts = trimmedLine.split(/\s+/);
  const pathText = parts.slice(1).join(" ");
  const pathWithoutQuery = pathText.split("?", 1)[0] ?? "";
  const pathPrefix = lineContent.slice(0, column - 1);
  const segmentCount = (pathPrefix.split(/\s+/, 2)[1] ?? "").split("/").filter(Boolean).length;
  const firstSegment = pathWithoutQuery.split("/").filter(Boolean)[0] ?? "";
  const currentSegment = lineContent.slice(range.startColumn - 1, range.endColumn - 1);
  const looksLikeGlobalApi = currentSegment.startsWith("_") || (segmentCount <= 1 && firstSegment.startsWith("_"));

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

  const apiSegments: ReadonlyArray<ApiSegment> =
    segmentCount > 1 && firstSegment && !firstSegment.startsWith("_") ? INDEX_API_SEGMENTS : GLOBAL_API_SEGMENTS;

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

  const targetSuggestions = [...indexSuggestions, ...aliasSuggestions, ...historySuggestions];
  return looksLikeGlobalApi ? [...apiSuggestions, ...targetSuggestions] : [...targetSuggestions, ...apiSuggestions];
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

    return buildPathSuggestions(monacoInstance, lineContent, position.column, autocompleteContext);
  }

  return buildJsonSuggestions(monacoInstance, model, position, autocompleteContext);
}
