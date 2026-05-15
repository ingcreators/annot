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

  void renderShortcutsSection();
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

type ShortcutsTarget =
  | { kind: "openable"; browser: string; url: string }
  | { kind: "manual"; browser: string; steps: string };

/** Detect which browser variant we're running in and how its
 *  extension-shortcuts page can be reached. `openable` variants get
 *  a clickable button; `manual` variants get instructional text
 *  because they block extensions from opening the relevant page. */
function detectShortcutsPage(): ShortcutsTarget {
  const ua = navigator.userAgent;

  // Firefox advertises `Firefox/` without any Chromium-ish tokens.
  // Reaching `about:addons` from a `tabs.create` call is blocked, so
  // we degrade to instructions instead of a button.
  if (ua.includes("Firefox/")) {
    return {
      kind: "manual",
      browser: "Firefox",
      steps:
        'Open the Firefox menu → Add-ons and themes → click the gear icon → "Manage Extension Shortcuts". Firefox does not allow extensions to open about: pages directly.',
    };
  }

  // Chromium variants — these all expose a deep-linkable config
  // page via their own internal URL scheme.
  if (ua.includes("Edg/")) {
    return { kind: "openable", browser: "Edge", url: "edge://extensions/shortcuts" };
  }
  if (ua.includes("OPR/") || ua.includes("Opera/")) {
    return {
      kind: "openable",
      browser: "Opera",
      url: "opera://settings/keyboardShortcuts",
    };
  }

  // Safari Web Extensions only ship on macOS / iOS. Their shortcut
  // bindings live in the OS Settings app, which an extension cannot
  // open. Detection: a Safari UA contains "Safari/" but lacks both
  // "Chrome/" and "Chromium/" (every Chromium variant carries the
  // Chrome token for legacy WebKit compatibility).
  if (ua.includes("Safari/") && !ua.includes("Chrome/") && !ua.includes("Chromium/")) {
    return {
      kind: "manual",
      browser: "Safari",
      steps:
        "On macOS, configure shortcuts in System Settings → Keyboard → Keyboard Shortcuts → App Shortcuts. Safari does not let extensions open the Settings app directly.",
    };
  }

  // Catch-all: Chrome proper, Brave, Vivaldi, plain Chromium. They
  // all map chrome://extensions/shortcuts to the same page.
  return { kind: "openable", browser: "Chrome", url: "chrome://extensions/shortcuts" };
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
