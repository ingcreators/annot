/**
 * Screen-capture IPC — Phase 3 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Direct port of `packages/desktop/src-tauri/src/commands/screen_capture.rs`.
 * Seven channels:
 *
 *   - `capture_screen`            — full primary-display capture.
 *   - `list_windows`              — enumerate capturable windows.
 *   - `capture_window(hwnd)`      — capture a specific window by id.
 *   - `capture_region(x,y,w,h)`   — capture a region of the screen.
 *   - `start_capture_overlay(m)`  — orchestrate: minimize main,
 *                                  capture screen, open overlay,
 *                                  await user selection, restore
 *                                  main, return `OverlayResult`.
 *   - `get_capture_params`        — overlay queries this on load.
 *   - `capture_overlay_result(r)` — overlay sends the picked
 *                                  rectangle (or `null` cancel).
 *
 * The capture path uses Electron's `desktopCapturer.getSources` with
 * an explicit `thumbnailSize` matching the screen's physical pixel
 * resolution. The returned `NativeImage` is the actual screen
 * pixels — Chromium handles the platform-specific capture under
 * the hood (Windows DXGI / Mac CGDisplayStream / Linux PipeWire).
 * Uniform behaviour on Win / Mac / Linux is the explicit
 * motivation for the migration; this is where it pays off.
 *
 * **Why not `getUserMedia`?** The plan suggests `getUserMedia` as
 * one option for grabbing frames, but that API only lives in
 * renderer contexts. A pure main-process `desktopCapturer +
 * thumbnailSize` path keeps the IPC contract identical to the
 * Rust handlers (single round-trip returns `CaptureResult`) without
 * spawning a hidden capture-worker BrowserWindow.
 *
 * **Window-mode UX gap (Phase 3 known issue).** Tauri's
 * `list_windows` returns Win32 hwnd + extended-frame bounds, which
 * the overlay's window-mode uses for fullscreen hover-and-click
 * detection. `desktopCapturer` provides only a source ID + name +
 * thumbnail — no per-OS window position. Phase 3 returns the
 * source list with `x/y/width/height` all set to 0 so the overlay's
 * existing hover hit-test silently fails to match anything; users
 * fall back to rect mode. A follow-up replaces the fullscreen
 * hover overlay with a thumbnail-grid picker for window mode.
 */

import type { NativeImage } from "electron";

// ---- Types matching the Rust IPC channels ───────────────────────

export interface CaptureResult {
  data_url: string;
  width: number;
  height: number;
}

export interface WindowInfo {
  /** Source identifier. The Rust impl uses Win32 HWND (an `isize`);
   *  the Electron port uses `desktopCapturer`'s opaque source id
   *  string (`"window:1234:5"`). The renderer treats it as opaque
   *  and passes it through to `capture_window`. The field name
   *  stays `hwnd` for the moment so the Phase 5 import-flip in
   *  the renderer is a one-line change. Phase 9 cleanup renames
   *  to `source_id` along with the rest of the Tauri-era naming. */
  hwnd: string;
  title: string;
  /** Empty under Electron — `desktopCapturer` doesn't expose
   *  per-OS class names. */
  class: string;
  /** All set to 0 under Electron — see file-level "window-mode UX
   *  gap" note. The overlay's hover detection silently no-ops. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionResult {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureParams {
  mode: string;
  screenshot_data_url: string;
  screen_width: number;
  screen_height: number;
  windows: WindowInfo[];
}

export interface OverlayResult {
  region: RegionResult;
  screenshot_data_url: string;
  screen_width: number;
  screen_height: number;
}

// ---- Dependency injection seam ─────────────────────────────────
//
// The handlers don't import `electron` themselves — they take a
// thin adapter so unit tests construct against fakes without
// requiring an Electron runtime.

export interface PrimaryDisplay {
  /** Logical pixel size (CSS-pixels). */
  size: { width: number; height: number };
  /** DPR. Multiply `size` by this to get physical pixels. */
  scaleFactor: number;
}

export interface CapturerSourceLite {
  id: string;
  name: string;
  /** Pre-rendered thumbnail at the size requested via
   *  `thumbnailSize`. The handler converts to bytes via
   *  `.toJPEG(quality)` / `.toPNG()`. */
  thumbnail: NativeImage | NativeImageLite;
}

/** The subset of `NativeImage` the handlers use. Production
 *  passes the real Electron type; tests pass an in-memory fake. */
