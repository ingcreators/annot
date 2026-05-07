/**
 * Cross-mode capture-prep helpers.
 *
 * Every orchestrator does the same dance around a viewport capture:
 *
 *  1. `beginCapturePrep` — send `hide-for-capture` with the settings-
 *     derived overlay / scrollbar policy for `(kind, segmentIndex)`.
 *  2. wait `POST_HIDE_PAINT_MS` so the DOM mutation paints before
 *     `host.captureViewport` runs.
 *  3. capture.
 *  4. (per-mode work — encode, stitch, save).
 *  5. `endCapturePrep` — send `restore-after-capture`.
 *
 * The `progress*` helpers are best-effort — content-script
 * unavailability (chrome:// pages, etc.) is logged at debug level
 * and otherwise swallowed.
 */

import type { CaptureHost, CaptureTargetRef } from "../host.js";
import {
  type CaptureKind,
  parseSelectorList,
  type Settings,
  shouldHideOverlaysFor,
} from "../shared/settings.js";

/**
 * Send hide/restore directives to the content script. `segmentIndex`
 * matters for scroll / perPage captures with `keepFirstSegment` enabled:
 * segment 0 keeps overlays visible (natural page top) while segments 1+
 * hide them to avoid repeating fixed headers in the stitched / per-page
 * output.
 */
export async function beginCapturePrep(
  host: CaptureHost,
  target: CaptureTargetRef,
  kind: CaptureKind,
  settings: Settings,
  segmentIndex = 0,
): Promise<void> {
  const hideOverlays = shouldHideOverlaysFor(
    kind,
    settings.overlays.mode,
    segmentIndex,
    settings.overlays.keepFirstSegment,
  );
  const hideScrollbars = settings.scrollbars.hide;
  // Always send the message so the content script tracks the CURRENT state.
  // In particular, transitioning from segment 0 (overlays shown) to
  // segment 1 (overlays hidden) requires an explicit hide call.
  try {
    await host.sendToContent(target, {
      type: "hide-for-capture",
      overlays: hideOverlays,
      preservedSelectors: parseSelectorList(settings.overlays.preservedSelectors),
      scrollbars: hideScrollbars,
    });
  } catch {
    /* content script may not be ready — ignore */
  }
}

export async function endCapturePrep(
  host: CaptureHost,
  target: CaptureTargetRef,
): Promise<void> {
  try {
    await host.sendToContent(target, { type: "restore-after-capture" });
  } catch (err) {
    host.log("debug", "[capture-prep] restore-after-capture failed (tab gone or navigated):", err);
  }
}

/** Send `show-progress` to the content side. The "send" prefix
 *  distinguishes this host-side dispatcher from the DOM-side
 *  `showProgress` helper in `@ingcreators/annot-capture/content`
 *  which is what actually renders the overlay. */
export async function sendShowProgress(
  host: CaptureHost,
  target: CaptureTargetRef,
  text: string,
): Promise<void> {
  try {
    await host.sendToContent(target, { type: "show-progress", text });
  } catch (err) {
    host.log("debug", "[capture-prep] show-progress failed:", err);
  }
}

export async function sendHideProgress(
  host: CaptureHost,
  target: CaptureTargetRef,
): Promise<void> {
  try {
    await host.sendToContent(target, { type: "hide-progress" });
  } catch (err) {
    host.log("debug", "[capture-prep] hide-progress failed:", err);
  }
}
