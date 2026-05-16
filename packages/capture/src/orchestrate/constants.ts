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

/** Settle between `chrome.windows.update` and the corrective
 *  `get-page-dimensions` re-probe inside the host's emulated-viewport
 *  apply. The window-resize call resolves before the page commits
 *  the new layout, so `window.innerWidth/Height` is stale unless we
 *  give the browser one paint tick to converge.
 *
 *  Originally tuned to 80 ms for the maximized→normal case, where
 *  the state change is essentially instantaneous on Windows. The
 *  fullscreen→normal case (F11 browser fullscreen exit) has a real
 *  animation that lasts ≈200 ms on Chrome / Windows — probing too
 *  early sees the inner viewport mid-transition, the residual gets
 *  computed against transitional dims, and the corrective resize
 *  lands on the wrong outer size. Bumped to 300 ms so the page has
 *  fully reached its final non-fullscreen state before we re-probe.
 *
 *  Smaller than `EMULATION_REFLOW_MS` (400 ms) because we're only
 *  waiting for the chrome / inner-viewport math to stabilize, not
 *  for media queries or lazy images. The orchestrator's separate
 *  reflow wait still runs after `setEmulatedViewport` returns, so
 *  the user-perceptible reflow budget is unaffected by this bump. */
export const EMULATION_INNER_SETTLE_MS = 300;

/** Promise-wrapped `setTimeout`. Used to wait out paint flushes
 *  and reflow settles between capture stages. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