export interface NativeImageLite {
  toJPEG(quality: number): Buffer | Uint8Array;
  toPNG(): Buffer | Uint8Array;
  getSize(): { width: number; height: number };
  crop(rect: { x: number; y: number; width: number; height: number }): NativeImageLite;
}

export interface OverlayHandle {
  /** Close the overlay BrowserWindow. Called when the user picks
   *  / cancels and when start_capture_overlay's caller bails. */
  destroy(): void;
}

export interface ScreenCaptureDeps {
  /** Primary display geometry — `electron.screen.getPrimaryDisplay()`
   *  in production, a fixed stub in tests. */
  getPrimaryDisplay(): PrimaryDisplay;
  /** Mirror of `desktopCapturer.getSources` — same input/output
   *  shape, just typed against the smaller `CapturerSourceLite`. */
  getSources(opts: {
    types: Array<"screen" | "window">;
    thumbnailSize?: { width: number; height: number };
  }): Promise<CapturerSourceLite[]>;
  /** Minimize the main window (start_capture_overlay step 1). */
  minimizeMain(): void;
  /** Restore the main window (start_capture_overlay step 8). */
  restoreMain(): void;
  /** Open the overlay BrowserWindow. The handle's `destroy()`
   *  closes it. The deps owner registers a 'closed' listener that
   *  calls `notifyOverlayClosed` so the awaiting promise gets
   *  rejected on user-driven close. */
  openOverlay(): OverlayHandle;
}

// ---- Handler interface ──────────────────────────────────────────

export interface ScreenCaptureHandlers {
  captureScreen(): Promise<CaptureResult>;
  listWindows(): Promise<WindowInfo[]>;
  captureWindow(input: { hwnd: string }): Promise<CaptureResult>;
  captureRegion(input: { x: number; y: number; width: number; height: number }): Promise<CaptureResult>;
  startCaptureOverlay(input: { mode: string }): Promise<OverlayResult | null>;
  getCaptureParams(): Promise<CaptureParams>;
  captureOverlayResult(input: { result: RegionResult | null }): Promise<void>;
  /** Called by the deps owner when the overlay BrowserWindow is
   *  destroyed externally (user closed it, OS killed it). Resolves
   *  any in-flight `start_capture_overlay` promise with `null`. */
  notifyOverlayClosed(): void;
}

interface OverlayState {
  params: CaptureParams;
  resolve: (r: RegionResult | null) => void;
  handle: OverlayHandle;
}

