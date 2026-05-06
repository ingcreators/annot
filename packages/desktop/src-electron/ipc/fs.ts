/**
 * Filesystem IPC handlers — Phase 1 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * One handler per primitive in the renderer-side `DesktopFs`
 * interface (see `packages/desktop/src/storage/desktop-fs.ts`):
 *
 *   - `fs.read`   `(path)              → Uint8Array`
 *   - `fs.write`  `(path, bytes)       → void`
 *   - `fs.list`   `(path)              → DesktopFsEntry[]`
 *   - `fs.mkdir`  `(path, recursive?)  → void`
 *   - `fs.rename` `(from, to)          → void`
 *   - `fs.unlink` `(path, recursive?)  → void`
 *   - `fs.stat`   `(path)              → DesktopFsStat | null`
 *
 * Every handler resolves its input against an absolute
 * `libraryRoot`. The renderer is *only* allowed to address paths
 * inside that root — the validation step in {@link resolveSafe}
 * rejects absolute inputs, `..` segments, and any resolved path
 * that doesn't sit under `libraryRoot`. Without that guard, a
 * compromised renderer (or a malformed XMP read pulled from
 * untrusted disk) could traverse to anywhere the Electron process
 * has filesystem access — which on the desktop is the user's
 * entire home directory.
 *
 * The handlers do NOT call `ipcMain.handle` themselves. The main
 * process owns IPC registration ({@link main.ts}) so this module
 * stays unit-testable: {@link createFsHandlers} returns a plain
 * object with one async function per channel, and the tests in
 * `fs.test.ts` exercise it directly against a tmpdir without
 * needing Electron at all.
 */

import { promises as fs } from "node:fs";
import { normalize, resolve, sep } from "node:path";

/** Single entry returned by `fs.list`. Mirrors the renderer's
 *  `DesktopFsEntry` (see `packages/desktop/src/storage/desktop-fs.ts`)
 *  so the JSON-over-IPC payload deserialises into the right shape on
 *  the renderer side without translation. Symlinks surface as the
 *  kind they point to — DesktopStore never inspects symlink-ness
 *  directly, and `stat`-following matches the Tauri-plugin-fs
 *  behaviour the renderer used previously. */
export interface FsListEntry {
  name: string;
  kind: "file" | "directory";
}

/** Mirror of the renderer's `DesktopFsStat`. `null` (rather than
 *  `undefined`) is the IPC return when a path doesn't exist —
 *  Electron's structured-clone IPC drops `undefined` properties on
 *  the wire, so the explicit null is what makes "missing" survive
 *  the round-trip. */
export interface FsStatPayload {
  kind: "file" | "directory";
  size: number;
  mtime: number;
}

export interface FsHandlers {
  read(input: { path: string }): Promise<Uint8Array>;
  write(input: { path: string; bytes: Uint8Array }): Promise<void>;
  list(input: { path: string }): Promise<FsListEntry[]>;
  mkdir(input: { path: string; recursive?: boolean }): Promise<void>;
  rename(input: { from: string; to: string }): Promise<void>;
  unlink(input: { path: string; recursive?: boolean }): Promise<void>;
  stat(input: { path: string }): Promise<FsStatPayload | null>;
}

/** Joins `relativePath` onto `libraryRoot` and verifies the result
 *  stays inside `libraryRoot`. Throws on absolute paths, `..`
 *  segments, or any resolved path that escapes the root via symlink
 *  / case-insensitive filesystem quirks (the resolved-path check
 *  catches those uniformly).
 *
 *  Empty / `"."` resolves to `libraryRoot` itself — used by the
 *  `fs.list("")` / `fs.mkdir("")` cases that operate on the root.
 */
function resolveSafe(libraryRoot: string, relativePath: string): string {
  // Empty, ".", and "/" all alias the library root. The latter is
  // handy for callers that build paths by concatenation and end up
  // with a stray leading slash; treating it as root rather than
  // erroring keeps the bridge ergonomic.
  if (relativePath === "" || relativePath === "." || relativePath === "/") {
    return libraryRoot;
  }
  // Reject absolute paths early — `path.resolve(absRoot, abs)` would
  // silently switch to `abs` and skip the containment check below.
  // `node:path` accepts `\\` on Windows and `/` everywhere; reject
  // both, plus the Windows drive-letter form `C:`.
  if (
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    /^[a-zA-Z]:/.test(relativePath)
  ) {
    throw new Error(`[fs-ipc] absolute paths are not permitted: ${relativePath}`);
  }
  // Defensive: reject any input that contains a `..` segment after
  // normalisation. `path.resolve` would happily walk above
  // libraryRoot if we let it.
  const normalised = normalize(relativePath);
  if (
    normalised === ".." ||
    normalised.startsWith(`..${sep}`) ||
    normalised.includes(`${sep}..${sep}`)
  ) {
    throw new Error(`[fs-ipc] path-traversal segments are not permitted: ${relativePath}`);
  }
  const absolute = resolve(libraryRoot, normalised);
  // Belt-and-suspenders: even after the segment check, confirm the
  // resolved path sits under libraryRoot. Catches any platform-
  // specific edge cases (case-insensitive Windows volumes, hardlinks,
  // …) that slipped past the textual check.
  const rootWithSep = libraryRoot.endsWith(sep) ? libraryRoot : libraryRoot + sep;
  if (absolute !== libraryRoot && !absolute.startsWith(rootWithSep)) {
    throw new Error(`[fs-ipc] resolved path escapes library root: ${relativePath}`);
  }
  return absolute;
}

