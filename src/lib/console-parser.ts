export type ParsedConsoleRequest = {
  method: string;
  path: string;
  bodyText: string;
  bodyJson: unknown | null;
};

const SUPPORTED_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

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
    };
  }

  try {
    return {
      method,
      path,
      bodyText,
      bodyJson: JSON.parse(bodyText),
    };
  } catch {
    throw new Error("请求体必须是合法的 JSON。");
  }
}

export function formatConsoleRequest(content: string) {
  const parsed = parseConsoleRequest(content);
  if (!parsed.bodyText) {
    return `${parsed.method} ${parsed.path}`;
  }

  return `${parsed.method} ${parsed.path}\n${JSON.stringify(parsed.bodyJson, null, 2)}`;
}

export function buildConsoleContent(method: string, path: string, body = "") {
  const normalizedBody = body.trim();
  if (!normalizedBody) {
    return `${method.toUpperCase()} ${path}`;
  }

  return `${method.toUpperCase()} ${path}\n${normalizedBody}`;
}
