export function normalizeRequestTags(tags: string[] | undefined | null): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "zh-CN"),
  );
}

export function parseTagsInput(input: string): string[] {
  return normalizeRequestTags(input.split(/[,，]/));
}

export function formatTagsInput(tags: string[]): string {
  return tags.join("，");
}

export type RequestTagFilter = "all" | "untagged" | string;

export function collectConnectionTags(requests: Array<{ tags?: string[] | null }>): string[] {
  const tags = new Set<string>();
  requests.forEach((request) => {
    normalizeRequestTags(request.tags).forEach((tag) => tags.add(tag));
  });
  return [...tags].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function matchesTagFilter(request: { tags?: string[] | null }, tagFilter: RequestTagFilter): boolean {
  const tags = normalizeRequestTags(request.tags);

  if (tagFilter === "all") {
    return true;
  }

  if (tagFilter === "untagged") {
    return tags.length === 0;
  }

  return tags.includes(tagFilter);
}

export function mergeTagChanges(tags: string[], add: string[], remove: string[]) {
  const removeSet = new Set(normalizeRequestTags(remove));
  const kept = normalizeRequestTags(tags).filter((tag) => !removeSet.has(tag));
  return normalizeRequestTags([...kept, ...add]);
}
