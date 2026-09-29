import { Channel, invoke } from "@tauri-apps/api/core";
import type { SecretsMigrationHint, SecretsVaultStatus } from "./secrets-vault";
import type { ConnectionAuthConfig, ConnectionTlsConfig, SshTunnelConfig } from "../types/connections";

import { checkRequestAbort, requestAbortError } from "./request-cancellation";

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

export async function saveAiApiKey(apiKey: string, baseUrl: string) {
  await invoke("save_ai_api_key", { apiKey, baseUrl });
}

export async function getAiApiKey(baseUrl: string) {
  return invoke<string | null>("get_ai_api_key", { baseUrl });
}

export async function deleteAiApiKey() {
  await invoke("delete_ai_api_key");
}

type ExecuteSshHttpRequestPayload = {
  baseUrl: string;
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
  sshTunnel: SshTunnelConfig;
  sshSecret?: string | null;
  requestId?: string;
  readMode?: "full" | "preview";
  previewBytes?: number;
};

type ExecuteEsHttpRequestPayload = {
  baseUrl: string;
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
  readMode?: "full" | "preview";
  previewBytes?: number;
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

export type ExecuteAiHttpRequestPayload = {
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
  totalBytes?: number;
  truncated?: boolean;
  errorMessage?: string;
  diagnostics?: string[];
};

export type TauriTunnelValidationResponse = {
  ok: boolean;
  hostKeySha256?: string | null;
  errorMessage?: string;
  diagnostics?: string[];
};

export async function executeSshHttpRequest(payload: ExecuteSshHttpRequestPayload, signal?: AbortSignal) {
  checkRequestAbort(signal);
  const requestId = crypto.randomUUID();
  const request = invoke<TauriHttpResponse>("execute_ssh_http_request", { payload: { ...payload, requestId } });
  if (!signal) return request;
  return new Promise<TauriHttpResponse>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      void invoke("cancel_ssh_http_request", { requestId }).catch(() => undefined);
      reject(requestAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    request.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
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

export type AiStreamEvent = {
  requestId: string;
  sequence: number;
  kind: "headers" | "chunk" | "done" | "error";
  status?: number;
  statusText?: string;
  text?: string;
};

export async function openAiHttpStream(payload: ExecuteAiHttpRequestPayload, signal?: AbortSignal): Promise<Response> {
  checkRequestAbort(signal);
  const requestId = crypto.randomUUID();
  const channel = new Channel<AiStreamEvent>();
  const encoder = new TextEncoder();
  const queue: Array<{ sequence: number; bytes: Uint8Array }> = [];
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let pendingPull: (() => void) | undefined;
  let headersReceived = false;
  let done = false;
  let closed = false;
  let cancelSent = false;
  let lastSequence = -1;
  let resolveResponse!: (response: Response) => void;
  let rejectResponse!: (reason: unknown) => void;
  const response = new Promise<Response>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });

  function detach() {
    signal?.removeEventListener("abort", onAbort);
    // Channel's native drop sends its end marker and unregisters the callback.
    // Detach the application handler immediately so late events retain no UI state.
    channel.onmessage = () => {};
  }
  function cancelNative() {
    if (cancelSent) return;
    cancelSent = true;
    void invoke("cancel_ai_http_request", { requestId }).catch(() => undefined);
  }
  function fail(reason: unknown) {
    if (closed) return;
    closed = true;
    queue.length = 0;
    detach();
    rejectResponse(reason);
    controller.error(reason);
    pendingPull?.();
    pendingPull = undefined;
  }
  function onAbort() { cancelNative(); fail(requestAbortError()); }
  function deliver() {
    if (closed) return;
    if (done && queue.length === 0) {
      closed = true;
      controller.close();
      detach();
      pendingPull?.();
      pendingPull = undefined;
      return;
    }
    if (!pendingPull) return;
    const next = queue.shift();
    if (next) {
      controller.enqueue(next.bytes);
      void invoke("ack_ai_stream_chunk", { requestId, sequence: next.sequence }).catch((error) => {
        cancelNative(); fail(error);
      });
    } else return;
    const resolve = pendingPull;
    pendingPull = undefined;
    resolve();
  }
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    pull() { return new Promise<void>((resolve) => { pendingPull = resolve; deliver(); }); },
    cancel() {
      closed = true;
      queue.length = 0;
      detach();
      pendingPull?.();
      pendingPull = undefined;
      cancelNative();
    },
  }, { highWaterMark: 0 });

  channel.onmessage = (event) => {
    if (closed || done || event.requestId !== requestId || event.sequence <= lastSequence) return;
    lastSequence = event.sequence;
    if (event.kind === "headers") {
      if (headersReceived) return;
      headersReceived = true;
      try {
        const status = event.status ?? 200;
        const noBody = [204, 205, 304].includes(status);
        resolveResponse(new Response(noBody ? null : body, {
          status, statusText: event.statusText ?? "", headers: { "Content-Type": "text/event-stream" },
        }));
      } catch (error) { cancelNative(); fail(error); }
    } else if (event.kind === "chunk") {
      const bytes = encoder.encode(event.text ?? "");
      if (!headersReceived || queue.length >= 8 || bytes.byteLength > 8192) {
        cancelNative(); fail(new Error("AI 流式通道超出协议限制。")); return;
      }
      queue.push({ sequence: event.sequence, bytes });
      deliver();
    } else if (event.kind === "done") {
      if (!headersReceived) { fail(new Error("AI 流式通道缺少响应头。")); return; }
      done = true;
      channel.onmessage = () => {};
      deliver();
    } else {
      fail(new Error(event.text || "AI 流式请求失败。"));
    }
  };
  const request = invoke<void>("execute_ai_http_request_stream", { payload, requestId, onEvent: channel });
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  // invoke 可先于 Channel 的异步 IPC 交付完成；终态只由 Channel 事件决定。
  void request.catch(fail);
  return response;
}
