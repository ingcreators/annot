/**
 * Pop-up vs. tab routing for embedded `<webview>` window-open
 * requests.
 *
 * Phase 5B of `docs/plans/desktop-browser-mode.md`. Phase 5
 * shipped multi-tab support that handled `target="_blank"` /
 * `window.open(url)` by opening the URL in a new tab in the same
 * Browse window — at the cost of `window.opener` being lost,
 * which broke OAuth popups (Google sign-in et al.) that rely on
 * `opener.postMessage` to send the auth response back.
 *
 * 5B differentiates two intents based on the window-features
 * string Chromium hands `setWindowOpenHandler`:
 *
 *   - **Popup**: features include explicit `width=` or `height=`
 *     (the OAuth pattern). Electron is allowed to spawn a child
 *     `BrowserWindow` so `window.opener` survives and the
 *     popup's `postMessage` reaches its parent. The popup window
 *     is sized per the requested dimensions, parented to the
 *     Browse window (auto-closes when Browse closes), and
 *     constrained to safe defaults (`contextIsolation: true`,
 *     `nodeIntegration: false`, no annot content-preload).
 *
 *   - **Navigation**: bare `window.open(url)` /
 *     `target="_blank"` / `disposition: "foreground-tab"`.
 *     Routed back to the Browse window's TabsManager via the
 *     `browse.open-tab` IPC event, opening as a new tab in the
 *     same Browse window.
 *
 * The classification + dimension parsing live in this module so
 * unit tests can drive every branch without booting Electron.
 * `main.ts` calls `classifyWindowOpenRequest(details)` from a
 * `webContents.setWindowOpenHandler` and routes accordingly.
 */

/** Subset of Electron's `HandlerDetails` we need for the
 *  classification. Pinned here so tests don't have to depend on
 *  Electron's type. */
export interface WindowOpenDetailsLike {
  /** Target URL the embedded page wants to open. */
  url: string;
  /** Comma-separated window features string from `window.open`'s
   *  third arg. Empty string for `target="_blank"` / bare
   *  `window.open(url)`. */
  features: string;
  /** Chromium's classification of the request. `'foreground-tab'`
   *  for `target="_blank"`, `'new-window'` for `window.open(url)`,
   *  `'background-tab'` / `'default'` / `'other'` are also
   *  possible per the docs. */
  disposition: string;
}

export type WindowOpenRouting =
  | {
      kind: "popup";
      /** Width parsed from `features.width=...` or the fallback. */
      width: number;
      /** Height parsed from `features.height=...` or the fallback. */
      height: number;
    }
  | { kind: "tab" };

/** Default popup dimensions when the features string is missing
 *  width / height (Electron's setWindowOpenHandler still hands
 *  us a `'new-window'` disposition with empty features for some
 *  bare `window.open(url, '_blank')` cases — treat those as
 *  navigation, but if they ever do reach the popup branch,
 *  600×700 is the conservative OAuth-popup default Chrome
 *  itself uses). */
export const DEFAULT_POPUP_WIDTH = 600;
export const DEFAULT_POPUP_HEIGHT = 700;

/** Decide whether a window-open request is a popup intent (OAuth
 *  pattern) or a navigation intent (target="_blank" / bare
 *  window.open). The detection uses the window-features string
 *  rather than the disposition because Chromium reports
 *  disposition `'new-window'` for both, but only popups carry
 *  explicit dimensions in features. */
export function classifyWindowOpenRequest(
  details: WindowOpenDetailsLike,
): WindowOpenRouting {
  if (hasExplicitDimensions(details.features)) {
    return {
      kind: "popup",
      width: parseFeatureDim(details.features, "width") ?? DEFAULT_POPUP_WIDTH,
      height: parseFeatureDim(details.features, "height") ?? DEFAULT_POPUP_HEIGHT,
    };
  }
  return { kind: "tab" };
}

/** Window features have one of the explicit-dimension keys
 *  (`width=` or `height=`). Treat the presence of either as a
 *  popup intent — most OAuth flows set both, but a few (Apple
 *  Sign-In) set only height. */
export function hasExplicitDimensions(features: string): boolean {
  return /(?:^|,)\s*(?:width|height)\s*=/i.test(features);
}

/** Parse a single numeric feature value (e.g. `width=600`). Returns
 *  `null` when missing or non-numeric so the caller can apply a
 *  fallback. */
export function parseFeatureDim(
  features: string,
  key: "width" | "height",
): number | null {
  const m = new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*(\\d+)`, "i").exec(features);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
