import { invoke } from "@tauri-apps/api/core";
import type { SecretsMigrationHint, SecretsVaultStatus } from "./secrets-vault";
import type { ConnectionAuthConfig, ConnectionTlsConfig, SshTunnelConfig } from "../types/connections";

const SSH_AUTH_SECRET_KEY = "ssh-auth-secret";

export async function loadSecretsVault(hint: SecretsMigrationHint) {
  return invoke<SecretsVaultStatus>("load_secrets_vault", { hint });
}

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

export async function saveAiApiKey(apiKey: string) {
  await invoke("save_ai_api_key", { apiKey });
}

export async function getAiApiKey() {
  return invoke<string | null>("get_ai_api_key");
}

export async function deleteAiApiKey() {
  await invoke("delete_ai_api_key");
}

type ExecuteSshHttpRequestPayload = {
  url: string;
  method: string;
  auth: ConnectionAuthConfig;
  username: string;
  password: string;
  authSecret: string;
  bodyText: string;
  contentType?: string | null;
  insecureTls: boolean;
  sshTunnel: SshTunnelConfig;
  sshSecret?: string | null;
};

type ExecuteEsHttpRequestPayload = {
  url: string;
  method: string;
  auth: ConnectionAuthConfig;
  username: string;
  password: string;
  authSecret: string;
  bodyText: string;
  contentType?: string | null;
  insecureTls: boolean;
  tls: ConnectionTlsConfig;
};

type ValidateEsConnectionPayload = {
  baseUrl: string;
  auth: ConnectionAuthConfig;
  username: string;
  password: string;
  authSecret: string;
  insecureTls: boolean;
  tls: ConnectionTlsConfig;
};

type ExecuteAiHttpRequestPayload = {
  url: string;
  method: string;
  apiKey?: string | null;
  bodyText?: string | null;
  contentType?: string | null;
  accept?: string | null;
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
  hostKeySha256?: string | null;
  errorMessage?: string;
  diagnostics?: string[];
};

export async function executeSshHttpRequest(payload: ExecuteSshHttpRequestPayload) {
  return invoke<TauriHttpResponse>("execute_ssh_http_request", { payload });
}

export async function executeEsHttpRequest(payload: ExecuteEsHttpRequestPayload) {
  return invoke<TauriHttpResponse>("execute_es_http_request", { payload });
}

export async function validateEsConnection(payload: ValidateEsConnectionPayload) {
  return invoke<TauriHttpResponse>("validate_es_connection", { payload });
}

export async function executeAiHttpRequest(payload: ExecuteAiHttpRequestPayload) {
  return invoke<TauriHttpResponse>("execute_ai_http_request", { payload });
}

export async function validateSshTunnel(payload: ValidateSshTunnelPayload) {
  return invoke<TauriTunnelValidationResponse>("validate_ssh_tunnel", { payload });
}
