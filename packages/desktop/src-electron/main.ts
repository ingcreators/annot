/**
 * Electron main process — Phases 1+2+3+4+5+6 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Boots the main `BrowserWindow`, resolves the library root under
 * `app.getPath('userData')`, registers the Phase 1+2+3+4 IPC handler
 * surface plus the Phase 6 Browse window factory, and starts the
 * localhost HTTP server on :19530 that catches extension-handoff
 * captures.
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
 * Phase 3 surface: screen capture
 * (`capture_screen` / `list_windows` / `capture_window` /
 * `capture_region` / `start_capture_overlay` /
 * `get_capture_params` / `capture_overlay_result`). Cross-
 * platform via Electron's `desktopCapturer.getSources` with an
 * explicit `thumbnailSize`.
 *
 * Phase 4 surface (this file): Office clipboard
 * (`copy_as_office`). Builds a GVML OPC ZIP envelope plus a
 * `CF_DIB` bitmap in pure JS and writes them atomically via the
 * in-tree `annot-win-clipboard` napi addon (one
 * `OpenClipboard + EmptyClipboard + N×SetClipboardData +
 * CloseClipboard` cycle). See `ipc/clipboard.ts` and
 * `native/win-clipboard/` for the architectural rationale.
 *
 * The Tauri build remains the default `pnpm dev` / `pnpm build`
 * target until Phase 5's cutover; the renderer's existing
 * `tauri-bridge.ts` call sites still address those channels and
 * surface "no handler registered" errors here. That's expected —
 * the Phase 5 cutover swaps imports to `desktop-bridge.ts` and
 * every channel registered here comes online for the renderer.
 */

import { promises as fsPromises } from "node:fs";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell as electronShell,
  webContents,
  type MenuItemConstructorOptions,
} from "electron";
import { startHttpServer } from "./http-server.js";
import type { CapturedImage } from "./ipc/browse.js";
import { registerAllIpcHandlers, type RegisteredIpc } from "./ipc/index.js";
import type { CapturerSourceLite, OverlayHandle } from "./ipc/screen-capture.js";

// `__dirname` is provided by electron-vite's CJS-shim wrapper
// (`const __dirname = import.meta.dirname;` at the top of the
// bundled `main.js` output). Declaring our own here would clash
// with the wrapper at runtime — `SyntaxError: Identifier
// '__dirname' has already been declared`. The bundled output
// resolves `__dirname` to `<package>/dist-electron/main/`, so
// the `join(__dirname, "../preload/preload.cjs")` references
// below climb one level up + into `preload/` as expected.
declare const __dirname: string;

const RENDERER_DEV_URL = process.env["ELECTRON_RENDERER_URL"];

/** CI smoke-boot mode. The release workflow's smoke step launches
 *  the packaged binary with `--smoke-test` after `electron-builder`
 *  emits it; the goal is to assert the main bundle parses + boots
 *  (the `__dirname`-already-declared SyntaxError fixed in #459 was
 *  the canonical "build emits, runtime crashes" miss the previous
 *  build-only CI couldn't catch). The flag schedules a clean
 *  `app.quit()` shortly after the main window opens so the smoke
 *  step gets a deterministic exit-0 from a healthy boot. */
const SMOKE_TEST = process.argv.includes("--smoke-test");
const SMOKE_TEST_QUIT_DELAY_MS = 3000;

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
let browseWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Annot by ingcreators",
    // Hide the OS menu bar on Windows / Linux. The application
    // menu still exists logically (Electron promotes it to a
    // per-window menu on these platforms) so accelerators like
    // `CmdOrCtrl+B` keep firing; `setAutoHideMenuBar` lets power
    // users press `Alt` to reveal it momentarily. macOS keeps the
    // global menu bar — both system convention and the only place
    // `appMenu` (About / Hide / Quit) lives.
    //
    // Constructor option (`autoHideMenuBar: true`) does the same
    // job as the runtime call in current Electron versions, but
    // setting both is harmless and keeps intent grouped with the
    // other window options. The `false` visibility default
    // suppresses the brief flash of the menu bar between
    // `BrowserWindow` construction and `loadFile/URL`.
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (process.platform !== "darwin") {
    win.setMenuBarVisibility(false);
  }

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

