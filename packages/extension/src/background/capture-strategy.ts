/**
 * Pure capture-orchestration math, extracted from `service-worker.ts`
 * so the segment plan, browser-chrome delta, and viewport-target
 * arithmetic can be unit-tested without `chrome.*` APIs.
 *
 * The service worker remains the I/O orchestrator (it actually scrolls
 * the page, calls `chrome.tabs.captureVisibleTab`, resizes windows);
 * this file owns the "what should we do?" decisions:
 *   - How many scroll segments fit the page, and what scrollY for each?
 *   - What stitch canvas size results, capped at MAX_CANVAS_DIMENSION?
 *   - What window size do we need to land the captured viewport at the
 *     user's target pixel resolution given the current DPR + chrome
 *     framing delta?
 *
 * Companion test fixtures: `capture-strategy.test.ts` drives every
 * branch with plain numbers; no DOM, no Chrome runtime.
 */

import { MAX_CANVAS_DIMENSION } from "./service-worker-helpers.js";

// ─── Window-size math (used by withWindowResize) ──────────────────────

export interface Size {
  width: number;
  height: number;
}

export interface ChromeDelta {
  /** Window width minus inner CSS viewport width — i.e. the horizontal
   *  pixels the browser chrome (toolbars, scrollbar) takes. */
  width: number;
  /** Window height minus inner CSS viewport height — i.e. the
   *  vertical pixels the browser chrome (tab bar, address bar) takes. */
  height: number;
}

/** Lower bound applied to every dimension before it lands at
 *  `chrome.windows.update`. Chrome silently ignores tiny values; the
 *  guard keeps captures sane when the user picks an absurd preset. */
export const MIN_WINDOW_DIMENSION = 320;

/**
 * Compute the browser-chrome delta given a window's outer size and
 * the page's reported inner viewport size. Negative components
 * collapse to 0 (the page sometimes reports a viewport larger than
 * the window when a transparent address-bar overlay is drawn). The
 * caller adds this delta back to a target CSS size to derive the
 * outer window size needed to land the inner viewport at that target.
 */
export function computeChromeDelta(
  outerWindow: { width?: number | undefined; height?: number | undefined },
  innerViewport: { width?: number | undefined; height?: number | undefined },
): ChromeDelta {
  const w = outerWindow.width;
  const h = outerWindow.height;
  const vw = innerViewport.width;
  const vh = innerViewport.height;
  return {
    width: w != null && vw != null ? Math.max(0, w - vw) : 0,
    height: h != null && vh != null ? Math.max(0, h - vh) : 0,
  };
}

/**
 * Convert a "physical pixel" capture target into the CSS-pixel size
 * the page must render at to produce that target after Chrome's
 * `captureVisibleTab` (which captures at CSS × DPR).
 *
 * Returns rounded integer dimensions because window-size APIs only
 * take ints. A DPR of 0 is treated as 1 (the I/O layer never sees
 * 0 in practice but the math should not divide by zero).
 */
export function pixelToCssSize(pixelTarget: Size, devicePixelRatio: number): Size {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    width: Math.round(pixelTarget.width / dpr),
    height: Math.round(pixelTarget.height / dpr),
  };
}

/**
 * Compute the outer window size needed so the inner CSS viewport
 * lands at `pixelTarget / devicePixelRatio`, after accounting for the
 * browser-chrome `chromeDelta`. Each dimension is clamped to a
 * minimum so degenerate inputs don't ask Chrome for a zero-sized
 * window.
 */
export function computeDesiredWindowSize(
  pixelTarget: Size,
  devicePixelRatio: number,
  chromeDelta: ChromeDelta,
  minDim: number = MIN_WINDOW_DIMENSION,
): Size {
  const css = pixelToCssSize(pixelTarget, devicePixelRatio);
  return {
    width: Math.max(minDim, css.width + Math.max(0, chromeDelta.width)),
    height: Math.max(minDim, css.height + Math.max(0, chromeDelta.height)),
  };
}

// ─── Scroll-segment plan (used by captureFullPageInner) ───────────────

