/**
 * PWA capture entry points — alternatives to Chrome Extension capture.
 *
 * Phase 5 of `docs/plans/web-capture-redesign.md` slimmed this
 * module down. The legacy `captureScreen` (single-frame
 * `getDisplayMedia` helper) and `startIntervalCapture` (the
 * Document-PiP-overlay-driven Timed Capture loop) are gone — the
 * new workspace at `/capture` (Phase 2+) reaches the same surface
 * via `CaptureSession` (`capture-session.ts`) and the
 * `AutoCaptureEngine` (Phase 4 of the same plan).
 *
 * `pasteFromClipboard` stays — it has nothing to do with screen
 * capture and is still wired by `CaptureHost.pasteAndSave` and
 * the desktop host.
 */

/**
 * Read image from clipboard.
 * Returns a data URL, or null if no image in clipboard.
 */
export async function pasteFromClipboard(): Promise<string | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          const blob = await item.getType(type);
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
