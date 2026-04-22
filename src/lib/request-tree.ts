import type { RequestModule, RequestProject, SavedRequest } from "../types/requests";

export type RequestTreeModuleNode = RequestModule & {
  requests: SavedRequest[];
  requestCount: number;
};

export type RequestTreeProjectNode = RequestProject & {
  modules: RequestTreeModuleNode[];
  requestCount: number;
};

const zhNameSorter = new Intl.Collator("zh-CN");

function compareByUpdatedAt<T extends { updatedAt: string; name: string }>(left: T, right: T) {
  return right.updatedAt.localeCompare(left.updatedAt) || zhNameSorter.compare(left.name, right.name);
}

function compareRequests(left: SavedRequest, right: SavedRequest) {
  return right.updatedAt.localeCompare(left.updatedAt) || zhNameSorter.compare(left.name, right.name);
}

export function buildRequestProjectTree(
  connectionId: string,
  requestProjects: RequestProject[],
  requestModules: RequestModule[],
  savedRequests: SavedRequest[],
) {
  const projects = requestProjects.filter((project) => project.connectionId === connectionId).sort(compareByUpdatedAt);
  const projectIds = new Set(projects.map((project) => project.id));
  const modules = requestModules.filter((module) => projectIds.has(module.projectId)).sort(compareByUpdatedAt);
  const requests = savedRequests.filter((request) => request.connectionId === connectionId).sort(compareRequests);

  const requestsByModuleId = new Map<string, SavedRequest[]>();
  requests.forEach((request) => {
    if (!request.moduleId) {
      return;
    }

    const bucket = requestsByModuleId.get(request.moduleId) ?? [];
    bucket.push(request);
    requestsByModuleId.set(request.moduleId, bucket);
  });

  const modulesByProjectId = new Map<string, RequestTreeModuleNode[]>();
  modules.forEach((module) => {
    const bucket = modulesByProjectId.get(module.projectId) ?? [];
    const moduleRequests = requestsByModuleId.get(module.id) ?? [];
    bucket.push({
      ...module,
      requests: moduleRequests,
      requestCount: moduleRequests.length,
    });
    modulesByProjectId.set(module.projectId, bucket);
  });

  return projects.map((project) => {
    const projectModules = modulesByProjectId.get(project.id) ?? [];
    return {
      ...project,
      modules: projectModules,
      requestCount: projectModules.reduce((total, module) => total + module.requestCount, 0),
    } satisfies RequestTreeProjectNode;
  });
}
