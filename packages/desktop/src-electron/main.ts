/**
 * Electron main process — Phases 1+2+3 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Boots a single `BrowserWindow`, resolves the library root under
 * `app.getPath('userData')`, registers the Phase 1+2+3 IPC handler
 * surface, and starts the localhost HTTP server on :19530 that
 * catches extension-handoff captures.
 *
 * Phase 1 surface: `fs.*` filesystem primitives + `app.getLibraryRoot`.
 *
 * Phase 2 surface: tool-presets persistence (`load_tool_presets` /
 * `save_tool_presets` / `get_portable_dir`), XMP read/write
 * (`save_with_xmp` / `read_xmp`), main-window controls
 * (`minimize_main_window` / `restore_main_window`), and the
 * extension-capture HTTP server (`POST /capture` →
 * `chrome-capture` IPC event).
 *
 * Phase 3 surface (this file): screen capture
 * (`capture_screen` / `list_windows` / `capture_window` /
 * `capture_region` / `start_capture_overlay` / `get_capture_params`
 * / `capture_overlay_result`). Cross-platform via Electron's
 * `desktopCapturer.getSources` with an explicit `thumbnailSize`.
 *
 * Still pending:
 *   - Office clipboard copy (`copy_as_office`). Phase 4.
 *
 * The Tauri build remains the default `pnpm dev` / `pnpm build`
 * target until Phase 5's cutover; the renderer's existing
 * `tauri-bridge.ts` call sites still address those channels and
 * surface "no handler registered" errors here. That's expected —
 * the Phase 5 cutover swaps imports to `desktop-bridge.ts` and
 * every channel registered here comes online for the renderer.
 */

import { promises as fsPromises } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  nativeImage,
  screen,
} from "electron";
import { startHttpServer } from "./http-server.js";
import { registerAllIpcHandlers, type RegisteredIpc } from "./ipc/index.js";
import type { CapturerSourceLite, OverlayHandle } from "./ipc/screen-capture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RENDERER_DEV_URL = process.env["ELECTRON_RENDERER_URL"];

/** Sub-directory under `<userData>` that holds the Annot library.
 *  Mirrors the renderer-side `LIBRARY_SUBDIR` constant in
 *  `packages/desktop/src/storage/bootstrap.ts` so the on-disk path
 *  stays human-predictable across platforms. */
const LIBRARY_SUBDIR = "library";

/** Default top-level folder created on first launch so the gallery
 *  doesn't open into a totally empty tree. Matches the renderer-
 *  side `DEFAULT_INBOX_FOLDER` for the same reason. */
const DEFAULT_INBOX_FOLDER = "Inbox";

/** Channel the http-server uses to forward incoming captures into
 *  the renderer. The renderer's existing extension-handoff sweep
 *  subscribes to this via `electronAPI.on("chrome-capture", …)`
 *  (Phase 2 preload addition). */
const CHROME_CAPTURE_EVENT = "chrome-capture";

/** Stable id for the capture overlay BrowserWindow. The Tauri
 *  impl identifies its overlay window by name; the Electron
 *  equivalent keeps the handle in `overlayWindow` rather than
 *  re-querying — but the id matches for log-grep parity. */
