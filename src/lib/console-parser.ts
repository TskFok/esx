export type ParsedConsoleRequest = {
  method: string;
  path: string;
  bodyText: string;
  bodyJson: unknown | null;
  bodyKind: "json" | "ndjson" | "text" | "empty";
  contentType: string | null;
};

const SUPPORTED_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

function normalizePath(path: string) {
  return path.split("?", 1)[0]?.toLowerCase() ?? "";
}

function inferBodyKind(path: string, bodyText: string): ParsedConsoleRequest["bodyKind"] {
  if (!bodyText.trim()) {
    return "empty";
  }

  const normalizedPath = normalizePath(path);
  if (/(^|\/)_(bulk|msearch)(\/|$)/.test(normalizedPath)) {
    return "ndjson";
  }
  if (/(^|\/)_(sql|eql)(\/|$)/.test(normalizedPath) && !bodyText.trim().startsWith("{")) {
    return "text";
  }
  return "json";
}

function contentTypeForBodyKind(kind: ParsedConsoleRequest["bodyKind"]) {
  if (kind === "json") {
    return "application/json";
  }
  if (kind === "ndjson") {
    return "application/x-ndjson";
  }
  if (kind === "text") {
    return "text/plain";
  }
  return null;
}

function validateNdjson(bodyText: string) {
  const lines = bodyText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return;
  }

  lines.forEach((line, index) => {
    try {
      JSON.parse(line);
    } catch {
      throw new Error(`NDJSON 第 ${index + 1} 行必须是合法 JSON。`);
    }
  });
}

export function parseConsoleRequest(content: string): ParsedConsoleRequest {
  const normalized = content.trim();
  if (!normalized) {
    throw new Error("请输入请求内容。");
  }

  const lines = normalized.split(/\r?\n/);
  const firstLine = lines.shift()?.trim() ?? "";
  if (!firstLine) {
    throw new Error("第一行必须是 METHOD /path 格式。");
  }

  const [methodRaw, ...pathParts] = firstLine.split(/\s+/);
  const method = methodRaw.toUpperCase();
  const path = pathParts.join(" ").trim();

  if (!SUPPORTED_METHODS.has(method)) {
    throw new Error("暂不支持该 HTTP Method。");
  }

  if (!path) {
    throw new Error("请求路径不能为空。");
  }

  const bodyText = lines.join("\n").trim();
  if (!bodyText) {
    return {
      method,
      path,
      bodyText: "",
      bodyJson: null,
      bodyKind: "empty",
      contentType: null,
    };
  }

  const bodyKind = inferBodyKind(path, bodyText);
  if (bodyKind === "ndjson") {
    validateNdjson(bodyText);
    return {
      method,
      path,
      bodyText,
      bodyJson: null,
      bodyKind,
      contentType: contentTypeForBodyKind(bodyKind),
    };
  }

  if (bodyKind === "text") {
    return {
      method,
      path,
      bodyText,
      bodyJson: null,
      bodyKind,
      contentType: contentTypeForBodyKind(bodyKind),
    };
  }

  try {
    return {
      method,
      path,
      bodyText,
      bodyJson: JSON.parse(bodyText),
      bodyKind,
      contentType: contentTypeForBodyKind(bodyKind),
    };
  } catch {
    throw new Error("请求体必须是合法的 JSON。");
  }
}

function formatParsedConsoleRequest(parsed: ParsedConsoleRequest) {
  if (!parsed.bodyText) {
    return `${parsed.method} ${parsed.path}`;
  }

  if (parsed.bodyKind !== "json") {
    return `${parsed.method} ${parsed.path}\n${parsed.bodyText}`;
  }

  return `${parsed.method} ${parsed.path}\n${JSON.stringify(parsed.bodyJson, null, 2)}`;
}

export function formatConsoleRequest(content: string) {
  const requests = parseConsoleRequests(content);
  if (requests.length > 1) {
    return requests.map(formatParsedConsoleRequest).join("\n\n");
  }
  return formatParsedConsoleRequest(requests[0] ?? parseConsoleRequest(content));
}

export function buildConsoleContent(method: string, path: string, body = "") {
  const normalizedBody = body.trim();
  if (!normalizedBody) {
    return `${method.toUpperCase()} ${path}`;
  }

  return `${method.toUpperCase()} ${path}\n${normalizedBody}`;
}

function looksLikeRequestHeader(line: string) {
  const [methodRaw, ...pathParts] = line.trim().split(/\s+/);
  return SUPPORTED_METHODS.has(methodRaw.toUpperCase()) && pathParts.join(" ").trim().length > 0;
}

export function parseConsoleRequests(content: string): ParsedConsoleRequest[] {
  const lines = content.trim().split(/\r?\n/);
  const chunks: string[] = [];
  let current: string[] = [];

  lines.forEach((line) => {
    if (looksLikeRequestHeader(line) && current.length > 0) {
      chunks.push(current.join("\n").trim());
      current = [line];
      return;
    }
    current.push(line);
  });

  if (current.join("\n").trim()) {
    chunks.push(current.join("\n").trim());
  }

  return chunks.map(parseConsoleRequest);
}
