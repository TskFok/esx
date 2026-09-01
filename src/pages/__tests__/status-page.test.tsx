/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
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

import { CONSOLE_STATUS_PATH } from "../../lib/console-error-logs-panel";
import { useAppState } from "../../providers/app-state";
import { StatusPage } from "../status-page";

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

function renderStatusPage() {
  return render(
    <MemoryRouter initialEntries={["/status"]}>
      <Routes>
        <Route path="/status" element={<StatusPage />} />
        <Route path="/console" element={<ConsoleSearchProbe />} />
        <Route path="/connections" element={<div>connections-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StatusPage", () => {
  it("已有当前连接时进入控制台并打开右侧状态", () => {
    useAppStateMock.mockReturnValue({
      currentConnection: connection,
    } as unknown as ReturnType<typeof useAppState>);

    renderStatusPage();

    expect(screen.getByText("console-page")).toBeInTheDocument();
    expect(screen.getByText(CONSOLE_STATUS_PATH.slice(CONSOLE_STATUS_PATH.indexOf("?")))).toBeInTheDocument();
  });

  it("没有当前连接时返回连接页", () => {
    useAppStateMock.mockReturnValue({
      currentConnection: null,
    } as unknown as ReturnType<typeof useAppState>);

    renderStatusPage();

    expect(screen.getByText("connections-page")).toBeInTheDocument();
  });
});
