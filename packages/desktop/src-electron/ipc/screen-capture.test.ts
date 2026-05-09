/**
 * Unit tests for the Phase 3 screen-capture IPC handlers.
 *
 * The handler factory accepts a `ScreenCaptureDeps` adapter (see
 * `screen-capture.ts`) so these tests inject in-memory fakes for
 * `desktopCapturer.getSources`, the primary-display geometry, and
 * the main-window minimize/restore + overlay BrowserWindow
 * spawning. End-to-end the test exercises:
 *
 *   - `capture_screen` returns a JPEG data URL with the
 *     thumbnailSize matching physical pixels (logical × DPR).
 *   - `list_windows` translates `desktopCapturer` sources into the
 *     `WindowInfo` shape the renderer expects.
 *   - `capture_window` selects the right source by id.
 *   - `capture_region` crops the screen capture to the requested
 *     rect — verified by inspecting the fake `NativeImage`'s
 *     captured `crop()` calls.
 *   - `start_capture_overlay` orchestrates minimize → capture →
 *     openOverlay → await result → restore.
 */

import { describe, expect, it, vi } from "vitest";
import {
  type CapturerSourceLite,
  createScreenCaptureHandlers,
  type NativeImageLite,
  type ScreenCaptureDeps,
} from "./screen-capture.js";

/** Tiny fake `NativeImage` that records its `crop()` calls and
 *  produces deterministic JPEG bytes from its internal label. */
function fakeImage(label: string, width: number, height: number): NativeImageLite {
  const cropCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
  const img: NativeImageLite & { _label: string; _crops: typeof cropCalls } = {
    _label: label,
    _crops: cropCalls,
    getSize: () => ({ width, height }),
    toJPEG: () => Buffer.from(`jpg:${label}:${width}x${height}`),
    toPNG: () => Buffer.from(`png:${label}`),
    crop: (rect) => {
      cropCalls.push(rect);
      return fakeImage(`${label}-crop`, rect.width, rect.height);
    },
  };
  return img;
}

interface DepsControl {
  deps: ScreenCaptureDeps;
  minimizeMain: ReturnType<typeof vi.fn>;
  restoreMain: ReturnType<typeof vi.fn>;
  openOverlay: ReturnType<typeof vi.fn>;
  destroyOverlay: ReturnType<typeof vi.fn>;
  getSources: ReturnType<typeof vi.fn>;
  /** The screen source's image — exposed so tests can assert on
   *  the underlying `crop()` call log. */
  screenImage: NativeImageLite & {
    _crops: Array<{ x: number; y: number; width: number; height: number }>;
  };
}

function makeDeps(opts?: {
  scaleFactor?: number;
  windowSources?: Array<{ id: string; name: string }>;
}): DepsControl {
  const scaleFactor = opts?.scaleFactor ?? 1;
  const minimizeMain = vi.fn();
  const restoreMain = vi.fn();
  const destroyOverlay = vi.fn();
  const openOverlay = vi.fn(() => ({ destroy: destroyOverlay }));

  const screenImage = fakeImage("screen", 1920, 1080) as NativeImageLite & {
    _crops: Array<{ x: number; y: number; width: number; height: number }>;
  };

  const getSources = vi.fn(
    async (opts2: {
      types: Array<"screen" | "window">;
      thumbnailSize?: { width: number; height: number };
    }): Promise<CapturerSourceLite[]> => {
      if (opts2.types.includes("window")) {
        const list = opts?.windowSources ?? [
          { id: "window:1:0", name: "Calculator" },
          { id: "window:2:0", name: "Notepad" },
        ];
        return list.map((s) => ({
          id: s.id,
          name: s.name,
          thumbnail: fakeImage(`win-${s.id}`, 800, 600),
        }));
      }
      return [
        {
          id: "screen:0:0",
          name: "Entire Screen",
          thumbnail: screenImage,
        },
      ];
    },
  );

  const deps: ScreenCaptureDeps = {
    getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 }, scaleFactor }),
    getSources,
    minimizeMain,
    restoreMain,
    openOverlay,
  };

  return { deps, minimizeMain, restoreMain, openOverlay, destroyOverlay, getSources, screenImage };
}