/** Decode PNG bytes into raw 4-channel BGRA pixels via Electron's
 *  `nativeImage.toBitmap()`. The byte order on Windows / Linux is
 *  BGRA (Skia's native layout); on macOS it can vary on Apple
 *  Silicon — but the Office-clipboard handler that calls this
 *  is gated on Windows (`isSupported`), so the BGRA assumption
 *  always holds at the call site. The caller (`bgraToDib` in
 *  `ipc/dib.ts`) drops the alpha channel and packs the BGR rows
 *  bottom-up with 4-byte scanline padding for `CF_DIB`. */
function pngToBgraViaNativeImage(png: Uint8Array): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) {
    throw new Error("[clipboard] nativeImage failed to decode PNG for CF_DIB fallback");
  }
  const size = img.getSize();
  const bitmap = img.toBitmap();
  return {
    data: new Uint8Array(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength),
    width: size.width,
    height: size.height,
  };
}

/** Resolve the path to the `annot-win-clipboard` napi addon and
 *  load it. Returns `null` on non-Windows hosts (the addon is
 *  Win32-only and will fail to load on macOS / Linux); the
 *  clipboard handler's `isSupported` gate keeps callers off the
 *  null path.
 *
 *  Resolution order (matches `defaultPresetsPath` above):
 *    1. `process.resourcesPath` — production build, where
 *       `electron-builder`'s `extraResources` puts the file next
 *       to `tool-presets.yml`.
 *    2. `<dist-electron>/../../native/win-clipboard/prebuilds/`
 *       — dev (`electron-vite dev`) where `__dirname` resolves
 *       under `dist-electron/main/`. */
function loadWinClipboardAddon(): { writeMultiFormat: (formats: unknown) => void } | null {
  if (process.platform !== "win32") return null;
  const candidates = [
    join(process.resourcesPath ?? "", "win-clipboard.node"),
    join(__dirname, "../../native/win-clipboard/prebuilds/win-clipboard.win32-x64.node"),
  ];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(p) as { writeMultiFormat: (formats: unknown) => void };
      }
    } catch {
      /* try next */
    }
  }
  console.warn("[clipboard] win-clipboard addon not found; Office paste will be unavailable");
  return null;
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

/** Spawn (or focus + navigate) the Browse window — Phase 6 of
 *  `desktop-electron-migration.md`. Loads the chrome from
 *  `browse.html`, which embeds an `<webview>` for the user-
 *  navigated URL. The IPC `browse.captureVisible` then
 *  captures that webview via `webContents.fromId().capturePage()`. */
async function openOrFocusBrowseWindow(opts: { url?: string } = {}): Promise<void> {
  if (browseWindow && !browseWindow.isDestroyed()) {
    if (browseWindow.isMinimized()) browseWindow.restore();
    browseWindow.show();
    browseWindow.focus();
    if (opts.url) {
      browseWindow.webContents.send("browse.navigate", { url: opts.url });
    }
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Annot Browse",
    // Same OS-menu treatment as the main window — see
    // `createMainWindow` for rationale. The Browse window's chrome
    // (back / forward / reload / URL bar / Capture Visible) lives
    // inside browse.html, so the OS menu bar contributes nothing
    // here either.
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The `<webview>` tag inside `browse.html` requires this
      // permission. Without it the tag renders as a no-op `div`.
      webviewTag: true,
    },
  });
  if (process.platform !== "darwin") {
    win.setMenuBarVisibility(false);
  }

  if (RENDERER_DEV_URL) {
    void win.loadURL(`${RENDERER_DEV_URL}/browse.html`);
  } else {
    void win.loadFile(join(__dirname, "../renderer/browse.html"));
  }

  browseWindow = win;
  win.on("closed", () => {
    if (browseWindow === win) browseWindow = null;
  });

  // Pop-up handling — `window.open()` and `<a target="_blank">`
  // currently route to the Browse window's own webview rather
  // than spawning OS-level windows. The plan notes a multi-tab
  // follow-up; for now, deny new windows so OAuth flows that
  // expect a popup show a clear error rather than silently
  // failing.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Wire the capture-package's content-preload onto the embedded
  // `<webview>` (Phase 4A of `desktop-browser-mode.md`). The
  // `will-attach-webview` event fires once per webview before it
  // attaches to the DOM, so listeners can rewrite its
  // `webPreferences`. The preload runs in the webview's renderer
  // context and bridges `ContentBus` over `ipcRenderer.sendToHost`
  // so the chrome-side `DesktopCaptureHost.sendToContent` /
  // `onContentMessage` primitives work uniformly across hosts.
  win.webContents.on("will-attach-webview", (_event, webPreferences) => {
    webPreferences.preload = join(__dirname, "../preload/content-preload.cjs");
  });

  // Send the navigation request once the chrome's renderer
  // signals ready. Browser renderer dispatches a one-shot
  // `browse.ready` IPC after `DOMContentLoaded`; until then
  // queue the navigation.
  if (opts.url) {
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("browse.navigate", { url: opts.url });
    });
  }
}

