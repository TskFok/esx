import { invoke } from "@tauri-apps/api/core";
import type { SshTunnelConfig } from "../types/connections";

const SSH_AUTH_SECRET_KEY = "ssh-auth-secret";

export async function saveConnectionPassword(connectionId: string, username: string, password: string) {
  await invoke("save_connection_password", {
    connectionId,
    username,
    password,
  });
}

export async function getConnectionPassword(connectionId: string, username: string) {
  return invoke<string | null>("get_connection_password", {
    connectionId,
    username,
  });
}

export async function deleteConnectionPassword(connectionId: string, username: string) {
  await invoke("delete_connection_password", {
    connectionId,
    username,
  });
}

export async function saveConnectionSecret(connectionId: string, secretKey: string, secret: string) {
  await invoke("save_connection_secret", {
    connectionId,
    secretKey,
    secret,
  });
}

export async function getConnectionSecret(connectionId: string, secretKey: string) {
  return invoke<string | null>("get_connection_secret", {
    connectionId,
    secretKey,
  });
}

export async function deleteConnectionSecret(connectionId: string, secretKey: string) {
  await invoke("delete_connection_secret", {
    connectionId,
    secretKey,
  });
}

export async function saveConnectionSshSecret(connectionId: string, secret: string) {
  await saveConnectionSecret(connectionId, SSH_AUTH_SECRET_KEY, secret);
}

export async function getConnectionSshSecret(connectionId: string) {
  return getConnectionSecret(connectionId, SSH_AUTH_SECRET_KEY);
}

export async function deleteConnectionSshSecret(connectionId: string) {
  await deleteConnectionSecret(connectionId, SSH_AUTH_SECRET_KEY);
}

type ExecuteSshHttpRequestPayload = {
  url: string;
  method: string;
  username: string;
  password: string;
  bodyText: string;
  insecureTls: boolean;
  sshTunnel: SshTunnelConfig;
  sshSecret?: string | null;
};

type ValidateSshTunnelPayload = {
  sshTunnel: SshTunnelConfig;
  sshSecret?: string | null;
};

export type TauriHttpResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  bodyText: string;
  errorMessage?: string;
  diagnostics?: string[];
};

export type TauriTunnelValidationResponse = {
  ok: boolean;
  errorMessage?: string;
  diagnostics?: string[];
};

export async function executeSshHttpRequest(payload: ExecuteSshHttpRequestPayload) {
  return invoke<TauriHttpResponse>("execute_ssh_http_request", { payload });
}

export async function validateSshTunnel(payload: ValidateSshTunnelPayload) {
  return invoke<TauriTunnelValidationResponse>("validate_ssh_tunnel", { payload });
}
