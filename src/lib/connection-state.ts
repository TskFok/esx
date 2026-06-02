import type { createEmptyStorage } from "./storage";

type AppStorageState = ReturnType<typeof createEmptyStorage>;

export function removeConnectionsFromStorage(
  current: AppStorageState,
  connectionIds: Set<string>,
): AppStorageState | null {
  if (connectionIds.size === 0) {
    return null;
  }

  const nextConnections = current.connections.filter((item) => !connectionIds.has(item.id));
  const nextDrafts = { ...current.drafts };
  connectionIds.forEach((connectionId) => {
    delete nextDrafts[connectionId];
  });

  return {
    ...current,
    connections: nextConnections,
    requests: current.requests.filter((item) => !connectionIds.has(item.connectionId)),
    searchMetadata: Object.fromEntries(
      Object.entries(current.searchMetadata).filter(([connectionId]) => !connectionIds.has(connectionId)),
    ),
    drafts: nextDrafts,
    currentConnectionId:
      current.currentConnectionId && connectionIds.has(current.currentConnectionId)
        ? nextConnections[0]?.id ?? null
        : current.currentConnectionId,
  };
}