describe("capture_screen", () => {
  it("returns a JPEG data URL with the screen thumbnail size", async () => {
    const ctrl = makeDeps();
    const handlers = createScreenCaptureHandlers(ctrl.deps);

    const result = await handlers.captureScreen();

    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.data_url).toMatch(/^data:image\/jpeg;base64,/);

    // Decoded payload comes from the fake's labeled output.
    const b64 = result.data_url.split(",")[1] ?? "";
    expect(Buffer.from(b64, "base64").toString()).toBe("jpg:screen:1920x1080");

    expect(ctrl.getSources).toHaveBeenCalledWith({
      types: ["screen"],
      thumbnailSize: { width: 1920, height: 1080 },
    });
  });

  it("requests thumbnailSize at physical (logical × scaleFactor) pixels on HiDPI displays", async () => {
    const ctrl = makeDeps({ scaleFactor: 2 });
    const handlers = createScreenCaptureHandlers(ctrl.deps);

    await handlers.captureScreen();

    expect(ctrl.getSources).toHaveBeenCalledWith({
      types: ["screen"],
      thumbnailSize: { width: 3840, height: 2160 },
    });
  });

  it("throws when the OS reports no screen sources", async () => {
    const ctrl = makeDeps();
    ctrl.getSources.mockImplementationOnce(async () => []);
    const handlers = createScreenCaptureHandlers(ctrl.deps);
    await expect(handlers.captureScreen()).rejects.toThrow(/permissions/);
  });
});

describe("list_windows", () => {
  it("translates desktopCapturer sources into WindowInfo entries", async () => {
    const ctrl = makeDeps({
      windowSources: [
        { id: "window:42:0", name: "Foo" },
        { id: "window:43:0", name: "Bar" },
      ],
    });
    const handlers = createScreenCaptureHandlers(ctrl.deps);

    const windows = await handlers.listWindows();

    expect(windows).toEqual([
      { hwnd: "window:42:0", title: "Foo", class: "", x: 0, y: 0, width: 0, height: 0 },
      { hwnd: "window:43:0", title: "Bar", class: "", x: 0, y: 0, width: 0, height: 0 },
    ]);
  });
});

