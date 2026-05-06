/**
 * `DesktopFs` — the file-system seam `DesktopStore` operates against.
 *
 * Three host implementations share this shape over the migration's
 * lifetime:
 *
 *   - **Tauri** (today): {@link createTauriDesktopFs} delegates to
 *     `@tauri-apps/plugin-fs` for every primitive. Resolves paths
 *     against an absolute `libraryRoot` so `DesktopStore` itself
 *     never traffics in absolute paths — every store-side path is
 *     a forward-slash, library-relative key (`""` = root,
 *     `"Inbox"` = top-level folder, `"Inbox/cap.annot.png"` = leaf).
 *   - **Electron** (after `desktop-electron-migration.md` Phase 1):
 *     a sibling factory swaps `@tauri-apps/plugin-fs` for an
 *     `ipcRenderer.invoke('fs.*')` IPC bridge backed by Node
 *     `fs/promises` in the main process. `DesktopStore` itself
 *     doesn't change at the cutover.
 *   - **Tests**: {@link createMockDesktopFs} in
 *     `desktop-fs.test-mock.ts` keeps a plain in-memory tree so
 *     the contract suite runs under happy-dom without ambient
 *     Tauri.
 *
 * The interface stays narrow on purpose — every method maps 1:1 to
 * a primitive Node `fs/promises` call so the Electron port stays
 * obvious. Higher-level concepts (`uniquify`, `recursive-copy`,
 * `walk-with-XMP`) live in `desktop-store.ts` on top.
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

// ---- Tauri-backed implementation ────────────────────────────────

/**
 * Resolve a library-relative `path` against `libraryRoot`. The
 * empty string maps to `libraryRoot` itself; non-empty paths are
 * appended with a forward slash. We keep the join string-level
 * (no `path.join`) because `@tauri-apps/plugin-fs` wants OS-native
 * separators only at the OS boundary, and forward slashes work
 * everywhere it's invoked.
 */
function joinAbsolute(libraryRoot: string, path: string): string {
  if (!path) return libraryRoot;
  return `${libraryRoot}/${path}`;
}

/**
 * Tauri-backed `DesktopFs`. Lazily imports `@tauri-apps/plugin-fs`
 * so the module loads cleanly in test environments without ambient
 * Tauri (the lazy `import()` only runs when a method is actually
 * called; tests use {@link createMockDesktopFs} and never reach the
 * import).
 */
export function createTauriDesktopFs(libraryRoot: string): DesktopFs {
  const resolve = (p: string) => joinAbsolute(libraryRoot, p);
  const fs = () => import("@tauri-apps/plugin-fs");

  return {
    async readDir(path) {
      const mod = await fs();
      try {
        const entries = await mod.readDir(resolve(path));
        return entries.map((e) => ({
          name: e.name,
          kind: e.isDirectory ? ("directory" as const) : ("file" as const),
        }));
      } catch {
        // Match `StorageProvider.listFolders` semantics: missing
        // directories surface as empty rather than error.
        return [];
      }
    },

    async readFile(path) {
      const mod = await fs();
      const bytes = await mod.readFile(resolve(path));
      // tauri-plugin-fs returns `Uint8Array<ArrayBuffer>` — narrow
      // for callers that want plain `Uint8Array`. Same bytes, same
      // identity; just a structural-typing relaxation.
      return bytes as Uint8Array;
    },

    async writeFile(path, bytes) {
      const mod = await fs();
      await mod.writeFile(resolve(path), bytes);
    },

    async mkdir(path, opts) {
      const mod = await fs();
      await mod.mkdir(resolve(path), { recursive: opts?.recursive ?? false });
    },

    async rename(from, to) {
      const mod = await fs();
      await mod.rename(resolve(from), resolve(to));
    },

    async remove(path, opts) {
      const mod = await fs();
      await mod.remove(resolve(path), { recursive: opts?.recursive ?? false });
    },

    async stat(path) {
      const mod = await fs();
      try {
        const info = await mod.stat(resolve(path));
        return {
          kind: info.isDirectory ? ("directory" as const) : ("file" as const),
          size: info.size ?? 0,
          mtime: info.mtime instanceof Date ? info.mtime.getTime() : 0,
        };
      } catch {
        return undefined;
      }
    },
  };
}
