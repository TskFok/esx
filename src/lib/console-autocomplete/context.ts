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

const compareNames = new Intl.Collator("zh-CN").compare;

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort(compareNames);
}

function includesSorted(values: readonly string[], target: string) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const comparison = compareNames(values[middle], target);
    if (comparison < 0) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < values.length && compareNames(values[index], target) === 0; index += 1) {
    if (values[index] === target) return true;
  }
  return false;
}

function mergeSortedLists(lists: readonly (readonly string[])[]): string[] {
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0] as string[];

  type Cursor = { list: readonly string[]; offset: number; order: number };
  const heap: Cursor[] = [];
  const compare = (left: Cursor, right: Cursor) =>
    compareNames(left.list[left.offset], right.list[right.offset]) || left.order - right.order;
  const push = (cursor: Cursor) => {
    heap.push(cursor);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (compare(heap[parent], heap[index]) <= 0) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  };
  const pop = () => {
    const first = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        if (left >= heap.length) break;
        const right = left + 1;
        const child = right < heap.length && compare(heap[right], heap[left]) < 0 ? right : left;
        if (compare(heap[index], heap[child]) <= 0) break;
        [heap[index], heap[child]] = [heap[child], heap[index]];
        index = child;
      }
    }
    return first;
  };

  lists.forEach((list, order) => {
    if (list.length > 0) push({ list, offset: 0, order });
  });
  const result: string[] = [];
  const seen = new Set<string>();
  while (heap.length > 0) {
    const cursor = pop();
    const value = cursor.list[cursor.offset];
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
    cursor.offset += 1;
    if (cursor.offset < cursor.list.length) push(cursor);
  }
  return result;
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

  const lists: (readonly string[])[] = [];
  const seenLists = new Set<readonly string[]>();
  const addList = (list: readonly string[]) => {
    if (!seenLists.has(list)) {
      seenLists.add(list);
      lists.push(list);
    }
  };
  currentTargets.forEach((name) => {
    const direct = fieldsByIndex[name];
    if (direct && direct.length > 0) {
      addList(stable.fieldNamesByTarget[name] ?? []);
      return;
    }

    const aliasTargets = aliasToIndices[name];
    if (aliasTargets && aliasTargets.length > 0) {
      if (aliasTargets.every((indexName) =>
        Object.prototype.hasOwnProperty.call(stable.fieldNamesByTarget, indexName))) {
        const aliasFields = stable.fieldNamesByTarget[name];
        if (aliasFields && aliasFields.length > 0) {
          addList(aliasFields);
          return;
        }
      }
      aliasTargets.forEach((indexName) => {
        const list = fieldsByIndex[indexName];
        if (list && list.length > 0) {
          addList(stable.fieldNamesByTarget[indexName] ?? []);
        }
      });
    }
  });

  if (lists.length === 0) {
    return allFields;
  }

  return mergeSortedLists(lists);
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
  const historyTargets = currentTargets.filter((item) =>
    !includesSorted(stable.indexNames, item) && !includesSorted(stable.aliasNames, item));
  const historyTargetNames = historyTargets.length === 0
    ? stable.savedHistoryTargetNames
    : mergeSortedLists([stable.savedHistoryTargetNames, ...historyTargets.map((item) => [item])]);

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