describe("capture_window", () => {
  it("selects the right source by id and returns its thumbnail", async () => {
    const ctrl = makeDeps({
      windowSources: [
        { id: "window:42:0", name: "Foo" },
        { id: "window:43:0", name: "Bar" },
      ],
    });
    const handlers = createScreenCaptureHandlers(ctrl.deps);

    const result = await handlers.captureWindow({ hwnd: "window:43:0" });

    const b64 = result.data_url.split(",")[1] ?? "";
    expect(Buffer.from(b64, "base64").toString()).toBe("jpg:win-window:43:0:800x600");
  });

  it("throws when the requested window id is missing", async () => {
    const ctrl = makeDeps();
    const handlers = createScreenCaptureHandlers(ctrl.deps);
    await expect(handlers.captureWindow({ hwnd: "window:does-not-exist" })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("capture_region", () => {
  it("calls crop on the screen image with the requested rect", async () => {
    const ctrl = makeDeps();
    const handlers = createScreenCaptureHandlers(ctrl.deps);

    const result = await handlers.captureRegion({ x: 100, y: 200, width: 320, height: 240 });

    expect(ctrl.screenImage._crops).toEqual([{ x: 100, y: 200, width: 320, height: 240 }]);
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
  });

  it("rejects invalid (zero / negative) regions", async () => {
    const handlers = createScreenCaptureHandlers(makeDeps().deps);
    await expect(handlers.captureRegion({ x: 0, y: 0, width: 0, height: 100 })).rejects.toThrow(
      /invalid/i,
    );
    await expect(handlers.captureRegion({ x: 0, y: 0, width: 100, height: -1 })).rejects.toThrow(
      /invalid/i,
    );
  });
});

describe("start_capture_overlay → get_capture_params → capture_overlay_result", () => {
  it("orchestrates minimize → capture → openOverlay → resolve → restore", async () => {
    const ctrl = makeDeps();
    const handlers = createScreenCaptureHandlers(ctrl.deps);

    const overlayPromise = handlers.startCaptureOverlay({ mode: "rect" });
    // Wait long enough for the internal 400ms minimize delay + the
    // capture call. After this microtask spin, the overlay handle
    // is open and `getCaptureParams` should resolve.
    await new Promise((r) => setTimeout(r, 500));

    expect(ctrl.minimizeMain).toHaveBeenCalledTimes(1);
    expect(ctrl.openOverlay).toHaveBeenCalledTimes(1);

    const params = await handlers.getCaptureParams();
    expect(params.mode).toBe("rect");
    expect(params.screen_width).toBe(1920);
    expect(params.screen_height).toBe(1080);
    expect(params.windows).toEqual([]);

    await handlers.captureOverlayResult({ result: { x: 10, y: 20, w: 300, h: 200 } });

    const overlayResult = await overlayPromise;
    expect(overlayResult).not.toBeNull();
    expect(overlayResult?.region).toEqual({ x: 10, y: 20, w: 300, h: 200 });
    expect(overlayResult?.screen_width).toBe(1920);
    expect(ctrl.destroyOverlay).toHaveBeenCalledTimes(1);
    expect(ctrl.restoreMain).toHaveBeenCalledTimes(1);
  });

  it("returns null when the overlay window is closed externally", async () => {
    // The deps owner (main.ts) wires `openOverlay` to return a
    // handle whose 'closed' event calls `notifyOverlayClosed`;
    // simulate that here.
    let closeOverlay: () => void = () => {};
    const minimizeMain = vi.fn();
    const restoreMain = vi.fn();
    const openOverlay = vi.fn(() => ({ destroy: vi.fn() }));
    const screenImage = fakeImage("screen", 1920, 1080);
    const deps: ScreenCaptureDeps = {
      getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 }, scaleFactor: 1 }),
      getSources: async () => [{ id: "screen:0:0", name: "Entire Screen", thumbnail: screenImage }],
      minimizeMain,
      restoreMain,
      openOverlay,
    };
    const handlers = createScreenCaptureHandlers(deps);
    closeOverlay = () => handlers.notifyOverlayClosed();

    const overlayPromise = handlers.startCaptureOverlay({ mode: "rect" });
    await new Promise((r) => setTimeout(r, 500));

    closeOverlay();
    const result = await overlayPromise;
    expect(result).toBeNull();
    expect(restoreMain).toHaveBeenCalledTimes(1);
  });

  it("populates windows[] when mode === 'window'", async () => {
    const ctrl = makeDeps({
      windowSources: [{ id: "window:1:0", name: "Foo" }],
    });
    const handlers = createScreenCaptureHandlers(ctrl.deps);

    const overlayPromise = handlers.startCaptureOverlay({ mode: "window" });
    await new Promise((r) => setTimeout(r, 500));

    const params = await handlers.getCaptureParams();
    expect(params.mode).toBe("window");
    expect(params.windows).toHaveLength(1);
    expect(params.windows[0]?.hwnd).toBe("window:1:0");
    expect(params.windows[0]?.title).toBe("Foo");

    await handlers.captureOverlayResult({ result: null });
    const result = await overlayPromise;
    expect(result).toBeNull();
  });

  it("get_capture_params throws when no overlay is in flight", async () => {
    const handlers = createScreenCaptureHandlers(makeDeps().deps);
    await expect(handlers.getCaptureParams()).rejects.toThrow(/no params/i);
  });
});
