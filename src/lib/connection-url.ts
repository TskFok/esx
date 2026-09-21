import { isSensitiveKey, stripUrlCredentialsFromUrl } from "./log-redaction";

export function normalizeConnectionBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  const invalid = () => new Error("连接地址必须是有效的 HTTP 或 HTTPS 地址，且不能包含账号、密码、查询参数或片段。");
  if (!/^https?:\/\//i.test(trimmed) || /[\s\\?#]/.test(trimmed) || /%(?![\da-f]{2})/i.test(trimmed)) {
    throw invalid();
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalid();
  }
  const authority = trimmed.slice(trimmed.indexOf("://") + 3).split("/")[0];
  if (!parsed.hostname || parsed.username || parsed.password || authority.includes("@")) {
    throw invalid();
  }
  return trimmed;
}

export function sanitizeStoredConnectionUrl(baseUrl: string): string {
  const stripped = stripUrlCredentialsFromUrl(baseUrl);
  const queryStart = stripped.indexOf("?");
  const fragmentStart = stripped.indexOf("#");
  if (queryStart === -1 || (fragmentStart !== -1 && fragmentStart < queryStart)) {
    return stripped;
  }

  const queryEnd = fragmentStart === -1 ? stripped.length : fragmentStart;
  const query = stripped.slice(queryStart + 1, queryEnd);
  const safeParts = query.split("&").filter((part) => !isSensitiveKey(part.split("=")[0]));
  if (safeParts.join("&") === query) {
    return stripped;
  }
  return `${stripped.slice(0, queryStart)}${safeParts.length ? `?${safeParts.join("&")}` : ""}${stripped.slice(queryEnd)}`;
}
