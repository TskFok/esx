import { describe, expect, it } from "vitest";
import {
  CONSOLE_REQUEST_NAME_INPUT_CLASS,
  CONSOLE_REQUEST_TOOLBAR_CLASS,
  CONSOLE_TOOLBAR_ACTIONS_CLASS,
  CONSOLE_TOOLBAR_BUTTON_CLASS,
  CONSOLE_TOOLBAR_ICON_CLASS,
} from "../console-toolbar";

describe("console toolbar layout classes", () => {
  it("keeps toolbar items aligned while allowing them to wrap", () => {
    expect(CONSOLE_REQUEST_TOOLBAR_CLASS).toContain("flex-wrap");
    expect(CONSOLE_REQUEST_TOOLBAR_CLASS).toContain("items-center");
  });

  it("keeps action buttons from shrinking and wrapping text", () => {
    expect(CONSOLE_TOOLBAR_BUTTON_CLASS).toContain("shrink-0");
    expect(CONSOLE_TOOLBAR_BUTTON_CLASS).toContain("whitespace-nowrap");
    expect(CONSOLE_TOOLBAR_BUTTON_CLASS).toContain("h-8");
  });

  it("keeps toolbar icons fixed size", () => {
    expect(CONSOLE_TOOLBAR_ICON_CLASS).toContain("shrink-0");
    expect(CONSOLE_TOOLBAR_ICON_CLASS).toContain("h-4");
    expect(CONSOLE_TOOLBAR_ICON_CLASS).toContain("w-4");
  });

  it("lets request name input absorb remaining width", () => {
    expect(CONSOLE_REQUEST_NAME_INPUT_CLASS).toContain("flex-1");
    expect(CONSOLE_REQUEST_NAME_INPUT_CLASS).toContain("min-w-0");
    expect(CONSOLE_REQUEST_NAME_INPUT_CLASS).toContain("h-9");
  });

  it("keeps action group aligned and wrapped", () => {
    expect(CONSOLE_TOOLBAR_ACTIONS_CLASS).toContain("items-center");
    expect(CONSOLE_TOOLBAR_ACTIONS_CLASS).toContain("flex-wrap");
  });
});
