export type SshAuthMethod = "password" | "privateKey";

export type ConnectionAuthType = "basic" | "apiKey" | "bearer";

export type ConnectionAuthConfig = {
  type: ConnectionAuthType;
};

export type ConnectionTlsMode = "default" | "insecure" | "caCertificate" | "certificateFingerprint";

export type ConnectionTlsConfig = {
  mode: ConnectionTlsMode;
  caPath?: string;
  fingerprint?: string;
};

export type ConnectionEnvironment = "dev" | "test" | "staging" | "prod";

export type SshHostKeyPolicy = "trustOnFirstUse" | "strict";

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
  hostKeyPolicy: SshHostKeyPolicy;
  trustedHostKeySha256: string | null;
};

export type ConnectionProfile = {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  auth: ConnectionAuthConfig;
  tls: ConnectionTlsConfig;
  environment: ConnectionEnvironment;
  readonly: boolean;
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
  authType: ConnectionAuthType;
  username: string;
  password: string;
  apiKey: string;
  bearerToken: string;
  tlsMode: ConnectionTlsMode;
  tlsCaPath: string;
  tlsFingerprint: string;
  insecureTls: boolean;
  environment: ConnectionEnvironment;
  readonly: boolean;
  allowInsecureProductionTls: boolean;
  sshProfileId: string;
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
