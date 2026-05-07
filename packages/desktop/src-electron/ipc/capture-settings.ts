/**
 * Capture-settings IPC — Phase 6 of
 * `docs/plans/desktop-browser-mode.md`.
 *
 * Persists the `Settings` shape from
 * `@ingcreators/annot-capture/shared` to a JSON file under
 * `<userData>/capture-settings.json`. The chrome extension uses
 * `chrome.storage.sync` for the same shape; the desktop's
 * persistence stays a single host-local file because the Browse
 * window is one of many windows in a single Annot install (no
 * cross-device sync surface today; that's a Phase 7 item if/when
 * cloud sync lands).
 *
 * Two channels:
 *
 *   - `capture.settings.load` — read + JSON.parse + return.
 *     Falls back to a host-supplied "no-file" default (the
 *     renderer merges with `DEFAULT_SETTINGS` from the capture
 *     package; we don't import that here to keep this module
 *     pure JSON I/O).
 *
 *   - `capture.settings.save(settings)` — write the JSON file.
 *     The renderer uses this on every change for autosave —
 *     the extension's options.html does the same on
 *     chrome.storage.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

/** On-disk shape — opaque to this module. The renderer treats
 *  the result as `unknown` and runs `mergeSettings` from the
 *  capture package, which validates / fills in defaults. The
 *  main process doesn't import the Settings type to stay free
 *  of capture-package transitive dependencies. */
export type CaptureSettingsBlob = unknown;

export interface CaptureSettingsHandlers {
  load(): Promise<CaptureSettingsBlob | null>;
  save(input: { settings: CaptureSettingsBlob }): Promise<void>;
}

export interface CaptureSettingsOptions {
  /** `app.getPath('userData')` resolved by the main process.
   *  The settings file lives at
   *  `<userData>/capture-settings.json`. */
  userDataDir: string;
}

export function createCaptureSettingsHandlers(
  opts: CaptureSettingsOptions,
): CaptureSettingsHandlers {
  const settingsPath = join(opts.userDataDir, "capture-settings.json");

  return {
    async load(): Promise<CaptureSettingsBlob | null> {
      try {
        const text = await fs.readFile(settingsPath, "utf-8");
        const parsed = JSON.parse(text) as CaptureSettingsBlob;
        return parsed;
      } catch (err) {
        if (isEnoent(err)) return null;
        // Corrupt file? Log + return null so the renderer falls
        // back to defaults. A future add could move the bad file
        // aside as a `.bak` for debugging.
        console.warn("[capture-settings] load failed:", err);
        return null;
      }
    },

    async save({ settings }) {
      await fs.mkdir(dirname(settingsPath), { recursive: true });
      const text = JSON.stringify(settings, null, 2);
      await fs.writeFile(settingsPath, text, "utf-8");
    },
  };
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

export const CAPTURE_SETTINGS_CHANNELS = {
  load: "capture.settings.load",
  save: "capture.settings.save",
} as const;

export type CaptureSettingsChannel =
  (typeof CAPTURE_SETTINGS_CHANNELS)[keyof typeof CAPTURE_SETTINGS_CHANNELS];

export const CAPTURE_SETTINGS_CHANNEL_TO_HANDLER: Record<
  CaptureSettingsChannel,
  keyof CaptureSettingsHandlers
> = {
  [CAPTURE_SETTINGS_CHANNELS.load]: "load",
  [CAPTURE_SETTINGS_CHANNELS.save]: "save",
};
