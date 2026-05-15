/**
 * Browser-aware detection of the extension shortcuts configuration
 * page. Consumed by both the Settings page (`options/options.ts`)
 * and the popup's "Hotkey unbound" inline notice
 * (`popup/annot-extension-popup.ts` + `popup/popup.ts`) so the two
 * surfaces stay in sync.
 *
 * Chromium variants (Chrome / Edge / Opera / Brave / Vivaldi /
 * Chromium proper) expose a deep-linkable internal page that
 * `chrome.tabs.create` can open. Firefox and Safari both block
 * extensions from opening their internal pages — Firefox blocks
 * `about:` URLs, Safari can't open the macOS Settings app — so
 * those variants fall back to a textual instruction step that the
 * UI renders inline instead of a button.
 */

export type ShortcutsTarget =
  | { kind: "openable"; browser: string; url: string }
  | { kind: "manual"; browser: string; steps: string };

/** Detect which browser variant we're running in and how its
 *  extension-shortcuts page can be reached. `openable` variants get
 *  a clickable button; `manual` variants get instructional text
 *  because they block extensions from opening the relevant page. */
export function detectShortcutsPage(): ShortcutsTarget {
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
