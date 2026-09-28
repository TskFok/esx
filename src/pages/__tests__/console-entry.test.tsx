/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultDraft } from "../../lib/storage";
import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../../types/ai-settings";
import type { ConnectionProfile } from "../../types/connections";

vi.mock("../../providers/app-state", () => ({ useAppState: vi.fn() }));
vi.mock("../../components/console/console-editor", () => ({
  ConsoleEditor: () => <div>请求编辑器</div>,
}));

import { useAppState } from "../../providers/app-state";
import { ConsolePage } from "../console-page";

const useAppStateMock = vi.mocked(useAppState);
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

function renderDirectConsoleEntry() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/console"]}>
        <Routes>
          <Route path="/console" element={<ConsolePage />} />
          <Route path="/connections" element={<div>连接管理页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createLocalStorageMock(),
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  useAppStateMock.mockReturnValue({
    currentConnection: connection,
    currentDraft: createDefaultDraft(connection.id),
    connections: [connection],
    requestsForCurrentConnection: [],
    searchMetadataByConnection: {},
    responsePreviewBytes: 256 * 1024,
    updateDraft: vi.fn(),
    refreshSearchMetadata: vi.fn().mockResolvedValue(undefined),
    ensureIndexFields: vi.fn().mockResolvedValue(undefined),
    getPassword: vi.fn().mockResolvedValue(null),
    getSshSecret: vi.fn().mockResolvedValue(null),
    getSshProfileForConnection: vi.fn(() => null),
    aiSettings: { ...DEFAULT_AI_ANALYSIS_SETTINGS },
    aiApiKeyConfigured: false,
    aiAnalysisHistory: [],
  } as unknown as ReturnType<typeof useAppState>);
});

describe("Console 直接入口", () => {
  it("有当前连接时显示控制台", async () => {
    renderDirectConsoleEntry();
    expect((await screen.findAllByText("请求编辑器"))[0]).toBeVisible();
  });

  it("无当前连接时返回连接管理页", () => {
    useAppStateMock.mockReturnValue({
      ...useAppStateMock(),
      currentConnection: null,
      currentDraft: null,
    });
    renderDirectConsoleEntry();
    expect(screen.getByText("连接管理页")).toBeVisible();
  });
});