export interface PageDims {
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

export interface ScrollSegment {
  /** Zero-based segment index. Useful as a stable id when rendering
   *  progress and as a discriminator for `shouldHideOverlaysFor`'s
   *  `segmentIndex` argument. */
  index: number;
  /** scrollY (in CSS pixels) the page should land at before
   *  capturing this segment. */
  scrollY: number;
  /** True for the last segment; tests use this and the orchestrator
   *  can reuse it to skip the inter-segment delay. */
  isLast: boolean;
}

export interface ScrollSegmentPlan {
  segments: ScrollSegment[];
  /** Width of the stitched canvas in physical pixels. */
  stitchWidth: number;
  /** Height of the stitched canvas in physical pixels, capped at
   *  `maxCanvasDim`. The orchestrator uses this exact value when
   *  calling the offscreen stitcher. */
  stitchHeight: number;
  /** True when the natural stitch height was capped by `maxCanvasDim`.
   *  The orchestrator currently surfaces this via a console warning;
   *  exposed here so future UI can show a "page truncated" hint. */
  capped: boolean;
}

/**
 * Plan a vertical scroll-capture across the page. Segments are
 * laid out top-down at viewport height intervals; the last segment
 * is shifted up so its bottom lines up with the page bottom (instead
 * of clipping a partial viewport). This matches the historical
 * behavior in `captureFullPageInner` exactly.
 *
 * Pages shorter than one viewport produce a single segment at scrollY=0.
 */
export function planScrollSegments(
  page: PageDims,
  maxCanvasDim: number = MAX_CANVAS_DIMENSION,
): ScrollSegmentPlan {
  const vpHeight = page.viewportHeight;
  // Defensive: a zero viewport would loop forever. The orchestrator
  // never sees this in practice (a zero-height tab can't be
  // captured), but the math should not blow up.
  const safeVpHeight = vpHeight > 0 ? vpHeight : 1;
  const numSegments = Math.max(1, Math.ceil(page.scrollHeight / safeVpHeight));

  const segments: ScrollSegment[] = [];
  for (let i = 0; i < numSegments; i++) {
    let scrollY = i * safeVpHeight;
    if (i === numSegments - 1 && numSegments > 1) {
      // Last segment: shift up so its bottom edge aligns with the
      // page bottom. For a single-segment page (numSegments === 1)
      // we keep scrollY = 0 since the viewport already covers it.
      scrollY = page.scrollHeight - safeVpHeight;
    }
    // scrollY can become negative when scrollHeight < viewportHeight
    // (partial last viewport on a short page); clamp to 0.
    if (scrollY < 0) scrollY = 0;
    segments.push({
      index: i,
      scrollY,
      isLast: i === numSegments - 1,
    });
  }

  const stitchWidth = Math.round(page.viewportWidth * page.devicePixelRatio);
  const naturalStitchHeight = Math.round(page.scrollHeight * page.devicePixelRatio);
  const stitchHeight = Math.min(naturalStitchHeight, maxCanvasDim);

  return {
    segments,
    stitchWidth,
    stitchHeight,
    capped: naturalStitchHeight > maxCanvasDim,
  };
}

// ─── Per-page step decision (used by capturePagesInner) ──────────────
//
// Per-page capture re-measures the page on every iteration to handle
// lazy-loaded content that changes scrollHeight as the user scrolls
// past trigger points. So unlike `planScrollSegments`, we can't lay
// the whole capture out in one pass — we plan ONE iteration at a
// time, given the freshly-measured response from the page. Three
// stop conditions terminate the loop early when the orchestrator
// would otherwise produce a redundant or stuck capture.

/** Default minimum content height (in CSS pixels) below which a
 *  trailing page is dropped instead of becoming a "page N+1" with
 *  almost no fresh content. Matches the historical
 *  `MIN_LAST_PAGE_CONTENT_PX` literal in `service-worker.ts`. */
export const DEFAULT_MIN_LAST_PAGE_CONTENT_PX = 80;

/** Default safety cap on the number of per-page captures. Lazy-loaded
 *  pages that grow unboundedly need a hard ceiling so the loop can't
 *  spin forever. Matches the historical `MAX_PAGES` literal. */
export const DEFAULT_MAX_PAGES = 60;

export interface PerPageStepInput {
  /** Zero-based index of the iteration about to be processed. */
  pageIndex: number;
  /** The "intended top" — where the orchestrator asked the page to
   *  scroll to before this iteration. The page may have honored a
   *  smaller value (e.g. clamping to scrollHeight); the actual
   *  scroll position is read from `actualScrollY` below. */
  nextDocTop: number;
  /** CSS-pixel viewport height as last reported by the page. */
  viewportHeight: number;
  /** CSS-pixel scrollHeight as freshly reported AFTER the scroll +
   *  paint. Lazy-load triggers can have grown this between iterations. */
  scrollHeight: number;
  /** CSS-pixel scrollY actually reached after the scroll. May be
   *  below the requested `nextDocTop` if the page is shorter than
   *  expected. */
  actualScrollY: number;
  devicePixelRatio: number;
  /** `actualScrollY` from the previous iteration, for the
   *  "scroll position stuck" guard. Pass `-1` for the first
   *  iteration (no prior scroll). */
  lastActualScrollY: number;
  /** Minimum CSS-pixel slice for trailing pages. See
   *  {@link DEFAULT_MIN_LAST_PAGE_CONTENT_PX}. */
  minLastPageContentPx?: number;
}

/** "Capture this slice" payload returned when the iteration produces
 *  a usable image. Numbers are in physical pixels (DPR-scaled) where
 *  named with `Px`, in CSS pixels where named with `Css`. */
export interface PerPageSlice {
  /** Vertical offset INSIDE the captured PNG where this slice's
   *  fresh content begins, in physical pixels. */
  srcYpx: number;
  /** Height of this slice in physical pixels. */
  sliceHeightPx: number;
  /** Height of this slice in CSS pixels. */
  sliceCss: number;
  /** Top of this slice in document CSS coords. */
  intendedTopCss: number;
  /** Bottom of this slice in document CSS coords. */
  intendedBotCss: number;
  /** Where the next iteration should ask to scroll to. */
  nextDocTopAfter: number;
  /** True when `nextDocTopAfter >= scrollHeight`, i.e. the next
   *  iteration would be entirely past the end of the document and
   *  the orchestrator should stop the loop. */
  doneAfter: boolean;
}

export type PerPageStopReason = "no-advance" | "trailing-too-small" | "scroll-stuck";

export type PerPageStepDecision =
  | { action: "capture"; slice: PerPageSlice }
  | { action: "stop"; reason: PerPageStopReason };

/**
 * Decide what one iteration of `capturePagesInner` should do given
 * the freshly-measured page state. This is the entire pure portion
 * of the per-page loop: every conditional that could terminate the
 * loop OR shape the slice rectangle lives here, so each branch is
 * unit-testable.
 *
 * The orchestrator is responsible for:
 *   - actually scrolling the page to `input.nextDocTop`
 *   - sleeping for `scrollSettleMs` + `POST_HIDE_PAINT_MS`
 *   - calling `chrome.tabs.captureVisibleTab` after a `capture`
 *     decision
 *   - propagating `slice.nextDocTopAfter` into the next call's
 *     `nextDocTop`
 *   - propagating `actualScrollY` into the next call's
 *     `lastActualScrollY`
 *   - applying the `MAX_PAGES` cap (test for it externally — it's a
 *     loop-level rather than per-iteration concern)
 */
export function planPerPageStep(input: PerPageStepInput): PerPageStepDecision {
  const minLastPageContentPx = input.minLastPageContentPx ?? DEFAULT_MIN_LAST_PAGE_CONTENT_PX;

  const visibleTopCss = input.actualScrollY;
  const visibleBotCss = Math.min(input.actualScrollY + input.viewportHeight, input.scrollHeight);
  const intendedTopCss = Math.max(input.nextDocTop, visibleTopCss);
  const intendedBotCss = visibleBotCss;
  const sliceCss = intendedBotCss - intendedTopCss;

  // Stop condition 1: the page didn't (or couldn't) advance the
  // visible window enough to produce any new content for this slice.
  if (sliceCss <= 0) return { action: "stop", reason: "no-advance" };

  // Stop condition 2: the trailing slice has too little fresh content
  // to be worth a "page N+1" — only applies after at least one page
  // has been captured. The first page is always kept regardless.
  if (input.pageIndex > 0 && sliceCss < minLastPageContentPx) {
    return { action: "stop", reason: "trailing-too-small" };
  }

  // Stop condition 3: the scroll position got stuck at the same
  // value as the previous iteration AND the intended top matches
  // that position — the page is refusing to advance further (e.g.
  // a sticky footer pinning the viewport), so further iterations
  // would keep producing the same slice forever.
  if (
    input.actualScrollY === input.lastActualScrollY &&
    intendedTopCss === input.lastActualScrollY
  ) {
    return { action: "stop", reason: "scroll-stuck" };
  }

  const srcYpx = Math.round((intendedTopCss - visibleTopCss) * input.devicePixelRatio);
  const sliceHeightPx = Math.round(sliceCss * input.devicePixelRatio);
  const nextDocTopAfter = intendedBotCss;
  const doneAfter = nextDocTopAfter >= input.scrollHeight;

  return {
    action: "capture",
    slice: {
      srcYpx,
      sliceHeightPx,
      sliceCss,
      intendedTopCss,
      intendedBotCss,
      nextDocTopAfter,
      doneAfter,
    },
  };
}
