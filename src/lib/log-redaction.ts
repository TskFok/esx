const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "pwd",
  "token",
  "accesstoken",
  "refreshtoken",
  "bearertoken",
  "authtoken",
  "idtoken",
  "sessiontoken",
  "apikey",
  "xapikey",
  "secret",
  "clientsecret",
  "authsecret",
  "sshsecret",
  "privatekey",
  "passphrase",
]);

export function isSensitiveKey(key: string) {
  try {
    key = decodeURIComponent(key.replace(/\+/g, " "));
  } catch {
    // Malformed query keys must not prevent the remaining log from being redacted.
  }
  return SENSITIVE_KEYS.has(key.replace(/[-_\s]/g, "").toLowerCase());
}

export function stripUrlCredentials(text: string) {
  return text.replace(/(\bhttps?:\/\/)([^/?#]+)@(?=([^\s/?#@"'<>`,;}\]]+))/gi, (match, scheme: string, candidateUserinfo: string, host: string) => {
    const candidate = `${candidateUserinfo}@${host}`;
    let authorityEnd = candidate.length;
    const jsonBoundary = candidate.search(/["']\s*[,}\]]/);
    if (jsonBoundary !== -1) {
      authorityEnd = jsonBoundary;
    }
    const proseBoundary = /@(?:\[[\da-f:.]+\]|(?:[\w-]+\.)+[\w-]+|localhost)(?::\d+)?(?=\s|["'<>`,;}\]]|$)/i.exec(candidate);
    if (proseBoundary) {
      authorityEnd = Math.min(authorityEnd, proseBoundary.index + proseBoundary[0].length);
    }
    const authority = candidate.slice(0, authorityEnd);
    const userinfoEnd = authority.lastIndexOf("@");
    if (userinfoEnd === -1) {
      return match;
    }
    const userinfo = authority.slice(0, userinfoEnd);
    if (/[\s"'<>`,;()[\]{}]/.test(userinfo)) {
      const firstWord = userinfo.split(/\s/, 1)[0];
      if (!/^[^\s"'<>`,;()[\]{}:@]*:/.test(userinfo) || /^(?:\[[\da-f:.]+\]|[\w.-]+):\d+$/i.test(firstWord)) {
        return match;
      }
    }
    try {
      new URL(`${scheme}${authority}`);
      return `${scheme}${match.slice(scheme.length + userinfoEnd + 1)}`;
    } catch {
      return match;
    }
  });
}

export function stripUrlCredentialsFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const prefix = url.match(/^\s*https?:\/\//i)?.[0];
    if (prefix && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
      const authority = url.slice(prefix.length).split(/[/?#\\]/, 1)[0];
      const userinfoEnd = authority.lastIndexOf("@");
      if (userinfoEnd !== -1) {
        return `${prefix}${url.slice(prefix.length + userinfoEnd + 1)}`;
      }
    }
  } catch {
    // Failed connection forms can still contain credentials in malformed URLs.
  }
  return stripUrlCredentials(url);
}

function jsonStringEnd(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
    } else if (text[index] === '"') {
      return index + 1;
    }
  }
  return text.length;
}

function jsonValueEnd(text: string, start: number): number {
  if (text[start] === '"') {
    return jsonStringEnd(text, start);
  }
  if (text[start] !== "{" && text[start] !== "[") {
    return start + (text.slice(start).match(/^[^\s,}\]]+/)?.[0].length ?? 0);
  }

  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '"') {
      index = jsonStringEnd(text, index) - 1;
    } else if (text[index] === "{" || text[index] === "[") {
      depth += 1;
    } else if ((text[index] === "}" || text[index] === "]") && --depth === 0) {
      return index + 1;
    }
  }
  return text.length;
}

function redactJsonFields(text: string): string {
  const fieldPattern = /"((?:[^"\\]|\\.)*)"\s*:\s*/g;
  const parts: string[] = [];
  let copiedUntil = 0;
  for (let match = fieldPattern.exec(text); match; match = fieldPattern.exec(text)) {
    let key: string;
    try {
      key = JSON.parse(`"${match[1]}"`) as string;
    } catch {
      continue;
    }
    if (!isSensitiveKey(key)) {
      continue;
    }
    const valueStart = fieldPattern.lastIndex;
    const valueEnd = jsonValueEnd(text, valueStart);
    if (valueEnd === valueStart) {
      continue;
    }
    // Replace only secret spans so response formatting and large integers remain intact.
    parts.push(text.slice(copiedUntil, valueStart), '"[REDACTED]"');
    copiedUntil = valueEnd;
    fieldPattern.lastIndex = valueEnd;
  }
  parts.push(text.slice(copiedUntil));
  return parts.join("");
}

export function redactSensitiveText(text: string): string {
  return redactJsonFields(stripUrlCredentials(text))
    .replace(/^(\s*(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*)(.+)$/gim, "$1[REDACTED]")
    .replace(/([?&])([^=&#\s]+)=([^&#\s"'<>`]*)/g, (match, separator: string, key: string) => (
      isSensitiveKey(key) ? `${separator}${key}=[REDACTED]` : match
    ))
    .replace(/('([^'\\]*)'\s*:\s*)'(?:[^'\\]|\\.)*'/g, (match, prefix: string, key: string) => (
      isSensitiveKey(key) ? `${prefix}'[REDACTED]'` : match
    ))
    .replace(/\b([a-z][\w-]*)\s*=\s*(?:\[REDACTED\]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s&"'<>`,;()[\]{}]+)/gi, (match, key: string) => (
      isSensitiveKey(key) ? `${key}=[REDACTED]` : match
    ));
}

export function redactSensitiveValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactSensitiveText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactSensitiveValue(item)) as T;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key)
        ? "[REDACTED]"
        : redactSensitiveValue(typeof item === "string" && /url$/i.test(key) ? stripUrlCredentialsFromUrl(item) : item),
    ])) as T;
  }
  return value;
}

export function redactSensitiveList(items: string[]) {
  return items.map(redactSensitiveText);
}
