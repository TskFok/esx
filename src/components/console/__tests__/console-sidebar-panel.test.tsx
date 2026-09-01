/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConsoleSidebarPanel } from "../console-sidebar-panel";

const SIDEBAR_NAV_GHOST_CLASSES = ["text-slate-200", "hover:bg-white/10", "hover:text-white"];

function renderSidebar() {
  render(
    <ConsoleSidebarPanel
      connectionName="local"
      requests={[]}
      activeSavedRequestId={null}
      onClose={vi.fn()}
      onNavigateConnections={vi.fn()}
      onNavigateStatus={vi.fn()}
      onNavigateAdmin={vi.fn()}
      onNavigateLogs={vi.fn()}
      onCreateRequest={vi.fn()}
      onExportClick={vi.fn()}
      onImportFileSelected={vi.fn()}
      onSelectSavedRequest={vi.fn()}
      onEditRequest={vi.fn()}
      onDuplicateRequest={vi.fn()}
      onDeleteRequest={vi.fn()}
      onReorderRequests={vi.fn()}
      selectionMode={false}
      selectedRequestIds={[]}
      onToggleSelectionMode={vi.fn()}
      onToggleRequestSelection={vi.fn()}
      onSelectAllVisible={vi.fn()}
      onClearSelection={vi.fn()}
      onOpenBulkTags={vi.fn()}
    />,
  );
}

describe("ConsoleSidebarPanel navigation", () => {
  it("连接页按钮不使用 secondary 高亮，样式与其它导航按钮一致", () => {
    renderSidebar();

    const connectionsButton = screen.getByRole("button", { name: "连接页" });
    const statusButton = screen.getByRole("button", { name: "状态" });

    expect(connectionsButton).not.toHaveClass("bg-secondary");
    expect(connectionsButton).toHaveClass(...SIDEBAR_NAV_GHOST_CLASSES);
    expect(statusButton).toHaveClass(...SIDEBAR_NAV_GHOST_CLASSES);
  });
});