/** Build the application menu bar.
 *
 *  Visibility:
 *    - macOS: always shown (system-managed; users expect it).
 *    - Windows / Linux: hidden by default + auto-hide. The bar is
 *      still present logically so accelerators (Ctrl+B, Cmd+W,
 *      etc.) keep firing; pressing Alt momentarily reveals it for
 *      power users who want the on-screen affordance. The hide is
 *      applied per-window in `createMainWindow` because Electron
 *      promotes the application menu to a per-window menu on
 *      non-mac platforms.
 *
 *  Menu shape:
 *    - File: just Close (Mac) / Quit (Win/Linux). "New Browse
 *      Window" used to live here (with `Cmd-B` / `Ctrl-B`); it
 *      moved into the unified New menu inside the gallery
 *      sidebar via `getNewMenuExtras` so capture entry points
 *      (Capture Screen / Window / Region / Open Browse Window)
 *      sit together. The keyboard accelerator went away with the
 *      menu entry — re-adding it via a renderer-side keydown
 *      listener is a future tweak if the shortcut is missed.
 *    - Edit (role): standard Cut / Copy / Paste / Select All so
 *      `<input>`-bound shortcuts work in panels and dialogs.
 *      `Undo` / `Redo` from this role conflict with the editor's
 *      own history (Cmd-Z / Ctrl-Z); a follow-up wires those to
 *      the editor session via IPC. Documented as a known
 *      pre-existing issue rather than fixed here.
 *    - View: trimmed to "Toggle Developer Tools" + "Toggle Full
 *      Screen". The default `viewMenu` role bundles
 *      `reload` / `forceReload` (data-loss risk during edit) and
 *      `resetZoom` / `zoomIn` / `zoomOut` (page-level zoom that
 *      conflicts with the editor's own zoom controls in the
 *      statusbar) — neither belongs in an annotation app.
 *    - Window (role): standard Minimize / Bring All to Front
 *      (Mac) / Close.
 */
function buildAppMenu(): Menu {
  const isMac = process.platform === "darwin";
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [isMac ? { role: "close" } : { role: "quit" }],
  };
  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    fileMenu,
    { role: "editMenu" },
    viewMenu,
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}

/** Capture the visible viewport of a `<webview>` by its
 *  webContentsId. The renderer-side `browse.ts` calls
 *  `<webview>.getWebContentsId()` and forwards the id; this main-
 *  side lookup uses `webContents.fromId()` to resolve the actual
 *  capture target.
 *
 *  The DPR is read from the page's `window.devicePixelRatio` via
 *  `executeJavaScript` IN THE SAME EVENT-LOOP TURN as the
 *  `capturePage()` call, so the value matches the capture's
 *  pixel density (Phase 2 of `desktop-browser-mode.md` —
 *  host-authoritative DPR). `nativeImage.getScaleFactor()` /
 *  `getScaleFactors()` were considered but neither reliably
 *  reports the page's DPR for `capturePage()` output across
 *  Electron versions; the executeJavaScript probe matches the
 *  chrome extension's content-side approach and stays consistent
 *  with what Chromium actually rendered. */
