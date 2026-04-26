/// <reference path="../types/fs-access-extras.d.ts" />

import { logger } from "../logger.js";
/**
 * Device (File System Access API) storage provider — path-based
 * identification. Reads/writes image files to a user-selected local
 * directory. The "Device" name mirrors the sidebar label so
 * identifiers line up across UI / URL (`/edit/device/...`) / code;
 * internally the implementation talks to the browser's
 * `FileSystemDirectoryHandle` API.
 *
 * Annot-native captures are saved as `annot-<ts>.annot.jpg|png`;
 * images coming from outside (dropped into the folder by other tools,
 * or imported with an explicit filename) keep their original name.
 * Annotations, tags, and original image are stored as XMP metadata inside each file.
 * Subfolders on disk = gallery folders.
 */
import type {
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  StorageProvider,
  StorageWithForceRefresh,
  StorageWithInit,
  StorageWithResync,
} from "@ingcreators/annot-core/storage";
import {
  ancestorPaths,
  getFilename,
  getParentPath,
  joinPath,
  rewritePathPrefix,
  uniquifyFilenameAsync,
  validateName,
} from "@ingcreators/annot-core/storage";
import { readEditableImage } from "@ingcreators/annot-core/xmp";
import { fileExists, getDirHandle, purgeEmptyFiles } from "./device-fs.js";
import { buildEditableImageBlob } from "./image-encode.js";
import { generateThumbnailFromDataUrl } from "./image-thumbnail.js";

const INDEX_FILE = ".annot.json";

interface IndexEntry {
  thumbnailDataUrl: string;
  createdAt: string;
  /** XMP-extracted tags, cached so the gallery can show them without reading the file. */
  tags?: Record<string, string>;
  width?: number;
  height?: number;
  sourceUrl?: string;
  /** File.lastModified at the time the entry was last synced. Used to detect external edits. */
  mtime?: number;
}

interface IndexData {
  /** Map path -> cached metadata. */
  images: Record<string, IndexEntry>;
}

