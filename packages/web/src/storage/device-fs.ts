/**
 * Generic File System Access (FSA) API helpers used by `DeviceStore`.
 * Take any `FileSystemDirectoryHandle`-shaped object and operate
 * against the standard methods (`getDirectoryHandle`, `getFileHandle`,
 * `entries`, `removeEntry`).
 *
 * Lifted out of `device-store.ts` (closing slice of proposal 4) so
 * the path-walking + crash-recovery scans can be unit-tested
 * directly against `device-fs.test-mock.ts`'s in-memory directory
 * tree, without standing up a `DeviceStore` instance + index file.
 *
 * Every helper here is structurally typed on `FileSystemDirectoryHandle`:
 * pass a real handle in production, the mock handle under tests.
 */

/**
 * Walk a slash-separated `folderPath` from `root`, returning the
 * directory handle at the leaf. Empty `folderPath` resolves to the
 * root itself.
 *
 * - `create: false` (default) → throws `NotFoundError` (or whatever
 *   the FSA implementation surfaces) when an intermediate segment
 *   doesn't exist.
 * - `create: true` → creates missing directories along the way.
 *
 * Mirrors what `DeviceStore` previously did inline as `#getDirHandle`.
 */
export async function getDirHandle(
  root: FileSystemDirectoryHandle,
  folderPath: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  if (!folderPath) return root;
  let dir = root;
  for (const part of folderPath.split("/")) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

/**
 * Predicate: does `dir` already contain a file named `name`?
 *
 * The FSA spec doesn't expose a `has()` method, so the only way to
 * check existence is via `getFileHandle()` and catching the
 * "NotFoundError" rejection. Any other rejection (e.g. permission
 * revoked) also surfaces as `false` — callers shouldn't rely on
 * this helper to distinguish "missing" from "inaccessible".
 */
export async function fileExists(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively scan `dir` and remove every zero-byte file. Returns
 * the basePath-relative paths of every file actually deleted, so
 * the caller can clean its in-memory index in lock-step.
 *
 * The historical `DeviceStore.#purgeEmptyFiles` ran this scan at
 * `init()` to recover from the FSA crash signature: a writer that
 * truncates the file to 0 bytes IMMEDIATELY at `createWritable()`
 * time and never closes (e.g. tab killed mid-save) leaves an
 * orphan empty file the gallery would otherwise show as a broken
 * thumbnail.
 *
 * Subdirectories are walked but never removed — the gallery's
 * folder set comes from the on-disk tree, and a folder that
 * happens to contain only empty files (and nothing else) is
 * legitimately empty after this scan, not a candidate for
 * deletion.
 */
export async function purgeEmptyFiles(
  dir: FileSystemDirectoryHandle,
  parentPath: string,
): Promise<string[]> {
  const toDelete: string[] = [];
  const deleted: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") {
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        if (file.size === 0) toDelete.push(name);
      } catch {
        /* ignore — file vanished mid-scan, nothing to do */
      }
    } else if (handle.kind === "directory") {
      const sub = await purgeEmptyFiles(
        handle as FileSystemDirectoryHandle,
        parentPath ? `${parentPath}/${name}` : name,
      );
      deleted.push(...sub);
    }
  }
  for (const name of toDelete) {
    try {
      await dir.removeEntry(name);
      deleted.push(parentPath ? `${parentPath}/${name}` : name);
    } catch {
      /* ignore — entry vanished mid-purge */
    }
  }
  return deleted;
}
