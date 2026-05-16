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

import {
  applyPersistedTheme,
  getPersistedThemeMode,
  persistThemeChoice,
  type ThemeMode,
} from "@ingcreators/annot-editor";
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
import { detectShortcutsPage } from "../shared/shortcuts-page.js";

// Apply the persisted theme before the first paint depends on it.
// Defaults to "system" (follow OS) when nothing has been stored;
// the matchMedia listener installed by `applyPersistedTheme()`
// re-flips the `<html class="light">` gate live on OS preference
// change.
applyPersistedTheme();

// Wire the Theme select at module load (independent of `chrome.*`
// availability) so it works even if the capture-settings `init()`
// below aborts during a dev / non-extension load where
// `chrome.storage` / `chrome.commands` aren't available.
wireAppearanceSection();

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

  void renderShortcutsSection();
}

/** Wire the Appearance → Theme select to the
 *  `@ingcreators/annot-editor` theme-overrides helpers. The select
 *  is populated with the persisted mode on first render; picking
 *  a new value persists + re-applies immediately. `localStorage`
 *  fires `storage` events on cross-window changes (e.g. the popup
 *  re-opening after a theme flip), so the listener keeps the
 *  options select in sync when another extension surface updates
 *  the persisted mode. */
function wireAppearanceSection(): void {
  const select = el<HTMLSelectElement>("appearance-theme");
  select.value = getPersistedThemeMode();
  select.addEventListener("change", () => {
    const mode = select.value as ThemeMode;
    persistThemeChoice(mode);
    applyPersistedTheme();
    flashSaved("Saved");
  });
  window.addEventListener("storage", (ev) => {
    if (ev.key !== "annot.theme") return;
    const next = getPersistedThemeMode();
    if (select.value !== next) select.value = next;
    applyPersistedTheme();
  });
}

/** Render the current `chrome.commands` bindings + either a button
 *  that opens the browser's extension-shortcuts page or a textual
 *  instructions block, depending on what the host browser allows.
 *
 *  Chromium variants (Chrome / Edge / Opera / Brave / Vivaldi /
 *  Chromium proper) expose internal config pages we can deep-link
 *  to via `chrome.tabs.create`. (`<a href>` to `chrome://` URLs is
 *  blocked by browser security, hence the tabs API.)
 *
 *  Firefox + Safari block extensions from opening their internal
 *  pages — `about:` URLs in Firefox, the macOS Settings app in
 *  Safari — so for those we hide the button and reveal a fallback
 *  paragraph with manual navigation steps. The extension doesn't
 *  ship a Firefox/Safari manifest today, but the defense lets the
 *  Settings page degrade gracefully if someone repackages it for
 *  those browsers later (or if a future build target adds them). */
async function renderShortcutsSection(): Promise<void> {
  const list = el<HTMLUListElement>("shortcuts-list");
  const btn = el<HTMLButtonElement>("shortcuts-config-btn");
  const manual = el<HTMLParagraphElement>("shortcuts-manual");

  const commands = await chrome.commands.getAll().catch(() => [] as chrome.commands.Command[]);
  list.innerHTML = "";
  for (const cmd of commands) {
    if (!cmd.name) continue;
    const item = document.createElement("li");
    item.className = "shortcuts-item";

    const label = document.createElement("span");
    label.className = "shortcuts-label";
    label.textContent = cmd.description ?? cmd.name;

    const value = document.createElement("span");
    if (cmd.shortcut) {
      value.className = "shortcuts-value";
      value.textContent = cmd.shortcut;
    } else {
      value.className = "shortcuts-value shortcuts-value-unset";
      value.textContent = "Not set";
    }

    item.append(label, value);
    list.appendChild(item);
  }

  const target = detectShortcutsPage();
  if (target.kind === "openable") {
    btn.textContent = `Open ${target.browser} shortcuts page`;
    btn.hidden = false;
    btn.addEventListener("click", () => {
      void chrome.tabs.create({ url: target.url });
    });
  } else {
    manual.textContent = target.steps;
    manual.hidden = false;
  }
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
