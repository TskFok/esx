import { describe, expect, it } from "vitest";
import {
  defaultConnectionForm,
  getConnectionEditorLeaveBehavior,
  isConnectionFormDirty,
  isConnectionFormIncomplete,
  isSshFormIncomplete,
} from "../connection-form";

describe("isConnectionFormIncomplete", () => {
  it("缺少地址或凭据时视为不完整", () => {
    expect(isConnectionFormIncomplete(defaultConnectionForm)).toBe(true);
    expect(
      isConnectionFormIncomplete({
        ...defaultConnectionForm,
        baseUrl: "https://es.example.com:9200",
        username: "elastic",
        password: "secret",
      }),
    ).toBe(false);
  });

  it("API Key 模式要求填写 apiKey", () => {
    expect(
      isConnectionFormIncomplete({
        ...defaultConnectionForm,
        baseUrl: "https://es.example.com:9200",
        authType: "apiKey",
        apiKey: "",
      }),
    ).toBe(true);
  });
});

describe("isSshFormIncomplete", () => {
  it("密码认证缺少密码时不完整", () => {
    expect(
      isSshFormIncomplete({
        name: "bastion",
        sshHost: "bastion.example.com",
        sshPort: "22",
        sshUsername: "ubuntu",
        sshAuthMethod: "password",
        sshPassword: "",
        sshPrivateKeyPath: "",
        sshPassphrase: "",
      }),
    ).toBe(true);
  });
});

describe("isConnectionFormDirty", () => {
  it("任意字段变化即视为脏", () => {
    const snapshot = { ...defaultConnectionForm, name: "开发" };
    expect(isConnectionFormDirty(snapshot, snapshot)).toBe(false);
    expect(isConnectionFormDirty({ ...snapshot, name: "生产" }, snapshot)).toBe(true);
  });
});

describe("getConnectionEditorLeaveBehavior", () => {
  it("保存中禁止离开", () => {
    expect(
      getConnectionEditorLeaveBehavior({ isDirty: true, savePending: true, reason: "cancel" }),
    ).toBe("block");
  });

  it("脏表单取消或切换编辑时先确认", () => {
    expect(
      getConnectionEditorLeaveBehavior({ isDirty: true, savePending: false, reason: "cancel" }),
    ).toBe("confirm");
    expect(
      getConnectionEditorLeaveBehavior({ isDirty: true, savePending: false, reason: "switch-editor" }),
    ).toBe("confirm");
  });

  it("单击进入 Console 不拦截", () => {
    expect(
      getConnectionEditorLeaveBehavior({ isDirty: true, savePending: false, reason: "open-console" }),
    ).toBe("allow");
  });

  it("表单未改动时允许取消", () => {
    expect(
      getConnectionEditorLeaveBehavior({ isDirty: false, savePending: false, reason: "cancel" }),
    ).toBe("allow");
  });
});
