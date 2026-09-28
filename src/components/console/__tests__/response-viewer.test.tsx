/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResponseSnapshot } from "../../../types/requests";

vi.mock("../lazy-console-editor", () => ({
  LazyConsoleEditor: ({ value }: { value: string }) => <div>{value}</div>,
}));

import { ResponseViewer } from "../response-viewer";

const response: ResponseSnapshot = {
  ok: true, status: 200, statusText: "OK", durationMs: 1, sizeBytes: 3_000_000,
  executedAt: "2026-01-01", bodyPreview: "", previewBytes: 0, truncated: true,
  isJson: true, diagnostics: [], previewEvicted: true,
};

describe("ResponseViewer", () => {
  it("explains that a stored historical preview was cleared", () => {
    render(<ResponseViewer response={response} fallbackValue="" />);
    expect(screen.getByText(/历史预览已清理/)).toBeInTheDocument();
  });
});
