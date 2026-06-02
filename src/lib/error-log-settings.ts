import type { ErrorLogSettings } from "../types/logs";
import { normalizeResponsePreviewBytes, RESPONSE_PREVIEW_BYTES } from "./response-snapshot";

export const DEFAULT_ERROR_LOG_SETTINGS: ErrorLogSettings = {
  enabled: false,
  responsePreviewBytes: RESPONSE_PREVIEW_BYTES,
};

export function normalizeErrorLogSettings(
  settings: Partial<ErrorLogSettings> | null | undefined,
): ErrorLogSettings {
  return {
    enabled: settings?.enabled === true,
    responsePreviewBytes: normalizeResponsePreviewBytes(
      settings?.responsePreviewBytes ?? DEFAULT_ERROR_LOG_SETTINGS.responsePreviewBytes,
    ),
  };
}

export function isErrorLoggingEnabled(settings: Partial<ErrorLogSettings> | null | undefined): boolean {
  return settings?.enabled === true;
}
