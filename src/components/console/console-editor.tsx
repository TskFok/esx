import Editor, { loader, type Monaco } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor";
import { useMemo } from "react";

loader.config({ monaco: monacoEditor });

function registerLanguage(monacoInstance: Monaco) {
  if (monacoInstance.languages.getLanguages().some((item) => item.id === "es-console")) {
    return;
  }

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
}
type ConsoleEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  height?: string;
};

export function ConsoleEditor({ value, onChange, readOnly = false, height = "100%" }: ConsoleEditorProps) {
  const options = useMemo(
    () => ({
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      fontLigatures: true,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      padding: { top: 16, bottom: 16 },
      readOnly,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "on" as const,
      renderLineHighlight: "all" as const,
      smoothScrolling: true,
    }),
    [readOnly],
  );

  return (
    <Editor
      beforeMount={registerLanguage}
      onMount={(editor) => {
        const textarea = editor.getDomNode()?.querySelector("textarea");
        if (textarea) {
          textarea.setAttribute("spellcheck", "false");
          textarea.setAttribute("autocorrect", "off");
          textarea.setAttribute("autocomplete", "off");
          textarea.setAttribute("autocapitalize", "off");
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
