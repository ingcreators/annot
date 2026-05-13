/**
 * Promise-shaped wrapper around `<annot-capture-screen-dialog>`,
 * mirroring the pattern `interval-dialog.ts` uses for the existing
 * Timed Capture dialog.
 *
 * Phase 1 of `docs/plans/web-capture-redesign.md`.
 */

import "./annot-capture-screen-dialog.js";
import type {
  AnnotCaptureScreenDialogElement,
  CaptureScreenDialogConfirmDetail,
} from "./annot-capture-screen-dialog.js";
import { loadCursorPreference, loadModePreference } from "./capture-prefs.js";
import type { CaptureMode } from "./types.js";

export interface CaptureScreenDialogResult {
  mode: CaptureMode;
  cursor: CaptureScreenDialogConfirmDetail["cursor"];
}

/** Show the `Capture Screen...` mode-picker dialog. Resolves with
 *  the user's choice, or `null` if they cancelled. The initial mode
 *  + cursor default to the last-used `localStorage` values
 *  (`loadModePreference` / `loadCursorPreference`). */
export function showCaptureScreenDialog(initial?: {
  mode?: CaptureMode;
  cursor?: CaptureScreenDialogConfirmDetail["cursor"];
}): Promise<CaptureScreenDialogResult | null> {
  const mode = initial?.mode ?? loadModePreference();
  const cursor = initial?.cursor ?? loadCursorPreference();
  return new Promise((resolve) => {
    const dlg: AnnotCaptureScreenDialogElement = document.createElement(
      "annot-capture-screen-dialog",
    );
    dlg.mode = mode;
    dlg.cursor = cursor;
    document.body.appendChild(dlg);

    const close = () => dlg.remove();
    dlg.addEventListener("capture-cancel", () => {
      close();
      resolve(null);
    });
    dlg.addEventListener("capture-confirm", (e: Event) => {
      const detail = (e as CustomEvent<CaptureScreenDialogConfirmDetail>).detail;
      close();
      resolve({ mode: detail.mode, cursor: detail.cursor });
    });
  });
}
