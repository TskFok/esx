/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConsoleWorkspaceRightPane } from "../console-workspace-right-pane";

describe("ConsoleWorkspaceRightPane", () => {
  const workspace = (
    <>
      <div>请求内容</div>
      <div>返回内容</div>
    </>
  );

  it("默认展示完整控制台工作区", () => {
    render(
      <ConsoleWorkspaceRightPane
        logsVisible={false}
        statusVisible={false}
        adminVisible={false}
        errorLogs={<div>错误日志面板</div>}
        status={<div>状态面板</div>}
        admin={<div>治理面板</div>}
        workspace={workspace}
      />,
    );

    expect(screen.getByText("请求内容")).toBeInTheDocument();
    expect(screen.getByText("返回内容")).toBeInTheDocument();
    expect(screen.queryByText("错误日志面板")).not.toBeInTheDocument();
    expect(screen.queryByText("状态面板")).not.toBeInTheDocument();
    expect(screen.queryByText("治理面板")).not.toBeInTheDocument();
  });

  it("打开错误日志时替换整个右侧工作区", () => {
    render(
      <ConsoleWorkspaceRightPane
        logsVisible
        statusVisible={false}
        adminVisible={false}
        errorLogs={<div>错误日志面板</div>}
        status={<div>状态面板</div>}
        admin={<div>治理面板</div>}
        workspace={workspace}
      />,
    );

    expect(screen.getByText("错误日志面板")).toBeInTheDocument();
    expect(screen.queryByText("请求内容")).not.toBeInTheDocument();
    expect(screen.queryByText("返回内容")).not.toBeInTheDocument();
    expect(screen.queryByText("状态面板")).not.toBeInTheDocument();
    expect(screen.queryByText("治理面板")).not.toBeInTheDocument();
  });

  it("打开状态时替换整个右侧工作区", () => {
    render(
      <ConsoleWorkspaceRightPane
        logsVisible={false}
        statusVisible
        adminVisible={false}
        errorLogs={<div>错误日志面板</div>}
        status={<div>状态面板</div>}
        admin={<div>治理面板</div>}
        workspace={workspace}
      />,
    );

    expect(screen.getByText("状态面板")).toBeInTheDocument();
    expect(screen.queryByText("请求内容")).not.toBeInTheDocument();
    expect(screen.queryByText("返回内容")).not.toBeInTheDocument();
    expect(screen.queryByText("错误日志面板")).not.toBeInTheDocument();
    expect(screen.queryByText("治理面板")).not.toBeInTheDocument();
  });

  it("打开治理时替换整个右侧工作区", () => {
    render(
      <ConsoleWorkspaceRightPane
        logsVisible={false}
        statusVisible={false}
        adminVisible
        errorLogs={<div>错误日志面板</div>}
        status={<div>状态面板</div>}
        admin={<div>治理面板</div>}
        workspace={workspace}
      />,
    );

    expect(screen.getByText("治理面板")).toBeInTheDocument();
    expect(screen.queryByText("请求内容")).not.toBeInTheDocument();
    expect(screen.queryByText("返回内容")).not.toBeInTheDocument();
    expect(screen.queryByText("错误日志面板")).not.toBeInTheDocument();
    expect(screen.queryByText("状态面板")).not.toBeInTheDocument();
  });
});
