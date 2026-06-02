import { describe, expect, it } from "vitest";
import {
  CONSOLE_REQUEST_NAME_INPUT_CLASS,
  CONSOLE_REQUEST_TOOLBAR_CLASS,
  CONSOLE_TOOLBAR_ACTIONS_CLASS,
  CONSOLE_TOOLBAR_BUTTON_CLASS,
  CONSOLE_TOOLBAR_ICON_CLASS,
} from "../console-toolbar";

describe("console toolbar layout classes", () => {
  it("uses responsive wrap on toolbar container", () => {
    expect(CONSOLE_REQUEST_TOOLBAR_CLASS).toContain("sm:flex-wrap");
    expect(CONSOLE_REQUEST_TOOLBAR_CLASS).toContain("md:flex-nowrap");
  });

  it("keeps action buttons from shrinking and wrapping text", () => {
    expect(CONSOLE_TOOLBAR_BUTTON_CLASS).toContain("shrink-0");
    expect(CONSOLE_TOOLBAR_BUTTON_CLASS).toContain("whitespace-nowrap");
  });

  it("keeps toolbar icons fixed size", () => {
    expect(CONSOLE_TOOLBAR_ICON_CLASS).toContain("shrink-0");
    expect(CONSOLE_TOOLBAR_ICON_CLASS).toContain("h-4");
    expect(CONSOLE_TOOLBAR_ICON_CLASS).toContain("w-4");
  });

  it("lets request name input absorb remaining width", () => {
    expect(CONSOLE_REQUEST_NAME_INPUT_CLASS).toContain("w-full");
    expect(CONSOLE_REQUEST_NAME_INPUT_CLASS).toContain("sm:flex-1");
    expect(CONSOLE_REQUEST_NAME_INPUT_CLASS).toContain("sm:min-w-0");
  });

  it("uses contents display for action group on sm+ breakpoints", () => {
    expect(CONSOLE_TOOLBAR_ACTIONS_CLASS).toContain("sm:contents");
    expect(CONSOLE_TOOLBAR_ACTIONS_CLASS).toContain("flex-wrap");
  });
});
