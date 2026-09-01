/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConsoleWorkspaceRightPane } from "../console-workspace-right-pane";

describe("ConsoleWorkspaceRightPane", () => {
  it("默认展示完整控制台工作区", () => {
    render(
      <ConsoleWorkspaceRightPane
        logsVisible={false}
        errorLogs={<div>错误日志面板</div>}
        workspace={
          <>
            <div>请求内容</div>
            <div>返回内容</div>
          </>
        }
      />,
    );

    expect(screen.getByText("请求内容")).toBeInTheDocument();
    expect(screen.getByText("返回内容")).toBeInTheDocument();
    expect(screen.queryByText("错误日志面板")).not.toBeInTheDocument();
  });

  it("打开错误日志时替换整个右侧工作区", () => {
    render(
      <ConsoleWorkspaceRightPane
        logsVisible
        errorLogs={<div>错误日志面板</div>}
        workspace={
          <>
            <div>请求内容</div>
            <div>返回内容</div>
          </>
        }
      />,
    );

    expect(screen.getByText("错误日志面板")).toBeInTheDocument();
    expect(screen.queryByText("请求内容")).not.toBeInTheDocument();
    expect(screen.queryByText("返回内容")).not.toBeInTheDocument();
  });
});
