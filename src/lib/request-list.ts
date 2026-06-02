import { matchesTagFilter, type RequestTagFilter } from "./request-tags";
import type { SavedRequest } from "../types/requests";

export const REQUEST_SORT_ORDER_STEP = 1000;

const zhNameSorter = new Intl.Collator("zh-CN");

export function compareSavedRequests(left: SavedRequest, right: SavedRequest) {
  const sortOrderDelta = left.sortOrder - right.sortOrder;
  if (sortOrderDelta !== 0) {
    return sortOrderDelta;
  }

  return (
    right.updatedAt.localeCompare(left.updatedAt) || zhNameSorter.compare(left.name, right.name)
  );
}

export function sortSavedRequests(requests: SavedRequest[]) {
  return [...requests].sort(compareSavedRequests);
}

export function getConnectionRequests(connectionId: string, savedRequests: SavedRequest[]) {
  return sortSavedRequests(savedRequests.filter((request) => request.connectionId === connectionId));
}

export function filterConnectionRequests(
  requests: SavedRequest[],
  params: {
    searchQuery?: string;
    tagFilter?: RequestTagFilter;
  },
) {
  const query = params.searchQuery?.trim().toLowerCase() ?? "";

  return requests.filter((request) => {
    if (!matchesTagFilter(request, params.tagFilter ?? "all")) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = [request.name, request.method, request.path, ...request.tags].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

export function computeNextSortOrder(requests: SavedRequest[]) {
  if (requests.length === 0) {
    return 0;
  }

  return Math.max(...requests.map((request) => request.sortOrder)) + REQUEST_SORT_ORDER_STEP;
}

export function buildSortOrdersFromIds(orderedIds: string[]) {
  return new Map(orderedIds.map((id, index) => [id, index * REQUEST_SORT_ORDER_STEP]));
}

export function reorderRequestIds(sourceIds: string[], draggedId: string, targetId: string) {
  if (draggedId === targetId) {
    return sourceIds;
  }

  const next = sourceIds.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) {
    return sourceIds;
  }

  next.splice(targetIndex, 0, draggedId);
  return next;
}

export function assignMissingSortOrders(requests: SavedRequest[]) {
  const grouped = new Map<string, SavedRequest[]>();

  requests.forEach((request) => {
    const bucket = grouped.get(request.connectionId) ?? [];
    bucket.push(request);
    grouped.set(request.connectionId, bucket);
  });

  const normalized: SavedRequest[] = [];

  grouped.forEach((group) => {
    const sorted = [...group].sort((left, right) => {
      const leftOrder = typeof left.sortOrder === "number" ? left.sortOrder : Number.POSITIVE_INFINITY;
      const rightOrder = typeof right.sortOrder === "number" ? right.sortOrder : Number.POSITIVE_INFINITY;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return compareSavedRequests(
        { ...left, sortOrder: 0 },
        { ...right, sortOrder: 0 },
      );
    });

    sorted.forEach((request, index) => {
      normalized.push({
        ...request,
        sortOrder: typeof request.sortOrder === "number" ? request.sortOrder : index * REQUEST_SORT_ORDER_STEP,
      });
    });
  });

  return normalized;
}
