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
 * `MetadataCache` opt-in, contract-test compliance — is shared.
 *
 * Annot-native captures save as `annot-<ts>.annot.{jpg,png}`;
 * images coming from outside (drag-dropped from the OS, imported
 * with an explicit name) keep their original filename. Annotations,
 * tags, and the original capture image are stored as XMP metadata
 * inside each file. Subfolders on disk = gallery folders 1:1.
 *
 * Phase 4 of `docs/plans/shared-metadata-cache.md` — the per-store
 * `.annot.json` sidecar that older builds wrote to the library root
 * is no longer read or written. Metadata persistence is delegated
 * to the host-supplied `MetadataCache`. The legacy file is **left
 * on disk** by design: a user who downgrades to a pre-Phase-4
 * build still finds a valid sidecar. A future plan can drop it
 * once enough release cycles have passed.
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
import { parseDocumentMetaCheap } from "@ingcreators/annot-doc/headless";
// Deep subpath (not the barrel) so the storage chunk doesn't pull
// the full rendering surface — same rationale as the pptx deep
// imports noted in annot-render's index.ts.
import { probeRasterDims } from "@ingcreators/annot-render/raster-dims";
import {
  type BuildEditableImageDeps,
  buildEditableImageBlob,
  DEFAULT_DEPS,
} from "@ingcreators/annot-web/storage/image-encode";
import type { DesktopFs } from "./desktop-fs.js";

/**
 * Legacy `.annot.json` sidecar at the library root. Pre-Phase-4
 * builds wrote `images` / `documents` maps here so cold starts
 * could skip re-reading XMP. Current code ignores it for both
 * read and write — the file is left in place for downgrade
 * compatibility. The directory-walk filters it out so it doesn't
 * surface in folder listings.
 */
const LEGACY_INDEX_FILE = ".annot.json";

/** Image-file extensions the gallery surfaces. Permissive on
 *  purpose: external screenshots dropped into the library appear
 *  alongside annot-native captures. */
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".svg"];

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isDocumentFile(name: string): boolean {
  return name.toLowerCase().endsWith(".annot.html");
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  return lower.endsWith(".png")
    ? "image/png"
    : lower.endsWith(".svg")
      ? "image/svg+xml"
      : "image/jpeg";
}

