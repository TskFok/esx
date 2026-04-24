import Editor, { loader, type Monaco } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor";
import { useEffect, useMemo, useRef } from "react";
import {
  type ConsoleAutocompleteContext,
  provideConsoleCompletionItems,
  validateConsoleContent,
} from "../../lib/console-autocomplete";

loader.config({ monaco: monacoEditor });

const EMPTY_AUTOCOMPLETE_CONTEXT: ConsoleAutocompleteContext = {
  indexNames: [],
  aliasNames: [],
  historyTargetNames: [],
  fieldNames: [],
};

const modelAutocompleteContext = new WeakMap<monacoEditor.editor.ITextModel, ConsoleAutocompleteContext>();
let completionProviderRegistered = false;

let cachedOverflowWidgetsDomNode: HTMLElement | null = null;

function getOverflowWidgetsDomNode(): HTMLElement | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  if (cachedOverflowWidgetsDomNode && cachedOverflowWidgetsDomNode.isConnected) {
    return cachedOverflowWidgetsDomNode;
  }

  const host = document.createElement("div");
  host.className = "monaco-editor es-console-overflow-widgets";
  host.style.position = "absolute";
  host.style.top = "0";
  host.style.left = "0";
  host.style.zIndex = "9999";
  document.body.appendChild(host);
  cachedOverflowWidgetsDomNode = host;
  return host;
}

const MARKER_OWNER = "es-console-validator";

function runConsoleValidation(model: monacoEditor.editor.ITextModel) {
  const diagnostics = validateConsoleContent(model.getValue());
  monacoEditor.editor.setModelMarkers(
    model,
    MARKER_OWNER,
    diagnostics.map((diag) => ({
      message: diag.message,
      startLineNumber: diag.startLineNumber,
      startColumn: diag.startColumn,
      endLineNumber: diag.endLineNumber,
      endColumn: diag.endColumn,
      severity:
        diag.severity === "error"
          ? monacoEditor.MarkerSeverity.Error
          : monacoEditor.MarkerSeverity.Warning,
    })),
  );
}

function registerLanguage(monacoInstance: Monaco) {
  if (monacoInstance.languages.getLanguages().some((item) => item.id === "es-console")) {
    monacoInstance.editor.defineTheme("es-console-theme", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "0f766e", fontStyle: "bold" },
        { token: "string.escape", foreground: "2563eb" },
        { token: "string", foreground: "b45309" },
        { token: "number", foreground: "7c3aed" },
        { token: "delimiter", foreground: "0f172a" },
      ],
      colors: {
        "editor.background": "#ffffff",
        "editorLineNumber.foreground": "#94a3b8",
        "editorLineNumber.activeForeground": "#0f172a",
        "editorLineNumber.dimmedForeground": "#cbd5e1",
        "editorGutter.background": "#ffffff",
        "editorCursor.foreground": "#059669",
        "editor.selectionBackground": "#d1fae5",
        "editor.lineHighlightBackground": "#f8fafc",
      },
    });
  } else {
    monacoInstance.languages.register({ id: "es-console" });
    monacoInstance.languages.setMonarchTokensProvider("es-console", {
      tokenizer: {
        root: [
          [/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/, "keyword"],
          [/\/[^\s]*/, "string.escape"],
          [/".*?"/, "string"],
          [/[{}[\]]/, "delimiter"],
          [/-?\d+(\.\d+)?/, "number"],
          [/(true|false|null)\b/, "keyword"],
        ],
      },
    });
  }

  monacoInstance.languages.setLanguageConfiguration("es-console", {
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
    indentationRules: {
      increaseIndentPattern: /^.*(\{[^}"']*|\[[^\]"']*)$/,
      decreaseIndentPattern: /^\s*[}\]],?\s*$/,
    },
    onEnterRules: [
      {
        beforeText: /^.*(\{|\[)\s*$/,
        afterText: /^\s*(\}|\]).*$/,
        action: {
          indentAction: monacoInstance.languages.IndentAction.IndentOutdent,
        },
      },
      {
        beforeText: /^.*(\{|\[)\s*$/,
        action: {
          indentAction: monacoInstance.languages.IndentAction.Indent,
        },
      },
    ],
  });

  monacoInstance.editor.defineTheme("es-console-theme", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "0f766e", fontStyle: "bold" },
      { token: "string.escape", foreground: "2563eb" },
      { token: "string", foreground: "b45309" },
      { token: "number", foreground: "7c3aed" },
      { token: "delimiter", foreground: "0f172a" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editorLineNumber.foreground": "#94a3b8",
      "editorLineNumber.activeForeground": "#0f172a",
      "editorLineNumber.dimmedForeground": "#cbd5e1",
      "editorGutter.background": "#ffffff",
      "editorCursor.foreground": "#059669",
      "editor.selectionBackground": "#d1fae5",
      "editor.lineHighlightBackground": "#f8fafc",
    },
  });

  if (!completionProviderRegistered) {
    monacoInstance.languages.registerCompletionItemProvider("es-console", {
      triggerCharacters: ["/", "\"", "_", ".", ":"],
      provideCompletionItems(model, position) {
        const autocompleteContext = modelAutocompleteContext.get(model) ?? EMPTY_AUTOCOMPLETE_CONTEXT;
        return {
          suggestions: provideConsoleCompletionItems(
            monacoEditor,
            model,
            position,
            autocompleteContext,
          ),
        };
      },
    });
    completionProviderRegistered = true;
  }
}
type ConsoleEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  autocompleteContext?: ConsoleAutocompleteContext;
  onRunShortcut?: () => void;
};

