import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchClusterOverview, fetchIndicesStatus, fetchOperationsStatus } from "./http-client";
import { useAppState } from "../providers/app-state";
import type { ConnectionProfile } from "../types/connections";
import type {
  ClusterOverviewSnapshot,
  IndicesStatusSnapshot,
  OperationsStatusSnapshot,
} from "../types/status";

export const STATUS_TAB_STALE_TIME = 30_000;

export type StatusTab = "overview" | "operations" | "indices";

export type StatusTabSnapshot<T extends StatusTab> = T extends "overview"
  ? ClusterOverviewSnapshot
  : T extends "operations"
    ? OperationsStatusSnapshot
    : IndicesStatusSnapshot;

export function statusTabQueryKey(
  connection: Pick<ConnectionProfile, "id" | "updatedAt">,
  tab: StatusTab,
) {
  return ["server-status", connection.id, connection.updatedAt, tab] as const;
}

export function useStatusTabQuery<T extends StatusTab>(
  connection: ConnectionProfile,
  tab: T,
  enabled: boolean,
): UseQueryResult<StatusTabSnapshot<T>> {
  const { getPassword, getSshSecret, getSshProfileForConnection } = useAppState();

  return useQuery({
    queryKey: statusTabQueryKey(connection, tab),
    queryFn: async () => {
      const sshProfile = getSshProfileForConnection(connection);
      const [password, sshSecret] = await Promise.all([
        getPassword(connection),
        getSshSecret(sshProfile),
      ]);
      if (!password) {
        throw new Error("当前连接未找到已保存密码，请回到连接页重新保存。");
      }

      const credentials = { password, sshSecret };
      const sshTunnel = sshProfile?.tunnel ?? null;

      if (tab === "overview") {
        return fetchClusterOverview(connection, credentials, sshTunnel) as Promise<StatusTabSnapshot<T>>;
      }
      if (tab === "operations") {
        return fetchOperationsStatus(connection, credentials, sshTunnel) as Promise<StatusTabSnapshot<T>>;
      }
      return fetchIndicesStatus(connection, credentials, sshTunnel) as Promise<StatusTabSnapshot<T>>;
    },
    enabled,
    staleTime: STATUS_TAB_STALE_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}
