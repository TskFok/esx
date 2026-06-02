import type { ConnectionProfile, SshProfile } from "../types/connections";

export function buildConnectionDeleteDescription(connection: Pick<ConnectionProfile, "name">) {
  return `确定删除连接“${connection.name}”吗？该连接下的已保存请求也会一起删除。`;
}

export function buildSshProfileDeleteDescription(profile: Pick<SshProfile, "name">, usedByCount: number) {
  const base = `确定删除 SSH 通道“${profile.name}”吗？`;
  if (usedByCount > 0) {
    return `${base}当前有 ${usedByCount} 个连接正在使用该通道，删除后会自动取消关联。`;
  }
  return `${base}删除后该通道无法恢复。`;
}
