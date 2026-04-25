/**
 * Pure helpers for the extension service worker. Constants, URL
 * builders / parsers, capturable-URL predicate, and a one-line
 * `delay`. All side-effect-free aside from the timer in `delay`.
 *
 * Extracted from `service-worker.ts` as Stage 3e-1 of
 * `docs/plans/pre-release-cleanup.md`. Same incremental pattern
 * as 3a-5 / 3b-1 / 3c-1 / 3d-1: lift the pure surface first, leave
 * the stateful capture orchestrator for future sub-PRs.
 */

/**
 * Hard cap on canvas dimension we'll attempt to render. Above this
 * Chrome silently downsamples or refuses, so the encoder pipeline
 * pre-checks before allocating.
 */
export const MAX_CANVAS_DIMENSION = 32767;

/** Maximum age for retained images in IDB before the startup
 *  auto-cleanup deletes them. Currently 7 days. */
export const IDB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Small delay after `hide-for-capture` so the DOM mutation is painted
 * before we snap the viewport. Using `display: none` on the progress
 * overlay triggers a layout + paint; 80 ms gives Chrome's compositor
 * enough time to flush a stale frame before `captureVisibleTab` runs.
 */
export const POST_HIDE_PAINT_MS = 80;

/** Click-capture debounce window — successive clicks within this
 *  interval are ignored to avoid duplicate frames. */
export const CLICK_CAPTURE_MIN_INTERVAL_MS = 350;

/** Safety cap on click-capture frame count per session. */
export const CLICK_CAPTURE_MAX_FRAMES = 500;

/** Hotkey-capture debounce window. Faster than click capture
 *  because keyboard shortcut presses can come from auto-repeat. */
export const HOTKEY_CAPTURE_MIN_INTERVAL_MS = 200;

/**
 * Annotation app URL. Vite swaps this at build time:
 *   `vite` / `vite dev`   → http://localhost:3000
 *   `vite build` (ship)   → https://annot.work
 * If a staging deploy ever needs a third target, promote this to a
 * VITE_ANNOTATION_URL env var.
 */
export const ANNOTATION_URL = import.meta.env.DEV
  ? "http://localhost:3000"
  : "https://annot.work";

/** Build edit URL with multi-segment image path. */
export function buildEditUrl(path: string, extId: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${ANNOTATION_URL}/edit/extension/${encoded}?extId=${encodeURIComponent(extId)}`;
}

/**
 * Shared URL → tag extractor. Returns empty object if the URL can't be parsed.
 * Keys are populated only when the corresponding URL component is present:
 *   - host: URL.hostname
 *   - path: URL.pathname (when not "/")
 *   - query: URL.search (leading "?" stripped)
 *   - fragment: URL.hash (leading "#" stripped)
 */
export function urlTags(sourceUrl: string | undefined | null): Record<string, string> {
  if (!sourceUrl) return {};
  try {
    const u = new URL(sourceUrl);
    const t: Record<string, string> = {};
    if (u.hostname) t.host = u.hostname;
    if (u.pathname && u.pathname !== "/") t.path = u.pathname;
    if (u.search) t.query = u.search.slice(1);
    if (u.hash) t.fragment = u.hash.slice(1);
    return t;
  } catch {
    return {};
  }
}

/** True for URLs the extension can capture. Excludes
 *  `chrome://` / `chrome-extension://` / `about:` etc. */
export function isCapturableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^(https?|file|ftp):/.test(url);
}

/** Promise-wrapped `setTimeout`. Used to wait out paint flushes
 *  and reflow settles between capture stages. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
