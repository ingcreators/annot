/**
 * `CaptureHost` — the seam every host implements so the orchestrators
 * (`runVisibleCapture` / `runAreaCapture` / `runScrollCapture` /
 * `runPerPageCapture`) can drive a capture without knowing whether
 * they're talking to the Chrome extension's service-worker or the
 * Electron Browse window's main process.
 *
 * The interface is the contract; concrete implementations live in
 * `packages/extension/src/background/host.ts` (Phase 1B) and
 * `packages/desktop/src/browse/host.ts` (Phase 3 of
 * `desktop-browser-mode.md`).
 *
 * Design notes:
 *
 *  - **One `captureViewport`, no full-page primitive.** Full-page is
 *    built by the orchestrator out of `scrollTo` (content) +
 *    `captureViewport` (host) + stitch (host). Each host's API matches
 *    this shape: extension `chrome.tabs.captureVisibleTab`, Electron
 *    `webContents.capturePage()`. An optional CDP fast-path via
 *    `webContents.debugger.attach() + Page.captureScreenshot
 *    { captureBeyondViewport: true }` stays an internal optimisation
 *    in the orchestrator, not a host primitive.
 *
 *  - **`setEmulatedViewport` is async + reversible.** Always paired
 *    `set(target)` … `set(null)` to restore. On Chrome this maps to
 *    `chrome.windows.update` with a saved geometry; on Electron to
 *    `BrowserView::setBounds` / `<webview>.setSize` with a saved
 *    geometry on the main side. The host owns the saved-geometry
 *    bookkeeping AND the chrome-delta math (extension reads dpr +
 *    chrome-delta from a fresh page-dimensions probe; desktop reads
 *    them from `webContents.getZoomFactor` / window outer size).
 *
 *  - **DPR is always returned by the host** alongside the captured
 *    PNG. Orchestrators stop calling `window.devicePixelRatio` from
 *    JS and trust the value here. This fixes a long-standing
 *    extension bug where DPR drift between content/background
 *    mid-capture corrupts the stitched output (see Phase 2 of
 *    `desktop-browser-mode.md`).
 *
 *  - **Stitch / crop / encode primitives are host-side.** The
 *    extension routes them through its offscreen document; the
 *    Electron Browse window runs them in its chrome renderer. Either
 *    way the orchestrator just calls `host.stitchSegments(...)` and
 *    gets a PNG data URL back.
 *
 *  - **Persistence and editor-routing are NOT on this interface.**
 *    The orchestrator returns capture *frames* (encoded image data +
 *    metadata); the caller (extension service-worker, future desktop
 *    Browse-window renderer) decides where they go. That keeps
 *    extension-specific concerns (IDB tags, click/hotkey session
 *    bookkeeping, "open or reuse the PWA tab" routing) out of the
 *    shared seam.
 */

import type { ElementTree } from "@ingcreators/annot-core";
import type { EncodeResult } from "@ingcreators/annot-core/encode";
import type { CaptureRect, CaptureSegment } from "@ingcreators/annot-core/utils/types";
import type { BatchItem } from "./encode/worker-pool.js";
import type { BackgroundToContentMessage, ContentToBackgroundMessage } from "./shared/messages.js";
import type { Settings } from "./shared/settings.js";

// Re-export `BatchItem` so consumers reaching for the host
// surface (`@ingcreators/annot-capture/host`) don't have to also
// import from `@ingcreators/annot-capture/encode` just to type a
// host implementation that calls `host.encodeBatch(items)`.
export type { BatchItem };

/** A single captured PNG plus the host-reported DPR at capture time. */
export interface CapturedViewport {
  pngDataUrl: string;
  /**
   * Authoritative device-pixel-ratio for THIS capture. Hosts must
   * derive `dpr` from a source that's tied to the capture itself —
   * not from a separate content-side probe that could drift between
   * the read and the snapshot.
   *
   *   - Extension: `capturedWidth / reportedViewportWidth` once we
   *     have the bitmap, OR a fresh `get-page-dimensions` probe
   *     paired with the same `captureVisibleTab` call.
   *   - Electron (Browse window): `nativeImage.getScaleFactor()` on
   *     the `webContents.capturePage()` result.
   *   - Electron (`desktopCapturer`): the
   *     `MediaStreamTrack.getSettings()` ratio.
   *
   * Orchestrators consume this value for any post-capture math
   * (crop physical-pixel rect, stitch offset, metadata-area
   * conversion) — they MUST NOT use a separately-probed DPR for
   * those calculations, since the two can drift mid-capture if the
   * window moves between displays.
   */
  dpr: number;
}

