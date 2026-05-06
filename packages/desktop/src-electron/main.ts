/**
 * Electron main process — Phase 1 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Boots a single `BrowserWindow`, resolves the library root under
 * `app.getPath('userData')`, and registers the Phase 1 IPC handler
 * surface (`fs.*` filesystem primitives + `app.getLibraryRoot`).
 * The renderer-side `bootstrap.ts` reads the library root via the
 * `app.getLibraryRoot` channel and constructs an Electron-backed
 * `DesktopFs` against the `fs.*` channels — same `DesktopStore`
 * contract the Tauri host satisfies, just over a different
 * transport.
 *
 * What this file deliberately still doesn't do (lands in later
 * phases):
 *
 *   - XMP read/write IPC channels, the tool-presets persistence,
 *     and the http-server that catches extension-handoff captures
 *     on :19530. Phase 2.
 *   - Screen capture (`capture_screen` / `capture_window` / region
 *     overlay). Phase 3.
 *   - Office clipboard copy (`copy_as_office`). Phase 4.
 *
 * The Tauri build remains the default `pnpm dev` / `pnpm build`
 * target until Phase 5's cutover; the renderer's existing
 * `tauri-bridge.ts` call sites still address those (now-gone-on-
 * Electron) channels and surface "no handler registered" errors
 * here. That's expected — the Phase 5 cutover swaps imports to
 * `desktop-bridge.ts` and the Phase-2/3/4 handlers come online by
 * then.
 */

import { promises as fsPromises } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { registerAllIpcHandlers } from "./ipc/index.js";

// `__dirname` isn't defined in ESM; recover the equivalent from
// `import.meta.url`. The bundled output sits at
// `dist-electron/main/main.js`, so `__dirname` resolves to
// `<package>/dist-electron/main/`. The preload reference below
// climbs one level up + into `preload/`. electron-vite's default
// emit filenames (`main.js`, `preload.cjs`) are taken as-is rather
// than overridden — the convention is well-known and matches the
// electron-vite scaffolding examples.
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

void app.whenReady().then(async () => {
  // Phase 0's `ping` placeholder stays for the moment so the
  // preload's contextBridge surface has at least one channel that
  // doesn't depend on the Phase 1 wiring. It's removed in the
  // Phase 5 cleanup.
  ipcMain.handle("ping", () => "pong");

  const libraryRoot = await ensureLibrarySkeleton();
  registerAllIpcHandlers(ipcMain, { libraryRoot });

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
