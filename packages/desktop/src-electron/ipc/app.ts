/**
 * Misc app-info IPC handlers — Phase 1 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Just one channel today (`app.getLibraryRoot`), kept in its own
 * file so future low-traffic info channels (`app.getVersion` /
 * `app.getName` / etc.) have an obvious home that doesn't bloat
 * `main.ts`.
 *
 * The renderer-side `bootstrap.ts` calls `app.getLibraryRoot` once
 * at boot to learn where on disk to find the library — the
 * Electron-flavoured replacement for the Tauri build's
 * `appDataDir() + 'library/'` resolution. `<userData>/library/`
 * resolves per-OS:
 *
 *   - Windows: `%APPDATA%/Annot/library/`
 *   - macOS:   `~/Library/Application Support/Annot/library/`
 *   - Linux:   `~/.config/Annot/library/`
 *
 * The path resolution is wrapped in a factory so `main.ts` can
 * register the channel with a known root, and tests can construct
 * the handlers against a tmpdir without booting Electron.
 */

export interface AppHandlers {
  getLibraryRoot(): Promise<string>;
}

export function createAppHandlers(libraryRoot: string): AppHandlers {
  return {
    async getLibraryRoot() {
      return libraryRoot;
    },
  };
}

export const APP_CHANNELS = {
  getLibraryRoot: "app.getLibraryRoot",
} as const;

export type AppChannel = (typeof APP_CHANNELS)[keyof typeof APP_CHANNELS];

export const APP_CHANNEL_TO_HANDLER: Record<AppChannel, keyof AppHandlers> = {
  [APP_CHANNELS.getLibraryRoot]: "getLibraryRoot",
};
