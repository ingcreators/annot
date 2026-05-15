/**
 * Extension options page — Phase 6 follow-up of
 * `docs/plans/desktop-browser-mode.md`.
 *
 * Embeds the shared `<annot-capture-settings>` Lit component from
 * `@ingcreators/annot-host-ui` so the chrome extension and the
 * Electron Browse window share one settings UI implementation.
 * The chrome side owns persistence (`chrome.storage.sync`); the
 * desktop side persists through `<userData>/capture-settings.json`
 * via the `capture.settings.*` IPC pair (Phase 6).
 *
 * Pre-PR, this file owned the field-by-field wiring + a 200 LOC
 * `apply` / `readCurrent` / `wireEvents` chain mirroring the
 * options.html form's IDs. The Lit component now owns all of
 * that — this file just loads, sets the element's `settings`
 * property, and saves on `settings-changed`.
 */

import type {
  AnnotCaptureSettingsElement,
  AutoCaptureOptionsChangeDetail,
  CaptureSettingsChangeDetail,
} from "@ingcreators/annot-host-ui/annot-capture-settings";
import "@ingcreators/annot-host-ui/annot-capture-settings";
import {
  loadAutoCaptureOptions,
  loadSettings,
  onAutoCaptureOptionsChange,
  onSettingsChange,
  saveAutoCaptureOptions,
  saveSettings,
} from "../shared/settings.js";

let savedTimer: number | undefined;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

async function init(): Promise<void> {
  const settingsEl = el<AnnotCaptureSettingsElement>("capture-settings");

  // Load + populate. Settings and AutoCaptureOptions live in
  // separate `chrome.storage.sync` keys (`annot.settings.v1` /
  // `annot.autoCapture.v1`); the component's two props handle them
  // independently and fire separate events on change.
  const [settings, autoOptions] = await Promise.all([loadSettings(), loadAutoCaptureOptions()]);
  settingsEl.settings = settings;
  settingsEl.autoCaptureOptions = autoOptions;
  settingsEl.showAutoCapture = true;

  // Autosave on every input. The Lit component fires the events
  // synchronously so the value the host saves exactly matches what
  // the user just toggled — no read-back race through
  // `chrome.storage`.
  settingsEl.addEventListener("settings-changed", (event) => {
    const detail = (event as CustomEvent<CaptureSettingsChangeDetail>).detail;
    void saveSettings(detail.settings)
      .then(() => flashSaved("Saved"))
      .catch((err) => {
        console.error("[options] save failed:", err);
        flashSaved(`Save failed: ${(err as Error).message}`);
      });
  });

  settingsEl.addEventListener("auto-capture-options-changed", (event) => {
    const detail = (event as CustomEvent<AutoCaptureOptionsChangeDetail>).detail;
    void saveAutoCaptureOptions(detail.options)
      .then(() => flashSaved("Saved"))
      .catch((err) => {
        console.error("[options] saveAutoCaptureOptions failed:", err);
        flashSaved(`Save failed: ${(err as Error).message}`);
      });
  });

  // Cross-extension-context updates: another tab with options.html
  // open, or a future popup/manage-screen that toggles a setting,
  // pushes the new value through `chrome.storage.onChanged`. Keep
  // this tab's form in sync so the user sees the latest state
  // without reloading.
  onSettingsChange((s) => {
    settingsEl.settings = s;
  });
  onAutoCaptureOptionsChange((o) => {
    settingsEl.autoCaptureOptions = o;
  });
}

function flashSaved(text: string): void {
  const note = el<HTMLElement>("saved-note");
  note.textContent = text;
  note.classList.add("visible");
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => {
    note.classList.remove("visible");
  }, 1400);
}

void init();