const OVERLAY_WINDOW_TITLE = "annot-capture-overlay";

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Annot by ingcreators",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (RENDERER_DEV_URL) {
    void win.loadURL(RENDERER_DEV_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

/** Resolve `<userData>/library/` and ensure the skeleton (root +
 *  default `Inbox/`) exists. First launch: both directories are
 *  created empty. Per the plan's "no auto-import" decision, the
 *  legacy Tauri-era library at `<portable_dir>/library/` is left
 *  alone — surfacing the path to the user is the renderer's job
 *  (one-time toast), not the main process's. */
async function ensureLibrarySkeleton(): Promise<string> {
  const libraryRoot = join(app.getPath("userData"), LIBRARY_SUBDIR);
  await fsPromises.mkdir(libraryRoot, { recursive: true });
  await fsPromises.mkdir(join(libraryRoot, DEFAULT_INBOX_FOLDER), { recursive: true });
  return libraryRoot;
}

/** Locate the bundled default-presets YAML. `electron-builder`'s
 *  `extraResources` puts the file under `process.resourcesPath`
 *  in production; in dev (`pnpm dev:electron`) the file lives at
 *  `<repo>/packages/desktop/build/tool-presets.yml`. The
 *  `process.resourcesPath` fallback uses `__dirname` to walk up
 *  to the package root via the `dist-electron/main/` layout. */
function defaultPresetsPath(): string {
  const candidates = [
    join(process.resourcesPath ?? "", "tool-presets.yml"),
    join(__dirname, "../../build/tool-presets.yml"),
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return candidates[0]!;
}

/** Convert PNG bytes → JPEG bytes via Electron's `nativeImage`.
 *  Q90 baseline JPEG (NOT progressive — a behaviour gap from the
 *  Rust `image_to_progressive_jpeg` step, documented in
 *  `xmp.ts`). Throws on unparseable input. */
async function pngToJpegViaNativeImage(png: Uint8Array): Promise<Uint8Array> {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) {
    throw new Error("[xmp] nativeImage failed to decode rendered PNG");
  }
  const jpeg = img.toJPEG(90);
  return new Uint8Array(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
}

/** Spawn the fullscreen capture overlay. Loads
 *  `capture-overlay.html` from the same dist as `index.html` (dev:
 *  Vite serves it; prod: bundled by electron-vite into
 *  `dist-electron/renderer/`). */
function spawnCaptureOverlay(
  onClosed: () => void,
): OverlayHandle {
  const primary = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: primary.size.width,
    height: primary.size.height,
    x: primary.bounds.x,
    y: primary.bounds.y,
    title: OVERLAY_WINDOW_TITLE,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreen: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Maximize so the overlay covers the full primary display.
  win.maximize();
  win.setAlwaysOnTop(true, "screen-saver");
  win.focus();

  if (RENDERER_DEV_URL) {
    void win.loadURL(`${RENDERER_DEV_URL}/capture-overlay.html`);
  } else {
    void win.loadFile(join(__dirname, "../renderer/capture-overlay.html"));
  }

  overlayWindow = win;
  win.on("closed", () => {
    if (overlayWindow === win) overlayWindow = null;
    onClosed();
  });

  return {
    destroy: () => {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}

void app.whenReady().then(async () => {
  ipcMain.handle("ping", () => "pong");

  const userDataDir = app.getPath("userData");
  const libraryRoot = await ensureLibrarySkeleton();

  let registered: RegisteredIpc | null = null;

  registered = registerAllIpcHandlers(ipcMain, {
    libraryRoot,
    settings: {
      userDataDir,
      defaultPresetsPath: defaultPresetsPath(),
    },
    xmp: { pngToJpeg: pngToJpegViaNativeImage },
    getMainWindow: () => {
      const win = mainWindow;
      if (!win) return undefined;
      return {
        minimize: () => win.minimize(),
        restore: () => win.restore(),
        show: () => win.show(),
        focus: () => win.focus(),
      };
    },
    screenCapture: {
      getPrimaryDisplay: () => {
        const d = screen.getPrimaryDisplay();
        return { size: d.size, scaleFactor: d.scaleFactor };
      },
      getSources: async (opts) => {
        const sources = await desktopCapturer.getSources({
          types: opts.types,
          thumbnailSize: opts.thumbnailSize,
        });
        return sources.map(
          (s): CapturerSourceLite => ({
            id: s.id,
            name: s.name,
            // The real `NativeImage` already satisfies the
            // `NativeImageLite` shape used downstream.
            thumbnail: s.thumbnail,
          }),
        );
      },
      minimizeMain: () => mainWindow?.minimize(),
      restoreMain: () => {
        const win = mainWindow;
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      },
      openOverlay: () =>
        spawnCaptureOverlay(() => {
          // The handler is the source of truth for the overlay
          // promise's lifecycle. `notifyOverlayClosed` rejects
          // the in-flight promise with `null` (cancelled).
          registered?.screenCapture.notifyOverlayClosed();
        }),
    },
  });

  // The capture overlay's renderer-side script can't address the
  // overlay window's webContents.id from inside the contextBridge,
  // so the `capture_overlay_result` channel comes in via the
  // standard ipc registration. The overlay also fires a
  // `capture_overlay_result` send (no-handle) via
  // `ipcRenderer.send` — relay that into the registered handler so
  // the existing capture-overlay.html script keeps working when
  // ported to electronAPI.invoke (which it does — `invoke` over
  // `ipcRenderer.invoke` reaches the same handler).

  // Start the extension-capture HTTP server. Failures here are
  // logged + non-fatal — the gallery still works without the
  // extension handoff.
  try {
    await startHttpServer({
      userDataDir,
      onCapture: (payload) => {
        mainWindow?.webContents.send(CHROME_CAPTURE_EVENT, payload);
      },
      bringToFront: () => {
        const win = mainWindow;
        if (!win) return;
        win.show();
        if (win.isMinimized()) win.restore();
        win.focus();
      },
    });
  } catch (err) {
    console.error("[annot-http] failed to start:", err);
  }

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
