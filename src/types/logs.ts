import type { SshAuthMethod } from "./connections";

export type ErrorLogScope = "connection-save" | "connection-test" | "request-execution";

export type ErrorLogConnectionContext = {
  name?: string;
  baseUrl?: string;
  username?: string;
  sshTunnelEnabled: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshAuthMethod?: SshAuthMethod;
};

export type ErrorLogRequestContext = {
  method?: string;
  path?: string;
  content?: string;
};

export type ErrorLogEntry = {
  id: string;
  createdAt: string;
  scope: ErrorLogScope;
  title: string;
  summary: string;
  diagnostics: string[];
  status?: number | null;
  rawResponse?: string;
  connection?: ErrorLogConnectionContext;
  request?: ErrorLogRequestContext;
};

export type ErrorLogSettings = {
  enabled: boolean;
  responsePreviewBytes: number;
};
