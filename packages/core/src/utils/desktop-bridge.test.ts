/**
 * @vitest-environment happy-dom
 *
 * `desktop-bridge` is the renderer-side seam every desktop-host IPC
 * call goes through. Each public function is a thin wrapper around
 * `window.electronAPI.invoke(channel, args)`. The tests pin the
 * channel + args contract (because every Electron IPC handler in
 * `packages/desktop/src-electron/ipc/` looks for these exact strings)
 * and the error paths (no window, no electronAPI).
 *
 * `isDesktop` reads `window.__ANNOT_DESKTOP__` at module load and
 * is exported as a constant. happy-dom doesn't set the flag by
 * default, so the value will be `false` here — the truthy branch
 * is verified through a separate dynamic-import test that sets the
 * flag before re-importing the module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bridge from "./desktop-bridge.js";

interface MockElectronApi {
  invoke: ReturnType<typeof vi.fn>;
}

declare global {
  interface Window {
    electronAPI?: MockElectronApi;
    __ANNOT_DESKTOP__?: boolean;
  }
}

let originalElectronApi: MockElectronApi | undefined;

beforeEach(() => {
  originalElectronApi = window.electronAPI;
});

afterEach(() => {
  window.electronAPI = originalElectronApi;
  vi.restoreAllMocks();
});

/** Wire a mock electronAPI whose `invoke` resolves to the given
 *  value. Returns the spy so tests can assert channel + args. */
function mockElectronApi(returnValue: unknown = undefined): ReturnType<typeof vi.fn> {
  const invoke = vi.fn().mockResolvedValue(returnValue);
  window.electronAPI = { invoke };
  return invoke;
}

describe("isDesktop module-load constant", () => {
  it("is false in a browser-like context without the __ANNOT_DESKTOP__ flag", () => {
    // happy-dom doesn't set window.__ANNOT_DESKTOP__, so isDesktop
    // resolves to false at module load. The const captures the value
    // at first import — this assertion verifies the typical PWA
    // runtime path.
    expect(bridge.isDesktop).toBe(false);
  });
});

describe("invoke error paths", () => {
  it("throws a clear error when window.electronAPI is missing (preload script not loaded)", async () => {
    delete window.electronAPI;
    await expect(bridge.getLibraryRoot()).rejects.toThrow(/electronAPI is missing/);
  });
});

describe("library + portable-dir wrappers", () => {
  it("getLibraryRoot invokes 'app.getLibraryRoot' with no args, returns the resolved path", async () => {
    const invoke = mockElectronApi("/users/foo/Library/Application Support/Annot/library");
    const result = await bridge.getLibraryRoot();
    expect(invoke).toHaveBeenCalledWith("app.getLibraryRoot", undefined);
    expect(result).toBe("/users/foo/Library/Application Support/Annot/library");
  });

  it("getPortableDir invokes 'get_portable_dir' with no args", async () => {
    const invoke = mockElectronApi("/portable/data");
    const result = await bridge.getPortableDir();
    expect(invoke).toHaveBeenCalledWith("get_portable_dir", undefined);
    expect(result).toBe("/portable/data");
  });
});

describe("tool-preset wrappers", () => {
  it("loadToolPresets invokes 'load_tool_presets', returns the resolved ToolPresets", async () => {
    const presets: bridge.ToolPresets = {
      tools: { "shape.rect": { stroke_color: "#ff0000", stroke_width: 3 } },
      last_variants: { shape: "rect" },
    };
    const invoke = mockElectronApi(presets);
    const result = await bridge.loadToolPresets();
    expect(invoke).toHaveBeenCalledWith("load_tool_presets", undefined);
    expect(result).toBe(presets);
  });

  it("saveToolPresets invokes 'save_tool_presets' with { presets }", async () => {
    const invoke = mockElectronApi(undefined);
    const presets: bridge.ToolPresets = { tools: { highlight: { highlight_color: "#ffff00" } } };
    await bridge.saveToolPresets(presets);
    expect(invoke).toHaveBeenCalledWith("save_tool_presets", { presets });
  });
});

describe("XMP wrappers", () => {
  it("saveWithXmp invokes 'save_with_xmp' with the full args object", async () => {
    const invoke = mockElectronApi(undefined);
    await bridge.saveWithXmp(
      "data:image/png;base64,abc",
      "data:image/png;base64,xyz",
      "<g><rect/></g>",
      800,
      600,
      "/path/to/file.annot.png",
    );
    expect(invoke).toHaveBeenCalledWith("save_with_xmp", {
      renderedImageB64: "data:image/png;base64,abc",
      originalImageB64: "data:image/png;base64,xyz",
      annotationsSvg: "<g><rect/></g>",
      width: 800,
      height: 600,
      filePath: "/path/to/file.annot.png",
    });
  });

  it("readXmp invokes 'read_xmp' with { filePath }, returns the resolved AnnotMetadata", async () => {
    const meta: bridge.AnnotMetadata = {
      original_image_b64: "data:image/png;base64,abc",
      annotations_svg: "<g/>",
      width: 100,
      height: 50,
    };
    const invoke = mockElectronApi(meta);
    const result = await bridge.readXmp("/path/to/file.annot.png");
    expect(invoke).toHaveBeenCalledWith("read_xmp", { filePath: "/path/to/file.annot.png" });
    expect(result).toBe(meta);
  });

  it("readXmp resolves to null when the file has no Annot metadata (passthrough)", async () => {
    mockElectronApi(null);
    expect(await bridge.readXmp("/some/file.png")).toBeNull();
  });
});

