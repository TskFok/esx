import type { ConnectionFormValues, SshProfileFormValues } from "../types/connections";

export type ConnectionEditorMode = "idle" | "create" | "edit";

export type ConnectionEditorLeaveReason = "cancel" | "switch-editor" | "open-console";

export const defaultConnectionForm: ConnectionFormValues = {
  name: "",
  baseUrl: "",
  authType: "basic",
  username: "",
  password: "",
  apiKey: "",
  bearerToken: "",
  tlsMode: "default",
  tlsCaPath: "",
  tlsFingerprint: "",
  insecureTls: false,
  environment: "dev",
  readonly: false,
  allowInsecureProductionTls: false,
  sshProfileId: "",
};

export const defaultSshForm: SshProfileFormValues = {
  name: "",
  sshHost: "",
  sshPort: "22",
  sshUsername: "",
  sshAuthMethod: "password",
  sshPassword: "",
  sshPrivateKeyPath: "",
  sshPassphrase: "",
};

export function isConnectionFormIncomplete(values: ConnectionFormValues): boolean {
  return (
    !values.baseUrl.trim() ||
    (values.authType === "basic"
      ? !values.username.trim() || !values.password.trim()
      : values.authType === "apiKey"
        ? !values.apiKey.trim()
        : !values.bearerToken.trim()) ||
    (values.tlsMode === "caCertificate" && !values.tlsCaPath.trim()) ||
    (values.tlsMode === "certificateFingerprint" && !values.tlsFingerprint.trim())
  );
}

export function isSshFormIncomplete(values: SshProfileFormValues): boolean {
  return (
    !values.sshHost.trim() ||
    !values.sshPort.trim() ||
    !values.sshUsername.trim() ||
    (values.sshAuthMethod === "password" ? !values.sshPassword.trim() : !values.sshPrivateKeyPath.trim())
  );
}

const connectionFormKeys = Object.keys(defaultConnectionForm) as (keyof ConnectionFormValues)[];

export function isConnectionFormDirty(current: ConnectionFormValues, snapshot: ConnectionFormValues): boolean {
  return connectionFormKeys.some((key) => current[key] !== snapshot[key]);
}

export function getConnectionEditorLeaveBehavior(options: {
  isDirty: boolean;
  savePending: boolean;
  reason: ConnectionEditorLeaveReason;
}): "block" | "confirm" | "allow" {
  if (options.reason === "open-console") {
    return "allow";
  }
  if (options.savePending) {
    return "block";
  }
  if (options.isDirty) {
    return "confirm";
  }
  return "allow";
}
