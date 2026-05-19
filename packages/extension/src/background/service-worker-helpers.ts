/**
 * Extension-only helpers for the service worker. URL builders / parsers,
 * the capturable-URL predicate, and the storage-cleanup window.
 *
 * Phase 1A of `docs/plans/desktop-browser-mode.md`: shared constants
 * (canvas dim cap, paint-flush delay, hotkey debounce window,
 * `delay`) and the strategy math moved into
 * `@ingcreators/annot-capture/orchestrate`. The chrome / annot-app /
 * IDB-cleanup pieces stay here — they're extension-specific. The
 * shared constants are re-exported below so existing call sites
 * compile unchanged.
 */

export {
  delay,
  HOTKEY_CAPTURE_MIN_INTERVAL_MS,
  MAX_CANVAS_DIMENSION,
  POST_HIDE_PAINT_MS,
} from "@ingcreators/annot-capture/orchestrate";

/** Maximum age for retained images in IDB before the startup
 *  auto-cleanup deletes them. Currently 7 days. */
export const IDB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Annotation app URL. Vite swaps this at build time:
 *   `vite` / `vite dev`   → http://localhost:3000/app
 *   `vite build` (ship)   → https://annot.work/app
 *
 * The `/app` suffix is the PWA's Cloudflare route binding as of
 * Phase 8d of `docs/plans/launch-prep.md` (atomic URL switchover).
 * The PWA's Vite config sets `base: "/app/"` so its built `index.html`
 * carries `/app/`-prefixed asset URLs and its router strips the
 * prefix before parsing — staying in sync requires that EVERY URL
 * the extension hands back to the PWA includes the prefix.
 *
 * If a staging deploy ever needs a third target, promote this to a
 * VITE_ANNOTATION_URL env var.
 */
export const ANNOTATION_URL = import.meta.env.DEV
  ? "http://localhost:3000/app"
  : "https://annot.work/app";

/** Build edit URL with multi-segment image path. Mirrors the web app's
 *  `editUrl(store, path, extId)` builder — resource type lives between
 *  `edit` and `<store>` so `img` and `doc` share the same parent. */
export function buildEditUrl(path: string, extId: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${ANNOTATION_URL}/edit/img/extension/${encoded}?extId=${encodeURIComponent(extId)}`;
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
