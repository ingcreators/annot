/**
 * Feature-detection predicates for browser screen-capture and
 * clipboard read APIs. Used by the gallery's New menu (in
 * `editor-shell/gallery/sidebar.ts`) to gate the "Capture Screen"
 * / "Timed Capture" / "Paste from Clipboard" entries on platform
 * availability.
 *
 * Phase 2 of `docs/plans/host-convergence.md` lifts these out of
 * `packages/web/src/capture/pwa-capture.ts` so the gallery can
 * import them without a back-channel through `@ingcreators/annot-web`.
 * The PWA-specific runtime (`captureScreen`, `pasteFromClipboard`,
 * `startIntervalCapture`, the PiP overlay) stays in web — it's
 * only the predicates that the host-neutral gallery needs.
 */

/** Check if `navigator.mediaDevices.getDisplayMedia` is available. */
export function isScreenCaptureSupported(): boolean {
  return !!navigator.mediaDevices?.getDisplayMedia;
}

/** Check if `navigator.clipboard.read` is available. */
export function isClipboardReadSupported(): boolean {
  return !!navigator.clipboard?.read;
}
