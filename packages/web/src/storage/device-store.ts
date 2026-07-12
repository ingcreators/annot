/// <reference path="../types/fs-access-extras.d.ts" />

/**
 * Device (File System Access API) storage provider — path-based
 * identification. Reads/writes image files to a user-selected local
 * directory. The "Device" name mirrors the sidebar label so
 * identifiers line up across UI / URL (`/edit/img/device/...`) / code;
 * internally the implementation talks to the browser's
 * `FileSystemDirectoryHandle` API.
 *
 * Annot-native captures are saved as `annot-<ts>.annot.jpg|png`;
 * images coming from outside (dropped into the folder by other tools,
 * or imported with an explicit filename) keep their original name.
 * Annotations, tags, and original image are stored as XMP metadata inside each file.
 * Subfolders on disk = gallery folders.
 *
 * Metadata persistence is delegated to the host-supplied
 * `MetadataCache` (`IndexedDBMetadataCache` in production). The
 * pre-metadata-cache `.annot.json` sidecar has no special handling
 * anymore (metadata-unification Phase 5) — a stray one is just an
 * unlisted non-image file.
 */
import type {
  DocumentRecord,
  DocumentRecordUpdate,
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  ListingEntry,
  MetadataCache,
  StorageProvider,
  StorageWithDocuments,
  StorageWithForceRefresh,
  StorageWithInit,
  StorageWithMetadataCache,
  StorageWithResync,
  StorageWithThumbnailCache,
} from "@ingcreators/annot-core/storage";
import {
  ancestorPaths,
  annotationsYamlPathFor,
  getFilename,
  getParentPath,
  joinPath,
  StorageConflictError,
  StorageNotFoundError,
  uniquifyFilenameAsync,
  validateName,
} from "@ingcreators/annot-core/storage";
import {
  defaultAnnotImageFilename,
  normalizeAnnotImageFilename,
} from "@ingcreators/annot-core/utils";
import { readEditableImage } from "@ingcreators/annot-core/xmp";
// Deep subpath (not the barrel) so the storage chunk doesn't pull
// the full rendering surface — same rationale as the pptx deep
// imports noted in annot-render's index.ts.
import { probeRasterDims } from "@ingcreators/annot-render/raster-dims";
import { fileExists, getDirHandle, purgeEmptyFiles } from "./device-fs.js";
import { buildEditableImageBlob } from "./image-encode.js";