async function captureWebContentsById(webContentsId: number): Promise<CapturedImage> {
  const wc = webContents.fromId(webContentsId);
  if (!wc) {
    throw new Error(`[browse] webContents id ${webContentsId} not found`);
  }
  const image = await wc.capturePage();
  const png = image.toPNG();
  const size = image.getSize();
  let dpr = 1;
  try {
    const probed = (await wc.executeJavaScript(
      "window.devicePixelRatio || 1",
      true,
    )) as unknown;
    const probedNum = typeof probed === "number" ? probed : Number(probed);
    if (Number.isFinite(probedNum) && probedNum > 0) dpr = probedNum;
  } catch {
    /* page navigated mid-capture or executeJavaScript rejected — fall back to 1 */
  }
  return {
    png: new Uint8Array(png.buffer, png.byteOffset, png.byteLength),
    width: size.width,
    height: size.height,
    dpr,
  };
}

/** Run a MAIN-world JavaScript expression against the target
 *  `webContents`. Used by `browse.host.requestPageMetadata` to
 *  drive the capture-package walker. The `userGesture` flag is
 *  `true` so the executed code can call APIs that require a user
 *  activation (the walker doesn't, but the chrome host's
 *  `chrome.scripting.executeScript({ world: "MAIN" })` runs with
 *  the same kind of elevated permissions, so this matches the
 *  semantics). */
async function executeJavaScriptInTarget(
  webContentsId: number,
  expression: string,
): Promise<unknown> {
  const wc = webContents.fromId(webContentsId);
  if (!wc) {
    throw new Error(`[browse] webContents id ${webContentsId} not found`);
  }
  return wc.executeJavaScript(expression, true);
}

/** Lazily-loaded `annot-win-clipboard` addon. Resolved once at
 *  app-ready time; the resolved handle is captured in the
 *  `clipboard` deps closure below. Stays `null` on macOS / Linux
 *  (the addon is Win32-only) and on Windows builds where the
 *  prebuilt `.node` is missing — the `clipboard.isSupported`
 *  gate throws a clear "Windows-only" error in that case. */
let winClipboardAddon: { writeMultiFormat: (formats: unknown) => void } | null = null;

void app.whenReady().then(async () => {
  ipcMain.handle("ping", () => "pong");

  const userDataDir = app.getPath("userData");
  const libraryRoot = await ensureLibrarySkeleton();
  winClipboardAddon = loadWinClipboardAddon();

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
    browse: {
      openBrowseWindow: (browseOpts) => openOrFocusBrowseWindow(browseOpts),
      captureWebContents: captureWebContentsById,
      executeJavaScriptInTarget,
    },
    extension: { userDataDir },
    shell: {
      openPath: (absPath) => electronShell.openPath(absPath),
    },
    clipboard: {
      writeFormats: (formats) => {
        if (!winClipboardAddon) {
          throw new Error(
            "Office clipboard paste requires the win-clipboard addon, which is " +
              "Windows-only and was not found in the current build.",
          );
        }
        // The napi addon expects `data: Buffer`, not `Uint8Array`
        // — translate at the boundary so the renderer / handler
        // can stay platform-neutral.
        const wireFormats = formats.map((f) => ({
          format: f.format,
          data: Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength),
        }));
        winClipboardAddon.writeMultiFormat(wireFormats);
      },
      pngToJpeg: pngToJpegViaNativeImage,
      pngToBgra: pngToBgraViaNativeImage,
      isSupported: () => process.platform === "win32" && winClipboardAddon !== null,
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

  Menu.setApplicationMenu(buildAppMenu());

  createMainWindow();

  if (SMOKE_TEST) {
    // Reaching this line means module parse + every synchronous main-
    // process boot path above (IPC handlers, library skeleton,
    // BrowserWindow construction) succeeded — exactly the "did the
    // packaged bundle's runtime survive its own boot?" question the
    // release workflow's smoke step asks. Quit cleanly so the launcher
    // sees a deterministic exit code 0.
    console.log(
      `[smoke] --smoke-test detected; quitting in ${SMOKE_TEST_QUIT_DELAY_MS}ms`,
    );
    setTimeout(() => app.quit(), SMOKE_TEST_QUIT_DELAY_MS);
  }

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
