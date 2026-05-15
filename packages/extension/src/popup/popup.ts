/**
 * Popup host: loads persisted Settings + active-session state, wires
 * the Lit `<annot-extension-popup>` element's events to the service
 * worker, and closes the popup after a capture is dispatched.
 *
 * The element itself owns rendering + the per-field Settings draft;
 * this file owns I/O (`chrome.runtime.sendMessage`,
 * `chrome.runtime.openOptionsPage`, `chrome.storage.sync` via
 * `loadSettings` / `saveSettings`).
 */

import type { Settings } from "@ingcreators/annot-capture/shared";
import { loadSettings, onSettingsChange, saveSettings } from "../shared/settings.js";
import { AnnotExtensionPopupElement } from "./annot-extension-popup.js";

// Force-register the element (the file's top-level
// `customElements.define` runs as a side-effect of the import, but
// referencing the class here keeps tree-shakers from dropping the
// module when Vite bundles popup.ts).
void AnnotExtensionPopupElement;

const POPUP_CLOSE_DELAY_MS = 100;

function sendAndClose(msg: { type: string }): void {
  chrome.runtime.sendMessage(msg);
  setTimeout(() => window.close(), POPUP_CLOSE_DELAY_MS);
}

function sendWithResponse<T>(msg: { type: string }): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

async function init(): Promise<void> {
  const el = document.getElementById("popup") as AnnotExtensionPopupElement;

  // Load persisted Settings + active-session state in parallel. Auto
  // Capture has its own status message because the hotkey/click status
  // is shared and adding auto-state there would conflate three
  // independent session machines.
  const [settings, clickStatus, autoStatus] = await Promise.all([
    loadSettings(),
    sendWithResponse<{
      active: boolean;
      count: number;
      hotkeyActive: boolean;
      hotkeyCount: number;
    }>({ type: "click-capture-status" }).catch(() => null),
    sendWithResponse<{
      active: boolean;
      count: number;
      stableWaitMs: number;
      minIntervalMs: number;
    }>({ type: "auto-capture-status" }).catch(() => null),
  ]);

  el.settings = settings;
  if (autoStatus?.active) {
    el.view = "autoActive";
    el.autoSummary = {
      count: autoStatus.count ?? 0,
      stableWaitMs: autoStatus.stableWaitMs ?? 0,
      minIntervalMs: autoStatus.minIntervalMs ?? 0,
    };
  } else if (clickStatus?.hotkeyActive) {
    el.view = "hotkeyActive";
    el.hotkeyCount = clickStatus.hotkeyCount ?? 0;
  } else {
    el.view = "idle";
  }

  // Cross-tab Settings updates (Settings page edits while popup is
  // open) push through `chrome.storage.onChanged` → mirror into the
  // element so users see the latest values without reopening.
  onSettingsChange((s) => {
    el.settings = s;
  });

  // Element events → service worker + storage.
  el.addEventListener("popup-message", (event) => {
    const detail = (event as CustomEvent<{ type: string }>).detail;
    sendAndClose(detail);
  });

  el.addEventListener("popup-settings-changed", (event) => {
    const detail = (event as CustomEvent<Settings>).detail;
    void saveSettings(detail).catch((err) => {
      console.error("[popup] saveSettings failed:", err);
    });
  });

  el.addEventListener("open-options", () => {
    chrome.runtime.openOptionsPage();
    setTimeout(() => window.close(), POPUP_CLOSE_DELAY_MS);
  });
}

void init();
