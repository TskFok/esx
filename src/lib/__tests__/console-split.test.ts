import { describe, expect, it } from "vitest";
import {
  CONSOLE_EDITOR_FRACTION_MAX,
  CONSOLE_EDITOR_FRACTION_MIN,
  clampConsoleEditorFraction,
  computeEditorFractionFromDrag,
} from "../console-split";

describe("clampConsoleEditorFraction", () => {
  it("clamps below minimum", () => {
    expect(clampConsoleEditorFraction(0)).toBe(CONSOLE_EDITOR_FRACTION_MIN);
    expect(clampConsoleEditorFraction(CONSOLE_EDITOR_FRACTION_MIN - 0.01)).toBe(CONSOLE_EDITOR_FRACTION_MIN);
  });

  it("clamps above maximum", () => {
    expect(clampConsoleEditorFraction(1)).toBe(CONSOLE_EDITOR_FRACTION_MAX);
    expect(clampConsoleEditorFraction(CONSOLE_EDITOR_FRACTION_MAX + 0.01)).toBe(CONSOLE_EDITOR_FRACTION_MAX);
  });

  it("leaves in-range values unchanged", () => {
    expect(clampConsoleEditorFraction(0.5)).toBe(0.5);
  });
});

describe("computeEditorFractionFromDrag", () => {
  it("adds movement relative to container width", () => {
    expect(
      computeEditorFractionFromDrag({
        startFraction: 0.5,
        startClientX: 100,
        currentClientX: 200,
        containerWidth: 1000,
      }),
    ).toBe(0.6);
  });

  it("respects clamp when dragging far right", () => {
    expect(
      computeEditorFractionFromDrag({
        startFraction: 0.8,
        startClientX: 0,
        currentClientX: 500,
        containerWidth: 100,
      }),
    ).toBe(CONSOLE_EDITOR_FRACTION_MAX);
  });

  it("falls back sanely when container width is zero", () => {
    expect(
      computeEditorFractionFromDrag({
        startFraction: 0.5,
        startClientX: 0,
        currentClientX: 100,
        containerWidth: 0,
      }),
    ).toBe(0.5);
  });
});
