import type { ConnectionSearchMetadata, SavedRequest } from "../../types/requests";
import { DEFAULT_CLUSTER_METADATA, normalizeClusterMetadata } from "./capabilities";
import {
  parseConsoleRequestContext,
  type ConsoleRequestContext,
} from "./request-context";

export interface ConsoleAutocompleteContext {
  indexNames: string[];
  aliasNames: string[];
  historyTargetNames: string[];
  fieldNames: string[];
  readonly fieldNamesByTarget: Readonly<Record<string, readonly string[]>>;
  cluster: typeof DEFAULT_CLUSTER_METADATA;
  request: ConsoleRequestContext;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "zh-CN"));
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

export type SearchMetadataInput = Partial<ConnectionSearchMetadata> & {
  fields?: string[];
  fieldsByIndex?: Record<string, string[]>;
  aliasToIndices?: Record<string, string[]>;
};

export type ConsoleAutocompleteStaticContext = Pick<
  ConsoleAutocompleteContext,
  "indexNames" | "aliasNames" | "fieldNamesByTarget" | "cluster"
> & {
  savedHistoryTargetNames: string[];
  metadata: SearchMetadataInput | null;
};

function resolveFieldNames(
  currentTargets: string[],
  stable: ConsoleAutocompleteStaticContext,
): string[] {
  const allFields = stable.metadata?.fields ?? [];
  const fieldsByIndex = stable.metadata?.fieldsByIndex ?? {};
  const aliasToIndices = stable.metadata?.aliasToIndices ?? {};

  if (currentTargets.length === 0) {
    return allFields;
  }

  const resolved = new Set<string>();
  let matchedAny = false;
  currentTargets.forEach((name) => {
    const direct = fieldsByIndex[name];
    if (direct && direct.length > 0) {
      matchedAny = true;
      stable.fieldNamesByTarget[name]?.forEach((item) => resolved.add(item));
      return;
    }

    const aliasTargets = aliasToIndices[name];
    if (aliasTargets && aliasTargets.length > 0) {
      aliasTargets.forEach((indexName) => {
        const list = fieldsByIndex[indexName];
        if (list && list.length > 0) {
          matchedAny = true;
          stable.fieldNamesByTarget[indexName]?.forEach((item) => resolved.add(item));
        }
      });
    }
  });

  if (!matchedAny) {
    return allFields;
  }

  return uniqueSorted([...resolved]);
}

function buildFieldNamesByTarget(
  metadata: SearchMetadataInput | null | undefined,
): Readonly<Record<string, readonly string[]>> {
  const fieldsByIndex = metadata?.fieldsByIndex ?? {};
  const aliasToIndices = metadata?.aliasToIndices ?? {};
  const result: Record<string, readonly string[]> = {};
  const indexNames = uniqueSorted([
    ...(metadata?.indices ?? []),
    ...Object.keys(fieldsByIndex),
  ]);

  indexNames.forEach((indexName) => {
    result[indexName] = uniqueSorted([...(fieldsByIndex[indexName] ?? [])]);
  });

  uniqueSorted([...(metadata?.aliases ?? []), ...Object.keys(aliasToIndices)]).forEach(
    (aliasName) => {
      const indexTargets = aliasToIndices[aliasName] ?? [];
      if (
        indexTargets.length === 0 ||
        indexTargets.some((indexName) => !Object.prototype.hasOwnProperty.call(result, indexName))
      ) {
        result[aliasName] = [];
        return;
      }

      result[aliasName] = uniqueSorted(
        indexTargets.flatMap((indexName) => [...(result[indexName] ?? [])]),
      );
    },
  );

  return result;
}

export function resolveFieldNamesForTargets(
  targetNames: readonly string[],
  fieldNamesByTarget: Readonly<Record<string, readonly string[]>>,
) {
  if (
    targetNames.length === 0 ||
    targetNames.some((targetName) =>
      !Object.prototype.hasOwnProperty.call(fieldNamesByTarget, targetName)
    )
  ) {
    return [];
  }

  return uniqueSorted(
    targetNames.flatMap((targetName) => [...(fieldNamesByTarget[targetName] ?? [])]),
  );
}

export function buildConsoleAutocompleteStaticContext(
  requests: SavedRequest[],
  metadata?: SearchMetadataInput | null,
): ConsoleAutocompleteStaticContext {
  const indexNames = uniqueSorted([...(metadata?.indices ?? [])]);
  const aliasNames = uniqueSorted([...(metadata?.aliases ?? [])]);
  const fieldNamesByTarget = buildFieldNamesByTarget(metadata);
  const cluster = normalizeClusterMetadata(metadata?.cluster);
  const knownTargets = new Set([...indexNames, ...aliasNames]);
  const savedHistoryTargetNames = uniqueSorted(
    requests.flatMap((request) => extractIndexNamesFromPath(request.path))
      .filter((item) => !knownTargets.has(item)),
  );

  return {
    indexNames,
    aliasNames,
    fieldNamesByTarget,
    cluster,
    savedHistoryTargetNames,
    metadata: metadata ? { ...metadata, fields: uniqueSorted(metadata.fields ?? []) } : null,
  };
}

export function buildConsoleAutocompleteContextForRequest(
  stable: ConsoleAutocompleteStaticContext,
  firstLine: string,
): ConsoleAutocompleteContext {
  const request = parseConsoleRequestContext(firstLine);
  const currentTargets = extractIndexNamesFromPath(request.path);
  const historyTargetNames = uniqueSorted([
    ...stable.savedHistoryTargetNames,
    ...currentTargets.filter((item) =>
      !stable.indexNames.includes(item) && !stable.aliasNames.includes(item)),
  ]);

  return {
    indexNames: stable.indexNames,
    aliasNames: stable.aliasNames,
    fieldNames: resolveFieldNames(currentTargets, stable),
    fieldNamesByTarget: stable.fieldNamesByTarget,
    cluster: stable.cluster,
    request,
    historyTargetNames,
  };
}

export function buildConsoleAutocompleteContext(
  requests: SavedRequest[],
  currentContent = "",
  metadata?: SearchMetadataInput | null,
): ConsoleAutocompleteContext {
  return buildConsoleAutocompleteContextForRequest(
    buildConsoleAutocompleteStaticContext(requests, metadata),
    currentContent,
  );
}
