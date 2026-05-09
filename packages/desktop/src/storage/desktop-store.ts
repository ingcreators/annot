/**
 * Desktop (Electron) storage provider — path-based identification,
 * per-file XMP metadata, filesystem-as-folder-tree.
 *
 * Direct sibling of {@link DeviceStore} from
 * `@ingcreators/annot-web/storage/device-store`. Where DeviceStore
 * targets the browser File System Access API (talks to a
 * `FileSystemDirectoryHandle`), DesktopStore targets a host-supplied
 * {@link DesktopFs} backed by an `ipcRenderer.invoke('fs.*')`
 * bridge into Node `fs/promises`. Everything above the FS adapter —
 * XMP encode pipeline, path validation, uniquification on save,
 * `ImageRecord` round-trip, `ThumbnailManager` integration,
 * contract-test compliance — is shared.
 *
 * Annot-native captures save as `annot-<ts>.annot.{jpg,png}`;
 * images coming from outside (drag-dropped from the OS, imported
 * with an explicit name) keep their original filename. Annotations,
 * tags, and the original capture image are stored as XMP metadata
 * inside each file. Subfolders on disk = gallery folders 1:1.
 *
 * Phase 1 of `docs/plans/desktop-storage-provider-migration.md`:
 * core + contract tests, NOT yet wired into the bridge / renderer.
 * Phase 2 adds the bridge registration + parallel mount; Phase 3
 * routes capture pipelines through `saveImage`.
 */

import type {
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  StorageProvider,
  StorageWithForceRefresh,
  StorageWithInit,
  StorageWithResync,
  StorageWithThumbnailCache,
} from "@ingcreators/annot-core/storage";
import {
  ancestorPaths,
  getFilename,
  getParentPath,
  joinPath,
  rewritePathPrefix,
  StorageConflictError,
  StorageNotFoundError,
  uniquifyFilenameAsync,
  validateName,
} from "@ingcreators/annot-core/storage";
import { defaultAnnotImageFilename } from "@ingcreators/annot-core/utils";
import { readEditableImage } from "@ingcreators/annot-core/xmp";
import {
  type BuildEditableImageDeps,
  buildEditableImageBlob,
  DEFAULT_DEPS,
} from "@ingcreators/annot-web/storage/image-encode";
import type { DesktopFs } from "./desktop-fs.js";

/** Index file kept at the library root. Mirrors DeviceStore's
 *  `.annot.json` so a human inspecting the library on disk sees a
 *  familiar shape. The leading dot keeps it out of the gallery's
 *  folder list (per `#listFolders`'s dot-prefix filter). */
const INDEX_FILE = ".annot.json";

interface IndexEntry {
  createdAt: string;
  /** XMP-extracted tags, cached so the gallery can show them without
   *  reading the full file. */
  tags?: Record<string, string>;
  width?: number;
  height?: number;
  sourceUrl?: string;
  /** Last-modified timestamp at the time the entry was last synced.
   *  Used for thumbnail-cache versioning + external-edit detection
   *  via `#revalidateModified`. */
  mtime?: number;
}

interface IndexData {
  /** Map full path -> cached metadata. Paths are forward-slash,
   *  library-relative ("Inbox/cap.annot.png"), matching the keys
   *  every other `StorageProvider` uses. */
  images: Record<string, IndexEntry>;
}