export function createScreenCaptureHandlers(deps: ScreenCaptureDeps): ScreenCaptureHandlers {
  let overlay: OverlayState | null = null;

  function physicalScreenSize(): { width: number; height: number; scaleFactor: number } {
    const d = deps.getPrimaryDisplay();
    return {
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      scaleFactor: d.scaleFactor,
    };
  }

  async function captureScreenInternal(): Promise<{
    image: NativeImageLite;
    width: number;
    height: number;
  }> {
    const screen = physicalScreenSize();
    const sources = await deps.getSources({
      types: ["screen"],
      thumbnailSize: { width: screen.width, height: screen.height },
    });
    if (sources.length === 0) {
      throw new Error("No screen sources available — check OS-level permissions");
    }
    const primary = sources[0]!;
    const image = primary.thumbnail as NativeImageLite;
    const size = image.getSize();
    return { image, width: size.width, height: size.height };
  }

  function imageToCaptureResult(image: NativeImageLite): CaptureResult {
    const jpeg = image.toJPEG(90);
    const buf = jpeg instanceof Uint8Array ? Buffer.from(jpeg) : jpeg;
    const size = image.getSize();
    return {
      data_url: `data:image/jpeg;base64,${buf.toString("base64")}`,
      width: size.width,
      height: size.height,
    };
  }

  return {
    async captureScreen() {
      const { image } = await captureScreenInternal();
      return imageToCaptureResult(image);
    },

    async listWindows() {
      const sources = await deps.getSources({ types: ["window"] });
      return sources.map(
        (s): WindowInfo => ({
          hwnd: s.id,
          title: s.name,
          class: "",
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        }),
      );
    },

    async captureWindow({ hwnd }) {
      const id = String(hwnd);
      const screen = physicalScreenSize();
      // Thumbnail at full screen resolution caps the upscale at the
      // window's actual pixel size — Chromium downscales when the
      // window is smaller. JPEG quality is the same as screen
      // capture.
      const sources = await deps.getSources({
        types: ["window"],
        thumbnailSize: { width: screen.width, height: screen.height },
      });
      const found = sources.find((s) => s.id === id);
      if (!found) {
        throw new Error(`Window not found: ${id}`);
      }
      return imageToCaptureResult(found.thumbnail as NativeImageLite);
    },

    async captureRegion({ x, y, width, height }) {
      if (width <= 0 || height <= 0) {
        throw new Error("Invalid region");
      }
      const { image } = await captureScreenInternal();
      const cropped = image.crop({ x, y, width, height });
      return imageToCaptureResult(cropped);
    },

    async startCaptureOverlay({ mode }) {
      // Reject any in-flight overlay so a stale window doesn't
      // collide with a fresh request. Mirrors the Rust impl's
      // "destroy any existing overlay" guard.
      if (overlay) {
        overlay.handle.destroy();
        overlay.resolve(null);
        overlay = null;
      }

      deps.minimizeMain();
      // 400ms breathing room so the minimize animation completes
      // before the screen grab — matches the Rust impl's
      // `std::thread::sleep(Duration::from_millis(400))`.
      await new Promise<void>((r) => setTimeout(r, 400));

      let captureResult: { image: NativeImageLite; width: number; height: number };
      try {
        captureResult = await captureScreenInternal();
      } catch (err) {
        deps.restoreMain();
        throw err;
      }

      let windows: WindowInfo[] = [];
      if (mode === "window") {
        const winSources = await deps.getSources({ types: ["window"] });
        windows = winSources.map((s) => ({
          hwnd: s.id,
          title: s.name,
          class: "",
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        }));
      }

      const screenshotResult = imageToCaptureResult(captureResult.image);
      const params: CaptureParams = {
        mode,
        screenshot_data_url: screenshotResult.data_url,
        screen_width: screenshotResult.width,
        screen_height: screenshotResult.height,
        windows,
      };

      const handle = deps.openOverlay();
      const region = await new Promise<RegionResult | null>((resolve) => {
        overlay = { params, resolve, handle };
      });

      // `captureOverlayResult` / `notifyOverlayClosed` clear
      // `overlay` before resolving the promise, so by the time
      // we land here it's null. The captured `params` from
      // before the await is what the OverlayResult uses.
      overlay = null;
      deps.restoreMain();

      if (!region) return null;
      return {
        region,
        screenshot_data_url: params.screenshot_data_url,
        screen_width: params.screen_width,
        screen_height: params.screen_height,
      };
    },

    async getCaptureParams() {
      if (!overlay) {
        throw new Error("No params");
      }
      return overlay.params;
    },

    async captureOverlayResult({ result }) {
      if (!overlay) return;
      const handle = overlay.handle;
      const resolve = overlay.resolve;
      overlay = null;
      try {
        handle.destroy();
      } catch {
        /* ignore — already destroyed */
      }
      resolve(result);
    },

    notifyOverlayClosed() {
      if (!overlay) return;
      const resolve = overlay.resolve;
      overlay = null;
      resolve(null);
    },
  };
}

// ---- IPC channel inventory ──────────────────────────────────────

export const SCREEN_CAPTURE_CHANNELS = {
  captureScreen: "capture_screen",
  listWindows: "list_windows",
  captureWindow: "capture_window",
  captureRegion: "capture_region",
  startCaptureOverlay: "start_capture_overlay",
  getCaptureParams: "get_capture_params",
  captureOverlayResult: "capture_overlay_result",
} as const;

export type ScreenCaptureChannel =
  (typeof SCREEN_CAPTURE_CHANNELS)[keyof typeof SCREEN_CAPTURE_CHANNELS];

export const SCREEN_CAPTURE_CHANNEL_TO_HANDLER: Record<
  ScreenCaptureChannel,
  keyof ScreenCaptureHandlers
> = {
  [SCREEN_CAPTURE_CHANNELS.captureScreen]: "captureScreen",
  [SCREEN_CAPTURE_CHANNELS.listWindows]: "listWindows",
  [SCREEN_CAPTURE_CHANNELS.captureWindow]: "captureWindow",
  [SCREEN_CAPTURE_CHANNELS.captureRegion]: "captureRegion",
  [SCREEN_CAPTURE_CHANNELS.startCaptureOverlay]: "startCaptureOverlay",
  [SCREEN_CAPTURE_CHANNELS.getCaptureParams]: "getCaptureParams",
  [SCREEN_CAPTURE_CHANNELS.captureOverlayResult]: "captureOverlayResult",
};
