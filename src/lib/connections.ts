import type { SshProfileFormValues, SshTunnelConfig } from "../types/connections";

export function buildSshTunnelConfig(formValues: SshProfileFormValues): SshTunnelConfig {
  const host = formValues.sshHost.trim();
  const username = formValues.sshUsername.trim();
  const port = Number.parseInt(formValues.sshPort.trim(), 10);
  const privateKeyPath = formValues.sshPrivateKeyPath.trim();

  if (!host) {
    throw new Error("请填写 SSH 主机地址。");
  }

  if (!username) {
    throw new Error("请填写 SSH 用户名。");
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("SSH 端口必须是 1 到 65535 之间的整数。");
  }

  if (formValues.sshAuthMethod === "password" && !formValues.sshPassword.trim()) {
    throw new Error("请填写 SSH 密码。");
  }

  if (formValues.sshAuthMethod === "privateKey" && !privateKeyPath) {
    throw new Error("请填写 SSH 私钥路径。");
  }

  return {
    host,
    port,
    username,
    authMethod: formValues.sshAuthMethod,
    privateKeyPath,
  } satisfies SshTunnelConfig;
}

export function getSshSecretFromForm(formValues: SshProfileFormValues) {
  return formValues.sshAuthMethod === "password" ? formValues.sshPassword.trim() : formValues.sshPassphrase.trim();
}