/** Image-file extensions the gallery surfaces. Permissive on
 *  purpose: external screenshots dropped into the library appear
 *  alongside annot-native captures. Save-back preserves the
 *  original name for non-annot files; only fresh captures use the
 *  `.annot.{ext}` shape. */
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".svg"];

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export class DesktopStore
  implements
    StorageProvider,
    StorageWithInit,
    StorageWithResync,
    StorageWithForceRefresh,
    StorageWithThumbnailCache
{
  #fs: DesktopFs;
  /** Stable identifier folded into the thumbnail cache key so two
   *  desktop installs (or two test instances) don't collide on
   *  identical relative paths. Defaults to the library root path
   *  when the caller doesn't provide one explicitly. */
  #rootName: string;
  #encodeDeps: BuildEditableImageDeps;
  #index: IndexData = { images: {} };

  get rootName(): string {
    return this.#rootName;
  }

  /**
   * @param fs           Host-supplied filesystem adapter.
   * @param rootName     Stable identifier for the library root —
   *                     used as the thumbnail-cache namespace and
   *                     as the human-readable name the sidebar
   *                     shows under the "Desktop" chip. The plan
   *                     uses `<userData>/library/`, so a sensible
   *                     default is the basename of that path.
   * @param encodeDeps   Optional override of the XMP encode
   *                     pipeline (`renderImageRecord` / worker
   *                     encode / `loadEncodeOptions` /
   *                     `createEditableImage`). Defaults to the
   *                     web package's `DEFAULT_DEPS` which wires
   *                     the full PWA pipeline. Tests pass a
   *                     stubbed deps object that skips the
   *                     worker.
   */
  constructor(fs: DesktopFs, rootName: string, encodeDeps: BuildEditableImageDeps = DEFAULT_DEPS) {
    this.#fs = fs;
    this.#rootName = rootName;
    this.#encodeDeps = encodeDeps;
  }

  // ---- Init / resync ──────────────────────────────────────────

  async init(): Promise<void> {
    await this.#loadIndex();
    await this.#syncFilesToIndex();
    await this.#removeOrphanedEntries();
    await this.#backfillMissingMetadata();
    await this.#revalidateModified();
  }

  async resync(): Promise<void> {
    await this.#syncFilesToIndex();
    await this.#removeOrphanedEntries();
    await this.#backfillMissingMetadata();
    await this.#revalidateModified();
  }

  /**
   * Force a full refresh: clear cached mtimes so every entry is
   * re-validated against disk on the next pass. Use this when the
   * mtime-based heuristic might have missed something (filesystems
   * with sub-second mtime resolution, host clock skew). Mirrors
   * `DeviceStore.forceRefresh` semantics so the unified "Refresh"
   * button behaves identically across hosts.
   */
  async forceRefresh(): Promise<void> {
    for (const entry of Object.values(this.#index.images)) {
      entry.mtime = undefined;
    }
    await this.#revalidateModified();
    await this.#removeOrphanedEntries();
  }

  // ---- Index management ───────────────────────────────────────

  async #loadIndex(): Promise<void> {
    try {
      const bytes = await this.#fs.readFile(INDEX_FILE);
      const text = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && parsed.images) {
        this.#index = parsed as IndexData;
        return;
      }
    } catch {
      /* missing / malformed — start fresh */
    }
    this.#index = { images: {} };
  }

  async #saveIndex(): Promise<void> {
    const text = JSON.stringify(this.#index, null, 2);
    const bytes = new TextEncoder().encode(text);
    await this.#fs.writeFile(INDEX_FILE, bytes);
  }

  /** Walk the on-disk tree and add any image files missing from
   *  the index. New entries land with cached XMP-derived metadata
   *  so the gallery doesn't need to re-read the file on every
   *  list. */
  async #syncFilesToIndex(): Promise<void> {
    const known = new Set(Object.keys(this.#index.images));
    let changed = false;
    await this.#syncDir("", known, () => {
      changed = true;
    });
    if (changed) await this.#saveIndex();
  }

  async #syncDir(folderPath: string, known: Set<string>, onAdd: () => void): Promise<void> {
    const entries = await this.#fs.readDir(folderPath);
    for (const entry of entries) {
      if (entry.kind === "file" && isImageFile(entry.name)) {
        const path = joinPath(folderPath, entry.name);
        if (known.has(path)) continue;

        let tags: Record<string, string> = {};
        let width = 0;
        let height = 0;
        let mtime = 0;
        try {
          const stat = await this.#fs.stat(path);
          mtime = stat?.mtime ?? 0;
          const bytes = await this.#fs.readFile(path);
          const meta = readEditableImage(bytes);
          if (meta) {
            tags = meta.tags || {};
            width = meta.width || 0;
            height = meta.height || 0;
          }
        } catch {
          /* skip unreadable file — entry still added with empty tags */
        }

        this.#index.images[path] = {
          createdAt: new Date().toISOString(),
          tags,
          width,
          height,
          mtime,
        };
        onAdd();
      } else if (entry.kind === "directory" && !entry.name.startsWith(".")) {
        const subPath = joinPath(folderPath, entry.name);
        await this.#syncDir(subPath, known, onAdd);
      }
    }
  }

  async #removeOrphanedEntries(): Promise<void> {
    let changed = false;
    for (const path of Object.keys(this.#index.images)) {
      const stat = await this.#fs.stat(path);
      if (!stat || stat.kind !== "file") {
        delete this.#index.images[path];
        changed = true;
      }
    }
    if (changed) await this.#saveIndex();
  }

  /** Re-read XMP for entries whose `mtime` doesn't match disk —
   *  catches external edits made by other tools (image editors,
   *  Finder/Explorer rename-then-edit, etc.). */
  async #revalidateModified(): Promise<void> {
    let changed = false;
    for (const [path, entry] of Object.entries(this.#index.images)) {
      try {
        const stat = await this.#fs.stat(path);
        if (!stat || stat.kind !== "file") continue;
        if (entry.mtime !== undefined && stat.mtime === entry.mtime) {
          continue;
        }
        const bytes = await this.#fs.readFile(path);
        const meta = readEditableImage(bytes);
        entry.tags = meta?.tags || entry.tags || {};
        entry.width = meta?.width || entry.width || 0;
        entry.height = meta?.height || entry.height || 0;
        entry.mtime = stat.mtime;
        changed = true;
      } catch {
        /* file may have vanished mid-check; #removeOrphanedEntries
         * catches that on the next pass */
      }
    }
    if (changed) await this.#saveIndex();
  }

  /** Backfill cached XMP metadata for index entries created by an
   *  older schema (no `tags` field). Runs once on init / resync. */
  async #backfillMissingMetadata(): Promise<void> {
    let changed = false;
    for (const [path, entry] of Object.entries(this.#index.images)) {
      if (entry.tags !== undefined) continue;
      try {
        const bytes = await this.#fs.readFile(path);
        const meta = readEditableImage(bytes);
        entry.tags = meta?.tags || {};
        entry.width = meta?.width || entry.width || 0;
        entry.height = meta?.height || entry.height || 0;
        changed = true;
      } catch {
        entry.tags = {};
        changed = true;
      }
    }
    if (changed) await this.#saveIndex();
  }

  // ---- Path helpers ───────────────────────────────────────────

  async #fileExists(folderPath: string, name: string): Promise<boolean> {
    const stat = await this.#fs.stat(joinPath(folderPath, name));
    return !!stat && stat.kind === "file";
  }

  async #folderExists(path: string): Promise<boolean> {
    if (!path) return true;
    const stat = await this.#fs.stat(path);
    return !!stat && stat.kind === "directory";
  }

  // ---- Images ─────────────────────────────────────────────────

  async saveImage(data: Omit<ImageRecord, "path">, opts?: { filename?: string }): Promise<string> {
    const isJpeg = data.originalDataUrl.startsWith("data:image/jpeg");
    // No explicit filename = annot-native capture → use the shared
    // `annot-<ts>.annot.<ext>` shape. External-file saves pass their
    // original filename and keep it unchanged.
    const desiredFilename = opts?.filename || defaultAnnotImageFilename(data.originalDataUrl);
    validateName(desiredFilename);
    const folderPath = data.folderPath || "";

    // Ensure parent directory exists. `recursive: true` accepts a
    // pre-existing directory silently — the typical hot-path case.
    if (folderPath) {
      await this.#fs.mkdir(folderPath, { recursive: true });
    }

    const filename = await uniquifyFilenameAsync(desiredFilename, (candidate) =>
      this.#fileExists(folderPath, candidate),
    );
    const path = joinPath(folderPath, filename);

    // Build XMP blob through the shared encode pipeline. Format is
    // derived from the source's data URL — JPEG inputs stay JPEG,
    // anything else lands as PNG.
    const record: Partial<ImageRecord> = {
      originalDataUrl: data.originalDataUrl,
      annotationsSvg: data.annotationsSvg,
      width: data.width,
      height: data.height,
      tags: data.tags,
    };
    const blob = await buildEditableImageBlob(record, isJpeg ? "jpg" : "png", this.#encodeDeps);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    try {
      await this.#fs.writeFile(path, bytes);
    } catch (e) {
      // Best-effort cleanup so a retry can use the same name. If
      // remove fails the next save still works (uniquify just hands
      // back " (2)").
      try {
        await this.#fs.remove(path);
      } catch {
        /* ignore */
      }
      throw e;
    }

    let mtime = 0;
    try {
      mtime = (await this.#fs.stat(path))?.mtime ?? 0;
    } catch {
      /* ignore */
    }

    this.#index.images[path] = {
      createdAt: data.createdAt || new Date().toISOString(),
      tags: data.tags || {},
      width: data.width || 0,
      height: data.height || 0,
      sourceUrl: data.sourceUrl || "",
      mtime,
    };
    await this.#saveIndex();

    return path;
  }

  async getImage(path: string): Promise<ImageRecord | undefined> {
    const entry = this.#index.images[path];
    if (!entry) return undefined;

    try {
      const bytes = await this.#fs.readFile(path);
      const meta = readEditableImage(bytes);

      return {
        path,
        folderPath: getParentPath(path),
        originalDataUrl: meta?.originalImageDataUrl || (await this.#bytesToDataUrl(bytes, path)),
        // Thumbnail bytes owned by the unified `ThumbnailManager`.
        thumbnailDataUrl: "",
        annotationsSvg: meta?.annotationsSvg || "",
        width: meta?.width || 0,
        height: meta?.height || 0,
        sourceUrl: entry.sourceUrl || "",
        tags: meta?.tags || {},
        createdAt: entry.createdAt,
        updatedAt: entry.createdAt,
      };
    } catch {
      return undefined;
    }
  }

  async listImages(folderPath: string): Promise<ImageRecord[]> {
    const results: ImageRecord[] = [];
    for (const [path, entry] of Object.entries(this.#index.images)) {
      if (getParentPath(path) !== folderPath) continue;
      results.push({
        path,
        folderPath,
        originalDataUrl: "", // lazy — loaded on getImage
        // Thumbnail bytes owned by the unified `ThumbnailManager`;
        // gallery hydrates via `attach` after this returns.
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: entry.width || 0,
        height: entry.height || 0,
        sourceUrl: entry.sourceUrl || "",
        tags: entry.tags || {},
        createdAt: entry.createdAt,
        updatedAt: entry.createdAt,
      });
    }
    results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return results;
  }

  async updateImage(path: string, updates: ImageRecordUpdate): Promise<void> {
    const record = await this.getImage(path);
    if (!record) return;

    Object.assign(record, updates);
    const entry = this.#index.images[path];
    if (!entry) return;

    // Rewrite file if annotations / tags / underlying bitmap changed.
    // `originalDataUrl` carries the new bitmap when the redact-burn
    // path explicitly mutates the base image (see
    // `_done/redact-burn-into-image.md`); without it in the gate
    // condition, a bitmap-only update would skip the rebuild and
    // the new bytes never reach disk.
    if (
      updates.annotationsSvg !== undefined ||
      updates.tags !== undefined ||
      updates.originalDataUrl !== undefined
    ) {
      const isJpeg = (record.originalDataUrl || "").startsWith("data:image/jpeg");
      const blob = await buildEditableImageBlob(record, isJpeg ? "jpg" : "png", this.#encodeDeps);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await this.#fs.writeFile(path, bytes);
      try {
        entry.mtime = (await this.#fs.stat(path))?.mtime ?? entry.mtime;
      } catch {
        /* ignore */
      }
    }

    if (updates.tags !== undefined) {
      entry.tags = { ...updates.tags };
    }

    await this.#saveIndex();
  }

  async moveImage(path: string, newFolderPath: string): Promise<string> {
    if (newFolderPath === getParentPath(path)) return path;
    const entry = this.#index.images[path];
    if (!entry) throw new StorageNotFoundError(path, `Image not found: ${path}`);

    const filename = getFilename(path);
    if (newFolderPath) {
      await this.#fs.mkdir(newFolderPath, { recursive: true });
    }
    const uniqueName = await uniquifyFilenameAsync(filename, (candidate) =>
      this.#fileExists(newFolderPath, candidate),
    );
    const newPath = joinPath(newFolderPath, uniqueName);

    await this.#fs.rename(path, newPath);

    delete this.#index.images[path];
    this.#index.images[newPath] = entry;
    try {
      entry.mtime = (await this.#fs.stat(newPath))?.mtime ?? entry.mtime;
    } catch {
      /* ignore */
    }
    await this.#saveIndex();
    return newPath;
  }

  async renameImage(path: string, newName: string): Promise<string> {
    validateName(newName);
    if (!this.#index.images[path]) {
      throw new StorageNotFoundError(path, `Image not found: ${path}`);
    }
    const folderPath = getParentPath(path);
    const newPath = joinPath(folderPath, newName);
    if (newPath === path) return path;

    if (await this.#fileExists(folderPath, newName)) {
      throw new StorageConflictError(newPath, `Image already exists: ${newPath}`);
    }

    await this.#fs.rename(path, newPath);

    const entry = this.#index.images[path];
    delete this.#index.images[path];
    if (entry) {
      try {
        entry.mtime = (await this.#fs.stat(newPath))?.mtime ?? entry.mtime;
      } catch {
        /* ignore */
      }
      this.#index.images[newPath] = entry;
    }
    await this.#saveIndex();
    return newPath;
  }

  async deleteImage(path: string): Promise<void> {
    if (!this.#index.images[path]) return;

    try {
      await this.#fs.remove(path);
    } catch {
      /* may already be gone */
    }

    delete this.#index.images[path];
    await this.#saveIndex();
  }

  // ---- Folders ────────────────────────────────────────────────

  async createFolder(parentPath: string, name: string): Promise<string> {
    validateName(name);
    if (parentPath) {
      await this.#fs.mkdir(parentPath, { recursive: true });
    }
    const path = joinPath(parentPath, name);
    if (await this.#folderExists(path)) {
      throw new StorageConflictError(path, `Folder already exists: ${path}`);
    }
    await this.#fs.mkdir(path);
    return path;
  }

  async listFolders(parentPath: string): Promise<FolderRecord[]> {
    const entries = await this.#fs.readDir(parentPath);
    const results: FolderRecord[] = [];
    for (const entry of entries) {
      if (entry.kind !== "directory") continue;
      // Hide dotfiles (`.annot.json` index, future `.thumbnails`
      // dir, etc.) from the gallery — same convention DeviceStore
      // uses.
      if (entry.name.startsWith(".")) continue;
      results.push({
        path: joinPath(parentPath, entry.name),
        parentPath,
        name: entry.name,
        createdAt: "",
      });
    }
    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  async getFolder(path: string): Promise<FolderRecord | undefined> {
    if (!path) return undefined;
    if (!(await this.#folderExists(path))) return undefined;
    return {
      path,
      parentPath: getParentPath(path),
      name: getFilename(path),
      createdAt: "",
    };
  }

  async renameFolder(path: string, newName: string): Promise<string> {
    validateName(newName);
    if (!(await this.#folderExists(path))) {
      throw new StorageNotFoundError(path, `Folder not found: ${path}`);
    }
    const parentPath = getParentPath(path);
    const newPath = joinPath(parentPath, newName);
    if (newPath === path) return path;
    return this.#moveFolderImpl(path, newPath);
  }

  async moveFolder(path: string, newParentPath: string): Promise<string> {
    if (!(await this.#folderExists(path))) {
      throw new StorageNotFoundError(path, `Folder not found: ${path}`);
    }
    const newPath = joinPath(newParentPath, getFilename(path));
    if (newPath === path) return path;
    return this.#moveFolderImpl(path, newPath);
  }

  async #moveFolderImpl(oldPath: string, newPath: string): Promise<string> {
    if (await this.#folderExists(newPath)) {
      throw new StorageConflictError(newPath, `Folder already exists: ${newPath}`);
    }
    const parentOfNew = getParentPath(newPath);
    if (parentOfNew) {
      await this.#fs.mkdir(parentOfNew, { recursive: true });
    }
    await this.#fs.rename(oldPath, newPath);

    // Rewrite index entries whose paths shared the old prefix.
    const newIndex: Record<string, IndexEntry> = {};
    for (const [p, entry] of Object.entries(this.#index.images)) {
      const rewritten = rewritePathPrefix(p, oldPath, newPath);
      newIndex[rewritten] = entry;
    }
    this.#index.images = newIndex;
    await this.#saveIndex();

    return newPath;
  }

  async deleteFolder(path: string): Promise<void> {
    if (!path) return;
    for (const p of Object.keys(this.#index.images)) {
      if (p === path || p.startsWith(`${path}/`)) {
        delete this.#index.images[p];
      }
    }

    try {
      await this.#fs.remove(path, { recursive: true });
    } catch {
      /* may have been removed externally */
    }

    await this.#saveIndex();
  }

  async getBreadcrumb(path: string): Promise<FolderRecord[]> {
    if (!path) return [];
    const paths = [...ancestorPaths(path), path];
    const result: FolderRecord[] = [];
    for (const p of paths) {
      const f = await this.getFolder(p);
      if (f) result.push(f);
    }
    return result;
  }

  // ── StorageWithThumbnailCache ────────────────────────────────

  /**
   * Stable per-image identifier. Folds in `rootName` so two desktop
   * library roots (e.g. dev install + portable install) don't
   * collide on identical relative paths.
   */
  thumbnailKey(path: string): string | undefined {
    if (!this.#index.images[path]) return undefined;
    return `desktop:${this.#rootName}:${path}`;
  }

  /**
   * Per-file mtime as the cache version. Advances on every write
   * (this store's own `saveImage` / `updateImage` and external
   * edits picked up by `#revalidateModified`). Cache hits require
   * an exact match.
   */
  thumbnailVersion(path: string): string {
    return String(this.#index.images[path]?.mtime ?? 0);
  }

  /**
   * Source bytes for thumbnail regeneration. Reads the file from
   * disk; the manager runs the result through
   * `generateThumbnailFromBlob` when the cache misses.
   */
  async fetchThumbnailSource(path: string): Promise<Blob | undefined> {
    try {
      const bytes = await this.#fs.readFile(path);
      const lower = path.toLowerCase();
      const type = lower.endsWith(".png")
        ? "image/png"
        : lower.endsWith(".svg")
          ? "image/svg+xml"
          : "image/jpeg";
      return new Blob([bytes as BlobPart], { type });
    } catch {
      return undefined;
    }
  }

  // ---- Internals ──────────────────────────────────────────────

  /**
   * Build a data URL fallback for `getImage` when the file has no
   * embedded XMP (i.e. an external image dropped into the library).
   * The MIME guess is path-extension-based; that's good enough for
   * gallery + editor consumers and matches what DeviceStore does.
   */
  async #bytesToDataUrl(bytes: Uint8Array, path: string): Promise<string> {
    const lower = path.toLowerCase();
    const mime = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".svg")
        ? "image/svg+xml"
        : "image/jpeg";
    // Convert via Blob → FileReader so this works under both happy-
    // dom (tests) and the Tauri webview (production). Synchronous
    // base64 helpers (Buffer / btoa) trip up on multi-byte / large
    // payloads, while the Blob path is universally OK.
    const blob = new Blob([bytes as BlobPart], { type: mime });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("FileReader returned non-string result"));
      };
      reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
      reader.readAsDataURL(blob);
    });
  }
}
