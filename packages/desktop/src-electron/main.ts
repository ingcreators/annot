/**
 * Electron main process — Phases 1+2 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Boots a single `BrowserWindow`, resolves the library root under
 * `app.getPath('userData')`, registers the Phase 1+2 IPC handler
 * surface, and starts the localhost HTTP server on :19530 that
 * catches extension-handoff captures.
 *
 * Phase 1 surface (already merged): `fs.*` filesystem primitives
 * + `app.getLibraryRoot`.
 *
 * Phase 2 surface (this file): tool-presets persistence
 * (`load_tool_presets` / `save_tool_presets` /
 * `get_portable_dir`), XMP read/write
 * (`save_with_xmp` / `read_xmp`), main-window controls
 * (`minimize_main_window` / `restore_main_window`), and the
 * extension-capture HTTP server (`POST /capture` →
 * `chrome-capture` IPC event).
 *
 * Still pending:
 *   - Screen capture (`capture_screen` / `capture_window` /
 *     `capture_region` / overlay). Phase 3.
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
import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import { startHttpServer } from "./http-server.js";
import { registerAllIpcHandlers } from "./ipc/index.js";

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

let mainWindow: BrowserWindow | null = null;

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
  // Return the first candidate that exists synchronously. The
  // settings handler tolerates a missing file (returns empty
  // presets) so even if both paths are absent the renderer
  // falls back to its hardcoded defaults.
  for (const p of candidates) {
    try {
      // Synchronous existence check at boot is fine — runs once.
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

void app.whenReady().then(async () => {
  // Phase 0's `ping` placeholder stays for the moment so the
  // preload's contextBridge surface has at least one channel that
  // doesn't depend on the Phase 1+ wiring. It's removed in the
  // Phase 5 cleanup.
  ipcMain.handle("ping", () => "pong");

  const userDataDir = app.getPath("userData");
  const libraryRoot = await ensureLibrarySkeleton();

  registerAllIpcHandlers(ipcMain, {
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
  });

  // Start the extension-capture HTTP server. Failures here are
  // logged + non-fatal — the gallery still works without the
  // extension handoff, same as the Rust impl which `eprintln!`s
  // and returns from the spawned thread on bind failure.
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
