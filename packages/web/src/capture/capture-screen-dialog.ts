/**
 * Promise-shaped wrapper around `<annot-capture-screen-dialog>`,
 * mirroring the pattern `interval-dialog.ts` uses for the existing
 * Timed Capture dialog.
 *
 * Persistence model:
 * - `mode` + `cursor` use the dedicated `localStorage` keys in
 *   `capture-prefs.ts` (long-standing).
 * - `saveSizePreset` lives on the shared `EncodeOptions` blob the
 *   encode pipeline reads (`encode-options.ts`). Same blob the
 *   future Browser Extension settings UI will write to. The
 *   wrapper loads the current value at mount + writes any change
 *   back at confirm so the next capture / encode picks it up.
 */

import type { SaveSizePreset } from "@ingcreators/annot-core/encode/options";
import { loadEncodeOptions, saveEncodeOptions } from "../encode-options.js";
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
  saveSizePreset: SaveSizePreset;
}

/** Show the `Capture Screen...` mode-picker dialog. Resolves with
 *  the user's choice, or `null` if they cancelled. Defaults pull
 *  from the same persisted stores future captures read from
 *  (`loadModePreference` / `loadCursorPreference` /
 *  `loadEncodeOptions().saveSizePreset`). */
export function showCaptureScreenDialog(initial?: {
  mode?: CaptureMode;
  cursor?: CaptureScreenDialogConfirmDetail["cursor"];
  saveSizePreset?: SaveSizePreset;
}): Promise<CaptureScreenDialogResult | null> {
  const mode = initial?.mode ?? loadModePreference();
  const cursor = initial?.cursor ?? loadCursorPreference();
  const persistedEncodeOpts = loadEncodeOptions();
  // `saveSizePreset` is optional on the core EncodeOptions
  // interface for back-compat (extension passes undefined). Web
  // populates it from `DEFAULT_ENCODE_OPTIONS` in
  // `loadEncodeOptions`, so the fallback is defensive belt-and-
  // braces — should never be exercised in practice.
  const saveSizePreset: SaveSizePreset =
    initial?.saveSizePreset ?? persistedEncodeOpts.saveSizePreset ?? "standard";
  return new Promise((resolve) => {
    const dlg: AnnotCaptureScreenDialogElement = document.createElement(
      "annot-capture-screen-dialog",
    );
    dlg.mode = mode;
    dlg.cursor = cursor;
    dlg.saveSizePreset = saveSizePreset;
    document.body.appendChild(dlg);

    const close = () => dlg.remove();
    dlg.addEventListener("capture-cancel", () => {
      close();
      resolve(null);
    });
    dlg.addEventListener("capture-confirm", (e: Event) => {
      const detail = (e as CustomEvent<CaptureScreenDialogConfirmDetail>).detail;
      close();
      // Persist the chosen size preset back to the shared encode
      // options blob so the encode pipeline + the (future)
      // Browser Extension settings UI both pick it up. Cursor +
      // mode have their own dedicated `capture-prefs` calls
      // higher in the stack (`capture-host.ts`).
      if (detail.saveSizePreset !== persistedEncodeOpts.saveSizePreset) {
        saveEncodeOptions({
          ...persistedEncodeOpts,
          saveSizePreset: detail.saveSizePreset,
        });
      }
      resolve({
        mode: detail.mode,
        cursor: detail.cursor,
        saveSizePreset: detail.saveSizePreset,
      });
    });
  });
}
