import { beforeEach, expect, it, vi } from "vitest";

const { configureLoader, createWorker } = vi.hoisted(() => ({
  configureLoader: vi.fn(),
  createWorker: vi.fn(),
}));

vi.mock("@monaco-editor/react", () => ({ loader: { config: configureLoader } }));
vi.mock("monaco-editor/esm/vs/editor/editor.worker.js?worker", () => ({
  default: class {
    constructor() {
      createWorker();
    }
  },
}));

import { configureMonaco, monaco } from "../monaco-runtime";

beforeEach(() => {
  configureLoader.mockClear();
  createWorker.mockClear();
});

it("configure_once_for_multiple_editors", () => {
  configureMonaco();
  configureMonaco();

  expect(configureLoader).toHaveBeenCalledTimes(1);
  expect(configureLoader).toHaveBeenCalledWith({ monaco });
  const environment = (globalThis as typeof globalThis & {
    MonacoEnvironment?: { getWorker: (moduleId: string, label: string) => Worker };
  }).MonacoEnvironment;
  expect(environment).toBeDefined();
  environment?.getWorker("", "es-console");
  expect(createWorker).toHaveBeenCalledTimes(1);
});
