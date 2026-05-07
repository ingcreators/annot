/**
 * Shared constants for the capture orchestrators.
 *
 * Phase 1A: lifted verbatim from
 * `packages/extension/src/background/service-worker-helpers.ts`. The
 * thresholds aren't host-specific — every consumer needs the same
 * canvas cap, paint-flush delay, etc.
 */

/**
 * Hard cap on canvas dimension we'll attempt to render. Above this
 * Chrome silently downsamples or refuses, so the encoder pipeline
 * pre-checks before allocating.
 */
export const MAX_CANVAS_DIMENSION = 32767;

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

/** Promise-wrapped `setTimeout`. Used to wait out paint flushes
 *  and reflow settles between capture stages. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
