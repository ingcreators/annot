/**
 * Renderer-side `CaptureHost` for the Electron Browse window.
 *
 * Phase 3 of `docs/plans/desktop-browser-mode.md` shipped the
 * visible-mode-only stub. Phase 4A wires the host primitives that
 * round-trip through the `<webview>`'s content-script preload
 * (`./content-preload.ts`):
 *
 *   - `sendToContent` posts `annot.host.request` messages to the
 *     embedded webview via `webview.send(...)`. The preload
 *     responds on `annot.content.response` (the chrome listens via
 *     `webview.addEventListener("ipc-message", ...)`); the host
 *     correlates by `reqId` to settle the matching pending
 *     promise. A 5-second timeout protects against a non-
 *     responding preload.
 *
 *   - `onContentMessage` subscribes to one-shot events
 *     (`annot.content.event`) the preload posts via
 *     `ipcRenderer.sendToHost`. The orchestrator uses this for
 *     area-select / area-cancelled / click-detected events.
 *
 *   - `setEmulatedViewport` flips the `<webview>` element's
 *     inline `width` / `height` styles so the embedded
 *     `webContents` re-lays-out the page at the requested CSS-
 *     pixel viewport. `null` clears the inline styles to restore
 *     the chrome's default flex sizing.
 *
 *   - `injectContentScript` stays a no-op — the
 *     `will-attach-webview` listener in `main.ts` registers the
 *     content-preload declaratively, so navigation events don't
 *     need per-capture re-injection logic.
 *
 * Two host primitives still round-trip through main-process IPC
 * (Phase 3 wiring): `captureViewport` →
 * `browse.host.captureViewport` (which calls
 * `webContents.capturePage()` server-side); and
 * `requestPageMetadata` → `browse.host.executeMainWorld` (the
 * walker stringification stays renderer-side so
 * `src-electron/tsconfig.json` doesn't have to pull DOM types).
 *
 * Image-ops (`stitchSegments`, `cropRect`) and `encodeBatch` run
 * in the chrome renderer's `OffscreenCanvas` via the pure helpers
 * in `@ingcreators/annot-capture/encode` — no IPC.
 *
 * Phase 4B: `loadSettings` / `saveSettings` / `onSettingsChange`
 * remain Phase-6 stubs that return `DEFAULT_SETTINGS` and no-op.
 */

import { walkPageMetadata } from "@ingcreators/annot-capture/content/page-metadata-walker";
import {
  applyMosaic,
  cropRect as cropRectInRenderer,
  stitchSegments as stitchSegmentsInRenderer,
} from "@ingcreators/annot-capture/encode";
import type {
  BatchItem,
  CaptureEncodeResult,
  CaptureHost,
  CapturedViewport,
  CaptureTargetRef,
} from "@ingcreators/annot-capture/host";
import {
  DEFAULT_SETTINGS,
  type BackgroundToContentMessage,
  type ContentToBackgroundMessage,
  type Settings,
} from "@ingcreators/annot-capture/shared";
import type { PageMetadata } from "@ingcreators/annot-core";
import { encodeCapture } from "@ingcreators/annot-core/encode";
import type { CaptureRect, CaptureSegment } from "@ingcreators/annot-core/utils/types";

/** IPC channel names — mirrored verbatim in `content-preload.ts`.
 *  Pinned here as constants so a typo on either side surfaces at
 *  test-time rather than as a silent runtime no-op. */
const HOST_REQUEST_CHANNEL = "annot.host.request";
const CONTENT_RESPONSE_CHANNEL = "annot.content.response";
const CONTENT_EVENT_CHANNEL = "annot.content.event";

/** How long the host waits for a content-side response before
 *  rejecting the pending `sendToContent` promise. The orchestrator
 *  flows that need a response (`get-page-dimensions`,
 *  `scroll-to`'s `scroll-done` ack) all complete within a
 *  requestAnimationFrame in practice; 5 s is a generous ceiling
 *  that catches outright deadlock without masking momentary
 *  hiccups. */
const CONTENT_REQUEST_TIMEOUT_MS = 5000;

/** Reference to the `<webview>` the host targets. The host calls
 *  `getWebContentsId()` to resolve the main-side capture target,
 *  `getURL()` / `getTitle()` to populate the passthrough fields,
 *  `send(channel, payload)` to push host-side requests into the
 *  preload, and `addEventListener("ipc-message", ...)` to receive
 *  the preload's responses + events. The `style` accessors flip
 *  inline width/height for `setEmulatedViewport`. */
export interface BrowseTargetWebview {
  getWebContentsId(): number;
  getURL?(): string;
  getTitle?(): string;
  /** Optional URL/title accessor when the host calls them via
   *  property reads instead of method calls (the Electron
   *  `<webview>` tag exposes both — the property reads are
   *  cheaper but only update on `did-navigate`). */
  src?: string;
  /** Send an IPC message into the embedded webContents. The
   *  preload listens via `ipcRenderer.on(channel, ...)`. */
  send(channel: string, payload: unknown): void;
  /** Subscribe to `ipc-message` events the preload posts via
   *  `ipcRenderer.sendToHost(channel, payload)`. */
  addEventListener(
    type: "ipc-message",
    listener: (event: WebviewIpcMessageEvent) => void,
  ): void;
  removeEventListener(
    type: "ipc-message",
    listener: (event: WebviewIpcMessageEvent) => void,
  ): void;
  /** Inline-style accessor used by `setEmulatedViewport`. The
   *  HTMLElement `style` property is the production target;
   *  tests can pass a stub object with the same `width`/`height`
   *  setters. */
  style: { width: string; height: string };
}