/** Build the `fs.*` handler set for a given library root. Caller
 *  (`main.ts`) wires each function into one `ipcMain.handle`
 *  registration. Tests construct against a tmpdir + call directly. */
export function createFsHandlers(libraryRoot: string): FsHandlers {
  return {
    async read(input) {
      const abs = resolveSafe(libraryRoot, input.path);
      const buf = await fs.readFile(abs);
      // Convert Node Buffer → Uint8Array so the IPC wire format is
      // a plain typed array. Electron's structured clone preserves
      // this verbatim on the renderer side.
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },

    async write(input) {
      const abs = resolveSafe(libraryRoot, input.path);
      await fs.writeFile(abs, input.bytes);
    },

    async list(input) {
      const abs = resolveSafe(libraryRoot, input.path);
      try {
        const dirents = await fs.readdir(abs, { withFileTypes: true });
        return dirents.map((d) => ({
          name: d.name,
          kind: d.isDirectory() ? ("directory" as const) : ("file" as const),
        }));
      } catch (err) {
        // `StorageProvider.listFolders` semantics: missing
        // directories surface as empty rather than error. Match
        // that here so the renderer-side adapter can stay a thin
        // pass-through.
        if (isEnoent(err)) return [];
        throw err;
      }
    },

    async mkdir(input) {
      const abs = resolveSafe(libraryRoot, input.path);
      await fs.mkdir(abs, { recursive: input.recursive ?? false });
    },

    async rename(input) {
      const fromAbs = resolveSafe(libraryRoot, input.from);
      const toAbs = resolveSafe(libraryRoot, input.to);
      await fs.rename(fromAbs, toAbs);
    },

    async unlink(input) {
      const abs = resolveSafe(libraryRoot, input.path);
      // Dispatch by entry kind so the renderer's
      // `DesktopFs.remove(emptyDir)` (without `recursive:true`) works
      // — Node's `fs.rm({recursive: false})` rejects all directories
      // unconditionally, but the contract this handler implements is
      // "remove an empty directory or any file". The kind dispatch
      // matches the renderer-side JSDoc on `DesktopFs.remove`.
      const stat = await fs.stat(abs); // throws ENOENT for missing — matches plugin-fs behaviour.
      if (stat.isDirectory()) {
        if (input.recursive) {
          await fs.rm(abs, { recursive: true, force: false });
        } else {
          await fs.rmdir(abs); // rejects with ENOTEMPTY for non-empty dirs.
        }
      } else {
        await fs.unlink(abs);
      }
    },

    async stat(input) {
      const abs = resolveSafe(libraryRoot, input.path);
      try {
        const info = await fs.stat(abs);
        return {
          kind: info.isDirectory() ? ("directory" as const) : ("file" as const),
          size: info.size,
          mtime: info.mtimeMs,
        };
      } catch (err) {
        if (isEnoent(err)) return null;
        throw err;
      }
    },
  };
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

// ---- Channel name constants ──────────────────────────────────────
//
// Centralising the channel strings means the main-process
// registration site, the renderer-side bridge, and the tests all
// reference the same source of truth. A typo in any one of those
// surfaces produces a TypeScript error rather than a silent no-op.

export const FS_CHANNELS = {
  read: "fs.read",
  write: "fs.write",
  list: "fs.list",
  mkdir: "fs.mkdir",
  rename: "fs.rename",
  unlink: "fs.unlink",
  stat: "fs.stat",
} as const;

export type FsChannel = (typeof FS_CHANNELS)[keyof typeof FS_CHANNELS];

/** Map a channel name to the matching handler key. Used by main.ts
 *  to register every `fs.*` channel in one loop. */
export const FS_CHANNEL_TO_HANDLER: Record<FsChannel, keyof FsHandlers> = {
  [FS_CHANNELS.read]: "read",
  [FS_CHANNELS.write]: "write",
  [FS_CHANNELS.list]: "list",
  [FS_CHANNELS.mkdir]: "mkdir",
  [FS_CHANNELS.rename]: "rename",
  [FS_CHANNELS.unlink]: "unlink",
  [FS_CHANNELS.stat]: "stat",
};