export function ConsoleEditor({
  value,
  onChange,
  readOnly = false,
  height = "100%",
  autocompleteContext,
  onRunShortcut,
}: ConsoleEditorProps) {
  const modelRef = useRef<monacoEditor.editor.ITextModel | null>(null);
  const runShortcutRef = useRef(onRunShortcut);
  const options = useMemo(
    () => ({
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: "'SF Mono', 'Monaco', 'Cascadia Mono', 'Menlo', monospace",
      fontLigatures: false,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      padding: { top: 16, bottom: 16 },
      readOnly,
      tabSize: 2,
      insertSpaces: true,
      autoIndent: "full" as const,
      autoClosingBrackets: "always" as const,
      autoClosingQuotes: "always" as const,
      autoSurround: "languageDefined" as const,
      formatOnPaste: true,
      formatOnType: true,
      bracketPairColorization: { enabled: true },
      quickSuggestions: {
        other: true,
        comments: false,
        strings: true,
      },
      suggestOnTriggerCharacters: true,
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode: getOverflowWidgetsDomNode(),
      guides: {
        bracketPairs: true,
        indentation: true,
      },
      wordWrap: "on" as const,
      renderLineHighlight: "all" as const,
      smoothScrolling: true,
    }),
    [readOnly],
  );

  useEffect(() => {
    runShortcutRef.current = onRunShortcut;
  }, [onRunShortcut]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) {
      return;
    }

    modelAutocompleteContext.set(model, autocompleteContext ?? EMPTY_AUTOCOMPLETE_CONTEXT);
  }, [autocompleteContext]);

  return (
    <Editor
      beforeMount={registerLanguage}
      onMount={(editor) => {
        const model = editor.getModel();
        modelRef.current = model;
        if (model) {
          modelAutocompleteContext.set(model, autocompleteContext ?? EMPTY_AUTOCOMPLETE_CONTEXT);

          if (!readOnly) {
            runConsoleValidation(model);
            const disposable = model.onDidChangeContent(() => runConsoleValidation(model));
            editor.onDidDispose(() => disposable.dispose());
          }
        }

        const textarea = editor.getDomNode()?.querySelector("textarea");
        if (textarea) {
          textarea.setAttribute("spellcheck", "false");
          textarea.setAttribute("autocorrect", "off");
          textarea.setAttribute("autocomplete", "off");
          textarea.setAttribute("autocapitalize", "off");
        }

        if (!readOnly) {
          editor.addCommand(monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.Enter, () => {
            runShortcutRef.current?.();
          });

          editor.addAction({
            id: "es-console.delete-line",
            label: "删除当前行",
            keybindings: [monacoEditor.KeyMod.CtrlCmd | monacoEditor.KeyCode.KeyD],
            run(currentEditor) {
              const action = currentEditor.getAction("editor.action.deleteLines");
              if (!action) {
                return;
              }

              return action.run();
            },
          });

          editor.addAction({
            id: "es-console.format-document",
            label: "格式化 JSON",
            keybindings: [
              monacoEditor.KeyMod.Shift | monacoEditor.KeyMod.Alt | monacoEditor.KeyCode.KeyF,
            ],
            run(currentEditor) {
              return currentEditor.getAction("editor.action.formatDocument")?.run();
            },
          });
        }
      }}
      height={height}
      language="es-console"
      onChange={(nextValue) => onChange(nextValue ?? "")}
      options={options}
      theme="es-console-theme"
      value={value}
    />
  );
}
