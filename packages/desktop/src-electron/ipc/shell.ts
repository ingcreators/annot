/**
 * Shell IPC — Phase 9 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * One channel:
 *
 *   - `shell.openPath(absPath)` → reveal `absPath` in the OS file
 *     manager (Finder / Explorer / xdg-open). Used by the
 *     legacy-data toast's "Open old folder" affordance now that
 *     the @tauri-apps/plugin-shell dynamic import is gone.
 *
 * Dependency-injected `openPath` callback so the handler stays
 * unit-testable; `main.ts` wires it to Electron's
 * `shell.openPath`.
 */

export interface ShellHandlers {
  openPath(input: { path: string }): Promise<{ ok: boolean; error?: string }>;
}

export interface ShellDeps {
  /** Open the path in the OS file manager. Returns the empty
   *  string on success or a human-readable failure reason. */
  openPath(absPath: string): Promise<string>;
}

export function createShellHandlers(deps: ShellDeps): ShellHandlers {
  return {
    async openPath({ path }) {
      const error = await deps.openPath(path);
      if (error) return { ok: false, error };
      return { ok: true };
    },
  };
}

export const SHELL_CHANNELS = {
  openPath: "shell.openPath",
} as const;

export type ShellChannel = (typeof SHELL_CHANNELS)[keyof typeof SHELL_CHANNELS];

export const SHELL_CHANNEL_TO_HANDLER: Record<ShellChannel, keyof ShellHandlers> = {
  [SHELL_CHANNELS.openPath]: "openPath",
};