export class DeviceStore
  implements StorageProvider, StorageWithInit, StorageWithResync, StorageWithForceRefresh
{
  #root: FileSystemDirectoryHandle;
  #index: IndexData = { images: {} };

  get rootName(): string {
    return this.#root.name;
  }

  constructor(root: FileSystemDirectoryHandle) {
    this.#root = root;
  }

  async init(): Promise<void> {
    await this.#loadIndex();
    await this.#purgeEmptyFiles(this.#root, "");
    await this.#syncFilesToIndex();
    await this.#removeOrphanedEntries();
    await this.#backfillMissingMetadata();
    await this.#revalidateModified();
  }

  async resync(): Promise<void> {
    await this.#purgeEmptyFiles(this.#root, "");
    await this.#syncFilesToIndex();
    await this.#removeOrphanedEntries();
    await this.#backfillMissingMetadata();
    await this.#revalidateModified();
  }

  /**
   * Recursively delete 0-byte files left behind by aborted writes
   * (createWritable() truncates the file to 0 immediately, so a crash
   * between then and close() leaves an orphan empty file). Subdirectories
   * are walked but never removed.
   */
  /** Remove every zero-byte file under `dir` (recursive) and drop
   *  matching entries from the in-memory index. The FS-side scan
   *  lives in `./device-fs.ts`'s `purgeEmptyFiles`; this wrapper
   *  applies the index cleanup that's specific to DeviceStore. */
  async #purgeEmptyFiles(dir: FileSystemDirectoryHandle, parentPath: string): Promise<void> {
    const deleted = await purgeEmptyFiles(dir, parentPath);
    for (const fullPath of deleted) {
      if (this.#index.images[fullPath]) {
        delete this.#index.images[fullPath];
      }
      logger.debug("[device-store] purged empty file:", fullPath);
    }
  }

  /**
   * Force a full refresh: re-read every image's XMP and regenerate its thumbnail
   * regardless of mtime. Use this as a "Refresh" action when the mtime-based
   * heuristic might have missed something (e.g. filesystems with sub-second mtime).
   */
  async forceRefresh(): Promise<void> {
    for (const entry of Object.values(this.#index.images)) {
      // Force re-check: clear mtime so revalidate treats it as changed
      entry.mtime = undefined;
    }
    await this.#revalidateModified();
    await this.#removeOrphanedEntries();
  }

  async #removeOrphanedEntries(): Promise<void> {
    let changed = false;
    for (const path of Object.keys(this.#index.images)) {
      try {
        const dir = await this.#getDirHandle(getParentPath(path));
        await dir.getFileHandle(getFilename(path));
      } catch {
        delete this.#index.images[path];
        changed = true;
      }
    }
    if (changed) await this.#saveIndex();
  }

  /**
   * Detect external modifications (Explorer / Finder / image editor) by
   * comparing each file's current `lastModified` against the cached `mtime`.
   * Entries that changed get their XMP tags + dimensions + thumbnail refreshed.
   */
  async #revalidateModified(): Promise<void> {
    let changed = false;
    for (const [path, entry] of Object.entries(this.#index.images)) {
      try {
        const dir = await this.#getDirHandle(getParentPath(path));
        const fh = await dir.getFileHandle(getFilename(path));
        const file = await fh.getFile();
        if (entry.mtime !== undefined && file.lastModified === entry.mtime) {
          continue; // unchanged
        }
        // File was added/modified externally — refresh cached metadata
        const bytes = new Uint8Array(await file.arrayBuffer());
        const meta = readEditableImage(bytes);
        entry.tags = meta?.tags || {};
        entry.width = meta?.width || entry.width || 0;
        entry.height = meta?.height || entry.height || 0;
        try {
          const dataUrl = await this.#fileToDataUrl(file);
          entry.thumbnailDataUrl = await generateThumbnailFromDataUrl(dataUrl);
        } catch {
          /* keep old thumbnail on failure */
        }
        entry.mtime = file.lastModified;
        changed = true;
      } catch {
        // File disappeared mid-check; #removeOrphanedEntries will handle it
      }
    }
    if (changed) await this.#saveIndex();
  }

  /**
   * Backfill missing metadata (tags / dimensions) for entries created by an
   * older version of the index schema. Reads each image's XMP once. Runs on
   * init() and resync(). Skips entries that already have tags set.
   */
  async #backfillMissingMetadata(): Promise<void> {
    let changed = false;
    for (const [path, entry] of Object.entries(this.#index.images)) {
      if (entry.tags !== undefined) continue; // already migrated
      try {
        const dir = await this.#getDirHandle(getParentPath(path));
        const fileHandle = await dir.getFileHandle(getFilename(path));
        const file = await fileHandle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
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

  // ---- Index management ----

  async #loadIndex(): Promise<void> {
    try {
      const handle = await this.#root.getFileHandle(INDEX_FILE);
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && parsed.images) {
        this.#index = parsed;
      } else {
        this.#index = { images: {} };
      }
    } catch {
      this.#index = { images: {} };
    }
  }

  async #saveIndex(): Promise<void> {
    const handle = await this.#root.getFileHandle(INDEX_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(this.#index, null, 2));
    await writable.close();
  }

  /** Scan disk for image files not yet in the index. */
  async #syncFilesToIndex(): Promise<void> {
    const known = new Set(Object.keys(this.#index.images));
    let changed = false;
    await this.#syncDir(this.#root, "", known, () => {
      changed = true;
    });
    if (changed) await this.#saveIndex();
  }

  async #syncDir(
    dir: FileSystemDirectoryHandle,
    folderPath: string,
    known: Set<string>,
    onAdd: () => void,
  ): Promise<void> {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "file" && this.#isImageFile(name)) {
        const path = joinPath(folderPath, name);
        if (!known.has(path)) {
          let thumbnailDataUrl = "";
          let tags: Record<string, string> = {};
          let width = 0;
          let height = 0;
          let mtime = 0;
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            mtime = file.lastModified;
            // Read once; extract XMP (tags + dimensions) AND make thumbnail.
            const bytes = new Uint8Array(await file.arrayBuffer());
            const meta = readEditableImage(bytes);
            if (meta) {
              tags = meta.tags || {};
              width = meta.width || 0;
              height = meta.height || 0;
            }
            const dataUrl = await this.#fileToDataUrl(file);
            thumbnailDataUrl = await generateThumbnailFromDataUrl(dataUrl);
          } catch {
            /* skip on error — entry still added with empty tags */
          }

          this.#index.images[path] = {
            thumbnailDataUrl,
            createdAt: new Date().toISOString(),
            tags,
            width,
            height,
            mtime,
          };
          onAdd();
        }
      } else if (handle.kind === "directory" && !name.startsWith(".")) {
        const subPath = joinPath(folderPath, name);
        await this.#syncDir(handle as FileSystemDirectoryHandle, subPath, known, onAdd);
      }
    }
  }

  #isImageFile(name: string): boolean {
    const lower = name.toLowerCase();
    // Accept any PNG / JPEG / SVG. `.annot.*` and legacy `.anno.*`
    // are subsumed by the plain extension checks below. Listing is
    // intentionally permissive so external screenshots dropped into
    // the folder appear in the Annot gallery alongside annot-native
    // captures — editor save-back preserves the original name for
    // external files and uses `.annot.*` only for fresh captures.
    return (
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".svg")
    );
  }

  /** Thin wrappers around the shared FSA helpers in `./device-fs.ts`
   *  so call sites stay short. The helpers themselves are
   *  structurally typed and unit-tested separately. */
  #getDirHandle(folderPath: string, create = false): Promise<FileSystemDirectoryHandle> {
    return getDirHandle(this.#root, folderPath, create);
  }

  #fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    return fileExists(dir, name);
  }

  // ---- Images ----

  async saveImage(data: Omit<ImageRecord, "path"> & { filename?: string }): Promise<string> {
    const isJpeg = data.originalDataUrl.startsWith("data:image/jpeg");
    // No explicit filename = annot-native capture → use the shared
    // `annot-<ts>.annot.<ext>` shape. External-file saves pass their
    // original filename and keep it unchanged.
    const ext = isJpeg ? "annot.jpg" : "annot.png";
    const desiredFilename = data.filename || `annot-${Date.now()}.${ext}`;
    validateName(desiredFilename);
    const folderPath = data.folderPath || "";

    const dir = await this.#getDirHandle(folderPath, true);
    const filename = await uniquifyFilenameAsync(desiredFilename, (candidate) =>
      this.#fileExists(dir, candidate),
    );
    const path = joinPath(folderPath, filename);

    // Build XMP blob
    const record: Partial<ImageRecord> = {
      originalDataUrl: data.originalDataUrl,
      annotationsSvg: data.annotationsSvg,
      width: data.width,
      height: data.height,
      tags: data.tags,
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
      // Critical: createWritable() truncates the file to 0 bytes immediately,
      // so a failure between here and close() leaves an empty file behind.
      // That orphan file then collides on the next attempt and the retry
      // saves into "filename (2)". Clean up the partial file so retries
      // can use the original name.
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

    const thumbnailDataUrl = await generateThumbnailFromDataUrl(data.originalDataUrl);
    let mtime = 0;
    try {
      mtime = (await fileHandle.getFile()).lastModified;
    } catch {
      /* ignore */
    }

    this.#index.images[path] = {
      thumbnailDataUrl,
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
      const dir = await this.#getDirHandle(getParentPath(path));
      const fileHandle = await dir.getFileHandle(getFilename(path));
      const file = await fileHandle.getFile();
      const data = new Uint8Array(await file.arrayBuffer());
      const meta = readEditableImage(data);

      return {
        path,
        folderPath: getParentPath(path),
        originalDataUrl: meta?.originalImageDataUrl || (await this.#fileToDataUrl(file)),
        thumbnailDataUrl: entry.thumbnailDataUrl || "",
        annotationsSvg: meta?.annotationsSvg || "",
        width: meta?.width || 0,
        height: meta?.height || 0,
        sourceUrl: "",
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
        thumbnailDataUrl: entry.thumbnailDataUrl || "",
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

  async updateImage(path: string, updates: ImageRecordUpdate): Promise<string> {
    const record = await this.getImage(path);
    if (!record) return path;

    Object.assign(record, updates);
    const entry = this.#index.images[path];
    if (!entry) return path;

    // Rewrite file if annotations or tags changed
    if (updates.annotationsSvg !== undefined || updates.tags !== undefined) {
      const isJpeg = (record.originalDataUrl || "").startsWith("data:image/jpeg");
      const blob = await this.#buildXmpBlob(record, isJpeg ? "jpg" : "png");

      const dir = await this.#getDirHandle(getParentPath(path));
      const fileHandle = await dir.getFileHandle(getFilename(path));
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      // Record the new mtime so external-edit detection knows this change was ours
      try {
        entry.mtime = (await fileHandle.getFile()).lastModified;
      } catch {
        /* ignore */
      }
    }

    if (updates.thumbnailDataUrl) {
      entry.thumbnailDataUrl = updates.thumbnailDataUrl;
    }
    // Cache tag edits in the index so the gallery sees them without reopening the file
    if (updates.tags !== undefined) {
      entry.tags = { ...updates.tags };
    }

    // Handle folder move
    if (updates.folderPath !== undefined && updates.folderPath !== getParentPath(path)) {
      const newFolderPath = updates.folderPath;
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

      delete this.#index.images[path];
      this.#index.images[newPath] = entry;
      await this.#saveIndex();
      return newPath;
    }

    await this.#saveIndex();
    return path;
  }

  async renameImage(path: string, newName: string): Promise<string> {
    validateName(newName);
    const folderPath = getParentPath(path);
    const newPath = joinPath(folderPath, newName);
    if (newPath === path) return path;

    const dir = await this.#getDirHandle(folderPath);
    if (await this.#fileExists(dir, newName)) {
      throw new Error(`Image already exists: ${newPath}`);
    }

    const oldFilename = getFilename(path);
    // Copy + delete (FS Access API has no native rename)
    const oldHandle = await dir.getFileHandle(oldFilename);
    const file = await oldHandle.getFile();
    const newHandle = await dir.getFileHandle(newName, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();
    await dir.removeEntry(oldFilename);

    const entry = this.#index.images[path];
    delete this.#index.images[path];
    if (entry) {
      try {
        entry.mtime = (await newHandle.getFile()).lastModified;
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
      const dir = await this.#getDirHandle(getParentPath(path));
      await dir.removeEntry(getFilename(path));
    } catch {
      /* may already be gone */
    }

    delete this.#index.images[path];
    await this.#saveIndex();
  }

  // ---- Folders ----

  async createFolder(parentPath: string, name: string): Promise<string> {
    validateName(name);
    const parentDir = await this.#getDirHandle(parentPath, true);
    // Throw if already exists
    try {
      await parentDir.getDirectoryHandle(name);
      throw new Error(`Folder already exists: ${joinPath(parentPath, name)}`);
    } catch (e: unknown) {
      const name = (e as { name?: string }).name;
      const message = String((e as { message?: unknown }).message ?? "");
      if (name !== "NotFoundError" && !message.startsWith("Folder already")) {
        throw e;
      }
      if (message.startsWith("Folder already")) throw e;
    }
    await parentDir.getDirectoryHandle(name, { create: true });
    return joinPath(parentPath, name);
  }

  async listFolders(parentPath: string): Promise<FolderRecord[]> {
    const dir = await this.#getDirHandle(parentPath);
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
    const parentPath = getParentPath(path);
    const newPath = joinPath(parentPath, newName);
    if (newPath === path) return path;
    return this.#moveFolderImpl(path, newPath);
  }

  async moveFolder(path: string, newParentPath: string): Promise<string> {
    const newPath = joinPath(newParentPath, getFilename(path));
    if (newPath === path) return path;
    return this.#moveFolderImpl(path, newPath);
  }

  async #moveFolderImpl(oldPath: string, newPath: string): Promise<string> {
    // Collision check
    if (await this.getFolder(newPath)) {
      throw new Error(`Folder already exists: ${newPath}`);
    }

    // Copy recursively from oldPath to newPath
    const oldDir = await this.#getDirHandle(oldPath);
    const newParentDir = await this.#getDirHandle(getParentPath(newPath), true);
    const newDir = await newParentDir.getDirectoryHandle(getFilename(newPath), { create: true });
    await this.#copyDirRecursive(oldDir, newDir);

    // Remove old
    const oldParentDir = await this.#getDirHandle(getParentPath(oldPath));
    await oldParentDir.removeEntry(getFilename(oldPath), { recursive: true });

    // Rewrite index entries
    const newIndex: Record<string, IndexEntry> = {};
    for (const [p, entry] of Object.entries(this.#index.images)) {
      const np = rewritePathPrefix(p, oldPath, newPath);
      newIndex[np] = entry;
    }
    this.#index.images = newIndex;
    await this.#saveIndex();

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
    // Drop index entries
    for (const p of Object.keys(this.#index.images)) {
      if (p === path || p.startsWith(`${path}/`)) {
        delete this.#index.images[p];
      }
    }

    const parentDir = await this.#getDirHandle(getParentPath(path));
    try {
      await parentDir.removeEntry(getFilename(path), { recursive: true });
    } catch {
      /* may fail if not empty in some browsers */
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

  // ---- Helpers ----

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
}
