export type SshAuthMethod = "password" | "privateKey";

export type SshTunnelConfig = {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  privateKeyPath: string;
};

export type SshProfile = {
  id: string;
  name: string;
  tunnel: SshTunnelConfig;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string;
};

export type ProjectProfile = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ModuleProfile = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionProfile = {
  id: string;
  name: string;
  moduleId: string | null;
  baseUrl: string;
  username: string;
  insecureTls: boolean;
  sshProfileId: string | null;
  sshTunnel?: SshTunnelConfig | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
};

export type ConnectionFormValues = {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  insecureTls: boolean;
  sshProfileId: string;
};

export type ProjectFormValues = {
  name: string;
};

export type ModuleFormValues = {
  name: string;
};

export type SshProfileFormValues = {
  name: string;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshAuthMethod: SshAuthMethod;
  sshPassword: string;
  sshPrivateKeyPath: string;
  sshPassphrase: string;
};
