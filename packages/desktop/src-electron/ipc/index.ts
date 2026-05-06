/**
 * IPC registration — Phases 1+2+3+4 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Single entry point that wires every per-channel handler defined
 * in this directory onto Electron's `ipcMain`. Keeping the
 * registration centralised:
 *
 *   - keeps `main.ts` short: it calls `registerAllIpcHandlers(...)`
 *     once during `app.whenReady()`.
 *   - makes the channel inventory greppable from one place.
 *   - keeps the per-handler files (`fs.ts`, `app.ts`, `xmp.ts`,
 *     `settings.ts`, `window.ts`, `screen-capture.ts`,
 *     `clipboard.ts`) free of Electron imports so unit tests can
 *     construct them in a plain Node environment. `window.ts`,
 *     `screen-capture.ts`, and `clipboard.ts` take dependency-
 *     injection callbacks for the bits that need real
 *     `BrowserWindow` / `desktopCapturer` / `clipboard.writeBuffer`
 *     access; tests inject fakes.
 */

import type { IpcMain } from "electron";
import { APP_CHANNEL_TO_HANDLER, createAppHandlers } from "./app.js";
import {
  CLIPBOARD_CHANNEL_TO_HANDLER,
  type ClipboardDeps,
  createClipboardHandlers,
} from "./clipboard.js";
import { FS_CHANNEL_TO_HANDLER, createFsHandlers } from "./fs.js";
import {
  SCREEN_CAPTURE_CHANNEL_TO_HANDLER,
  type ScreenCaptureDeps,
  type ScreenCaptureHandlers,
  createScreenCaptureHandlers,
} from "./screen-capture.js";
import {
  SETTINGS_CHANNEL_TO_HANDLER,
  createSettingsHandlers,
  type SettingsHandlerOptions,
} from "./settings.js";
import {
  WINDOW_CHANNEL_TO_HANDLER,
  createWindowHandlers,
  type WindowController,
} from "./window.js";
import { XMP_CHANNEL_TO_HANDLER, createXmpHandlers, type XmpHandlerOptions } from "./xmp.js";

export interface RegisterAllOptions {
  /** Absolute path to the library root, already created on disk. */
  libraryRoot: string;
  /** Settings-handler dependencies (user-data dir + bundled
   *  default-presets path). */
  settings: SettingsHandlerOptions;
  /** XMP-handler dependencies — only the PNG→JPEG converter. */
  xmp: XmpHandlerOptions;
  /** Screen-capture dependencies — primary-display info,
   *  desktopCapturer adapter, main-window minimize/restore,
   *  overlay-window factory. */
  screenCapture: ScreenCaptureDeps;
  /** Office-clipboard dependencies — Win32 clipboard.writeBuffer
   *  adapter, PNG→JPEG converter, and a platform-support gate. */
  clipboard: ClipboardDeps;
  /** Resolves the current main window for the minimize / restore
   *  IPC handlers. May return `undefined` during shutdown — the
   *  handlers no-op in that case to mirror the Rust impl's
   *  `if let Some(win)` defensive pattern. */
  getMainWindow(): WindowController | undefined;
}

/** Returned by `registerAllIpcHandlers` so the main process can
 *  call `notifyOverlayClosed` on the screen-capture state machine
 *  when the overlay BrowserWindow is destroyed externally
 *  (user-driven close, OS kill). */
export interface RegisteredIpc {
  screenCapture: ScreenCaptureHandlers;
}

export function registerAllIpcHandlers(
  ipcMain: IpcMain,
  opts: RegisterAllOptions,
): RegisteredIpc {
  registerSet(ipcMain, createFsHandlers(opts.libraryRoot), FS_CHANNEL_TO_HANDLER);
  registerSet(ipcMain, createAppHandlers(opts.libraryRoot), APP_CHANNEL_TO_HANDLER);
  registerSet(ipcMain, createSettingsHandlers(opts.settings), SETTINGS_CHANNEL_TO_HANDLER);
  registerSet(ipcMain, createXmpHandlers(opts.xmp), XMP_CHANNEL_TO_HANDLER);
  registerSet(
    ipcMain,
    createWindowHandlers(opts.getMainWindow),
    WINDOW_CHANNEL_TO_HANDLER,
  );
  const screenCapture = createScreenCaptureHandlers(opts.screenCapture);
  registerSet(ipcMain, screenCapture, SCREEN_CAPTURE_CHANNEL_TO_HANDLER);
  registerSet(ipcMain, createClipboardHandlers(opts.clipboard), CLIPBOARD_CHANNEL_TO_HANDLER);
  return { screenCapture };
}

/** Wire each channel in `channelToHandler` onto `ipcMain.handle`,
 *  dispatching to the matching method on `handlers`. The lookup
 *  table is the source of truth — adding a new channel means one
 *  entry in the per-module `*_CHANNEL_TO_HANDLER` constant.
 *
 *  The `handlers` parameter is typed loosely (object with async
 *  methods) because TS's mapped-record constraint doesn't accept
 *  interfaces with named methods that don't carry an index
 *  signature. The lookup table itself is strictly typed at the
 *  call site, so a typo there still fails the build. */
function registerSet<Channel extends string>(
  ipcMain: IpcMain,
  handlers: object,
  channelToHandler: Record<Channel, string>,
): void {
  const ref = handlers as Record<string, (input: unknown) => Promise<unknown>>;
  for (const channel of Object.keys(channelToHandler) as Channel[]) {
    const handlerKey = channelToHandler[channel];
    const handler = ref[handlerKey];
    if (!handler) {
      throw new Error(`[ipc] missing handler for channel ${channel}`);
    }
    ipcMain.handle(channel, async (_evt, input: unknown) => handler.call(handlers, input));
  }
}
