export function flattenMappingFields(mapping: unknown): string[] {
  const byIndex = flattenMappingFieldsByIndex(mapping);
  const merged = new Set<string>();
  Object.values(byIndex).forEach((list) => list.forEach((item) => merged.add(item)));
  return [...merged].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function flattenMappingFieldsByIndex(mapping: unknown): Record<string, string[]> {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    return {};
  }

  const result: Record<string, string[]> = {};

  const walk = (node: unknown, pathSegments: string[], collected: Set<string>) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return;
    }

    const record = node as Record<string, unknown>;
    const properties = record.properties;
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      Object.entries(properties as Record<string, unknown>).forEach(([fieldName, fieldNode]) => {
        const nextPath = [...pathSegments, fieldName];
        collected.add(nextPath.join("."));
        walk(fieldNode, nextPath, collected);
      });
    }

    const fields = record.fields;
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
      Object.entries(fields as Record<string, unknown>).forEach(([subName, subNode]) => {
        const nextPath = [...pathSegments, subName];
        collected.add(nextPath.join("."));
        walk(subNode, nextPath, collected);
      });
    }
  };

  Object.entries(mapping as Record<string, unknown>).forEach(([indexName, indexNode]) => {
    if (!indexNode || typeof indexNode !== "object" || Array.isArray(indexNode)) {
      return;
    }

    const record = indexNode as Record<string, unknown>;
    const mappings = record.mappings;
    if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
      return;
    }

    const collected = new Set<string>();
    walk(mappings, [], collected);

    if (collected.size === 0) {
      return;
    }

    result[indexName] = [...collected].sort((left, right) => left.localeCompare(right, "zh-CN"));
  });

  return result;
}