export class DesktopStore
  implements
    StorageProvider,
    StorageWithInit,
    StorageWithResync,
    StorageWithForceRefresh,
    StorageWithThumbnailCache,
    StorageWithDocuments,
    StorageWithMetadataCache
{
  #fs: DesktopFs;
  /** Stable identifier folded into the cache namespaces (metadata
   *  + thumbnail) so two desktop installs (or two test instances)
   *  don't collide on identical relative paths. Defaults to the
   *  library root's basename when the caller doesn't provide one
   *  explicitly. */
  #rootName: string;
  #encodeDeps: BuildEditableImageDeps;
  #cache?: MetadataCache;
  /** Sync mtime mirror for `thumbnailVersion(path)` — see the
   *  matching mirror in DeviceStore for the rationale (Phase 3 of
   *  the shared-metadata-cache plan). */
  #mtimeByPath = new Map<string, number>();

  get rootName(): string {
    return this.#rootName;
  }

  /**
   * @param fs           Host-supplied filesystem adapter.
   * @param rootName     Stable identifier for the library root —
   *                     used as the cache namespace and as the
   *                     human-readable name the sidebar shows under
   *                     the "Desktop" chip.
   * @param encodeDeps   Optional override of the XMP encode
   *                     pipeline. Tests pass a stubbed deps object
   *                     that skips the worker.
   */
  constructor(fs: DesktopFs, rootName: string, encodeDeps: BuildEditableImageDeps = DEFAULT_DEPS) {
    this.#fs = fs;
    this.#rootName = rootName;
    this.#encodeDeps = encodeDeps;
  }

  // ── StorageWithMetadataCache ─────────────────────────────────

  metadataNamespace(): string {
    return `desktop:${this.#rootName}`;
  }

  attachMetadataCache(cache: MetadataCache): void {
    this.#cache = cache;
  }

  #c(): MetadataCache {
    const cache = this.#cache;
    if (!cache) {
      throw new Error(
        "DesktopStore: MetadataCache not attached. Call attachMetadataCache() before init().",
      );
    }
    return cache;
  }

  #ns(): string {
    return this.metadataNamespace();
  }

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
    await this.#syncFolderRecursive("");
  }

  async resync(): Promise<void> {
    await this.#syncFolderRecursive("");
  }

  async forceRefresh(): Promise<void> {
    await this.#c().invalidatePrefix(`${this.#ns()}:`);
    this.#mtimeByPath.clear();
    await this.#syncFolderRecursive("");
  }

  async #syncFolderRecursive(folderPath: string): Promise<void> {
    let entries: { name: string; kind: "file" | "directory" }[];
    try {
      entries = await this.#fs.readDir(folderPath);
    } catch {
      return;
    }

    const liveEntries: ListingEntry[] = [];
    const subfolders: string[] = [];

    for (const entry of entries) {
      if (entry.kind === "file") {
        if (entry.name === LEGACY_INDEX_FILE) continue;
        const path = joinPath(folderPath, entry.name);
        if (isImageFile(entry.name)) {
          const mtime = (await this.#fs.stat(path))?.mtime ?? 0;
          liveEntries.push({ path, version: String(mtime), kind: "image" });
        } else if (isDocumentFile(entry.name)) {
          const mtime = (await this.#fs.stat(path))?.mtime ?? 0;
          liveEntries.push({ path, version: String(mtime), kind: "document" });
        }
      } else if (entry.kind === "directory" && !entry.name.startsWith(".")) {
        subfolders.push(joinPath(folderPath, entry.name));
      }
    }

    const cached = (await this.#c().getListing(this.#ns(), folderPath)) ?? [];
    const cachedByPath = new Map(cached.map((e) => [e.path, e]));

    for (const live of liveEntries) {
      const previous = cachedByPath.get(live.path);
      if (previous?.version === live.version) continue;
      if (live.kind === "image") {
        await this.#refreshImageCache(live.path, live.version);
      } else {
        await this.#refreshDocumentCache(live.path, live.version);
      }
    }

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

    for (const sub of subfolders) {
      await this.#syncFolderRecursive(sub);
    }
  }

  async #refreshImageCache(path: string, version: string): Promise<void> {
    try {
      const bytes = await this.#fs.readFile(path);
      const meta = readEditableImage(bytes);
      const stat = await this.#fs.stat(path);
      const previous = await this.#c().getImage(this.#ns(), path, version);
      // The packet is the authority for provenance (schema 2.0);
      // the cache entry is refreshed FROM it. Pre-2.0 files fall
      // back to the previous cache entry, then to the file mtime.
      const createdAt =
        meta?.createdAt || previous?.createdAt || new Date(stat?.mtime ?? Date.now()).toISOString();
      // XMP-less external files: probe dimensions once per version
      // so gallery cards show real dims instead of falling back to
      // a date. Cache hits skip the decode on later listings.
      const probed = meta
        ? null
        : await probeRasterDims(new Blob([bytes as BlobPart], { type: mimeForPath(path) }));
      const rec: ImageRecord = {
        path,
        folderPath: getParentPath(path),
        originalDataUrl: "",
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: meta?.width || probed?.width || 0,
        height: meta?.height || probed?.height || 0,
        sourceUrl: meta?.sourceUrl || previous?.sourceUrl || "",
        tags: meta?.tags ?? {},
        createdAt,
        updatedAt: new Date(stat?.mtime ?? Date.now()).toISOString(),
        producer: meta?.producer || undefined,
        dpr: meta?.dpr || undefined,
      };
      await this.#cachePutImage(path, version, rec);
    } catch {
      /* file vanished mid-scan — listing reconciler handles cleanup */
    }
  }

  async #refreshDocumentCache(path: string, version: string): Promise<void> {
    try {
      const raw = await this.#fs.readFile(path);
      const bytes = new TextDecoder().decode(raw);
      const meta = parseDocumentMetaCheap(bytes);
      const stat = await this.#fs.stat(path);
      const previous = await this.#c().getDocument(this.#ns(), path, version);
      const createdAt = previous?.createdAt ?? new Date(stat?.mtime ?? Date.now()).toISOString();
      const rec: DocumentRecord = {
        path,
        folderPath: getParentPath(path),
        bytes: "",
        thumbnailDataUrl: "",
        title: meta.title,
        blockCount: meta.blockCount,
        imageCount: meta.imageCount,
        createdAt,
        updatedAt: new Date(stat?.mtime ?? Date.now()).toISOString(),
      };
      await this.#cachePutDocument(path, version, rec);
    } catch {
      /* file vanished — listing reconciler handles cleanup */
    }
  }

  // ── Path helpers ─────────────────────────────────────────────

  async #fileExists(folderPath: string, name: string): Promise<boolean> {
    const stat = await this.#fs.stat(joinPath(folderPath, name));
    return !!stat && stat.kind === "file";
  }

  async #fileExistsAtPath(path: string): Promise<boolean> {
    const stat = await this.#fs.stat(path);
    return !!stat && stat.kind === "file";
  }

  async #folderExists(path: string): Promise<boolean> {
    if (!path) return true;
    const stat = await this.#fs.stat(path);
    return !!stat && stat.kind === "directory";
  }

  // ── Images ───────────────────────────────────────────────────

  async saveImage(data: Omit<ImageRecord, "path">, opts?: { filename?: string }): Promise<string> {
    const isJpeg = data.originalDataUrl.startsWith("data:image/jpeg");
    const desiredFilename = opts?.filename
      ? normalizeAnnotImageFilename(opts.filename)
      : defaultAnnotImageFilename(data.originalDataUrl);
    validateName(desiredFilename);
    const folderPath = data.folderPath || "";

    if (folderPath) {
      await this.#fs.mkdir(folderPath, { recursive: true });
    }

    const filename = await uniquifyFilenameAsync(desiredFilename, (candidate) =>
      this.#fileExists(folderPath, candidate),
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
    const blob = await buildEditableImageBlob(record, isJpeg ? "jpg" : "png", this.#encodeDeps);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    try {
      await this.#fs.writeFile(path, bytes);
    } catch (e) {
      try {
        await this.#fs.remove(path);
      } catch {
        /* ignore */
      }
      throw e;
    }

    const mtime = (await this.#fs.stat(path))?.mtime ?? 0;
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
      const bytes = await this.#fs.readFile(path);
      const meta = readEditableImage(bytes);
      const stat = await this.#fs.stat(path);
      const mtime = stat?.mtime ?? 0;
      const version = String(mtime);
      const cached = await this.#c().getImage(this.#ns(), path, version);
      // The packet is the authority for provenance (schema 2.0);
      // the cache is a fallback for pre-2.0 files only.
      const createdAt =
        meta?.createdAt || cached?.createdAt || new Date(mtime || Date.now()).toISOString();
      // No XMP packet (an external image dropped into the library):
      // probe the real pixel dimensions — a 0×0 record mounts a 0×0
      // canvas svg (blank editor) since the shell sizes the canvas
      // from the record, not from the decoded bitmap. Mirrors the
      // vscode webview's raw-raster fallback.
      const probed = meta
        ? null
        : await probeRasterDims(new Blob([bytes as BlobPart], { type: mimeForPath(path) }));
      return {
        path,
        folderPath: getParentPath(path),
        originalDataUrl: meta?.originalImageDataUrl || (await this.#bytesToDataUrl(bytes, path)),
        thumbnailDataUrl: "",
        annotationsSvg: meta?.annotationsSvg || "",
        width: meta?.width || probed?.width || 0,
        height: meta?.height || probed?.height || 0,
        sourceUrl: meta?.sourceUrl || cached?.sourceUrl || "",
        tags: meta?.tags || {},
        createdAt,
        updatedAt: new Date(mtime || Date.now()).toISOString(),
        producer: meta?.producer || undefined,
        dpr: meta?.dpr || undefined,
      };
    } catch {
      return undefined;
    }
  }

  async listImages(folderPath: string): Promise<ImageRecord[]> {
    let entries: { name: string; kind: "file" | "directory" }[];
    try {
      entries = await this.#fs.readDir(folderPath);
    } catch {
      return [];
    }

    const liveEntries: ListingEntry[] = [];
    const records: ImageRecord[] = [];

    for (const entry of entries) {
      if (entry.kind !== "file") continue;
      if (entry.name === LEGACY_INDEX_FILE) continue;
      if (!isImageFile(entry.name)) continue;
      const path = joinPath(folderPath, entry.name);
      const stat = await this.#fs.stat(path);
      const version = String(stat?.mtime ?? 0);
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
    let newMtime: number | undefined;
    if (
      updates.annotationsSvg !== undefined ||
      updates.tags !== undefined ||
      updates.originalDataUrl !== undefined
    ) {
      const isJpeg = (merged.originalDataUrl || "").startsWith("data:image/jpeg");
      const blob = await buildEditableImageBlob(merged, isJpeg ? "jpg" : "png", this.#encodeDeps);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await this.#fs.writeFile(path, bytes);
      newMtime = (await this.#fs.stat(path))?.mtime ?? undefined;
    }

    const versionMtime = newMtime ?? (await this.#fs.stat(path))?.mtime ?? 0;
    const version = String(versionMtime);
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
      updatedAt: newMtime ? new Date(newMtime).toISOString() : merged.updatedAt,
    };
    await this.#cachePutImage(path, version, cached);
    if (newMtime !== undefined) {
      await this.#upsertListing(folderPath, { path, version, kind: "image" });
    }
  }

  async moveImage(path: string, newFolderPath: string): Promise<string> {
    if (newFolderPath === getParentPath(path)) return path;
    if (!(await this.#fileExistsAtPath(path))) {
      throw new StorageNotFoundError(path, `Image not found: ${path}`);
    }

    const filename = getFilename(path);
    if (newFolderPath) {
      await this.#fs.mkdir(newFolderPath, { recursive: true });
    }
    const uniqueName = await uniquifyFilenameAsync(filename, (candidate) =>
      this.#fileExists(newFolderPath, candidate),
    );
    const newPath = joinPath(newFolderPath, uniqueName);

    await this.#fs.rename(path, newPath);

    await this.#c().migrateEntry(this.#ns(), path, newPath);
    this.#forgetMtime(path);
    const newVersion = String((await this.#fs.stat(newPath))?.mtime ?? 0);
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

    if (await this.#fileExists(folderPath, newName)) {
      throw new StorageConflictError(newPath, `Image already exists: ${newPath}`);
    }

    await this.#fs.rename(path, newPath);

    await this.#c().migrateEntry(this.#ns(), path, newPath);
    this.#forgetMtime(path);
    const newVersion = String((await this.#fs.stat(newPath))?.mtime ?? 0);
    this.#rememberMtime(newPath, newVersion);
    await this.#upsertListing(folderPath, { path: newPath, version: newVersion, kind: "image" });
    return newPath;
  }

  async deleteImage(path: string): Promise<void> {
    if (!(await this.#fileExistsAtPath(path))) return;

    try {
      await this.#fs.remove(path);
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

    if (folderPath) {
      await this.#fs.mkdir(folderPath, { recursive: true });
    }

    const filename = await uniquifyFilenameAsync(desiredFilename, (candidate) =>
      this.#fileExists(folderPath, candidate),
    );
    const path = joinPath(folderPath, filename);

    const bytes = new TextEncoder().encode(data.bytes);
    try {
      await this.#fs.writeFile(path, bytes);
    } catch (e) {
      try {
        await this.#fs.remove(path);
      } catch {
        /* ignore */
      }
      throw e;
    }

    const mtime = (await this.#fs.stat(path))?.mtime ?? 0;
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
      const raw = await this.#fs.readFile(path);
      bytes = new TextDecoder().decode(raw);
      mtime = (await this.#fs.stat(path))?.mtime ?? 0;
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
    let entries: { name: string; kind: "file" | "directory" }[];
    try {
      entries = await this.#fs.readDir(folderPath);
    } catch {
      return [];
    }

    const out: DocumentRecord[] = [];
    for (const entry of entries) {
      if (entry.kind !== "file") continue;
      if (!isDocumentFile(entry.name)) continue;
      const path = joinPath(folderPath, entry.name);
      const mtime = (await this.#fs.stat(path))?.mtime ?? 0;
      const version = String(mtime);
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
      const bytes = new TextEncoder().encode(updates.bytes);
      await this.#fs.writeFile(path, bytes);
      newMtime = (await this.#fs.stat(path))?.mtime ?? undefined;
    }
    const merged: DocumentRecord = {
      ...existing,
      title: updates.title ?? existing.title,
      blockCount: updates.blockCount ?? existing.blockCount,
      imageCount: updates.imageCount ?? existing.imageCount,
    };
    const versionMtime = newMtime ?? (await this.#fs.stat(path))?.mtime ?? 0;
    const version = String(versionMtime);
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
      const raw = await this.#fs.readFile(sidecarPath);
      return new TextDecoder().decode(raw);
    } catch {
      return undefined;
    }
  }

  async setAnnotationsYaml(pngPath: string, content: string): Promise<void> {
    const sidecarPath = annotationsYamlPathFor(pngPath);
    const folderPath = getParentPath(sidecarPath);
    if (folderPath) {
      await this.#fs.mkdir(folderPath, { recursive: true });
    }
    const bytes = new TextEncoder().encode(content);
    await this.#fs.writeFile(sidecarPath, bytes);
  }

  // ── Folders ──────────────────────────────────────────────────

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
    let entries: { name: string; kind: "file" | "directory" }[];
    try {
      entries = await this.#fs.readDir(parentPath);
    } catch {
      return [];
    }
    const results: FolderRecord[] = [];
    for (const entry of entries) {
      if (entry.kind !== "directory") continue;
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

    await this.#c().rewriteEntriesForPrefix(this.#ns(), oldPath, newPath);
    for (const [k, v] of [...this.#mtimeByPath.entries()]) {
      if (k === oldPath || k.startsWith(`${oldPath}/`)) {
        this.#mtimeByPath.delete(k);
        const moved = newPath + k.slice(oldPath.length);
        this.#mtimeByPath.set(moved, v);
      }
    }

    return newPath;
  }

  async deleteFolder(path: string): Promise<void> {
    if (!path) return;
    try {
      await this.#fs.remove(path, { recursive: true });
    } catch {
      /* may have been removed externally */
    }

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

  thumbnailKey(path: string): string | undefined {
    return `desktop:${this.#rootName}:${path}`;
  }

  thumbnailVersion(path: string): string {
    return String(this.#mtimeByPath.get(path) ?? 0);
  }

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

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Single-entry listing patch — upsert into the cached listing
   * if one exists for the folder; otherwise reconcile by walking
   * the folder so a never-listed folder still has its listing
   * ready for the next `listImages` call.
   */
  async #upsertListing(folderPath: string, entry: ListingEntry): Promise<void> {
    const cached = await this.#c().getListing(this.#ns(), folderPath);
    if (cached) {
      await this.#c().upsertListingEntry(this.#ns(), folderPath, entry);
    } else {
      try {
        await this.#syncFolderRecursive(folderPath);
      } catch {
        await this.#c().putListing(this.#ns(), folderPath, [entry]);
      }
    }
  }

  /**
   * Build a data URL fallback for `getImage` when the file has no
   * embedded XMP (i.e. an external image dropped into the library).
   */
  async #bytesToDataUrl(bytes: Uint8Array, path: string): Promise<string> {
    const blob = new Blob([bytes as BlobPart], { type: mimeForPath(path) });
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
