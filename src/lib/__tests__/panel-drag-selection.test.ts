/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { lockPanelDragSelection } from "../panel-drag-selection";

describe("lockPanelDragSelection", () => {
  afterEach(() => {
    document.body.style.userSelect = "";
  });

  it("locks and restores body userSelect", () => {
    document.body.style.userSelect = "auto";

    const unlock = lockPanelDragSelection();
    expect(document.body.style.userSelect).toBe("none");

    unlock();
    expect(document.body.style.userSelect).toBe("auto");
  });

  it("prevents selectstart while locked", () => {
    const unlock = lockPanelDragSelection();
    const event = new Event("selectstart", { cancelable: true });

    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    unlock();
  });

  it("restores selectstart behavior after unlock", () => {
    const unlock = lockPanelDragSelection();
    unlock();

    const event = new Event("selectstart", { cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