export class DeviceStore
  implements
    StorageProvider,
    StorageWithInit,
    StorageWithResync,
    StorageWithForceRefresh,
    StorageWithThumbnailCache,
    StorageWithDocuments,
    StorageWithMetadataCache
{
  #root: FileSystemDirectoryHandle;
  #cache?: MetadataCache;
  /**
   * Synchronous mtime lookup for `thumbnailVersion`. The unified
   * `ThumbnailManager` calls that method on the synchronous path
   * (no `await`), so reads from the async `MetadataCache` won't
   * work. Every cache write path populates this map alongside the
   * IDB write — they stay in sync as long as the store is the
   * only writer for its namespace, which is the per-tab guarantee.
   */
  #mtimeByPath = new Map<string, number>();

  get rootName(): string {
    return this.#root.name;
  }

  constructor(root: FileSystemDirectoryHandle) {
    this.#root = root;
  }

  // ── StorageWithMetadataCache ─────────────────────────────────

  /**
   * Namespace prefix used to scope this store's entries in the
   * shared cache. The root folder name is folded in so two distinct
   * user-picked folders with identical relative paths don't
   * collide. Stable across `resync` / `forceRefresh`.
   */
  metadataNamespace(): string {
    return `device:${this.#root.name}`;
  }

  /**
   * Receive the host-owned `MetadataCache` instance. The host MUST
   * call this BEFORE `init()` so the lifecycle scan has somewhere
   * to populate. Constructed-but-unattached stores raise on the
   * first cache access; this mirrors how
   * `StorageWithTokenRefresher` requires `setToken` before any
   * network call lands.
   */
  attachMetadataCache(cache: MetadataCache): void {
    this.#cache = cache;
  }

  #c(): MetadataCache {
    const cache = this.#cache;
    if (!cache) {
      throw new Error(
        "DeviceStore: MetadataCache not attached. Call attachMetadataCache() before init().",
      );
    }
    return cache;
  }

  #ns(): string {
    return this.metadataNamespace();
  }

  /**
   * Record `path → mtime` after every cache write so the
   * synchronous `thumbnailVersion(path)` accessor has somewhere
   * to look. Numbers are derived from the `version` string the
   * cache already received (we always pass `String(mtime)`).
   */
  #rememberMtime(path: string, version: string): void {
    const n = Number(version);
    if (Number.isFinite(n) && n > 0) this.#mtimeByPath.set(path, n);
  }

  #forgetMtime(path: string): void {
    this.#mtimeByPath.delete(path);
  }

  #forgetMtimePrefix(prefix: string): void {
    for (const k of [...this.#mtimeByPath.keys()]) {
      if (k === prefix || k.startsWith(`${prefix}/`)) this.#mtimeByPath.delete(k);
    }
  }

  async #cachePutImage(path: string, version: string, rec: ImageRecord): Promise<void> {
    await this.#c().putImage(this.#ns(), path, version, rec);
    this.#rememberMtime(path, version);
  }

  async #cachePutDocument(path: string, version: string, rec: DocumentRecord): Promise<void> {
    await this.#c().putDocument(this.#ns(), path, version, rec);
    this.#rememberMtime(path, version);
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async init(): Promise<void> {
    await this.#purgeEmptyFiles(this.#root, "");
    await this.#syncFolderRecursive(this.#root, "");
  }

  async resync(): Promise<void> {
    await this.#purgeEmptyFiles(this.#root, "");
    await this.#syncFolderRecursive(this.#root, "");
  }

  /**
   * Force a full refresh: clear every cached metadata entry under
   * this namespace, then re-scan disk from scratch. Use this when
   * the mtime-based heuristic might have missed something (e.g.
   * filesystems with sub-second mtime).
   */
  async forceRefresh(): Promise<void> {
    await this.#c().invalidatePrefix(`${this.#ns()}:`);
    this.#mtimeByPath.clear();
    await this.#syncFolderRecursive(this.#root, "");
  }

  /**
   * Recursively delete 0-byte files left behind by aborted writes
   * (`createWritable()` truncates the file to 0 immediately, so a
   * crash between then and `close()` leaves an orphan empty file).
   * Subdirectories are walked but never removed.
   */
  async #purgeEmptyFiles(dir: FileSystemDirectoryHandle, parentPath: string): Promise<void> {
    const deleted = await purgeEmptyFiles(dir, parentPath);
    for (const fullPath of deleted) {
      await this.#c().invalidatePath(this.#ns(), fullPath);
      this.#forgetMtime(fullPath);
    }
  }

  /**
   * Reconcile the on-disk state of `(dir, folderPath)` with the
   * cache: build the current listing from disk, diff against the
   * cached listing by mtime version, re-read XMP for changed / new
   * entries, drop cache rows for missing entries, then recurse into
   * subfolders. The walk is intentionally O(N) per call — the FS
   * Access API doesn't expose a cheap "what changed" probe, and
   * mtime comparison via `getFile()` is fast enough on SSD.
   */
  async #syncFolderRecursive(dir: FileSystemDirectoryHandle, folderPath: string): Promise<void> {
    const liveEntries: ListingEntry[] = [];
    const subfolders: Array<[FileSystemDirectoryHandle, string]> = [];

    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "file") {
        if (this.#isImageFile(name)) {
          const path = joinPath(folderPath, name);
          const file = await (handle as FileSystemFileHandle).getFile();
          liveEntries.push({ path, version: String(file.lastModified), kind: "image" });
        } else if (this.#isDocumentFile(name)) {
          const path = joinPath(folderPath, name);
          const file = await (handle as FileSystemFileHandle).getFile();
          liveEntries.push({ path, version: String(file.lastModified), kind: "document" });
        }
      } else if (handle.kind === "directory" && !name.startsWith(".")) {
        subfolders.push([handle as FileSystemDirectoryHandle, joinPath(folderPath, name)]);
      }
    }

    const cached = (await this.#c().getListing(this.#ns(), folderPath)) ?? [];
    const cachedByPath = new Map(cached.map((e) => [e.path, e]));

    // Refresh any entry whose mtime version doesn't match the cache.
    for (const live of liveEntries) {
      const previous = cachedByPath.get(live.path);
      if (previous?.version === live.version) continue;
      if (live.kind === "image") {
        await this.#refreshImageCache(live.path, live.version);
      } else {
        await this.#refreshDocumentCache(live.path, live.version);
      }
    }

    // Drop cache entries for files that vanished since the last sync.
    const liveSet = new Set(liveEntries.map((e) => e.path));
    for (const previous of cached) {
      if (!liveSet.has(previous.path)) {
        await this.#c().invalidatePath(this.#ns(), previous.path);
        this.#forgetMtime(previous.path);
      }
    }
    for (const live of liveEntries) {
      this.#rememberMtime(live.path, live.version);
    }

    await this.#c().putListing(this.#ns(), folderPath, liveEntries);

    for (const [sub, subPath] of subfolders) {
      await this.#syncFolderRecursive(sub, subPath);
    }
  }

  /**
   * Re-read XMP for `path` (image) and populate the metadata cache
   * with the lightweight subset. Heavy fields (`originalDataUrl`,
   * `annotationsSvg`) are intentionally NOT cached — see the plan's
   * caching policy. The cached record carries empty strings for
   * those so a `getImage` cache hit doesn't accidentally deliver
   * stale annotation bytes; the real read path falls through to
   * the file when callers need the full record.
   */
  async #refreshImageCache(path: string, version: string): Promise<void> {
    try {
      const dir = await this.#getDirHandle(getParentPath(path));
      const fileHandle = await dir.getFileHandle(getFilename(path));
      const file = await fileHandle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const meta = readEditableImage(bytes);
      const previous = await this.#c().getImage(this.#ns(), path, version);
      // The packet is the authority for provenance (schema 2.0);
      // the cache entry is refreshed FROM it. Pre-2.0 files fall
      // back to the previous cache entry, then to the file mtime.
      const createdAt =
        meta?.createdAt || previous?.createdAt || new Date(file.lastModified).toISOString();
      // XMP-less external files: probe dimensions once per version
      // so gallery cards show real dims instead of falling back to
      // a date. Cache hits skip the decode on later listings.
      const probed = meta ? null : await probeRasterDims(file);
      const rec: ImageRecord = {
        path,
        folderPath: getParentPath(path),
        // Heavy fields not persisted in the cache.
        originalDataUrl: "",
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: meta?.width || probed?.width || 0,
        height: meta?.height || probed?.height || 0,
        sourceUrl: meta?.sourceUrl || previous?.sourceUrl || "",
        tags: meta?.tags ?? {},
        createdAt,
        updatedAt: new Date(file.lastModified).toISOString(),
        producer: meta?.producer || undefined,
        dpr: meta?.dpr || undefined,
      };
      await this.#cachePutImage(path, version, rec);
    } catch {
      // File disappeared mid-scan; the listing reconciliation step
      // handles cleanup.
    }
  }

  /**
   * Re-parse a `.annot.html` document header for its lightweight
   * metadata (title, block / image counts) and populate the cache.
   * Bytes are not stored — they're fetched on demand from disk.
   */
  async #refreshDocumentCache(path: string, version: string): Promise<void> {
    try {
      const dir = await this.#getDirHandle(getParentPath(path));
      const fileHandle = await dir.getFileHandle(getFilename(path));
      const file = await fileHandle.getFile();
      const bytes = await file.text();
      const meta = parseDocumentMetaCheap(bytes);
      const previous = await this.#c().getDocument(this.#ns(), path, version);
      const createdAt = previous?.createdAt ?? new Date(file.lastModified).toISOString();
      const rec: DocumentRecord = {
        path,
        folderPath: getParentPath(path),
        bytes: "",
        thumbnailDataUrl: "",
        title: meta.title,
        blockCount: meta.blockCount,
        imageCount: meta.imageCount,
        createdAt,
        updatedAt: new Date(file.lastModified).toISOString(),
      };
      await this.#cachePutDocument(path, version, rec);
    } catch {
      /* file vanished — listing reconciler handles it */
    }
  }

  #isImageFile(name: string): boolean {
    const lower = name.toLowerCase();
    // Permissive — external screenshots dropped into the folder
    // appear in the Annot gallery alongside annot-native captures.
    return (
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".svg")
    );
  }

  #isDocumentFile(name: string): boolean {
    return name.toLowerCase().endsWith(".annot.html");
  }

  /** Thin wrappers around the shared FSA helpers in `./device-fs.ts`. */
  #getDirHandle(folderPath: string, create = false): Promise<FileSystemDirectoryHandle> {
    return getDirHandle(this.#root, folderPath, create);
  }

  #fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    return fileExists(dir, name);
  }

  // ── Images ────────────────────────────────────────────────────

  async saveImage(data: Omit<ImageRecord, "path">, opts?: { filename?: string }): Promise<string> {
    const isJpeg = data.originalDataUrl.startsWith("data:image/jpeg");
    const desiredFilename = opts?.filename
      ? normalizeAnnotImageFilename(opts.filename)
      : defaultAnnotImageFilename(data.originalDataUrl);
    validateName(desiredFilename);
    const folderPath = data.folderPath || "";

    const dir = await this.#getDirHandle(folderPath, true);
    const filename = await uniquifyFilenameAsync(desiredFilename, (candidate) =>
      this.#fileExists(dir, candidate),
    );
    const path = joinPath(folderPath, filename);

    const record: Partial<ImageRecord> = {
      originalDataUrl: data.originalDataUrl,
      annotationsSvg: data.annotationsSvg,
      width: data.width,
      height: data.height,
      tags: data.tags,
      sourceUrl: data.sourceUrl,
      createdAt: data.createdAt,
      producer: data.producer,
      dpr: data.dpr,
    };
    const blob = await this.#buildXmpBlob(record, isJpeg ? "jpg" : "png");

    const fileHandle = await dir.getFileHandle(filename, { create: true });
    let writable: FileSystemWritableFileStream | null = null;
    try {
      writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      writable = null;
    } catch (e) {
      // createWritable() truncates the file to 0 bytes immediately,
      // so a failure between here and close() leaves an empty file
      // behind. Clean up the partial file so retries can reuse the
      // original name.
      if (writable) {
        try {
          await writable.abort();
        } catch {
          /* ignore */
        }
      }
      try {
        await dir.removeEntry(filename);
      } catch {
        /* ignore */
      }
      throw e;
    }

    const mtime = await this.#getMtime(fileHandle);
    const version = String(mtime);

    const cached: ImageRecord = {
      path,
      folderPath,
      originalDataUrl: "",
      thumbnailDataUrl: "",
      annotationsSvg: "",
      width: data.width ?? 0,
      height: data.height ?? 0,
      sourceUrl: data.sourceUrl ?? "",
      tags: data.tags ?? {},
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date(mtime).toISOString(),
    };
    await this.#cachePutImage(path, version, cached);
    await this.#upsertListing(folderPath, { path, version, kind: "image" });

    return path;
  }

  async getImage(path: string): Promise<ImageRecord | undefined> {
    try {
      const dir = await this.#getDirHandle(getParentPath(path));
      const fileHandle = await dir.getFileHandle(getFilename(path));
      const file = await fileHandle.getFile();
      const data = new Uint8Array(await file.arrayBuffer());
      const meta = readEditableImage(data);
      // Prefer the cached createdAt (preserves the value the caller
      // passed to `saveImage`); fall back to the file mtime when the
      // cache is cold or missed.
      const version = String(file.lastModified);
      const cached = await this.#c().getImage(this.#ns(), path, version);
      // The packet is the authority for provenance (schema 2.0);
      // the cache is a fallback for pre-2.0 files only.
      const createdAt =
        meta?.createdAt || cached?.createdAt || new Date(file.lastModified).toISOString();
      // No XMP packet (an external image dropped into the folder):
      // probe the real pixel dimensions — a 0×0 record mounts a 0×0
      // canvas svg (blank editor) since the shell sizes the canvas
      // from the record, not from the decoded bitmap. Mirrors the
      // vscode webview's raw-raster fallback and DesktopStore.
      const probed = meta ? null : await probeRasterDims(file);
      return {
        path,
        folderPath: getParentPath(path),
        originalDataUrl: meta?.originalImageDataUrl || (await this.#fileToDataUrl(file)),
        thumbnailDataUrl: "",
        annotationsSvg: meta?.annotationsSvg || "",
        width: meta?.width || probed?.width || 0,
        height: meta?.height || probed?.height || 0,
        sourceUrl: meta?.sourceUrl || cached?.sourceUrl || "",
        tags: meta?.tags || {},
        createdAt,
        updatedAt: new Date(file.lastModified).toISOString(),
        producer: meta?.producer || undefined,
        dpr: meta?.dpr || undefined,
      };
    } catch {
      return undefined;
    }
  }

  async listImages(folderPath: string): Promise<ImageRecord[]> {
    // Always walk disk first — the FS is the source of truth, and a
    // user could have dropped files since the last `init()` /
    // `resync()`. Refresh the cache opportunistically; cache hits
    // skip the XMP re-parse for unchanged entries.
    const dir = await this.#getDirHandleOrUndefined(folderPath);
    if (!dir) return [];

    const liveEntries: ListingEntry[] = [];
    const records: ImageRecord[] = [];

    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file") continue;
      if (!this.#isImageFile(name)) continue;
      const path = joinPath(folderPath, name);
      const file = await (handle as FileSystemFileHandle).getFile();
      const version = String(file.lastModified);
      liveEntries.push({ path, version, kind: "image" });

      let cached = await this.#c().getImage(this.#ns(), path, version);
      if (!cached) {
        await this.#refreshImageCache(path, version);
        cached = await this.#c().getImage(this.#ns(), path, version);
      }
      if (!cached) continue;

      records.push({
        path,
        folderPath,
        originalDataUrl: "",
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: cached.width,
        height: cached.height,
        sourceUrl: cached.sourceUrl,
        tags: cached.tags,
        createdAt: cached.createdAt,
        updatedAt: cached.updatedAt,
      });
    }

    await this.#c().putListing(this.#ns(), folderPath, liveEntries);
    records.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return records;
  }

  async updateImage(path: string, updates: ImageRecordUpdate): Promise<void> {
    const existing = await this.getImage(path);
    if (!existing) return;

    const merged: ImageRecord = { ...existing, ...updates };
    const folderPath = getParentPath(path);

    // Rewrite file if annotations / tags / underlying bitmap changed.
    // `originalDataUrl` carries the new bitmap when the redact-burn
    // path explicitly mutates the base image (see
    // `_done/redact-burn-into-image.md`); without it in the gate
    // condition, a bitmap-only update would skip the rebuild.
    let newMtime: number | undefined;
    if (
      updates.annotationsSvg !== undefined ||
      updates.tags !== undefined ||
      updates.originalDataUrl !== undefined
    ) {
      const isJpeg = (merged.originalDataUrl || "").startsWith("data:image/jpeg");
      const blob = await this.#buildXmpBlob(merged, isJpeg ? "jpg" : "png");

      const dir = await this.#getDirHandle(folderPath);
      const fileHandle = await dir.getFileHandle(getFilename(path));
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      newMtime = await this.#getMtime(fileHandle);
    }

    if (newMtime !== undefined) {
      const version = String(newMtime);
      const cached: ImageRecord = {
        path,
        folderPath,
        originalDataUrl: "",
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: merged.width,
        height: merged.height,
        sourceUrl: merged.sourceUrl,
        tags: merged.tags,
        createdAt: merged.createdAt,
        updatedAt: new Date(newMtime).toISOString(),
      };
      await this.#cachePutImage(path, version, cached);
      await this.#upsertListing(folderPath, { path, version, kind: "image" });
    } else if (updates.tags !== undefined) {
      // Tag-only update with no on-disk write (caller passed
      // identical bytes alongside): refresh the cached row so the
      // gallery's tag display catches up.
      const version = String(await this.#mtimeForPath(path));
      const cached: ImageRecord = {
        path,
        folderPath,
        originalDataUrl: "",
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: merged.width,
        height: merged.height,
        sourceUrl: merged.sourceUrl,
        tags: merged.tags,
        createdAt: merged.createdAt,
        updatedAt: merged.updatedAt,
      };
      await this.#cachePutImage(path, version, cached);
    }
  }

  async moveImage(path: string, newFolderPath: string): Promise<string> {
    if (newFolderPath === getParentPath(path)) return path;
    const existing = await this.#c().getImage(this.#ns(), path, await this.#peekVersion(path));
    if (!existing && !(await this.#fileExistsAtPath(path))) {
      throw new StorageNotFoundError(path, `Image not found: ${path}`);
    }

    const filename = getFilename(path);
    const oldDir = await this.#getDirHandle(getParentPath(path));
    const newDir = await this.#getDirHandle(newFolderPath, true);

    const uniqueName = await uniquifyFilenameAsync(filename, (candidate) =>
      this.#fileExists(newDir, candidate),
    );
    const newPath = joinPath(newFolderPath, uniqueName);

    const oldFile = await (await oldDir.getFileHandle(filename)).getFile();
    const newHandle = await newDir.getFileHandle(uniqueName, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(await oldFile.arrayBuffer());
    await writable.close();
    await oldDir.removeEntry(filename);

    await this.#c().migrateEntry(this.#ns(), path, newPath);
    this.#forgetMtime(path);
    // The new mtime after copy may differ; refresh listing version.
    const newVersion = String(await this.#getMtime(newHandle));
    this.#rememberMtime(newPath, newVersion);
    await this.#upsertListing(newFolderPath, {
      path: newPath,
      version: newVersion,
      kind: "image",
    });
    return newPath;
  }

  async renameImage(path: string, newName: string): Promise<string> {
    validateName(newName);
    if (!(await this.#fileExistsAtPath(path))) {
      throw new StorageNotFoundError(path, `Image not found: ${path}`);
    }
    const folderPath = getParentPath(path);
    const newPath = joinPath(folderPath, newName);
    if (newPath === path) return path;

    const dir = await this.#getDirHandle(folderPath);
    if (await this.#fileExists(dir, newName)) {
      throw new StorageConflictError(newPath, `Image already exists: ${newPath}`);
    }

    const oldFilename = getFilename(path);
    // Copy + delete (FS Access API has no native rename).
    const oldHandle = await dir.getFileHandle(oldFilename);
    const file = await oldHandle.getFile();
    const newHandle = await dir.getFileHandle(newName, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();
    await dir.removeEntry(oldFilename);

    await this.#c().migrateEntry(this.#ns(), path, newPath);
    this.#forgetMtime(path);
    const newVersion = String(await this.#getMtime(newHandle));
    this.#rememberMtime(newPath, newVersion);
    await this.#upsertListing(folderPath, { path: newPath, version: newVersion, kind: "image" });
    return newPath;
  }

  async deleteImage(path: string): Promise<void> {
    // `deleteImage` is the path-keyed delete primitive — same shape
    // for images AND documents. The cache distinguishes via the
    // record `kind`, but the file system call is identical.
    if (!(await this.#fileExistsAtPath(path))) return;

    try {
      const dir = await this.#getDirHandle(getParentPath(path));
      await dir.removeEntry(getFilename(path));
    } catch {
      /* may already be gone */
    }

    await this.#c().invalidatePath(this.#ns(), path);
    await this.#c().removeListingEntry(this.#ns(), getParentPath(path), path);
    this.#forgetMtime(path);
  }

  // ── Documents ────────────────────────────────────────────────

  async saveDocument(
    data: Omit<DocumentRecord, "path">,
    opts?: { filename?: string },
  ): Promise<string> {
    const desiredFilename = opts?.filename || `document-${Date.now()}.annot.html`;
    validateName(desiredFilename);
    const folderPath = data.folderPath || "";

    const dir = await this.#getDirHandle(folderPath, true);
    const filename = await uniquifyFilenameAsync(desiredFilename, (candidate) =>
      this.#fileExists(dir, candidate),
    );
    const path = joinPath(folderPath, filename);

    const fileHandle = await dir.getFileHandle(filename, { create: true });
    let writable: FileSystemWritableFileStream | null = null;
    try {
      writable = await fileHandle.createWritable();
      await writable.write(data.bytes);
      await writable.close();
      writable = null;
    } catch (e) {
      if (writable) {
        try {
          await writable.abort();
        } catch {
          /* ignore */
        }
      }
      try {
        await dir.removeEntry(filename);
      } catch {
        /* ignore */
      }
      throw e;
    }

    const mtime = await this.#getMtime(fileHandle);
    const version = String(mtime);
    const cached: DocumentRecord = {
      path,
      folderPath,
      bytes: "",
      thumbnailDataUrl: "",
      title: data.title,
      blockCount: data.blockCount,
      imageCount: data.imageCount,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date(mtime).toISOString(),
    };
    await this.#cachePutDocument(path, version, cached);
    await this.#upsertListing(folderPath, { path, version, kind: "document" });
    return path;
  }

  async getDocument(path: string): Promise<DocumentRecord | undefined> {
    let bytes: string;
    let mtime: number;
    try {
      const dir = await this.#getDirHandle(getParentPath(path));
      const handle = await dir.getFileHandle(getFilename(path));
      const file = await handle.getFile();
      mtime = file.lastModified;
      bytes = await file.text();
    } catch {
      return undefined;
    }
    const version = String(mtime);
    let cached = await this.#c().getDocument(this.#ns(), path, version);
    if (!cached) {
      await this.#refreshDocumentCache(path, version);
      cached = await this.#c().getDocument(this.#ns(), path, version);
    }
    if (!cached) return undefined;
    return {
      path,
      folderPath: getParentPath(path),
      bytes,
      thumbnailDataUrl: "",
      title: cached.title,
      imageCount: cached.imageCount,
      blockCount: cached.blockCount,
      createdAt: cached.createdAt,
      updatedAt: cached.updatedAt,
    };
  }

  async listDocuments(folderPath: string): Promise<DocumentRecord[]> {
    const dir = await this.#getDirHandleOrUndefined(folderPath);
    if (!dir) return [];

    const out: DocumentRecord[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file") continue;
      if (!this.#isDocumentFile(name)) continue;
      const path = joinPath(folderPath, name);
      const file = await (handle as FileSystemFileHandle).getFile();
      const version = String(file.lastModified);
      let cached = await this.#c().getDocument(this.#ns(), path, version);
      if (!cached) {
        await this.#refreshDocumentCache(path, version);
        cached = await this.#c().getDocument(this.#ns(), path, version);
      }
      if (!cached) continue;
      out.push({
        path,
        folderPath,
        bytes: "",
        thumbnailDataUrl: "",
        title: cached.title,
        imageCount: cached.imageCount,
        blockCount: cached.blockCount,
        createdAt: cached.createdAt,
        updatedAt: cached.updatedAt,
      });
    }
    return out;
  }

  async updateDocument(path: string, updates: DocumentRecordUpdate): Promise<void> {
    const existing = await this.getDocument(path);
    if (!existing) return;
    const folderPath = getParentPath(path);
    let newMtime: number | undefined;
    if (updates.bytes !== undefined) {
      const dir = await this.#getDirHandle(folderPath);
      const handle = await dir.getFileHandle(getFilename(path), { create: true });
      const writable = await handle.createWritable();
      await writable.write(updates.bytes);
      await writable.close();
      newMtime = await this.#getMtime(handle);
    }
    const merged: DocumentRecord = {
      ...existing,
      title: updates.title ?? existing.title,
      blockCount: updates.blockCount ?? existing.blockCount,
      imageCount: updates.imageCount ?? existing.imageCount,
    };
    const version = String(newMtime ?? (await this.#mtimeForPath(path)));
    const cached: DocumentRecord = {
      path,
      folderPath,
      bytes: "",
      thumbnailDataUrl: "",
      title: merged.title,
      blockCount: merged.blockCount,
      imageCount: merged.imageCount,
      createdAt: merged.createdAt,
      updatedAt: newMtime ? new Date(newMtime).toISOString() : merged.updatedAt,
    };
    await this.#cachePutDocument(path, version, cached);
    if (newMtime !== undefined) {
      await this.#upsertListing(folderPath, { path, version, kind: "document" });
    }
  }

  // ── Annotations YAML sidecar (Phase 4a) ──────────────────────

  async getAnnotationsYaml(pngPath: string): Promise<string | undefined> {
    const sidecarPath = annotationsYamlPathFor(pngPath);
    try {
      const dir = await this.#getDirHandle(getParentPath(sidecarPath));
      const handle = await dir.getFileHandle(getFilename(sidecarPath));
      const file = await handle.getFile();
      return await file.text();
    } catch {
      return undefined;
    }
  }

  async setAnnotationsYaml(pngPath: string, content: string): Promise<void> {
    const sidecarPath = annotationsYamlPathFor(pngPath);
    const folderPath = getParentPath(sidecarPath);
    const dir = await this.#getDirHandle(folderPath, true);
    const handle = await dir.getFileHandle(getFilename(sidecarPath), { create: true });
    let writable: FileSystemWritableFileStream | null = null;
    try {
      writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      writable = null;
    } catch (e) {
      if (writable) {
        try {
          await writable.abort();
        } catch {
          /* ignore */
        }
      }
      throw e;
    }
  }

  // ── Folders ──────────────────────────────────────────────────

  async createFolder(parentPath: string, name: string): Promise<string> {
    validateName(name);
    const parentDir = await this.#getDirHandle(parentPath, true);
    try {
      await parentDir.getDirectoryHandle(name);
      throw new StorageConflictError(
        joinPath(parentPath, name),
        `Folder already exists: ${joinPath(parentPath, name)}`,
      );
    } catch (e: unknown) {
      if (e instanceof StorageConflictError) throw e;
      const errName = (e as { name?: string }).name;
      if (errName !== "NotFoundError") {
        throw e;
      }
    }
    await parentDir.getDirectoryHandle(name, { create: true });
    return joinPath(parentPath, name);
  }

  async listFolders(parentPath: string): Promise<FolderRecord[]> {
    const dir = await this.#getDirHandleOrUndefined(parentPath);
    if (!dir) return [];
    const results: FolderRecord[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory" && !name.startsWith(".")) {
        results.push({
          path: joinPath(parentPath, name),
          parentPath,
          name,
          createdAt: "",
        });
      }
    }
    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  async getFolder(path: string): Promise<FolderRecord | undefined> {
    if (!path) return undefined;
    try {
      await this.#getDirHandle(path);
      return {
        path,
        parentPath: getParentPath(path),
        name: getFilename(path),
        createdAt: "",
      };
    } catch {
      return undefined;
    }
  }

  async renameFolder(path: string, newName: string): Promise<string> {
    validateName(newName);
    if (!(await this.getFolder(path))) {
      throw new StorageNotFoundError(path, `Folder not found: ${path}`);
    }
    const parentPath = getParentPath(path);
    const newPath = joinPath(parentPath, newName);
    if (newPath === path) return path;
    return this.#moveFolderImpl(path, newPath);
  }

  async moveFolder(path: string, newParentPath: string): Promise<string> {
    if (!(await this.getFolder(path))) {
      throw new StorageNotFoundError(path, `Folder not found: ${path}`);
    }
    const newPath = joinPath(newParentPath, getFilename(path));
    if (newPath === path) return path;
    return this.#moveFolderImpl(path, newPath);
  }

  async #moveFolderImpl(oldPath: string, newPath: string): Promise<string> {
    if (await this.getFolder(newPath)) {
      throw new StorageConflictError(newPath, `Folder already exists: ${newPath}`);
    }

    // Copy recursively from oldPath to newPath
    const oldDir = await this.#getDirHandle(oldPath);
    const newParentDir = await this.#getDirHandle(getParentPath(newPath), true);
    const newDir = await newParentDir.getDirectoryHandle(getFilename(newPath), { create: true });
    await this.#copyDirRecursive(oldDir, newDir);

    // Remove old
    const oldParentDir = await this.#getDirHandle(getParentPath(oldPath));
    await oldParentDir.removeEntry(getFilename(oldPath), { recursive: true });

    // Rewrite cache entries under the prefix in one call. The
    // primitive moves records, backend IDs, and listing keys; it
    // also rewrites the `path` field inside the listing entries.
    await this.#c().rewriteEntriesForPrefix(this.#ns(), oldPath, newPath);

    // Mirror the prefix rewrite into the synchronous mtime map so
    // `thumbnailVersion` keeps working for the moved files.
    for (const [k, v] of [...this.#mtimeByPath.entries()]) {
      if (k === oldPath || k.startsWith(`${oldPath}/`)) {
        this.#mtimeByPath.delete(k);
        const moved = newPath + k.slice(oldPath.length);
        this.#mtimeByPath.set(moved, v);
      }
    }

    return newPath;
  }

  async #copyDirRecursive(
    src: FileSystemDirectoryHandle,
    dst: FileSystemDirectoryHandle,
  ): Promise<void> {
    for await (const [name, handle] of src.entries()) {
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        const newHandle = await dst.getFileHandle(name, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(await file.arrayBuffer());
        await writable.close();
      } else if (handle.kind === "directory") {
        const newSubDir = await dst.getDirectoryHandle(name, { create: true });
        await this.#copyDirRecursive(handle as FileSystemDirectoryHandle, newSubDir);
      }
    }
  }

  async deleteFolder(path: string): Promise<void> {
    if (!path) return;

    const parentDir = await this.#getDirHandle(getParentPath(path));
    try {
      await parentDir.removeEntry(getFilename(path), { recursive: true });
    } catch {
      /* may fail if not empty in some browsers */
    }

    // Drop every cache row under this folder's prefix.
    await this.#c().invalidatePrefix(`${this.#ns()}:${path}`);
    await this.#c().removeListingEntry(this.#ns(), getParentPath(path), path);
    this.#forgetMtimePrefix(path);
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
   * Stable per-image identifier. Folds in the rootHandle's name so
   * two distinct user-picked folders don't collide on identical
   * relative paths (e.g. two `Screenshots/foo.png` entries from
   * different parent folders).
   */
  thumbnailKey(path: string): string | undefined {
    // The thumbnail key must be stable regardless of whether the
    // metadata cache has been populated yet; key just off the path.
    return `device:${this.#root.name}:${path}`;
  }

  /**
   * `mtime` advances on every write — both this store's own
   * `saveImage` / `updateImage` and external edits picked up by
   * the listing-reconciliation walk. The unified thumbnail manager
   * gates cache hits on this value via a synchronous lookup, so we
   * mirror mtimes into `#mtimeByPath` alongside every metadata-cache
   * write. Returns `"0"` for paths we haven't seen yet (the
   * manager treats mismatches as cache misses and re-prefetches —
   * correct fallback while the per-folder walk is still in
   * progress).
   */
  thumbnailVersion(path: string): string {
    return String(this.#mtimeByPath.get(path) ?? 0);
  }

  /**
   * Source bytes for thumbnail regeneration. Reads the file from
   * disk; the manager runs the result through
   * `generateThumbnailFromBlob` when the cache misses.
   */
  async fetchThumbnailSource(path: string): Promise<Blob | undefined> {
    try {
      const dir = await this.#getDirHandle(getParentPath(path));
      const fh = await dir.getFileHandle(getFilename(path));
      return await fh.getFile();
    } catch {
      return undefined;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  async #buildXmpBlob(record: Partial<ImageRecord>, format: "jpg" | "png"): Promise<Blob> {
    return buildEditableImageBlob(record, format);
  }

  async #fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  }

  async #getMtime(handle: FileSystemFileHandle): Promise<number> {
    try {
      return (await handle.getFile()).lastModified;
    } catch {
      return 0;
    }
  }

  async #mtimeForPath(path: string): Promise<number> {
    try {
      const dir = await this.#getDirHandle(getParentPath(path));
      const fh = await dir.getFileHandle(getFilename(path));
      return await this.#getMtime(fh);
    } catch {
      return 0;
    }
  }

  async #peekVersion(path: string): Promise<string> {
    return String(await this.#mtimeForPath(path));
  }

  async #fileExistsAtPath(path: string): Promise<boolean> {
    try {
      const dir = await this.#getDirHandle(getParentPath(path));
      await dir.getFileHandle(getFilename(path));
      return true;
    } catch {
      return false;
    }
  }

  async #getDirHandleOrUndefined(
    folderPath: string,
  ): Promise<FileSystemDirectoryHandle | undefined> {
    try {
      return await this.#getDirHandle(folderPath);
    } catch {
      return undefined;
    }
  }

  /**
   * Single-entry listing patch — upsert into the cached listing if
   * one exists for the folder; otherwise reconcile by walking the
   * folder so a never-listed folder still has its listing ready
   * for the next `listImages` call. Avoids the common pitfall
   * where `saveImage` populates the record cache but the parent
   * folder's listing stays stale.
   */
  async #upsertListing(folderPath: string, entry: ListingEntry): Promise<void> {
    const cached = await this.#c().getListing(this.#ns(), folderPath);
    if (cached) {
      await this.#c().upsertListingEntry(this.#ns(), folderPath, entry);
    } else {
      // Initialize the listing from disk so we don't drop sibling
      // files that happen to exist but weren't listed yet.
      try {
        const dir = await this.#getDirHandle(folderPath);
        await this.#syncFolderRecursive(dir, folderPath);
      } catch {
        // Folder may have been removed mid-flight; fall back to a
        // single-entry listing.
        await this.#c().putListing(this.#ns(), folderPath, [entry]);
      }
    }
  }

  // ── Logger import preserved for explicit-debug callsites ────
  // (Earlier code had `logger.debug` calls in the purge path;
  // those moved to `MetadataCache.invalidatePath` which doesn't
  // need a debug log. Keep the import out of dead-code territory.)
}

// ─── Cheap document-meta parser ─────────────────────────────────

interface CheapDocumentMeta {
  title: string;
  blockCount: number;
  imageCount: number;
}

/**
 * Pull title / block / image counts out of an `.annot.html` document
 * without instantiating the full parser. Two regex passes against
 * the source text: cheaper than spinning up a DOMParser in the
 * walking critical path.
 *
 * Robust against minor variations — the format spec mandates
 * `<title>` + `data-annot-block` markers per
 * [`docs/plans/_done/annot-html-document.md`](../../../docs/plans/_done/annot-html-document.md).
 */
function parseDocumentMetaCheap(text: string): CheapDocumentMeta {
  const titleMatch = text.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? "";
  const blockMatches = text.match(/data-annot-block="[^"]+"/g);
  const imageMatches = text.match(/data-annot-block="image"/g);
  return {
    title,
    blockCount: blockMatches?.length ?? 0,
    imageCount: imageMatches?.length ?? 0,
  };
}
