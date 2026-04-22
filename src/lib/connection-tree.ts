import type {
  ConnectionProfile,
  ModuleProfile,
  ProjectProfile,
} from "../types/connections";

export type ConnectionModuleNode = ModuleProfile & {
  connections: ConnectionProfile[];
  connectionCount: number;
};

export type ConnectionProjectNode = ProjectProfile & {
  modules: ConnectionModuleNode[];
  connectionCount: number;
};

const zhNameSorter = new Intl.Collator("zh-CN");

function compareByUpdatedAt<T extends { updatedAt: string; name: string }>(left: T, right: T) {
  return right.updatedAt.localeCompare(left.updatedAt) || zhNameSorter.compare(left.name, right.name);
}

function compareByLastUsedAt(left: ConnectionProfile, right: ConnectionProfile) {
  return right.lastUsedAt.localeCompare(left.lastUsedAt) || zhNameSorter.compare(left.name, right.name);
}

export function buildConnectionProjectTree(
  projects: ProjectProfile[],
  modules: ModuleProfile[],
  connections: ConnectionProfile[],
) {
  const sortedConnections = [...connections].sort(compareByLastUsedAt);
  const connectionsByModuleId = new Map<string, ConnectionProfile[]>();

  sortedConnections.forEach((connection) => {
    if (!connection.moduleId) {
      return;
    }

    const bucket = connectionsByModuleId.get(connection.moduleId) ?? [];
    bucket.push(connection);
    connectionsByModuleId.set(connection.moduleId, bucket);
  });

  const modulesByProjectId = new Map<string, ConnectionModuleNode[]>();

  [...modules]
    .sort(compareByUpdatedAt)
    .forEach((module) => {
      const bucket = modulesByProjectId.get(module.projectId) ?? [];
      const moduleConnections = connectionsByModuleId.get(module.id) ?? [];

      bucket.push({
        ...module,
        connections: moduleConnections,
        connectionCount: moduleConnections.length,
      });

      modulesByProjectId.set(module.projectId, bucket);
    });

  return [...projects].sort(compareByUpdatedAt).map((project) => {
    const projectModules = modulesByProjectId.get(project.id) ?? [];

    return {
      ...project,
      modules: projectModules,
      connectionCount: projectModules.reduce((count, module) => count + module.connectionCount, 0),
    } satisfies ConnectionProjectNode;
  });
}
