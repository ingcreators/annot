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

  // Load persisted Settings + active-session state in parallel.
  const [settings, status] = await Promise.all([
    loadSettings(),
    sendWithResponse<{
      active: boolean;
      count: number;
      hotkeyActive: boolean;
      hotkeyCount: number;
    }>({ type: "click-capture-status" }).catch(() => null),
  ]);

  el.settings = settings;
  if (status?.hotkeyActive) {
    el.view = "hotkeyActive";
    el.hotkeyCount = status.hotkeyCount ?? 0;
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
