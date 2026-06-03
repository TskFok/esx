const SENSITIVE_KEYS = [
  "authorization",
  "password",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "secret",
  "private_key",
  "privatekey",
  "passphrase",
];

const SENSITIVE_KEY_PATTERN = SENSITIVE_KEYS.join("|");

export function redactSensitiveText(text: string) {
  return text
    .replace(/^(\s*Authorization\s*:\s*)(.+)$/gim, "$1[REDACTED]")
    .replace(new RegExp(`("(?:${SENSITIVE_KEY_PATTERN})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "gi"), '$1"[REDACTED]"')
    .replace(new RegExp(`('\\b(?:${SENSITIVE_KEY_PATTERN})\\b'\\s*:\\s*)'(?:[^'\\\\]|\\\\.)*'`, "gi"), "$1'[REDACTED]'")
    .replace(new RegExp(`\\b(${SENSITIVE_KEY_PATTERN})\\b\\s*=\\s*([^\\s&]+)`, "gi"), "$1=[REDACTED]");
}

export function redactSensitiveList(items: string[]) {
  return items.map(redactSensitiveText);
}