describe("screen-capture wrappers", () => {
  it("captureScreen invokes 'capture_screen', returns the CaptureResult", async () => {
    const result: bridge.CaptureResult = {
      data_url: "data:image/png;base64,abc",
      width: 1920,
      height: 1080,
    };
    const invoke = mockElectronApi(result);
    const got = await bridge.captureScreen();
    expect(invoke).toHaveBeenCalledWith("capture_screen", undefined);
    expect(got).toBe(result);
  });

  it("listWindows invokes 'list_windows', returns the array of WindowInfo", async () => {
    const list: bridge.WindowInfo[] = [
      {
        hwnd: "window:1234:5",
        title: "Foo",
        class: "MyApp",
        x: 10,
        y: 20,
        width: 800,
        height: 600,
      },
    ];
    const invoke = mockElectronApi(list);
    const got = await bridge.listWindows();
    expect(invoke).toHaveBeenCalledWith("list_windows", undefined);
    expect(got).toBe(list);
  });

  it("captureWindow invokes 'capture_window' with { hwnd }", async () => {
    const result: bridge.CaptureResult = {
      data_url: "data:image/png;base64,xyz",
      width: 400,
      height: 300,
    };
    const invoke = mockElectronApi(result);
    const got = await bridge.captureWindow("window:1234:5");
    expect(invoke).toHaveBeenCalledWith("capture_window", { hwnd: "window:1234:5" });
    expect(got).toBe(result);
  });

  it("captureRegion invokes 'capture_region' with { x, y, width, height }", async () => {
    const invoke = mockElectronApi({ data_url: "...", width: 100, height: 50 });
    await bridge.captureRegion(10, 20, 100, 50);
    expect(invoke).toHaveBeenCalledWith("capture_region", {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });
});

describe("window-control wrappers", () => {
  it("minimizeMainWindow invokes 'minimize_main_window' with no args", async () => {
    const invoke = mockElectronApi(undefined);
    await bridge.minimizeMainWindow();
    expect(invoke).toHaveBeenCalledWith("minimize_main_window", undefined);
  });

  it("restoreMainWindow invokes 'restore_main_window' with no args", async () => {
    const invoke = mockElectronApi(undefined);
    await bridge.restoreMainWindow();
    expect(invoke).toHaveBeenCalledWith("restore_main_window", undefined);
  });
});

describe("Office-clipboard wrapper (copyAsOffice)", () => {
  it("invokes 'copy_as_office' with drawingXml + JSON-serialized media bytes", async () => {
    const invoke = mockElectronApi(undefined);
    const drawingXml = "<a:graphicFrame/>";
    const media: bridge.MosaicMediaPayload[] = [
      { filename: "mosaic1.png", bytes: new Uint8Array([1, 2, 3]) },
      { filename: "mosaic2.png", bytes: new Uint8Array([4, 5]) },
    ];
    await bridge.copyAsOffice(drawingXml, media, "screenshotData", "data:image/png;base64,abc");
    expect(invoke).toHaveBeenCalledTimes(1);
    const [channel, args] = invoke.mock.calls[0]!;
    expect(channel).toBe("copy_as_office");
    expect(args).toEqual({
      drawingXml,
      mosaicMedia: [
        { filename: "mosaic1.png", bytes: [1, 2, 3] },
        { filename: "mosaic2.png", bytes: [4, 5] },
      ],
      screenshotData: "screenshotData",
      pngDataUrl: "data:image/png;base64,abc",
    });
  });

  it("copyAsOffice serialises Uint8Array bytes via Array.from (so the IPC layer can JSON-encode them)", async () => {
    const invoke = mockElectronApi(undefined);
    await bridge.copyAsOffice("<a:foo/>", [
      { filename: "m.png", bytes: new Uint8Array([255, 0, 128]) },
    ]);
    const args = invoke.mock.calls[0]![1] as { mosaicMedia: Array<{ bytes: number[] }> };
    expect(Array.isArray(args.mosaicMedia[0]!.bytes)).toBe(true);
    expect(args.mosaicMedia[0]!.bytes).toEqual([255, 0, 128]);
  });

  it("copyAsOffice supports omitting optional screenshotData / pngDataUrl args", async () => {
    const invoke = mockElectronApi(undefined);
    await bridge.copyAsOffice("<a:foo/>", []);
    const args = invoke.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.screenshotData).toBeUndefined();
    expect(args.pngDataUrl).toBeUndefined();
  });
});

describe("invoke contract — return-value passthrough", () => {
  it("each wrapper returns whatever electronAPI.invoke resolves to (no transformation)", async () => {
    // Sanity: a non-trivial object passes through unchanged.
    const sentinel = { unique: Symbol() };
    const invoke = vi.fn().mockResolvedValue(sentinel);
    window.electronAPI = { invoke };
    // Use a representative wrapper. `getLibraryRoot` returns a typed
    // string but the invoke shim is generic — the value passes through
    // without checks.
    const got = await bridge.getLibraryRoot();
    expect(got).toBe(sentinel);
  });
});
