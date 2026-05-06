/**
 * Main-window control IPC — Phase 2 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Direct port of the `minimize_main_window` / `restore_main_window`
 * commands in `packages/desktop/src-tauri/src/lib.rs`. Same channel
 * names, same contract:
 *
 *   - `minimize_main_window` → `BrowserWindow.minimize()`.
 *   - `restore_main_window`  → `restore() + show() + focus()`.
 *
 * The renderer-side `desktop-bridge.ts` (Phase 1) already declares
 * the matching `minimizeMainWindow` / `restoreMainWindow` exports;
 * the renderer call sites still import from `tauri-bridge.ts` until
 * the Phase 5 cutover, so this handler sits unused at Phase 2 time
 * — same as the rest of the Phase 2 surface.
 */

export interface WindowController {
  minimize(): void;
  restore(): void;
  show(): void;
  focus(): void;
}

export interface WindowHandlers {
  minimizeMainWindow(): Promise<void>;
  restoreMainWindow(): Promise<void>;
}

/** Build the handler set against a callable that resolves the
 *  current main window. The callable can return `undefined` (e.g.
 *  during shutdown) — handlers no-op in that case to match the
 *  Rust impl's `if let Some(win)` defensive pattern. */
export function createWindowHandlers(
  getMainWindow: () => WindowController | undefined,
): WindowHandlers {
  return {
    async minimizeMainWindow() {
      getMainWindow()?.minimize();
    },

    async restoreMainWindow() {
      const win = getMainWindow();
      if (!win) return;
      win.restore();
      win.show();
      win.focus();
    },
  };
}

export const WINDOW_CHANNELS = {
  minimizeMainWindow: "minimize_main_window",
  restoreMainWindow: "restore_main_window",
} as const;

export type WindowChannel = (typeof WINDOW_CHANNELS)[keyof typeof WINDOW_CHANNELS];

export const WINDOW_CHANNEL_TO_HANDLER: Record<WindowChannel, keyof WindowHandlers> = {
  [WINDOW_CHANNELS.minimizeMainWindow]: "minimizeMainWindow",
  [WINDOW_CHANNELS.restoreMainWindow]: "restoreMainWindow",
};
