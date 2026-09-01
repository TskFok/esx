/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../types/connections";

const connection = {
  id: "conn-1",
  name: "开发集群",
  baseUrl: "https://es.example.com:9200",
  username: "elastic",
  auth: { type: "basic" },
  tls: { mode: "default" },
  environment: "dev",
  readonly: false,
  insecureTls: false,
  sshProfileId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastUsedAt: "2026-09-01T00:00:00.000Z",
} satisfies ConnectionProfile;

vi.mock("../../providers/app-state", () => ({
  useAppState: vi.fn(),
}));

import { useAppState } from "../../providers/app-state";
import { ErrorLogsPage } from "../error-logs-page";

const useAppStateMock = vi.mocked(useAppState);

function ConsoleSearchProbe() {
  const location = useLocation();
  return (
    <div>
      console-page
      <span>{location.search}</span>
    </div>
  );
}

function renderLogsPage() {
  return render(
    <MemoryRouter initialEntries={["/logs"]}>
      <Routes>
        <Route path="/logs" element={<ErrorLogsPage />} />
        <Route path="/console" element={<ConsoleSearchProbe />} />
        <Route path="/connections" element={<div>connections-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ErrorLogsPage", () => {
  it("已有当前连接时进入控制台并打开右侧日志", () => {
    useAppStateMock.mockReturnValue({
      currentConnection: connection,
      errorLoggingEnabled: false,
      setErrorLoggingEnabled: vi.fn(),
      clearErrorLogs: vi.fn(),
      errorLogs: [],
    } as unknown as ReturnType<typeof useAppState>);

    renderLogsPage();

    expect(screen.getByText("console-page")).toBeInTheDocument();
    expect(screen.getByText("?logs=1")).toBeInTheDocument();
  });

  it("没有当前连接时在右侧面板展示日志，关闭后返回连接页", () => {
    useAppStateMock.mockReturnValue({
      currentConnection: null,
      errorLoggingEnabled: false,
      setErrorLoggingEnabled: vi.fn(),
      clearErrorLogs: vi.fn(),
      errorLogs: [],
    } as unknown as ReturnType<typeof useAppState>);

    renderLogsPage();

    expect(screen.getByText("错误日志")).toBeInTheDocument();
    expect(screen.getByText("当前还没有日志")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回连接页" }));
    expect(screen.getByText("connections-page")).toBeInTheDocument();
  });
});
