export type SearchSizeWarning = {
  level: "warning" | "danger";
  size: number;
  message: string;
};

function parseConsoleParts(content: string) {
  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  const lines = normalized.split(/\r?\n/);
  const firstLine = lines.shift()?.trim() ?? "";
  const [, ...pathParts] = firstLine.split(/\s+/);
  const path = pathParts.join(" ").trim();
  const bodyText = lines.join("\n").trim();

  return { path, bodyText };
}

function isSearchPath(path: string) {
  return /(^|\/)_search(\?|$|\/)/.test(path);
}

function collectJsonSizes(value: unknown): number[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectJsonSizes);
  }

  const record = value as Record<string, unknown>;
  const current = typeof record.size === "number" && Number.isFinite(record.size) ? [record.size] : [];
  return [...current, ...Object.values(record).flatMap(collectJsonSizes)];
}

function collectLooseSizes(bodyText: string) {
  return [...bodyText.matchAll(/(?:^|[,{]\s*)"?size"?\s*:\s*(\d+)/g)].map((match) => Number(match[1]));
}

export function getSearchSizeWarning(content: string): SearchSizeWarning | null {
  const parts = parseConsoleParts(content);
  if (!parts || !isSearchPath(parts.path) || !parts.bodyText) {
    return null;
  }

  let sizes: number[] = [];
  try {
    sizes = collectJsonSizes(JSON.parse(parts.bodyText));
  } catch {
    sizes = collectLooseSizes(parts.bodyText);
  }

  const size = Math.max(0, ...sizes);
  if (size >= 10000) {
    return {
      level: "danger",
      size,
      message: `当前 _search 请求 size 为 ${size}，返回体可能很大。建议改用分页、search_after、_source 过滤或更小 size。`,
    };
  }

  if (size >= 1000) {
    return {
      level: "warning",
      size,
      message: `当前 _search 请求 size 为 ${size}，返回内容可能偏大，建议确认是否需要这么多结果。`,
    };
  }

  return null;
}
