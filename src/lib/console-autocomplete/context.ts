import type { ConnectionSearchMetadata, SavedRequest } from "../../types/requests";

export type ConsoleAutocompleteContext = {
  indexNames: string[];
  aliasNames: string[];
  historyTargetNames: string[];
  fieldNames: string[];
};

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function extractPathFromContent(content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!firstLine) {
    return "";
  }

  const [, ...pathParts] = firstLine.split(/\s+/);
  return pathParts.join(" ").trim();
}

function normalizeIndexName(value: string) {
  return value.trim().replace(/^["']+|["']+$/g, "");
}

export function extractIndexNamesFromPath(path: string) {
  const normalizedPath = (path.trim().split("?", 1)[0] ?? "").replace(/^\/+/, "");
  if (!normalizedPath) {
    return [];
  }

  const firstSegment = normalizedPath.split("/").filter(Boolean)[0] ?? "";
  if (!firstSegment || firstSegment.startsWith("_")) {
    return [];
  }

  return firstSegment
    .split(",")
    .map(normalizeIndexName)
    .filter(
      (item) =>
        item.length > 0 &&
        !item.startsWith("_") &&
        !item.includes("*") &&
        !item.includes("{") &&
        !item.includes("}") &&
        item !== "_all",
    );
}

type SearchMetadataInput = Partial<ConnectionSearchMetadata> & {
  fields?: string[];
  fieldsByIndex?: Record<string, string[]>;
  aliasToIndices?: Record<string, string[]>;
};

function resolveFieldNames(
  currentTargets: string[],
  metadata: SearchMetadataInput | null | undefined,
): string[] {
  const allFields = metadata?.fields ?? [];
  const fieldsByIndex = metadata?.fieldsByIndex ?? {};
  const aliasToIndices = metadata?.aliasToIndices ?? {};

  if (currentTargets.length === 0 || Object.keys(fieldsByIndex).length === 0) {
    return uniqueSorted(allFields);
  }

  const resolved = new Set<string>();
  let matchedAny = false;
  currentTargets.forEach((name) => {
    const direct = fieldsByIndex[name];
    if (direct && direct.length > 0) {
      matchedAny = true;
      direct.forEach((item) => resolved.add(item));
      return;
    }

    const aliasTargets = aliasToIndices[name];
    if (aliasTargets && aliasTargets.length > 0) {
      aliasTargets.forEach((indexName) => {
        const list = fieldsByIndex[indexName];
        if (list && list.length > 0) {
          matchedAny = true;
          list.forEach((item) => resolved.add(item));
        }
      });
    }
  });

  if (!matchedAny) {
    return uniqueSorted(allFields);
  }

  return uniqueSorted([...resolved]);
}

export function buildConsoleAutocompleteContext(
  requests: SavedRequest[],
  currentContent = "",
  metadata?: SearchMetadataInput | null,
): ConsoleAutocompleteContext {
  const currentPath = extractPathFromContent(currentContent);
  const currentTargets = extractIndexNamesFromPath(currentPath);
  const historyTargetNames = uniqueSorted([
    ...requests.flatMap((request) => extractIndexNamesFromPath(request.path)),
    ...currentTargets,
  ]);
  const indexNames = uniqueSorted([...(metadata?.indices ?? [])]);
  const aliasNames = uniqueSorted([...(metadata?.aliases ?? [])]);
  const fieldNames = resolveFieldNames(currentTargets, metadata);

  return {
    indexNames,
    aliasNames,
    fieldNames,
    historyTargetNames: historyTargetNames.filter(
      (item) => !indexNames.includes(item) && !aliasNames.includes(item),
    ),
  };
}
