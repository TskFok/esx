import { parseConsoleRequest } from "./console-parser";
import type { ConnectionFormValues, ConnectionProfile, SshProfile, SshProfileFormValues } from "../types/connections";
import type { ErrorLogConnectionContext, ErrorLogRequestContext } from "../types/logs";

export function buildConnectionLogContextFromProfile(
  connection: ConnectionProfile,
  sshProfile?: SshProfile | null,
): ErrorLogConnectionContext {
  return {
    name: connection.name,
    baseUrl: connection.baseUrl,
    username: connection.username,
    sshTunnelEnabled: Boolean(sshProfile),
    sshHost: sshProfile?.tunnel.host,
    sshPort: sshProfile?.tunnel.port,
    sshUsername: sshProfile?.tunnel.username,
    sshAuthMethod: sshProfile?.tunnel.authMethod,
  };
}

export function buildConnectionLogContextFromForm(
  formValues: ConnectionFormValues,
  sshProfile?: SshProfile | null,
): ErrorLogConnectionContext {
  return {
    name: formValues.name.trim() || undefined,
    baseUrl: formValues.baseUrl.trim() || undefined,
    username: formValues.username.trim() || undefined,
    sshTunnelEnabled: Boolean(formValues.sshProfileId.trim()),
    sshHost: sshProfile?.tunnel.host,
    sshPort: sshProfile?.tunnel.port,
    sshUsername: sshProfile?.tunnel.username,
    sshAuthMethod: sshProfile?.tunnel.authMethod,
  };
}

export function buildSshLogContextFromForm(formValues: SshProfileFormValues): ErrorLogConnectionContext {
  return {
    name: formValues.name.trim() || undefined,
    sshTunnelEnabled: true,
    sshHost: formValues.sshHost.trim() || undefined,
    sshPort: Number.parseInt(formValues.sshPort.trim(), 10) || undefined,
    sshUsername: formValues.sshUsername.trim() || undefined,
    sshAuthMethod: formValues.sshAuthMethod,
  };
}

export function buildRequestLogContext(content: string): ErrorLogRequestContext {
  try {
    const parsed = parseConsoleRequest(content);
    return {
      method: parsed.method,
      path: parsed.path,
      content,
    };
  } catch {
    return {
      content,
    };
  }
}
