/**
 * Electron main process — Phase 0 scaffold.
 *
 * This is the side-by-side opt-in entry point introduced by Phase 0
 * of `docs/plans/desktop-electron-migration.md`. It boots a single
 * `BrowserWindow`, loads the Vite-built renderer (the same
 * `index.html` the Tauri host uses), and registers a single `ping`
 * IPC handler so the preload's contextBridge surface has something
 * concrete to exercise.
 *
 * What this file deliberately does NOT do at Phase 0:
 *
 *   - Implement any of the real IPC channels (`fs.*`, `xmp.*`,
 *     `capture_*`, `copy_as_office`, `load_tool_presets`,
 *     `get_portable_dir`, …). Those land in Phases 1–4.
 *   - Start the extension-handoff HTTP server on :19530.
 *     That lands in Phase 2.
 *   - Spawn the capture overlay window. That lands in Phase 3.
 *
 * The Tauri build remains the default `pnpm dev` / `pnpm build`
 * target until Phase 5's cutover, so this scaffold loads the
 * renderer in Tauri-incompatible mode (`__TAURI_INTERNALS__` is
 * absent) — which means every `tauri-bridge.ts` call from the
 * renderer throws "Not running in Tauri" and the gallery / capture
 * surfaces don't function. That's expected for Phase 0; the goal
 * is "the Electron window opens and the renderer mounts," not
 * functional parity.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";

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

function registerPlaceholderIpc(): void {
  ipcMain.handle("ping", () => "pong");
}

void app.whenReady().then(() => {
  registerPlaceholderIpc();
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
