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
import { detectShortcutsPage } from "../shared/shortcuts-page.js";
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

  // Load persisted Settings + active-session state + the currently-
  // bound keyboard shortcuts in parallel. Hotkey and Auto each have
  // their own status message — they're independent session machines,
  // and folding them into one response shape would tempt callers
  // into ambiguous handling. `chrome.commands.getAll()` resolves
  // synchronously-ish from the in-memory command table; the popup
  // reads it once per open so every capture button's trailing badge
  // reflects whatever the user last set in the browser's extension
  // shortcuts page (re-opening the popup picks up changes — there's
  // no `onChanged` event on `chrome.commands`).
  const [settings, hotkeyStatus, autoStatus, commands] = await Promise.all([
    loadSettings(),
    sendWithResponse<{
      active: boolean;
      count: number;
    }>({ type: "hotkey-status" }).catch(() => null),
    sendWithResponse<{
      active: boolean;
      count: number;
      stableWaitMs: number;
      minIntervalMs: number;
    }>({ type: "auto-status" }).catch(() => null),
    chrome.commands.getAll().catch(() => [] as chrome.commands.Command[]),
  ]);

  el.settings = settings;
  el.hotkeyShortcut = commands.find((c) => c.name === "hotkey")?.shortcut ?? "";
  el.visibleAreaShortcut = commands.find((c) => c.name === "visible-area")?.shortcut ?? "";
  el.selectRegionShortcut = commands.find((c) => c.name === "select-region")?.shortcut ?? "";
  el.wholePageShortcut = commands.find((c) => c.name === "whole-page")?.shortcut ?? "";
  if (autoStatus?.active) {
    el.view = "autoActive";
    el.autoSummary = {
      count: autoStatus.count ?? 0,
      stableWaitMs: autoStatus.stableWaitMs ?? 0,
      minIntervalMs: autoStatus.minIntervalMs ?? 0,
    };
  } else if (hotkeyStatus?.active) {
    el.view = "hotkeyActive";
    el.hotkeyCount = hotkeyStatus.count ?? 0;
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

  // The popup component dispatches this when the user clicks
  // "Configure shortcut" inside the Hotkey-unbound inline notice.
  // Chromium variants get a direct `chrome.tabs.create` to the
  // matching `*://extensions/shortcuts` page; Firefox / Safari can't
  // be deep-linked there so we fall back to opening the Settings
  // page, which already renders the full per-browser instructions
  // block.
  el.addEventListener("open-shortcuts", () => {
    const target = detectShortcutsPage();
    if (target.kind === "openable") {
      void chrome.tabs.create({ url: target.url });
    } else {
      chrome.runtime.openOptionsPage();
    }
    setTimeout(() => window.close(), POPUP_CLOSE_DELAY_MS);
  });
}

void init();
