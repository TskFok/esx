export type JsonPathSegment = string | number;

export type JsonCursorInfo = {
  path: JsonPathSegment[];
  insideString: boolean;
  insideStringAsKey: boolean;
  expectingKey: boolean;
  expectingValue: boolean;
  previousMeaningfulChar: string;
  bodyStartIndex: number;
};

const WHITESPACE = /\s/;

export function isInsideString(text: string) {
  let escaped = false;
  let quoteCount = 0;

  for (const char of text) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      quoteCount += 1;
    }
  }

  return quoteCount % 2 === 1;
}

export function getPreviousMeaningfulCharacter(text: string) {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index] ?? "";
    if (!WHITESPACE.test(char) && char !== '"') {
      return char;
    }
  }
  return "";
}

export function locateJsonBodyStart(fullText: string) {
  const firstNewlineIndex = fullText.indexOf("\n");
  if (firstNewlineIndex < 0) {
    return -1;
  }

  const firstLine = fullText.slice(0, firstNewlineIndex).trim();
  if (!/^[A-Za-z]+\s+/.test(firstLine)) {
    return -1;
  }

  return firstNewlineIndex + 1;
}

type FrameKind = "object" | "array";

type Frame = {
  kind: FrameKind;
  key: string | null;
  index: number;
  stage: "key" | "value";
};

export function analyzeJsonCursor(prefix: string): JsonCursorInfo {
  const bodyStartIndex = locateJsonBodyStart(prefix);
  const jsonText = bodyStartIndex >= 0 ? prefix.slice(bodyStartIndex) : prefix;
  const stack: Frame[] = [];
  let insideString = false;
  let escaped = false;
  let pendingKey: string | null = null;
  let stringBuffer = "";
  let stringIsKey = false;
  let lastMeaningfulChar = "";

  const currentFrame = () => stack[stack.length - 1];

  const pathSegments = (): JsonPathSegment[] => {
    const segments: JsonPathSegment[] = [];
    for (const frame of stack) {
      if (frame.kind === "object") {
        if (frame.key !== null) {
          segments.push(frame.key);
        }
      } else {
        segments.push(frame.index);
      }
    }
    return segments;
  };

  for (let index = 0; index < jsonText.length; index += 1) {
    const char = jsonText[index] ?? "";

    if (insideString) {
      if (escaped) {
        stringBuffer += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        insideString = false;
        const frame = currentFrame();
        if (frame && frame.kind === "object" && stringIsKey) {
          frame.key = stringBuffer;
          frame.stage = "key";
        }
        lastMeaningfulChar = '"';
        stringBuffer = "";
        stringIsKey = false;
        continue;
      }

      stringBuffer += char;
      continue;
    }

    if (WHITESPACE.test(char)) {
      continue;
    }

    if (char === '"') {
      insideString = true;
      stringBuffer = "";
      const frame = currentFrame();
      stringIsKey = !!frame && frame.kind === "object" && frame.stage === "key";
      lastMeaningfulChar = '"';
      continue;
    }

    if (char === "{") {
      stack.push({ kind: "object", key: null, index: 0, stage: "key" });
      lastMeaningfulChar = char;
      continue;
    }

    if (char === "[") {
      stack.push({ kind: "array", key: null, index: 0, stage: "value" });
      lastMeaningfulChar = char;
      continue;
    }

    if (char === "}" || char === "]") {
      stack.pop();
      const parent = currentFrame();
      if (parent) {
        parent.stage = parent.kind === "object" ? "key" : "value";
      }
      lastMeaningfulChar = char;
      pendingKey = null;
      continue;
    }

    if (char === ":") {
      const frame = currentFrame();
      if (frame && frame.kind === "object") {
        frame.stage = "value";
      }
      lastMeaningfulChar = char;
      continue;
    }

    if (char === ",") {
      const frame = currentFrame();
      if (frame) {
        if (frame.kind === "object") {
          frame.key = null;
          frame.stage = "key";
        } else {
          frame.index += 1;
        }
      }
      lastMeaningfulChar = char;
      continue;
    }

    lastMeaningfulChar = char;
    pendingKey = null;
  }

  const frame = currentFrame();
  const effectivePath = pathSegments();
  const expectingKey = !!frame && frame.kind === "object" && frame.stage === "key" && !insideString;
  const expectingValue = !!frame && (
    (frame.kind === "object" && frame.stage === "value") || frame.kind === "array"
  ) && !insideString;

  const previousMeaningfulChar = insideString ? '"' : lastMeaningfulChar;
  const insideStringAsKey = insideString && stringIsKey;

  void pendingKey;

  return {
    path: effectivePath,
    insideString,
    insideStringAsKey,
    expectingKey,
    expectingValue,
    previousMeaningfulChar,
    bodyStartIndex,
  };
}
