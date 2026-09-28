export type ConsoleBodyDiagnostic = {
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  severity: "error" | "warning";
};

const WHITESPACE = /\s/;

function nextMeaningfulOffset(text: string, from: number) {
  let index = from;
  while (index < text.length && WHITESPACE.test(text[index] ?? "")) {
    index += 1;
  }
  return index;
}

type Frame = {
  kind: "object" | "array";
  line: number;
  column: number;
};

export function validateConsoleBody(body: string, bodyStartOffset = 0): ConsoleBodyDiagnostic[] {
  const diagnostics: ConsoleBodyDiagnostic[] = [];
  if (!body.trim()) {
    return diagnostics;
  }

  const stack: Frame[] = [];
  let insideString = false;
  let escaped = false;
  let stringStartLine = 1;
  let stringStartColumn = 1;
  let sawValue = false;
  let line = 1;
  let column = 1;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? "";
    const currentLine = line;
    const currentColumn = column;
    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }

    if (insideString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        insideString = false;
      }
      if (char === "\n") {
        diagnostics.push({
          message: "字符串未闭合",
          startLineNumber: stringStartLine,
          startColumn: stringStartColumn,
          endLineNumber: currentLine,
          endColumn: currentColumn,
          severity: "error",
        });
        insideString = false;
      }
      continue;
    }

    if (WHITESPACE.test(char)) {
      continue;
    }

    if (char === '"') {
      insideString = true;
      stringStartLine = currentLine;
      stringStartColumn = currentColumn;
      sawValue = true;
      continue;
    }

    if (char === "{") {
      stack.push({ kind: "object", line: currentLine, column: currentColumn });
      sawValue = false;
      continue;
    }

    if (char === "[") {
      stack.push({ kind: "array", line: currentLine, column: currentColumn });
      sawValue = false;
      continue;
    }

    if (char === "}") {
      const frame = stack.pop();
      if (!frame || frame.kind !== "object") {
        diagnostics.push({
          message: "多余的 }",
          startLineNumber: currentLine,
          startColumn: currentColumn,
          endLineNumber: currentLine,
          endColumn: currentColumn + 1,
          severity: "error",
        });
      }
      sawValue = true;
      continue;
    }

    if (char === "]") {
      const frame = stack.pop();
      if (!frame || frame.kind !== "array") {
        diagnostics.push({
          message: "多余的 ]",
          startLineNumber: currentLine,
          startColumn: currentColumn,
          endLineNumber: currentLine,
          endColumn: currentColumn + 1,
          severity: "error",
        });
      }
      sawValue = true;
      continue;
    }

    if (char === ",") {
      const next = nextMeaningfulOffset(body, index + 1);
      const nextChar = body[next] ?? "";
      if (nextChar === "}" || nextChar === "]" || next >= body.length) {
        diagnostics.push({
          message: "JSON 不允许尾随逗号",
          startLineNumber: currentLine,
          startColumn: currentColumn,
          endLineNumber: currentLine,
          endColumn: currentColumn + 1,
          severity: "error",
        });
      }
      sawValue = false;
      continue;
    }

    if (char === ":") {
      sawValue = false;
      continue;
    }
  }

  stack.forEach((frame) => {
    diagnostics.push({
      message: frame.kind === "object" ? "未闭合的 { 对象" : "未闭合的 [ 数组",
      startLineNumber: frame.line,
      startColumn: frame.column,
      endLineNumber: frame.line,
      endColumn: frame.column + 1,
      severity: "error",
    });
  });

  if (insideString) {
    diagnostics.push({
      message: "字符串未闭合",
      startLineNumber: stringStartLine,
      startColumn: stringStartColumn,
      endLineNumber: stringStartLine,
      endColumn: stringStartColumn + 1,
      severity: "error",
    });
  }

  if (diagnostics.length === 0) {
    try {
      JSON.parse(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "JSON 解析失败";
      diagnostics.push({
        message: `JSON 解析失败：${message}`,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: Math.max(2, body.split("\n", 1)[0]?.length ?? 2),
        severity: "error",
      });
    }
  }

  void sawValue;
  void bodyStartOffset;
  return diagnostics;
}

export function validateConsoleContent(content: string): ConsoleBodyDiagnostic[] {
  const firstNewlineIndex = content.indexOf("\n");
  if (firstNewlineIndex < 0) {
    return [];
  }

  const bodyStartOffset = firstNewlineIndex + 1;
  const body = content.slice(bodyStartOffset);
  if (!body.trim()) {
    return [];
  }

  const diagnostics = validateConsoleBody(body, bodyStartOffset);
  const firstLineCount = content.slice(0, bodyStartOffset).split("\n").length - 1;
  return diagnostics.map((diag) => ({
    ...diag,
    startLineNumber: diag.startLineNumber + firstLineCount,
    endLineNumber: diag.endLineNumber + firstLineCount,
  }));
}
