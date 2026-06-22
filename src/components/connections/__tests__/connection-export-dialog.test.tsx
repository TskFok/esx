/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionExportDialog } from "../connection-export-dialog";

function renderDialog(overrides: Partial<Parameters<typeof ConnectionExportDialog>[0]> = {}) {
  const props = {
    open: true,
    connectionCount: 2,
    sshProfileCount: 1,
    exporting: false,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };

  const view = render(<ConnectionExportDialog {...props} />);
  return { props, ...view };
}

describe("ConnectionExportDialog", () => {
  it("keeps the export action visually primary while exporting without allowing duplicate submits", () => {
    const { props, rerender } = renderDialog();

    fireEvent.change(screen.getByLabelText("导出密码"), { target: { value: "backup-password" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "backup-password" } });
    rerender(
      <ConnectionExportDialog
        {...props}
        exporting
      />,
    );

    const exportButton = screen.getByRole("button", { name: "导出中..." });
    expect(exportButton).not.toBeDisabled();
    expect(exportButton).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(exportButton);

    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});
