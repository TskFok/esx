import { describe, expect, it } from "vitest";
import {
  DEFAULT_ERROR_LOG_SETTINGS,
  isErrorLoggingEnabled,
  normalizeErrorLogSettings,
} from "../error-log-settings";
import { createEmptyStorage } from "../storage";

describe("error log settings", () => {
  it("defaults to disabled collection", () => {
    expect(DEFAULT_ERROR_LOG_SETTINGS.enabled).toBe(false);
    expect(createEmptyStorage().settings.enabled).toBe(false);
  });

  it("normalizes missing or invalid enabled values to false", () => {
    expect(normalizeErrorLogSettings(undefined).enabled).toBe(false);
    expect(normalizeErrorLogSettings(null).enabled).toBe(false);
    expect(normalizeErrorLogSettings({}).enabled).toBe(false);
    expect(normalizeErrorLogSettings({ enabled: undefined }).enabled).toBe(false);
    expect(normalizeErrorLogSettings({ enabled: "true" as unknown as boolean }).enabled).toBe(false);
  });

  it("keeps enabled true only when explicitly set", () => {
    expect(normalizeErrorLogSettings({ enabled: true }).enabled).toBe(true);
    expect(isErrorLoggingEnabled({ enabled: true })).toBe(true);
    expect(isErrorLoggingEnabled({ enabled: false })).toBe(false);
    expect(isErrorLoggingEnabled(undefined)).toBe(false);
  });
});
