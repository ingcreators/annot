/**
 * `CaptureHost` — the seam every host implements so the orchestrators
 * (Phase 1B and beyond) can drive a capture without knowing whether
 * they're talking to the Chrome extension's service-worker or the
 * Electron Browse window's main process.
 *
 * The interface is the contract; concrete implementations live in
 * `packages/extension/src/background/host.ts` (Phase 1B) and
 * `packages/desktop/src/browse/host.ts` (Phase 3 of
 * `desktop-browser-mode.md`).
 *
 * Phase 1A defines this shape so it's available to the orchestrator
 * code as it's lifted out of `service-worker.ts`. The interface is NOT
 * yet wired to any orchestrator in 1A — the live extension still calls
 * `chrome.*` directly from `service-worker.ts`. The first orchestrator
 * to consume it is `runVisibleCapture` in 1B.
 *
 * Design notes:
 *
 *  - **One `captureViewport`, no full-page primitive.** Full-page is
 *    built by the orchestrator out of `scrollTo` (content) +
 *    `captureViewport` (host) + stitch (shared). Each host's API
 *    matches this shape: extension `chrome.tabs.captureVisibleTab`,
 *    Electron `webContents.capturePage()`. An optional CDP fast-path
 *    via `webContents.debugger.attach() + Page.captureScreenshot
 *    { captureBeyondViewport: true }` stays an internal optimisation
 *    in the orchestrator, not a host primitive.
 *
 *  - **`setEmulatedViewport` is async + reversible.** Always paired
 *    `set(target)` … `set(null)` to restore. On Chrome this maps to
 *    `chrome.windows.update` with a saved geometry; on Electron to
 *    `BrowserView::setBounds` / `<webview>.setSize` with a saved
 *    geometry on the main side.
 *
 *  - **Transport is request/response + event stream.** Mirrors the
 *    `chrome.runtime.sendMessage` (with `sendResponse`) plus
 *    `chrome.runtime.onMessage` shape. Electron implements the same
 *    via a content-script preload's `__annot.dispatch` global +
 *    `ipcRenderer` events bridged through main.
 *
 *  - **DPR is always returned by the host** alongside the captured
 *    PNG. Orchestrators stop calling `window.devicePixelRatio` from
 *    JS and trust the value here. This fixes a long-standing
 *    extension bug where DPR drift between content/background
 *    mid-capture corrupts the stitched output (see Phase 2 of
 *    `desktop-browser-mode.md`).
 */

import type { PageMetadata } from "@ingcreators/annot-core";
import type { CaptureRect } from "@ingcreators/annot-core/utils/types";
import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
} from "./shared/messages.js";
import type { Settings } from "./shared/settings.js";

/** A single captured PNG plus the host-reported DPR at capture time. */
export interface CapturedViewport {
  pngDataUrl: string;
  /** `nativeImage.getScaleFactor()` (Electron) or
   *  capturedWidth / reportedViewportWidth (extension). */
  dpr: number;
}

/** A stable record the orchestrator hands to the host for persistence. */
export interface CaptureRecord {
  /** Encoded image data URL (PNG / JPEG / PNG-8 per user settings). */
  dataUrl: string;
  /** Pixel width of the encoded image. */
  width: number;
  /** Pixel height of the encoded image. */
  height: number;
  /** Source page URL at capture time. */
  sourceUrl: string;
  /** Free-form tag bag (host / path / click coords / sessionId / …). */
  tags: Record<string, string>;
  /** Optional DOM-side metadata snapshotted alongside the capture. */
  pageMetadata?: PageMetadata;
}

/** Logical capture target. Hosts map this to their concrete handle
 *  (extension: tab id; Electron: webContents id). */
export interface CaptureTargetRef {
  /** Opaque host-specific id. The orchestrator never inspects it; it
   *  passes the handle back to the host on every call so the host can
   *  resolve the right webContents / tab. */
  id: number;
  /** Human-readable URL the target is currently showing. Used for
   *  source-URL tagging on saved records. */
  url: string;
  /** Window-level handle the host needs to drive emulation
   *  (extension: chrome.windows id; Electron: BrowserWindow id). */
  windowId?: number;
}

/** Bag of size hints surfaced to the orchestrator after a content-side
 *  measurement. Mirrors the legacy `PageDimensions` shape. */
export interface ViewportMeasurement {
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
}

/** Options for the host's page-metadata extraction call. The
 *  orchestrator narrows captureRect to the slice the editor's Elements
 *  panel should surface (visible viewport for visible/area; the
 *  stitched/sliced rect for scroll/perPage). */
export interface PageMetadataRequest {
  area?: CaptureRect;
}

export interface CaptureHost {
  /** Capture the currently-visible viewport of `target`. */
  captureViewport(target: CaptureTargetRef): Promise<CapturedViewport>;

  /** Resize the host window so the inner viewport renders at the
   *  user's emulated size. Always called with `null` to restore on
   *  unwind. The host owns the saved-geometry bookkeeping. */
  setEmulatedViewport(
    target: CaptureTargetRef,
    size: { width: number; height: number } | null,
  ): Promise<void>;

  /** Send a request to the content side and await a response. */
  sendToContent<T = unknown>(target: CaptureTargetRef, msg: BackgroundToContentMessage): Promise<T>;

  /** Subscribe to one-shot events from the content side. Returns an
   *  unsubscribe function. */
  onContentMessage(handler: (msg: ContentToBackgroundMessage) => void): () => void;

  /** Snapshot DOM metadata for the area indicated by `req`. Returns
   *  null when injection isn't possible (e.g. chrome:// URLs). */
  requestPageMetadata(target: CaptureTargetRef, req?: PageMetadataRequest): Promise<PageMetadata | null>;

  /** Inject (or re-inject) the content-side capture script into
   *  `target`. Idempotent — the host's implementation deals with
   *  ping-then-skip-or-reinject. */
  injectContentScript(target: CaptureTargetRef): Promise<void>;

  /** Spawn one encode worker. The orchestrator multiplexes a small
   *  pool from the host-spawned workers (see
   *  `@ingcreators/annot-capture/encode/worker-pool`). */
  spawnEncodeWorker(): Worker;

  /** Persisted user settings. */
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  onSettingsChange(cb: (s: Settings) => void): () => void;

  /** Persist a finished capture record. The host owns whether this
   *  writes to IDB (extension), the filesystem under
   *  `<userData>/library/Inbox/` (desktop), or somewhere else
   *  (future). */
  appendCapture(record: CaptureRecord): Promise<void>;

  /** Open the editor on the just-saved record. Hosts route this to
   *  whichever editor surface they ship (extension: open or focus the
   *  PWA tab; desktop: open EditorShell on the in-process gallery). */
  openEditor(record: CaptureRecord): Promise<void>;

  /** Logging hook. Extension routes through `console.*`; desktop
   *  forwards to the main-process logger via IPC. */
  log(level: "debug" | "info" | "warn" | "error", ...args: unknown[]): void;
}
