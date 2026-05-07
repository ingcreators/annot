/**
 * Renderer-side `CaptureHost` for the Electron Browse window.
 *
 * Phase 3 of `docs/plans/desktop-browser-mode.md`: drives
 * `runVisibleCapture` from `@ingcreators/annot-capture/orchestrate`
 * so the orchestrator never sees `chrome.*` / `webContents.*`
 * directly. Two host primitives round-trip through IPC:
 *
 *   - `captureViewport`        → `browse.host.captureViewport`
 *                                 → `webContents.capturePage()`
 *   - `requestPageMetadata`    → `browse.host.requestPageMetadata`
 *                                 → `executeJavaScript(walker, true)`
 *
 * Everything else stays renderer-side:
 *
 *   - Image-ops (`stitchSegments`, `cropRect`) run in the chrome
 *     renderer's `OffscreenCanvas` via the pure helpers in
 *     `@ingcreators/annot-capture/encode`.
 *   - `encodeBatch` calls `encodeCapture` from
 *     `@ingcreators/annot-core/encode` directly — no offscreen
 *     document needed; the chrome renderer is itself a Chromium
 *     context that runs WASM.
 *   - `sendToContent` / `onContentMessage` / `injectContentScript`
 *     are STUBBED in Phase 3. The `<webview>` preload that
 *     bridges them lands in Phase 4 along with the area /
 *     full-page / per-page / click / hotkey orchestrators.
 *     `runVisibleCapture` calls `beginCapturePrep` /
 *     `endCapturePrep` (which use `sendToContent`) but those
 *     swallow rejected promises so the visible-mode flow still
 *     produces an image.
 *   - `setEmulatedViewport` is a no-op placeholder. Phase 4 will
 *     wire it to `<webview>` width/height styles when the chrome
 *     UI exposes the viewport-emulation preset picker.
 *   - `loadSettings` returns `DEFAULT_SETTINGS`. Phase 6 ports
 *     the settings UI from the extension and persists via
 *     `<userData>/browse-settings.json`.
 *
 * Designed so the orchestrator can run end-to-end without the
 * Phase 4 / 6 work landed; visible-mode capture flows through the
 * shared orchestrator in Phase 3.
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
  type Settings,
} from "@ingcreators/annot-capture/shared";
import type { PageMetadata } from "@ingcreators/annot-core";
import { encodeCapture } from "@ingcreators/annot-core/encode";
import type { CaptureRect, CaptureSegment } from "@ingcreators/annot-core/utils/types";

/** Reference to the `<webview>` the host targets. The host calls
 *  `getWebContentsId()` to resolve the main-side capture target,
 *  and `getURL()` / `getTitle()` to populate `CaptureTargetRef`'s
 *  passthrough fields. */
export interface BrowseTargetWebview {
  getWebContentsId(): number;
  getURL?(): string;
  getTitle?(): string;
  /** Optional URL/title accessors when the host calls them via
   *  property reads instead of method calls (the Electron
   *  `<webview>` tag exposes both — the property reads are
   *  cheaper but only update on `did-navigate`). */
  src?: string;
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
  /** The active `<webview>` to target. Phase 3 supports a single
   *  tab; Phase 5 lifts this to a "currently-active tab" lookup. */
  webview: BrowseTargetWebview;
  /** Required Electron preload bridge. Defaults to
   *  `(window as { electronAPI?: ElectronApi }).electronAPI`. */
  api?: ElectronApi;
  /** Optional console-equivalent for the `log` primitive.
   *  Defaults to `console.{level}`. */
  console?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export function createBrowseCaptureHost(opts: CreateBrowseCaptureHostOpts): CaptureHost {
  const api =
    opts.api ?? (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
  if (!api) {
    throw new Error("[browse-host] window.electronAPI is missing — preload script not loaded?");
  }
  const log = opts.console ?? console;

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

    // Phase 3 stub — wired in Phase 4 alongside the `<webview>`
    // preload that exposes a content-script bus. The orchestrator
    // tolerates `setEmulatedViewport` no-ops because emulation is
    // disabled in `DEFAULT_SETTINGS` (which is what `loadSettings`
    // returns until Phase 6 ports the settings UI).
    async setEmulatedViewport() {
      /* no-op — Phase 4 */
    },

    // Phase 3 stub — same rationale as `setEmulatedViewport`. The
    // orchestrator's `beginCapturePrep` / `endCapturePrep` wrap
    // `sendToContent` in try/catch so rejected promises silently
    // degrade to "no sticky-hide / no scrollbar-hide" — matching
    // the Phase 6 MVP's visible-mode behaviour.
    async sendToContent<T = unknown>(): Promise<T> {
      throw new Error("[browse-host] sendToContent is not wired until Phase 4");
    },

    onContentMessage() {
      /* no-op subscriber until Phase 4 — return an unsubscribe fn
       *  that does nothing. */
      return () => {};
    },

    async injectContentScript() {
      /* no-op until Phase 4 — the `<webview>` preload mechanism
       *  registers the content bundle declaratively. */
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
      // encoding (Phase 4 either spins up a worker pool here or
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
      // Phase 3: defaults only. Phase 6 ports the settings UI and
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
