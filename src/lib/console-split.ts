export const CONSOLE_EDITOR_FRACTION_MIN = 0.2;
export const CONSOLE_EDITOR_FRACTION_MAX = 0.82;
export const CONSOLE_EDITOR_FRACTION_DEFAULT = 0.5;

export const CONSOLE_EDITOR_SPLIT_STORAGE_KEY = "esx.console.editorSplitFraction";

export function clampConsoleEditorFraction(value: number): number {
  return Math.min(CONSOLE_EDITOR_FRACTION_MAX, Math.max(CONSOLE_EDITOR_FRACTION_MIN, value));
}

export function readStoredConsoleEditorFraction(): number {
  if (typeof window === "undefined") {
    return CONSOLE_EDITOR_FRACTION_DEFAULT;
  }

  try {
    const raw = window.localStorage.getItem(CONSOLE_EDITOR_SPLIT_STORAGE_KEY);
    const n = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(n) ? clampConsoleEditorFraction(n) : CONSOLE_EDITOR_FRACTION_DEFAULT;
  } catch {
    return CONSOLE_EDITOR_FRACTION_DEFAULT;
  }
}

export function computeEditorFractionFromDrag(params: {
  startFraction: number;
  startClientX: number;
  currentClientX: number;
  containerWidth: number;
}): number {
  if (params.containerWidth <= 0) {
    return clampConsoleEditorFraction(params.startFraction);
  }

  const delta = (params.currentClientX - params.startClientX) / params.containerWidth;
  return clampConsoleEditorFraction(params.startFraction + delta);
}
