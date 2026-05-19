/**
 * Post-reload "Updated to new version" toast.
 *
 * After `chunk-reload.ts` auto-reloads in response to a
 * `vite:preloadError`, the new bundle's `App.init` reads the
 * sessionStorage pending flag exactly once and shows a transient
 * info banner so the user isn't surprised by the apparent random
 * reload.
 *
 * Kept separate from `chunk-reload.ts` because that module imports
 * at the top of `main.ts` before any other initialisation, while
 * this one needs the `<annot-error-bar>` singleton mounted —
 * which only happens after the editor / file-manager DOM has been
 * built. `App.init` calls `showPostReloadBannerIfNeeded()` after
 * the first `requestAnimationFrame` so the `#toolbar` anchor
 * exists.
 *
 * See `docs/plans/web-dynamic-import-recovery.md`.
 */

import { showInfo } from "../ui/error-bar.js";
import { consumePostReloadFlag } from "./chunk-reload.js";

const POST_RELOAD_MESSAGE = "Updated to new version";
const POST_RELOAD_DURATION_MS = 4000;

/** Shows the toast at most once per page load. Returns `true` if
 *  it actually fired, `false` if there was no pending flag. */
export function showPostReloadBannerIfNeeded(): boolean {
  if (!consumePostReloadFlag()) return false;
  showInfo(POST_RELOAD_MESSAGE, POST_RELOAD_DURATION_MS);
  return true;
}
