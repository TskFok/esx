/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../providers/app-state", () => ({
  useAppStateField: () => true,
}));

import { RootRedirect } from "../root-redirect";

describe("RootRedirect", () => {
  it("已有当前连接时仍进入 /connections", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/connections" element={<div>connections-page</div>} />
          <Route path="/console" element={<div>console-page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("connections-page")).toBeInTheDocument();
    expect(screen.queryByText("console-page")).not.toBeInTheDocument();
  });
});
