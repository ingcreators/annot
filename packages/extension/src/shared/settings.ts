/**
 * Chrome-side settings I/O. Persisted in `chrome.storage.sync` so the
 * extension follows the user across devices.
 *
 * Phase 1A of `docs/plans/desktop-browser-mode.md`: the `Settings`
 * shape, defaults, merge / validation, and pure `parseSelectorList` /
 * `resolveEmulation` / `shouldHideOverlaysFor` helpers moved into
 * `@ingcreators/annot-capture/shared/settings`. This file keeps the
 * chrome.storage-bound `loadSettings` / `saveSettings` /
 * `onSettingsChange` and re-exports the moved types so existing call
 * sites compile unchanged.
 */

import {
  type Settings,
  mergeSettings,
} from "@ingcreators/annot-capture/shared";

export {
  type CaptureKind,
  DEFAULT_SETTINGS,
  type EmulationPreset,
  type EmulationViewport,
  type ImageFormat,
  mergeSettings,
  type OverlayMode,
  parseSelectorList,
  resolveEmulation,
  type Settings,
  shouldHideOverlaysFor,
} from "@ingcreators/annot-capture/shared";

const STORAGE_KEY = "annot.settings.v1";

/** Load settings, always returning a validated object (with defaults filled in). */
export async function loadSettings(): Promise<Settings> {
  try {
    const res = await chrome.storage.sync.get([STORAGE_KEY]);
    return mergeSettings(res[STORAGE_KEY]);
  } catch {
    try {
      const res = await chrome.storage.local.get([STORAGE_KEY]);
      return mergeSettings(res[STORAGE_KEY]);
    } catch {
      return mergeSettings(undefined);
    }
  }
}

/** Overwrite settings. Callers should pass a fully-formed Settings object. */
export async function saveSettings(settings: Settings): Promise<void> {
  const clean = mergeSettings(settings);
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: clean });
  } catch {
    await chrome.storage.local.set({ [STORAGE_KEY]: clean });
  }
}

/**
 * Listen for settings changes (e.g. when the options page writes).
 * Returns an unsubscribe function.
 */
export function onSettingsChange(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "sync" && area !== "local") return;
    if (!(STORAGE_KEY in changes)) return;
    cb(mergeSettings(changes[STORAGE_KEY]!.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
