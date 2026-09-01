/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultConnectionForm } from "../../../lib/connection-form";
import type { SshProfile } from "../../../types/connections";
import { ConnectionEditorPanel } from "../connection-editor-panel";

const sshProfile: SshProfile = {
  id: "ssh-1",
  name: "跳板机",
  tunnel: {
    host: "bastion.example.com",
    port: 22,
    username: "ubuntu",
    authMethod: "password",
    privateKeyPath: "",
  },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastVerifiedAt: "2026-09-01T00:00:00.000Z",
  hostKeyPolicy: "trustOnFirstUse",
  trustedHostKeySha256: null,
};

function renderPanel(overrides: Partial<Parameters<typeof ConnectionEditorPanel>[0]> = {}) {
  const props = {
    mode: "idle" as const,
    values: defaultConnectionForm,
    sshProfiles: [] as SshProfile[],
    selectedSshProfile: null,
    saving: false,
    incomplete: true,
    testingSshProfileId: null,
    onCreate: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    onChange: vi.fn(),
    onCreateSsh: vi.fn(),
    onEditSsh: vi.fn(),
    onTestSsh: vi.fn(),
    onDeleteSsh: vi.fn(),
    ...overrides,
  };
  const view = render(<ConnectionEditorPanel {...props} />);
  return { props, ...view };
}

describe("ConnectionEditorPanel", () => {
  it("idle 展示空状态，不展示连接名称输入", () => {
    const { props } = renderPanel();
    expect(screen.getByText("选择左侧连接进入 Console，或新建一条连接。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建连接" }));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText("例如 生产 ES / 预发日志集群")).not.toBeInTheDocument();
  });

  it("create 展示表单，保存按钮在不完整时禁用", () => {
    renderPanel({ mode: "create" });
    expect(screen.getByPlaceholderText("例如 生产 ES / 预发日志集群")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "验证并保存连接" })).toBeDisabled();
  });

  it("选中 SSH 后可打开编辑弹窗回调", () => {
    const { props } = renderPanel({
      mode: "edit",
      values: { ...defaultConnectionForm, sshProfileId: "ssh-1" },
      sshProfiles: [sshProfile],
      selectedSshProfile: sshProfile,
    });
    fireEvent.click(screen.getByRole("button", { name: "编辑当前 SSH 通道" }));
    expect(props.onEditSsh).toHaveBeenCalledWith(sshProfile);
    fireEvent.click(screen.getByRole("button", { name: "新建 SSH 通道" }));
    expect(props.onCreateSsh).toHaveBeenCalledTimes(1);
  });

  it("选中 SSH 后可测试、清除和删除", () => {
    const { props } = renderPanel({
      mode: "edit",
      values: { ...defaultConnectionForm, sshProfileId: "ssh-1" },
      sshProfiles: [sshProfile],
      selectedSshProfile: sshProfile,
    });

    fireEvent.click(screen.getByRole("button", { name: "测试 SSH 通道" }));
    expect(props.onTestSsh).toHaveBeenCalledWith(sshProfile);

    fireEvent.click(screen.getByRole("button", { name: "清除选择" }));
    expect(props.onChange).toHaveBeenCalledWith({ ...defaultConnectionForm, sshProfileId: "" });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(props.onDeleteSsh).toHaveBeenCalledWith(sshProfile);
  });

  it("SSH 测试中禁用测试按钮并显示加载文案", () => {
    renderPanel({
      mode: "edit",
      values: { ...defaultConnectionForm, sshProfileId: "ssh-1" },
      sshProfiles: [sshProfile],
      selectedSshProfile: sshProfile,
      testingSshProfileId: "ssh-1",
    });
    const testButton = screen.getByRole("button", { name: "测试 SSH 通道" });
    expect(testButton).toBeDisabled();
    expect(testButton).toHaveTextContent("测试中");
  });

  it("直连会清空 sshProfileId，点击通道列表会选中", () => {
    const { props } = renderPanel({
      mode: "create",
      values: { ...defaultConnectionForm, sshProfileId: "ssh-1" },
      sshProfiles: [sshProfile],
      selectedSshProfile: sshProfile,
    });

    fireEvent.click(screen.getByRole("button", { name: "直连" }));
    expect(props.onChange).toHaveBeenCalledWith({ ...defaultConnectionForm, sshProfileId: "" });

    fireEvent.click(screen.getByRole("button", { name: /跳板机/ }));
    expect(props.onChange).toHaveBeenCalledWith({ ...defaultConnectionForm, sshProfileId: "ssh-1" });
  });

  it("saving 时禁用取消和保存，create/edit 使用对应标题", () => {
    const createView = renderPanel({ mode: "create", saving: true, incomplete: false });
    expect(screen.getByText("新增连接")).toBeInTheDocument();
    expect(screen.getByText("连接直接保存为独立项。SSH 通道可选填。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "验证并保存连接" })).toBeDisabled();
    createView.unmount();

    renderPanel({ mode: "edit" });
    expect(screen.getByText("编辑连接")).toBeInTheDocument();
  });
});
