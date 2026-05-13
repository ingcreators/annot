/**
 * localStorage-backed user preferences shared across all capture
 * surfaces (`Capture Screen`, `Timed Capture...`, the Phase 1+
 * `Capture Screen...` dialog, and the future `/capture` workspace).
 *
 * Lifted out of `interval-dialog.ts` in Phase 1 of
 * `docs/plans/web-capture-redesign.md` so the prefs survive the
 * Phase 5 deletion of `interval-dialog.ts`. `interval-dialog.ts`
 * still re-exports `loadCursorPreference` / `saveCursorPreference`
 * for back-compat; new code should import from here directly.
 */

import type { CaptureMode } from "./types.js";

/** Cursor visibility for `getDisplayMedia({video: {cursor}})`.
 *  Structural duplicate of `pwa-capture.ts` / `annot-interval-
 *  capture-dialog.ts` — kept local so this module has no upward
 *  dependency on either file. */
export type CursorMode = "always" | "motion" | "never";

const CURSOR_PREF_KEY = "annot-capture-cursor";
const MODE_PREF_KEY = "annot-capture-mode";

/** Load the last-used cursor preference from localStorage, or default to `"always"`. */
export function loadCursorPreference(): CursorMode {
  const v = localStorage.getItem(CURSOR_PREF_KEY);
  return v === "motion" || v === "never" ? v : "always";
}

/** Persist the cursor preference for future captures. */
export function saveCursorPreference(cursor: CursorMode): void {
  localStorage.setItem(CURSOR_PREF_KEY, cursor);
}

/** Load the last-used capture-mode preference, or default to `"auto"`. */
export function loadModePreference(): CaptureMode {
  const v = localStorage.getItem(MODE_PREF_KEY);
  return v === "once" || v === "area" || v === "auto" ? v : "auto";
}

/** Persist the capture-mode preference for future dialog opens. */
export function saveModePreference(mode: CaptureMode): void {
  localStorage.setItem(MODE_PREF_KEY, mode);
}
