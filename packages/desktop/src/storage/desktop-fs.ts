/**
 * `DesktopFs` — the file-system seam `DesktopStore` operates
 * against. Two implementations share this shape:
 *
 *   - **Electron** (production): {@link createElectronDesktopFs}
 *     delegates each primitive to a `ipcRenderer.invoke('fs.*')`
 *     IPC bridge backed by Node `fs/promises` in the Electron
 *     main process. Every store-side path is a forward-slash,
 *     library-relative key (`""` = root, `"Inbox"` =
 *     top-level folder, `"Inbox/cap.annot.png"` = leaf); the
 *     main process resolves them against the canonical library
 *     root and rejects path-traversal attempts.
 *   - **Tests**: {@link createMockDesktopFs} in
 *     `desktop-fs.test-mock.ts` keeps a plain in-memory tree so
 *     the contract suite runs under happy-dom without ambient
 *     Electron.
 *
 * The interface stays narrow on purpose — every method maps 1:1 to
 * a primitive Node `fs/promises` call. Higher-level concepts
 * (`uniquify`, `recursive-copy`, `walk-with-XMP`) live in
 * `desktop-store.ts` on top.
 */

export type DesktopFsEntryKind = "file" | "directory";

export interface DesktopFsEntry {
  /** Leaf name only (no slashes). Symlinks surface as the kind they
   *  point to — DesktopStore never inspects symlink-ness directly,
   *  so collapsing the distinction matches what the store needs. */
  name: string;
  kind: DesktopFsEntryKind;
}

export interface DesktopFsStat {
  kind: DesktopFsEntryKind;
  /** File size in bytes. `0` for directories. */
  size: number;
  /** Last-modified time in ms since epoch. May be `0` if the host
   *  filesystem doesn't track mtime (rare; mostly a future-Electron
   *  edge case on exotic FUSE mounts). DesktopStore uses this for
   *  thumbnail-cache versioning + external-edit detection, so a
   *  zero stays "always considered changed" — safe but expensive. */
  mtime: number;
}

export interface DesktopFs {
  /** List a directory's direct children. Returns `[]` when `path`
   *  is empty / missing — missing directories are not an error
   *  here, matching the {@link StorageProvider.listFolders}
   *  semantics one layer up. Throws on permission / IO failures. */
  readDir(path: string): Promise<DesktopFsEntry[]>;

  /** Read a file as raw bytes. Throws when the file doesn't exist
   *  (caller is expected to `stat` first if "missing" should be
   *  silently swallowed). */
  readFile(path: string): Promise<Uint8Array>;

  /** Write `bytes` to `path`, creating or overwriting. Parent
   *  directories must already exist (caller `mkdir`s first). */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;

  /** Create a directory. With `recursive: true` (the typical
   *  caller default) intermediate directories are created too;
   *  pre-existing target directories are accepted silently. With
   *  `recursive: false` the call rejects if `path` already exists. */
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;

  /** Move / rename a file or directory. Cross-directory moves are
   *  expected to work atomically when `from` and `to` share a
   *  filesystem (real-world `EXDEV` cases on the desktop are rare;
   *  the future Electron impl can add a copy-then-delete fallback
   *  if a user reports it). */
  rename(from: string, to: string): Promise<void>;

  /** Remove a file or directory. With `recursive: true` directories
   *  are removed even when non-empty; without it removing a
   *  non-empty directory rejects. */
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;

  /** Stat a path. Returns `undefined` on `ENOENT` / `NotFound`;
   *  rethrows other errors so they don't get silently swallowed. */
  stat(path: string): Promise<DesktopFsStat | undefined>;
}

// ---- Electron-backed implementation ─────────────────────────────

/**
 * Shape of the IPC bridge exposed by the Electron preload script
 * (see `packages/desktop/src-electron/preload.ts`). Phase 1 of
 * `docs/plans/desktop-electron-migration.md` adds the `fs.*`
 * handlers consumed below; subsequent phases extend the channel
 * inventory (XMP, screen capture, Office clipboard, …) without
 * widening this bridge interface — each channel stays a string
 * passed through `invoke`.
 */
export interface ElectronApi {
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
}

/** Default invoker that pulls `window.electronAPI.invoke` off the
 *  current global. Tests pass a stub via the `invoker` parameter so
 *  the round-trip can be exercised without ambient Electron. */
function defaultInvoker(): ElectronApi {
  const api = (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
  if (!api) {
    throw new Error(
      "[desktop-fs] window.electronAPI is missing — is the Electron preload " +
        "script loaded? createElectronDesktopFs is renderer-only.",
    );
  }
  return api;
}

interface ElectronStat {
  kind: "file" | "directory";
  size: number;
  mtime: number;
}

interface ElectronEntry {
  name: string;
  kind: "file" | "directory";
}

/**
 * Electron-backed `DesktopFs`. Every primitive translates to a
 * single `ipcRenderer.invoke('fs.*', payload)` round-trip. The main-
 * process handler resolves the library-relative path against the
 * absolute library root (`<userData>/library/`) and validates that
 * the result stays inside the root — see
 * `packages/desktop/src-electron/ipc/fs.ts:resolveSafe` for the
 * traversal-guard rules.
 *
 * Path semantics match {@link createTauriDesktopFs}: the `path`
 * argument is forward-slash, library-relative (`""` = root,
 * `"Inbox"` = top-level folder, `"Inbox/cap.annot.png"` = leaf).
 * `DesktopStore` doesn't change at the Tauri-to-Electron cutover.
 */
export function createElectronDesktopFs(
  invoker: ElectronApi = defaultInvoker(),
): DesktopFs {
  return {
    async readDir(path) {
      try {
        const entries = await invoker.invoke<ElectronEntry[]>("fs.list", { path });
        return entries.map((e) => ({ name: e.name, kind: e.kind }));
      } catch {
        // Mirror `createTauriDesktopFs` and the
        // `StorageProvider.listFolders` contract: missing
        // directories surface as empty rather than error.
        return [];
      }
    },

    async readFile(path) {
      const bytes = await invoker.invoke<Uint8Array>("fs.read", { path });
      // Defensive copy: the structured-clone IPC may share the
      // backing ArrayBuffer with the renderer-side cache. Caller
      // expectations match the Tauri impl (returns plain
      // `Uint8Array`).
      return new Uint8Array(bytes);
    },

    async writeFile(path, bytes) {
      await invoker.invoke<void>("fs.write", { path, bytes });
    },

    async mkdir(path, opts) {
      await invoker.invoke<void>("fs.mkdir", {
        path,
        recursive: opts?.recursive ?? false,
      });
    },

    async rename(from, to) {
      await invoker.invoke<void>("fs.rename", { from, to });
    },

    async remove(path, opts) {
      await invoker.invoke<void>("fs.unlink", {
        path,
        recursive: opts?.recursive ?? false,
      });
    },

    async stat(path) {
      const info = await invoker.invoke<ElectronStat | null>("fs.stat", { path });
      if (!info) return undefined;
      return { kind: info.kind, size: info.size, mtime: info.mtime };
    },
  };
}
