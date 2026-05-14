/**
 * Promise-shaped wrapper around `<annot-capture-screen-dialog>`,
 * mirroring the pattern `interval-dialog.ts` uses for the existing
 * Timed Capture dialog.
 *
 * Persistence model (each field has its own shared options blob
 * so the future Browser Extension settings UI can pick them up
 * 1:1 without web-only forks):
 * - `mode` + `cursor` → `capture-prefs.ts` (web-only, simple kv).
 * - `saveSizePreset` / `format` / `smartFallback` / `jpegPercent`
 *   → `EncodeOptions` blob via `encode-options.ts`.
 * - `autoInterval` / `autoSensitivity` / `autoStableWait` /
 *   `autoIgnoreCursorOnlyChanges` → `AutoCaptureOptions` blob
 *   via `auto-capture-options.ts`.
 *
 * The wrapper loads each blob at mount, hands the values to the
 * dialog, and writes any changes back at confirm.
 */

import type { AutoCaptureOptions } from "@ingcreators/annot-core/auto-capture-options";
import type { EncodeOptions, SaveSizePreset } from "@ingcreators/annot-core/encode/options";
import { loadAutoCaptureOptions, saveAutoCaptureOptions } from "../auto-capture-options.js";
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
 *  from the same persisted stores future captures read from. */
export function showCaptureScreenDialog(initial?: {
  mode?: CaptureMode;
  cursor?: CaptureScreenDialogConfirmDetail["cursor"];
  saveSizePreset?: SaveSizePreset;
}): Promise<CaptureScreenDialogResult | null> {
  const mode = initial?.mode ?? loadModePreference();
  const cursor = initial?.cursor ?? loadCursorPreference();
  const persistedEncodeOpts = loadEncodeOptions();
  const persistedAutoOpts = loadAutoCaptureOptions();
  const saveSizePreset: SaveSizePreset =
    initial?.saveSizePreset ?? persistedEncodeOpts.saveSizePreset ?? "standard";
  return new Promise((resolve) => {
    const dlg: AnnotCaptureScreenDialogElement = document.createElement(
      "annot-capture-screen-dialog",
    );
    dlg.mode = mode;
    dlg.cursor = cursor;
    dlg.saveSizePreset = saveSizePreset;
    dlg.format = persistedEncodeOpts.format;
    dlg.smartFallback = persistedEncodeOpts.smartFallback;
    dlg.jpegPercent = persistedEncodeOpts.jpegPercent;
    dlg.autoInterval = persistedAutoOpts.interval;
    dlg.autoSensitivity = persistedAutoOpts.sensitivity;
    dlg.autoStableWait = persistedAutoOpts.stableWait;
    dlg.autoIgnoreCursorOnlyChanges = persistedAutoOpts.ignoreCursorOnlyChanges;
    document.body.appendChild(dlg);

    const close = () => dlg.remove();
    dlg.addEventListener("capture-cancel", () => {
      close();
      resolve(null);
    });
    dlg.addEventListener("capture-confirm", (e: Event) => {
      const detail = (e as CustomEvent<CaptureScreenDialogConfirmDetail>).detail;
      close();
      // Persist only when something changed — avoids redundant
      // localStorage writes for users who just confirm without
      // touching the Advanced section.
      const nextEncode: EncodeOptions = {
        ...persistedEncodeOpts,
        format: detail.format,
        smartFallback: detail.smartFallback,
        jpegPercent: detail.jpegPercent,
        saveSizePreset: detail.saveSizePreset,
      };
      if (
        nextEncode.format !== persistedEncodeOpts.format ||
        nextEncode.smartFallback !== persistedEncodeOpts.smartFallback ||
        nextEncode.jpegPercent !== persistedEncodeOpts.jpegPercent ||
        nextEncode.saveSizePreset !== persistedEncodeOpts.saveSizePreset
      ) {
        saveEncodeOptions(nextEncode);
      }
      const nextAuto: AutoCaptureOptions = {
        interval: detail.autoInterval,
        sensitivity: detail.autoSensitivity,
        stableWait: detail.autoStableWait,
        ignoreCursorOnlyChanges: detail.autoIgnoreCursorOnlyChanges,
      };
      if (
        nextAuto.interval !== persistedAutoOpts.interval ||
        nextAuto.sensitivity !== persistedAutoOpts.sensitivity ||
        nextAuto.stableWait !== persistedAutoOpts.stableWait ||
        nextAuto.ignoreCursorOnlyChanges !== persistedAutoOpts.ignoreCursorOnlyChanges
      ) {
        saveAutoCaptureOptions(nextAuto);
      }
      resolve({
        mode: detail.mode,
        cursor: detail.cursor,
        saveSizePreset: detail.saveSizePreset,
      });
    });
  });
}
