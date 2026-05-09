/**
 * Ambient extras for the File System Access API surface that
 * TypeScript 6.0's `lib.dom.d.ts` doesn't ship yet.
 *
 * In scope:
 *   - `window.showDirectoryPicker(opts)` — the entry point that
 *     gives Annot a `FileSystemDirectoryHandle` for the user's
 *     chosen "Device" folder.
 *   - `FileSystemHandle.queryPermission` /
 *     `FileSystemHandle.requestPermission` — used by the Device
 *     storage backend to re-acquire write permission across
 *     reloads. These ARE in the spec (Permissions appendix of
 *     the FSA standard) but lib.dom hasn't picked them up.
 *
 * Out of scope (already in lib.dom in TS 6+):
 *   - `FileSystemDirectoryHandle.entries()` — works without a
 *     cast.
 *   - `FileSystemDirectoryHandle.getFileHandle` /
 *     `getDirectoryHandle` / `removeEntry` — typed.
 *
 * Phase 5 of `docs/plans/source-audit-cleanup.md`.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface ShowDirectoryPickerOptions {
  mode?: "read" | "readwrite";
  startIn?:
    | FileSystemHandle
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos";
  id?: string;
}

declare global {
  interface FileSystemHandle {
    queryPermission(desc?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(desc?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface Window {
    showDirectoryPicker?(opts?: ShowDirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  }
}

export {};
