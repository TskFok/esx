import type { ConnectionSearchMetadata } from "../types/requests";
import type { TargetMappingFieldsResult } from "./http-client";

export const TARGET_FIELDS_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_INDICES = 100;
const MAX_FIELDS_PER_INDEX = 2000;
const sortedUnique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "zh-CN"));

export function normalizeFieldCache(cache: ConnectionSearchMetadata): ConnectionSearchMetadata {
  const fieldsByIndex: Record<string, string[]> = {};
  const fieldsFetchedAtByIndex: Record<string, string> = {};
  const fieldsTruncatedByIndex: Record<string, boolean> = {};
  const timestamp = (name: string) => Date.parse(cache.fieldsFetchedAtByIndex?.[name] ?? "") || 0;
  Object.keys(cache.fieldsByIndex ?? {})
    .sort((a, b) => timestamp(b) - timestamp(a) || a.localeCompare(b, "zh-CN"))
    .slice(0, MAX_CACHED_INDICES)
    .forEach((name) => {
      const fields = sortedUnique((cache.fieldsByIndex[name] ?? []).filter((field) => typeof field === "string" && field.trim()).map((field) => field.trim()));
      if (fields.length === 0) return;
      fieldsByIndex[name] = fields.slice(0, MAX_FIELDS_PER_INDEX);
      const fetchedAt = cache.fieldsFetchedAtByIndex?.[name];
      if (fetchedAt && Number.isFinite(Date.parse(fetchedAt))) fieldsFetchedAtByIndex[name] = fetchedAt;
      if (fields.length > MAX_FIELDS_PER_INDEX || cache.fieldsTruncatedByIndex?.[name]) fieldsTruncatedByIndex[name] = true;
    });
  return {
    ...cache,
    fieldsByIndex,
    fields: sortedUnique(Object.values(fieldsByIndex).flat()),
    fieldsFetchedAtByIndex,
    fieldsTruncatedByIndex,
    fieldsCacheTruncated: Object.keys(cache.fieldsByIndex ?? {}).length > MAX_CACHED_INDICES || cache.fieldsCacheTruncated === true,
  };
}

export function resolveFieldTargets(cache: ConnectionSearchMetadata | null, targets: string[]) {
  return sortedUnique(targets.flatMap((target) => {
    const indices = cache?.aliasToIndices[target];
    return indices?.length ? indices : [target];
  }));
}

export function hasFreshTargetFields(cache: ConnectionSearchMetadata | null, targets: string[], nowMs: number) {
  return Boolean(cache) && targets.length > 0 && resolveFieldTargets(cache, targets).every((name) => {
    const fetchedAt = Date.parse(cache?.fieldsFetchedAtByIndex?.[name] ?? "");
    return (cache?.fieldsByIndex[name]?.length ?? 0) > 0 && Number.isFinite(fetchedAt)
      && nowMs >= fetchedAt && nowMs - fetchedAt < TARGET_FIELDS_TTL_MS;
  });
}

export function mergeTargetFields(
  cache: ConnectionSearchMetadata,
  result: TargetMappingFieldsResult,
  nowMs: number,
): ConnectionSearchMetadata {
  const fieldsByIndex = { ...cache.fieldsByIndex };
  const fieldsFetchedAtByIndex = { ...cache.fieldsFetchedAtByIndex };
  const fieldsTruncatedByIndex = { ...cache.fieldsTruncatedByIndex };
  for (const [name, fields] of Object.entries(result.fieldsByIndex)) {
    fieldsByIndex[name] = fields;
    delete fieldsTruncatedByIndex[name];
    if (fields.length) fieldsFetchedAtByIndex[name] = new Date(nowMs).toISOString();
    else delete fieldsFetchedAtByIndex[name];
  }
  const aliasToIndices = { ...cache.aliasToIndices };
  const names = Object.keys(result.fieldsByIndex);
  const onlyTarget = result.requestedNames.length === 1 ? result.requestedNames[0] : null;
  // A response to multiple targets cannot tell us which alias owns each index.
  if (onlyTarget && names.length > 0 && !names.includes(onlyTarget) && !aliasToIndices[onlyTarget]?.length) {
    aliasToIndices[onlyTarget] = sortedUnique(names);
  }
  return normalizeFieldCache({
    ...cache, fieldsByIndex, fieldsFetchedAtByIndex, fieldsTruncatedByIndex, aliasToIndices,
    indices: sortedUnique([...cache.indices, ...names]),
  });
}

export function clearTargetFields(cache: ConnectionSearchMetadata, targets: string[]) {
  const removed = new Set(resolveFieldTargets(cache, targets));
  return normalizeFieldCache({
    ...cache,
    fieldsByIndex: Object.fromEntries(Object.entries(cache.fieldsByIndex).filter(([name]) => !removed.has(name))),
  });
}
