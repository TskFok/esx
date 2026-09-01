/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultSshForm } from "../../../lib/connection-form";
import { SshProfileDialog } from "../ssh-profile-dialog";

describe("SshProfileDialog", () => {
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
});
