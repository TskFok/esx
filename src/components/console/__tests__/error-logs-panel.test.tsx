/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ErrorLogEntry } from "../../../types/logs";

const { setErrorLoggingEnabledMock, clearErrorLogsMock } = vi.hoisted(() => ({
  setErrorLoggingEnabledMock: vi.fn(),
  clearErrorLogsMock: vi.fn(),
}));

const sampleLog = {
  id: "log-1",
  createdAt: "2026-09-01T08:00:00.000Z",
  scope: "request-execution",
  title: "请求执行失败",
  summary: "集群拒绝了当前请求。",
  diagnostics: ["status 400"],
  status: 400,
  request: {
    method: "GET",
    path: "/_cluster/health",
    content: "GET /_cluster/health",
  },
} satisfies ErrorLogEntry;

vi.mock("../../../providers/app-state", () => ({
  useAppState: vi.fn(),
}));

import { useAppState } from "../../../providers/app-state";
import { ErrorLogsPanel } from "../error-logs-panel";

const useAppStateMock = vi.mocked(useAppState);

function mockAppState(overrides: Partial<ReturnType<typeof useAppState>> = {}) {
  useAppStateMock.mockReturnValue({
    errorLoggingEnabled: false,
    setErrorLoggingEnabled: setErrorLoggingEnabledMock,
    clearErrorLogs: clearErrorLogsMock,
    errorLogs: [],
    ...overrides,
  } as unknown as ReturnType<typeof useAppState>);
}

describe("ErrorLogsPanel", () => {
  it("空列表时展示采集关闭说明", () => {
    mockAppState();
    render(<ErrorLogsPanel onClose={vi.fn()} />);

    expect(screen.getByText("当前还没有日志")).toBeInTheDocument();
    expect(screen.getByText(/请开启日志采集后复现问题/)).toBeInTheDocument();
  });

  it("采集开启且无日志时展示对应空状态", () => {
    mockAppState({ errorLoggingEnabled: true });
    render(<ErrorLogsPanel onClose={vi.fn()} />);

    expect(screen.getByText(/诊断日志采集已开启/)).toBeInTheDocument();
  });

  it("展示日志条目并支持清空与关闭", () => {
    const onClose = vi.fn();
    mockAppState({ errorLogs: [sampleLog] });
    render(<ErrorLogsPanel onClose={onClose} />);

    expect(screen.getByText("请求执行")).toBeInTheDocument();
    expect(screen.getByText("请求执行失败")).toBeInTheDocument();
    expect(screen.getByText("GET /_cluster/health")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清空日志" }));
    expect(clearErrorLogsMock).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "关闭错误日志" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("切换采集开关", () => {
    mockAppState();
    render(<ErrorLogsPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("收集诊断日志"));
    expect(setErrorLoggingEnabledMock).toHaveBeenCalledWith(true);
  });
});
