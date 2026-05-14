/**
 * Web-app side loader for the shared Auto Capture options blob.
 * Mirrors the `encode-options.ts` pattern: localStorage-backed,
 * forgiving merge that fills missing keys + drops invalid values.
 *
 * The shared shape lives at `@ingcreators/annot-core/auto-capture-options`
 * so a future Browser Extension Auto Capture surface can persist
 * the same fields under its own `Settings.autoCapture` namespace
 * without duplicating the union types or the preset → ms maps.
 */

import {
  type AutoCaptureOptions,
  DEFAULT_AUTO_CAPTURE_OPTIONS,
  isCaptureIntervalPreset,
  isChangeSensitivityPreset,
  isStableWaitPreset,
} from "@ingcreators/annot-core/auto-capture-options";

const STORAGE_KEY = "annot-auto-capture-options";

export function loadAutoCaptureOptions(): AutoCaptureOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUTO_CAPTURE_OPTIONS;
    const parsed = JSON.parse(raw);
    return {
      interval: isCaptureIntervalPreset(parsed.interval)
        ? parsed.interval
        : DEFAULT_AUTO_CAPTURE_OPTIONS.interval,
      sensitivity: isChangeSensitivityPreset(parsed.sensitivity)
        ? parsed.sensitivity
        : DEFAULT_AUTO_CAPTURE_OPTIONS.sensitivity,
      stableWait: isStableWaitPreset(parsed.stableWait)
        ? parsed.stableWait
        : DEFAULT_AUTO_CAPTURE_OPTIONS.stableWait,
      ignoreCursorOnlyChanges:
        typeof parsed.ignoreCursorOnlyChanges === "boolean"
          ? parsed.ignoreCursorOnlyChanges
          : DEFAULT_AUTO_CAPTURE_OPTIONS.ignoreCursorOnlyChanges,
    };
  } catch {
    return DEFAULT_AUTO_CAPTURE_OPTIONS;
  }
}

export function saveAutoCaptureOptions(options: AutoCaptureOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    /* ignore */
  }
}
