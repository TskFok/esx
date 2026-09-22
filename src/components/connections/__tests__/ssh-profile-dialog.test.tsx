/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSshForm } from "../../../lib/connection-form";
import { SshProfileDialog } from "../ssh-profile-dialog";

const pickSshPrivateKeyPath = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/native-file-dialog", () => ({
  pickSshPrivateKeyPath,
}));

describe("SshProfileDialog", () => {
  beforeEach(() => {
    pickSshPrivateKeyPath.mockReset();
  });
  it("打开时展示新增标题，保存中不关闭", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(
      <SshProfileDialog
        open
        title="新增 SSH 通道"
        values={defaultSshForm}
        saving
        incomplete={false}
        onClose={onClose}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("heading", { name: "新增 SSH 通道" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("完整表单可触发保存", () => {
    const onSave = vi.fn();
    render(
      <SshProfileDialog
        open
        title="编辑 SSH 通道"
        values={{
          ...defaultSshForm,
          sshHost: "bastion.example.com",
          sshUsername: "ubuntu",
          sshPassword: "secret",
        }}
        saving={false}
        incomplete={false}
        onClose={vi.fn()}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "验证并保存 SSH 通道" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("密码认证时不展示私钥文件选择", () => {
    render(
      <SshProfileDialog
        open
        title="新增 SSH 通道"
        values={defaultSshForm}
        saving={false}
        incomplete
        onClose={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "选择文件" })).not.toBeInTheDocument();
  });

  it("私钥认证可选择文件并回填路径，取消选择不改动", async () => {
    const onChange = vi.fn();
    const values = {
      ...defaultSshForm,
      sshAuthMethod: "privateKey" as const,
      sshPrivateKeyPath: "",
    };
    pickSshPrivateKeyPath.mockResolvedValueOnce("/Users/me/.ssh/id_ed25519");

    const { rerender } = render(
      <SshProfileDialog
        open
        title="新增 SSH 通道"
        values={values}
        saving={false}
        incomplete
        onClose={vi.fn()}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        ...values,
        sshPrivateKeyPath: "/Users/me/.ssh/id_ed25519",
      });
    });

    onChange.mockClear();
    pickSshPrivateKeyPath.mockResolvedValueOnce(null);
    rerender(
      <SshProfileDialog
        open
        title="新增 SSH 通道"
        values={values}
        saving={false}
        incomplete
        onClose={vi.fn()}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    await waitFor(() => {
      expect(pickSshPrivateKeyPath).toHaveBeenCalledTimes(2);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("保存中禁用私钥文件选择", () => {
    render(
      <SshProfileDialog
        open
        title="新增 SSH 通道"
        values={{ ...defaultSshForm, sshAuthMethod: "privateKey" }}
        saving
        incomplete={false}
        onClose={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "选择文件" })).toBeDisabled();
  });
});