/** Logical capture target. Hosts map this to their concrete handle
 *  (extension: tab id; Electron: webContents id). */
export interface CaptureTargetRef {
  /** Opaque host-specific id. The orchestrator never inspects it; it
   *  passes the handle back to the host on every call so the host can
   *  resolve the right webContents / tab. */
  id: number;
  /** Window-level handle the host needs to drive emulation
   *  (extension: chrome.windows id; Electron: BrowserWindow id). */
  windowId?: number;
  /** Current URL the target is showing. Used for source-URL tagging
   *  on saved records (the orchestrator passes it through to the
   *  caller; the host doesn't read it). */
  url: string;
  /** Page title at the time of resolution. Same role as `url` — pure
   *  passthrough. */
  title?: string;
}

/** Encode-batch result returned by `host.encodeBatch`. Same shape as
 *  `EncodeResult` from `@ingcreators/annot-core/encode`; re-exported
 *  under the `CaptureEncodeResult` alias so call sites read self-
 *  evident. */
export type CaptureEncodeResult = EncodeResult;

export interface CaptureHost {
  /** Locate the most plausible capture target. Returns null when no
   *  capturable surface is available (e.g. only `chrome://` /
   *  `chrome-extension://` tabs are open in the extension; no Browse
   *  window has focus on the desktop). */
  resolveTarget(): Promise<CaptureTargetRef | null>;

  /** Capture the currently-visible viewport of `target`. Returns a
   *  raw PNG data URL plus the DPR at capture time. */
  captureViewport(target: CaptureTargetRef): Promise<CapturedViewport>;

  /** Resize the host window so the inner viewport renders at the
   *  user's emulated size. Always paired `set(target, vp)` …
   *  `set(target, null)` to restore. The host's implementation owns
   *  the saved-geometry bookkeeping AND the chrome-delta / dpr math
   *  needed to translate `vp` (CSS pixels of inner viewport) into a
   *  concrete window-resize. */
  setEmulatedViewport(
    target: CaptureTargetRef,
    size: { width: number; height: number } | null,
  ): Promise<void>;

  /** Send a request to the content side and await a response. The
   *  generic on `T` is informational — every concrete `msg.type`
   *  binds to a specific response shape (e.g. `get-page-dimensions`
   *  → `PageDimensions`); the wire is fundamentally untyped, so the
   *  caller narrows. */
  sendToContent<T = unknown>(target: CaptureTargetRef, msg: BackgroundToContentMessage): Promise<T>;

  /** Subscribe to one-shot events from the content side. Returns an
   *  unsubscribe function. The orchestrator uses this for area-select
   *  / area-cancelled events. */
  onContentMessage(handler: (msg: ContentToBackgroundMessage) => void): () => void;

  /** Inject (or re-inject) the content-side capture script into
   *  `target`. Idempotent — the host's implementation deals with
   *  ping-then-skip-or-reinject and the "non-injectable URL" cases. */
  injectContentScript(target: CaptureTargetRef): Promise<void>;

  /** Snapshot the canonical `ElementTree` for `target`, optionally
   *  narrowed to `area` (in viewport CSS pixels). Returns null when
   *  injection isn't possible (e.g. chrome:// URLs) or fails for any
   *  reason — callers treat the tree as best-effort. */
  requestElementTree(target: CaptureTargetRef, area?: CaptureRect): Promise<ElementTree | null>;

  /** Stitch a vertical scroll capture's segments into one PNG. */
  stitchSegments(segments: CaptureSegment[], width: number, height: number): Promise<string>;

  /** Crop a `CaptureRect` (in CSS pixels) out of a full-viewport PNG.
   *  `dpr` scales the rect to physical pixels. */
  cropRect(dataUrl: string, rect: CaptureRect, dpr: number): Promise<string>;

  /** Encode a batch of capture frames per the user's quality settings.
   *  Implementations may parallelize across N workers (extension's
   *  offscreen pool) or run serially (small batches). */
  encodeBatch(items: BatchItem[]): Promise<CaptureEncodeResult[]>;

  /** Persisted user settings. Loading / saving / change-listening go
   *  through the host so chrome.storage / electron-fs / future
   *  backends share one orchestrator surface. */
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  onSettingsChange(cb: (s: Settings) => void): () => void;

  /** Logging hook. Extension routes through `console.*`; desktop
   *  forwards to the main-process logger via IPC. */
  log(level: "debug" | "info" | "warn" | "error", ...args: unknown[]): void;
}
