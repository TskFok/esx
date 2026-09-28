/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const modules = vi.hoisted(() => ({
  consoleLoads: 0,
  consoleGate: null as Promise<void> | null,
  adminGate: null as Promise<void> | null,
}));

vi.mock("../providers/app-state", () => ({
  useAppState: () => ({ ready: true }),
}));
vi.mock("../pages/connections-page", () => ({
  ConnectionsPage: () => <div data-testid="connections-page">连接页</div>,
}));
vi.mock("../pages/console-page", async () => {
  modules.consoleLoads += 1;
  await modules.consoleGate;
  return { ConsolePage: () => <div data-testid="console-page">控制台</div> };
});
vi.mock("../pages/admin-page", async () => {
  await modules.adminGate;
  return { AdminPage: () => <div data-testid="admin-page">管理页</div> };
});
vi.mock("../pages/status-page", () => ({
  StatusPage: () => <div>状态页</div>,
}));
vi.mock("../pages/error-logs-page", () => ({
  ErrorLogsPage: () => <div>日志页</div>,
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("App 页面加载", () => {
  beforeEach(() => {
    window.location.hash = "#/connections";
  });

  it("connections_route_does_not_load_console", async () => {
    const gate = deferred();
    modules.consoleGate = gate.promise;
    const appImport = import("../App");
    const timer = setTimeout(gate.resolve, 30);

    try {
      const { default: App } = await appImport;
      render(<App />);
      expect(screen.getByTestId("connections-page")).toBeVisible();
      expect(modules.consoleLoads).toBe(0);
    } finally {
      clearTimeout(timer);
      gate.resolve();
    }
  });

  it("console_route_waits_for_module", async () => {
    const gate = deferred();
    modules.consoleGate = gate.promise;
    window.location.hash = "#/console";
    const { default: App } = await import("../App");

    render(<App />);
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.queryByTestId("console-page")).not.toBeInTheDocument();

    await act(async () => gate.resolve());
    expect(await screen.findByTestId("console-page")).toBeVisible();
  });

  it("加载失败时可返回连接页", async () => {
    const gate = deferred();
    modules.adminGate = gate.promise;
    window.location.hash = "#/admin";
    const { default: App } = await import("../App");

    render(<App />);
    expect(screen.getByRole("status")).toBeVisible();
    await act(async () => gate.reject(new Error("chunk failed")));
    expect(await screen.findByRole("alert")).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "返回连接页" }));
    expect(await screen.findByTestId("connections-page")).toBeVisible();
  });
});