/** Shape of an Electron `<webview>` `ipc-message` event. The
 *  Electron type isn't exposed on `HTMLElementEventMap`, so we
 *  declare the minimal slice we use. */
export interface WebviewIpcMessageEvent {
  channel: string;
  args: unknown[];
}

interface ElectronApi {
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

/** Capture-target-ref id sentinel for "no `<webview>` resolvable" —
 *  triggers the orchestrator's "no capturable surface" branch.
 *  Negative so it can never collide with a real `webContentsId`. */
const NO_TARGET_ID = -1;

export interface CreateBrowseCaptureHostOpts {
  /** The active `<webview>` to target. Phase 3+ supports a single
   *  tab; Phase 5 lifts this to a "currently-active tab" lookup. */
  webview: BrowseTargetWebview;
  /** Required Electron preload bridge. Defaults to
   *  `(window as { electronAPI?: ElectronApi }).electronAPI`. */
  api?: ElectronApi;
  /** Optional console-equivalent for the `log` primitive.
   *  Defaults to `console.{level}`. */
  console?: Pick<Console, "debug" | "info" | "warn" | "error">;
  /** Override the request-response timeout. Tests pin this so
   *  unresponsive-preload assertions don't have to wait the full
   *  default. */
  contentRequestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ResponseEnvelope {
  reqId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export function createBrowseCaptureHost(opts: CreateBrowseCaptureHostOpts): CaptureHost {
  const api =
    opts.api ?? (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
  if (!api) {
    throw new Error("[browse-host] window.electronAPI is missing — preload script not loaded?");
  }
  const log = opts.console ?? console;
  const requestTimeoutMs = opts.contentRequestTimeoutMs ?? CONTENT_REQUEST_TIMEOUT_MS;

  // ---- Content-bridge state ────────────────────────────────────
  const pending = new Map<string, PendingRequest>();
  const contentListeners = new Set<(msg: ContentToBackgroundMessage) => void>();
  let nextReqId = 1;

  // Single ipc-message listener fans out to either the request-
  // response correlation map or the event-listener set, by channel.
  const onIpcMessage = (event: WebviewIpcMessageEvent): void => {
    if (event.channel === CONTENT_RESPONSE_CHANNEL) {
      const envelope = event.args[0] as ResponseEnvelope | undefined;
      if (!envelope || typeof envelope.reqId !== "string") return;
      const p = pending.get(envelope.reqId);
      if (!p) return;
      pending.delete(envelope.reqId);
      clearTimeout(p.timer);
      if (envelope.ok) {
        p.resolve(envelope.result);
      } else {
        p.reject(new Error(envelope.error || "[browse-host] content request failed"));
      }
      return;
    }
    if (event.channel === CONTENT_EVENT_CHANNEL) {
      const msg = event.args[0] as ContentToBackgroundMessage | undefined;
      if (!msg || typeof (msg as { type?: unknown }).type !== "string") return;
      for (const cb of contentListeners) {
        try {
          cb(msg);
        } catch (err) {
          log.debug("[browse-host] content-listener callback threw:", err);
        }
      }
    }
  };
  opts.webview.addEventListener("ipc-message", onIpcMessage);

  return {
    async resolveTarget(): Promise<CaptureTargetRef | null> {
      let id: number;
      try {
        id = opts.webview.getWebContentsId();
      } catch {
        return null;
      }
      if (id === NO_TARGET_ID || !Number.isFinite(id) || id <= 0) {
        return null;
      }
      const url =
        (typeof opts.webview.getURL === "function" ? opts.webview.getURL() : opts.webview.src) ??
        "";
      const title =
        typeof opts.webview.getTitle === "function" ? opts.webview.getTitle() : undefined;
      return { id, windowId: undefined, url, title };
    },

    async captureViewport(target): Promise<CapturedViewport> {
      const result = await api.invoke<CapturedViewport>("browse.host.captureViewport", {
        webContentsId: target.id,
      });
      return result;
    },

    async setEmulatedViewport(_target, size) {
      // Flip the `<webview>` element's inline size. The chrome's
      // flex layout collapses around the new dimensions; the
      // embedded webContents re-lays-out the page at the new
      // viewport. The orchestrator's `withEmulatedViewport`
      // already pairs `set(size)` … `set(null)` for restore.
      if (size === null) {
        opts.webview.style.width = "";
        opts.webview.style.height = "";
        return;
      }
      opts.webview.style.width = `${size.width}px`;
      opts.webview.style.height = `${size.height}px`;
    },

    async sendToContent<T = unknown>(
      _target: CaptureTargetRef,
      msg: BackgroundToContentMessage,
    ): Promise<T> {
      const reqId = String(nextReqId++);
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending.delete(reqId)) {
            reject(
              new Error(
                `[browse-host] sendToContent(${msg.type}) timed out after ${requestTimeoutMs}ms`,
              ),
            );
          }
        }, requestTimeoutMs);
        pending.set(reqId, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
        });
        try {
          opts.webview.send(HOST_REQUEST_CHANNEL, { reqId, msg });
        } catch (err) {
          // `webview.send` throws synchronously when the embedded
          // webContents is gone (navigation in flight, window
          // closing). Settle the pending promise immediately.
          if (pending.delete(reqId)) {
            clearTimeout(timer);
            reject(err);
          }
        }
      });
    },

    onContentMessage(handler) {
      contentListeners.add(handler);
      return () => {
        contentListeners.delete(handler);
      };
    },

    async injectContentScript() {
      // No-op: the `will-attach-webview` listener in `main.ts`
      // registers `content-preload.cjs` declaratively, so the
      // content bridge runs at every navigation without explicit
      // re-injection.
    },

    async requestPageMetadata(target, area?: CaptureRect): Promise<PageMetadata | null> {
      // Renderer-side composition of the walker expression. Keeping
      // the `.toString()` call on this side means src-electron's
      // tsconfig (which drops `lib: DOM` to keep main-process code
      // honest about no `document` / `window` access) doesn't have
      // to resolve the walker's DOM-using body. The IPC channel is
      // a generic main-world JS executor.
      const walkerSource = walkPageMetadata.toString();
      const areaArg = area ? JSON.stringify(area) : "null";
      const expression = `(${walkerSource})(${areaArg})`;
      try {
        const result = (await api.invoke<unknown>("browse.host.executeMainWorld", {
          webContentsId: target.id,
          expression,
        })) as PageMetadata | null | undefined;
        if (
          result &&
          typeof result === "object" &&
          Array.isArray((result as { elements?: unknown }).elements)
        ) {
          return result;
        }
        return null;
      } catch (err) {
        log.warn("[browse-host] page metadata request failed:", err);
        return null;
      }
    },

    async stitchSegments(segments: CaptureSegment[], width, height): Promise<string> {
      // The chrome renderer is itself a Chromium context with
      // `OffscreenCanvas`, so the pure-renderer helpers from
      // `@ingcreators/annot-capture/encode` work as-is — no IPC.
      return stitchSegmentsInRenderer(segments, width, height);
    },

    async cropRect(dataUrl, rect, dpr): Promise<string> {
      return cropRectInRenderer(dataUrl, rect, dpr);
    },

    async encodeBatch(items: BatchItem[]): Promise<CaptureEncodeResult[]> {
      // No offscreen worker pool yet — encode serially in the chrome
      // renderer. Visible-mode produces 1-element batches; future
      // multi-page / scroll modes will benefit from parallel
      // encoding (a follow-up either spins up a worker pool here or
      // lifts the offscreen-encode pattern from the extension).
      const results: CaptureEncodeResult[] = [];
      for (const item of items) {
        let url = item.pngDataUrl;
        if (
          item.cropSrcY > 0 ||
          (item.cropHeight > 0 && item.cropHeight < item.fullHeight)
        ) {
          try {
            url = await cropPngVerticalForBatch(item.pngDataUrl, item.cropSrcY, item.cropHeight);
          } catch (err) {
            log.debug("[browse-host] batch-crop failed, using uncropped slice:", err);
          }
        }
        const r = await encodeCapture(url, item.options);
        results.push(r);
      }
      return results;
    },

    async loadSettings(): Promise<Settings> {
      // Phase 4A: defaults only. Phase 6 ports the settings UI and
      // persists through `<userData>/browse-settings.json`.
      return DEFAULT_SETTINGS;
    },

    async saveSettings() {
      /* no-op until Phase 6 */
    },

    onSettingsChange() {
      /* no-op subscriber until Phase 6 */
      return () => {};
    },

    log(level, ...args) {
      log[level](...args);
    },
  };
}

/** `applyMosaic` re-export so tests / future blur-tool wiring can
 *  reach it through the host module. The mosaic helper itself is a
 *  pure function in the capture package; no host-state dependency. */
export { applyMosaic };

/** Vertical PNG crop used inside `encodeBatch`'s serial path. The
 *  chrome host has the same logic; here we inline a minimal copy so
 *  the desktop-renderer doesn't import `chrome-types` transitively. */
async function cropPngVerticalForBatch(
  pngDataUrl: string,
  srcY: number,
  keepHeight: number,
): Promise<string> {
  const blob = await (await fetch(pngDataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const w = bmp.width;
  const yClamped = Math.max(0, Math.min(srcY, bmp.height));
  const h = Math.max(0, Math.min(keepHeight, bmp.height - yClamped));
  if (h <= 0) {
    bmp.close();
    return pngDataUrl;
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    return pngDataUrl;
  }
  ctx.drawImage(bmp, 0, yClamped, w, h, 0, 0, w, h);
  bmp.close();
  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(outBlob);
  });
}
