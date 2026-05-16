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

/** Hotkey-capture debounce window. Faster than the desktop Browse
 *  window's click-capture floor because keyboard shortcut presses
 *  can come from auto-repeat. */
export const HOTKEY_CAPTURE_MIN_INTERVAL_MS = 200;

/** Settle after a window-state transition (maximized / fullscreen
 *  → normal). Win 11 Aero / DWM animations + Chrome's F11 fullscreen
 *  exit (≈200 ms on Chrome / Windows) can outlast a typical paint
 *  tick; without this wait, the post-transition chrome decoration
 *  hasn't settled, and our subsequent chrome-delta probe captures a
 *  transitional inner viewport. 500 ms covers the slowest case
 *  observed (Win 11 default Aero settings on a 4K@150% display). */
export const EMULATION_STATE_TRANSITION_MS = 500;

/** Settle after a corrective `chrome.windows.update` that only
 *  changes the inner viewport size (no state change). The window
 *  is already in normal state and the resize is a small CSS-px
 *  delta, so the page only needs one paint tick to update
 *  `window.innerWidth/Height`. Much shorter than the state-
 *  transition settle. */
export const EMULATION_INNER_SETTLE_MS = 100;

/** Promise-wrapped `setTimeout`. Used to wait out paint flushes
 *  and reflow settles between capture stages. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
