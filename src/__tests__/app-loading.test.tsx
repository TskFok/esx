/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const modules = vi.hoisted(() => ({
  consoleLoads: 0,
  consoleGate: null as Promise<void> | null,
  adminGate: null as Promise<void> | null,
  onConsoleLoad: null as (() => void) | null,
  onAdminLoad: null as (() => void) | null,
}));

vi.mock("../providers/app-state", () => ({
  useAppState: () => ({ ready: true }),
}));
vi.mock("../pages/connections-page", () => ({
  ConnectionsPage: () => <div data-testid="connections-page">连接页</div>,
}));
vi.mock("../pages/console-page", async () => {
  modules.consoleLoads += 1;
  modules.onConsoleLoad?.();
  await modules.consoleGate;
  return { ConsolePage: () => <div data-testid="console-page">控制台</div> };
});
vi.mock("../pages/admin-page", async () => {
  modules.onAdminLoad?.();
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

let testing: typeof import("@testing-library/react/pure");

beforeEach(async () => {
  vi.resetModules();
  testing = await import("@testing-library/react/pure");
  modules.consoleLoads = 0;
  modules.consoleGate = null;
  modules.adminGate = null;
  modules.onConsoleLoad = null;
  modules.onAdminLoad = null;
  window.location.hash = "#/connections";
});

afterEach(() => {
  testing.cleanup();
});

async function importAppWithGate(page: "console" | "admin", gate: ReturnType<typeof deferred>) {
  const loaded = deferred();
  if (page === "console") {
    modules.consoleGate = gate.promise;
    modules.onConsoleLoad = loaded.resolve;
  } else {
    modules.adminGate = gate.promise;
    modules.onAdminLoad = loaded.resolve;
  }

  const appImport = import("../App");
  const first = await Promise.race([
    appImport.then(() => "app" as const),
    loaded.promise.then(() => "module" as const),
  ]);
  if (first === "module") gate.resolve();
  const { default: App } = await appImport;
  return App;
}

describe("App 页面加载", () => {
  it("connections_route_does_not_load_console", async () => {
    const gate = deferred();
    const App = await importAppWithGate("console", gate);

    testing.render(<App />);
    expect(testing.screen.getByTestId("connections-page")).toBeVisible();
    expect(modules.consoleLoads).toBe(0);
    gate.resolve();
  });

  it("console_route_waits_for_module", async () => {
    const gate = deferred();
    window.location.hash = "#/console";
    const App = await importAppWithGate("console", gate);

    testing.render(<App />);
    expect(testing.screen.getByRole("status")).toBeVisible();
    expect(testing.screen.queryByTestId("console-page")).not.toBeInTheDocument();

    await testing.act(async () => gate.resolve());
    expect(await testing.screen.findByTestId("console-page")).toBeVisible();
  });

  it("加载失败时可返回连接页", async () => {
    const gate = deferred();
    window.location.hash = "#/admin";
    const App = await importAppWithGate("admin", gate);

    testing.render(<App />);
    expect(testing.screen.getByRole("status")).toBeVisible();
    await testing.act(async () => gate.reject(new Error("chunk failed")));
    expect(await testing.screen.findByRole("alert")).toBeVisible();
    testing.fireEvent.click(testing.screen.getByRole("link", { name: "返回连接页" }));
    expect(await testing.screen.findByTestId("connections-page")).toBeVisible();
  });
});
