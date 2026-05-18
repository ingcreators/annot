// `AnnotCloudStore` — `StorageProvider` implementation talking to
// the `@ingcreators/annot-worker` HTTP API.
//
// Lifecycle:
//   const store = new AnnotCloudStore({ baseUrl: "https://api.annot.work" });
//   store.attachMetadataCache(cache);   // optional, opts into the
//                                       // shared metadata cache
//   await store.init();                 // verifies session + caches
//                                       // workspaceId
//   await store.listImages("");         // ready to use
//
// Auth: the worker uses an HttpOnly session cookie minted by the
// OAuth callback. `credentials: "include"` carries it on every
// request; the cloud-store doesn't see or handle the token
// directly. When the session expires the API returns 401 and the
// store throws `StoragePermissionError` — the host (PWA's storage
// bridge) handles the "Sign in again" prompt.
//
// Worker ↔ StorageProvider impedance match:
//   - Worker uses image / document IDs in URLs; StorageProvider
//     uses paths. The store maintains a path → id map via the
//     shared `MetadataCache.setBackendId` so most calls don't pay
//     the lookup roundtrip.
//   - Worker has no folder resource. Folders are virtual: derived
//     from image + document paths during `listFolders`. Empty
//     folders created via `createFolder` exist only in the
//     current session — the next reload won't see them.
//   - Worker stores annotations in a sidecar R2 object, not inline
//     in the image bytes. `saveImage` / `updateImage` route the
//     SVG to `/api/images/:id/annotations` as a separate request.
//   - The unified ThumbnailManager calls `fetchThumbnailSource()`;
//     we stream the original bytes from `/api/images/:id/original`.

import {
  type DocumentRecord,
  type DocumentRecordUpdate,
  type FolderRecord,
  getFilename,
  getParentPath,
  type ImageRecord,
  type ImageRecordUpdate,
  joinPath,
  type MetadataCache,
  rewritePathPrefix,
  StorageConflictError,
  StorageNotFoundError,
  type StorageProvider,
  type StorageWithDocuments,
  type StorageWithInit,
  type StorageWithMetadataCache,
  type StorageWithThumbnailCache,
  uniquifyFilenameAsync,
  validateName,
} from "@ingcreators/annot-core/storage";
import { ApiClient, type ApiClientOptions, ApiError } from "./api-client.js";
import { bytesToDataUrl, dataUrlToBytes } from "./data-url.js";
import type {
  AuthMeWire,
  DocumentGetResponse,
  DocumentListResponse,
  DocumentWire,
  ImageGetResponse,
  ImageListResponse,
  ImageWire,
} from "./wire-types.js";

/** Per-instance options. `baseUrl` matches the worker deploy.
 *  `fetchImpl` is for tests. */
export interface AnnotCloudStoreOptions extends ApiClientOptions {}

/** Sentinel mime types used when the wire layer lacks the data we
 *  need to reconstruct an `ImageRecord`. */
const DEFAULT_MIME = "image/png";

export class AnnotCloudStore
  implements
    StorageProvider,
    StorageWithInit,
    StorageWithDocuments,
    StorageWithThumbnailCache,
    StorageWithMetadataCache
{
  readonly #api: ApiClient;
  /** Populated by `init()`. Used for the thumbnail-cache key +
   *  metadata namespace prefix. Undefined before init. */
  #workspaceId: string | undefined;
  /** Populated by `attachMetadataCache`. Optional — the store
   *  works without one, just with no cross-tab persistence. */
  #cache: MetadataCache | undefined;
  /** Session-scoped phantom folder set — folders created via
   *  `createFolder` that have no image / document under them yet.
   *  These appear in `listFolders` until an image is saved (and
   *  starts deriving from path) OR until reload (when the set
   *  resets). Backing this in the metadata cache is possible but
   *  adds complexity for a v1 corner case. */
  readonly #phantomFolders = new Set<string>();

  constructor(options: AnnotCloudStoreOptions) {
    this.#api = new ApiClient(options);
  }

  // ── StorageWithInit ─────────────────────────────────────────

  /**
   * Verify the session + cache the workspaceId. Throws
   * `StoragePermissionError` when the session is missing /
   * expired — the host catches that and shows a "Sign in to
   * Annot Cloud" affordance, then calls `init()` again.
   */
  async init(): Promise<void> {
    const me = await this.#api.getJson<AuthMeWire>("/api/auth/me", "");
    this.#workspaceId = me.user.workspaceId;
  }

  // ── StorageWithMetadataCache ────────────────────────────────

  /** Namespace prefix used to scope this store's cache entries.
   *  Stable across resync — `init()` must be called first so the
   *  workspaceId is known. */
  metadataNamespace(): string {
    if (!this.#workspaceId) {
      throw new Error("AnnotCloudStore: init() must run before metadataNamespace()");
    }
    return `annotcloud:${this.#workspaceId}`;
  }

  attachMetadataCache(cache: MetadataCache): void {
    this.#cache = cache;
  }

  // ── Path ↔ backend-id resolution ────────────────────────────

  /** Resolve a workspace-relative path to the image id the worker
   *  uses in `/api/images/:id` URLs. Hits the cache first; falls
   *  back to a listing query when missing. Returns undefined when
   *  the path doesn't correspond to a known image. */
  async #resolveImageId(path: string): Promise<string | undefined> {
    if (!path) return undefined;
    if (this.#cache) {
      const cached = await this.#cache.getBackendIdByPath(this.metadataNamespace(), path);
      if (cached) return cached;
    }
    // Cache miss — query by folder prefix to find the image with
    // this exact path. The worker doesn't expose a path-keyed
    // GET, so listing is the only way in.
    const folder = getParentPath(path);
    const list = await this.#listImagesWire(folder);
    for (const wire of list.images) {
      // Seed the cache while we're here so subsequent lookups
      // hit the fast path.
      if (this.#cache) {
        await this.#cache.setBackendId(this.metadataNamespace(), wire.path, wire.id);
      }
      if (wire.path === path) return wire.id;
    }
    return undefined;
  }

  /** Same idea for documents. Separate backend ID namespace would
   *  collide with images if we shared the path → id map, so we
   *  prefix document IDs with `doc:` in the cache. */
  async #resolveDocumentId(path: string): Promise<string | undefined> {
    if (!path) return undefined;
    const ns = this.metadataNamespace();
    if (this.#cache) {
      const cached = await this.#cache.getBackendIdByPath(ns, `doc:${path}`);
      if (cached) return cached;
    }
    const folder = getParentPath(path);
    const list = await this.#listDocumentsWire(folder);
    for (const wire of list.documents) {
      if (this.#cache) {
        await this.#cache.setBackendId(ns, `doc:${wire.path}`, wire.id);
      }
      if (wire.path === path) return wire.id;
    }
    return undefined;
  }

  // ── Listing API wrappers ────────────────────────────────────

  async #listImagesWire(folderPath: string): Promise<ImageListResponse> {
    // The worker's `folder` query param expects a prefix WITH the
    // trailing slash (`Screenshots/`, not `Screenshots`). Root is
    // an empty/missing param.
    const prefix = folderPath ? `${folderPath}/` : "";
    const qs = prefix ? `?folder=${encodeURIComponent(prefix)}&limit=500` : "?limit=500";
    return await this.#api.getJson<ImageListResponse>(`/api/images${qs}`, folderPath);
  }

  async #listDocumentsWire(folderPath: string): Promise<DocumentListResponse> {
    const prefix = folderPath ? `${folderPath}/` : "";
    const qs = prefix ? `?folder=${encodeURIComponent(prefix)}&limit=500` : "?limit=500";
    return await this.#api.getJson<DocumentListResponse>(`/api/documents${qs}`, folderPath);
  }

  // ── Wire ↔ record marshalling ───────────────────────────────

  /** Light wire → record conversion for listings. Bytes are
   *  intentionally empty; the gallery's ThumbnailManager
   *  lazy-loads via `fetchThumbnailSource`. */
  #toLightImageRecord(wire: ImageWire): ImageRecord {
    return {
      path: wire.path,
      folderPath: getParentPath(wire.path),
      originalDataUrl: "",
      thumbnailDataUrl: "",
      annotationsSvg: "",
      width: wire.width ?? 0,
      height: wire.height ?? 0,
      sourceUrl: wire.sourceUrl ?? "",
      tags: { ...wire.tags },
      createdAt: new Date(wire.createdAt).toISOString(),
      updatedAt: new Date(wire.updatedAt).toISOString(),
    };
  }

  #toLightDocumentRecord(wire: DocumentWire): DocumentRecord {
    return {
      path: wire.path,
      folderPath: getParentPath(wire.path),
      bytes: "",
      thumbnailDataUrl: "",
      title: wire.title ?? "",
      imageCount: 0,
      blockCount: wire.blockCount ?? 0,
      createdAt: new Date(wire.createdAt).toISOString(),
      updatedAt: new Date(wire.updatedAt).toISOString(),
    };
  }

  // ── Filename uniquification ─────────────────────────────────

  /** Check whether a path is taken by an image OR document in
   *  the workspace. Worker `path_conflict` covers same-resource
   *  collisions; cross-resource collisions (image at the same
   *  path as a document) are checked client-side. */
  async #pathTaken(path: string): Promise<boolean> {
    const folder = getParentPath(path);
    const [images, documents] = await Promise.all([
      this.#listImagesWire(folder),
      this.#listDocumentsWire(folder),
    ]);
    for (const img of images.images) if (img.path === path) return true;
    for (const doc of documents.documents) if (doc.path === path) return true;
    return false;
  }

  // ── StorageProvider: images ─────────────────────────────────

  async saveImage(
    record: Omit<ImageRecord, "path">,
    opts: { filename?: string } = {},
  ): Promise<string> {
    if (!this.#workspaceId) {
      throw new Error("AnnotCloudStore: init() must run before saveImage()");
    }
    const folderPath = record.folderPath;
    const desired = opts.filename ?? `image-${Date.now()}.png`;
    validateName(desired);

    // Uniquify against the destination folder. Async existence
    // check pays one listing per try, but the typical case is no
    // collision (single API call).
    const filename = await uniquifyFilenameAsync(desired, async (candidate) => {
      const candidatePath = joinPath(folderPath, candidate);
      return await this.#pathTaken(candidatePath);
    });
    const finalPath = joinPath(folderPath, filename);

    // POST original bytes.
    const { bytes, mimeType } = dataUrlToBytes(record.originalDataUrl);
    const headers: Record<string, string> = {
      "Content-Type": mimeType || DEFAULT_MIME,
      "Content-Length": String(bytes.byteLength),
    };
    if (record.width) headers["X-Annot-Width"] = String(record.width);
    if (record.height) headers["X-Annot-Height"] = String(record.height);
    if (record.sourceUrl) headers["X-Annot-Source-Url"] = record.sourceUrl;

    const created = await this.#api.postBytes<{ ok: true; image: ImageWire }>(
      `/api/images?path=${encodeURIComponent(finalPath)}`,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      headers,
      finalPath,
    );

    // Patch annotations sidecar + tags if either is non-empty.
    // Tags are sent as a JSON PATCH; annotations are bytes.
    let imageWire = created.image;
    if (record.annotationsSvg) {
      const svgBytes = new TextEncoder().encode(record.annotationsSvg);
      const patched = await this.#api.patchBytes<{ ok: true; image: ImageWire }>(
        `/api/images/${imageWire.id}/annotations`,
        svgBytes.buffer.slice(
          svgBytes.byteOffset,
          svgBytes.byteOffset + svgBytes.byteLength,
        ) as ArrayBuffer,
        { "Content-Type": "image/svg+xml" },
        finalPath,
      );
      imageWire = patched.image;
    }
    if (record.tags && Object.keys(record.tags).length > 0) {
      const patched = await this.#api.patchJson<{ ok: true; image: ImageWire }>(
        `/api/images/${imageWire.id}`,
        { tags: record.tags },
        finalPath,
      );
      imageWire = patched.image;
    }

    // Cache the new path → id mapping and remove the now-occupied
    // path from the phantom folder set (its containing folder is
    // now real).
    if (this.#cache) {
      await this.#cache.setBackendId(this.metadataNamespace(), finalPath, imageWire.id);
    }
    this.#phantomFolders.delete(folderPath);

    return finalPath;
  }

  async getImage(path: string): Promise<ImageRecord | undefined> {
    const id = await this.#resolveImageId(path);
    if (!id) return undefined;

    // Three reads in parallel: metadata, original bytes, optional
    // annotations sidecar. The worker streams each separately so
    // there's no consolidated endpoint to call instead.
    const [metaRes, originalRes, annotationsRes] = await Promise.all([
      this.#api.getJson<ImageGetResponse>(`/api/images/${id}`, path),
      this.#api.getBody(`/api/images/${id}/original`, path),
      this.#api.getBody(`/api/images/${id}/annotations`, path),
    ]);

    if (!originalRes) {
      // Metadata says the image exists but bytes are gone. Match
      // the contract: missing-by-design returns undefined.
      return undefined;
    }
    const originalBytes = new Uint8Array(await originalRes.arrayBuffer());
    const mimeType = metaRes.image.mimeType ?? DEFAULT_MIME;
    const annotationsSvg = annotationsRes ? await annotationsRes.text() : "";

    return {
      path: metaRes.image.path,
      folderPath: getParentPath(metaRes.image.path),
      originalDataUrl: bytesToDataUrl(originalBytes, mimeType),
      thumbnailDataUrl: "",
      annotationsSvg,
      width: metaRes.image.width ?? 0,
      height: metaRes.image.height ?? 0,
      sourceUrl: metaRes.image.sourceUrl ?? "",
      tags: { ...metaRes.image.tags },
      createdAt: new Date(metaRes.image.createdAt).toISOString(),
      updatedAt: new Date(metaRes.image.updatedAt).toISOString(),
    };
  }

  async listImages(folderPath: string): Promise<ImageRecord[]> {
    const list = await this.#listImagesWire(folderPath);
    if (this.#cache) {
      // Seed the path → id map so subsequent getImage / updateImage
      // calls hit the fast resolver path.
      const ns = this.metadataNamespace();
      await Promise.all(
        list.images.map((wire) => this.#cache!.setBackendId(ns, wire.path, wire.id)),
      );
    }
    return list.images
      .map((wire) => this.#toLightImageRecord(wire))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async updateImage(path: string, updates: ImageRecordUpdate): Promise<void> {
    const id = await this.#resolveImageId(path);
    if (!id) return; // Idempotent on missing — contract.

    // Annotations sidecar update: bytes.
    if (updates.annotationsSvg !== undefined) {
      const svgBytes = new TextEncoder().encode(updates.annotationsSvg);
      await this.#api.patchBytes<{ ok: true; image: ImageWire }>(
        `/api/images/${id}/annotations`,
        svgBytes.buffer.slice(
          svgBytes.byteOffset,
          svgBytes.byteOffset + svgBytes.byteLength,
        ) as ArrayBuffer,
        { "Content-Type": "image/svg+xml" },
        path,
      );
    }

    // Original-bytes update (redact / crop destructive paths).
    // The worker doesn't expose a PATCH for original bytes today,
    // so we delete + re-upload at the same path. Path conflict
    // is unreachable because the source row is gone by the time
    // we POST.
    if (updates.originalDataUrl !== undefined) {
      const { bytes, mimeType } = dataUrlToBytes(updates.originalDataUrl);
      // Capture the source row's tags + sourceUrl before delete
      // so the recreated row preserves them.
      const sourceMeta = await this.#api.getJson<ImageGetResponse>(`/api/images/${id}`, path);
      await this.#api.deleteJson(`/api/images/${id}`, path);

      const headers: Record<string, string> = {
        "Content-Type": mimeType || sourceMeta.image.mimeType || DEFAULT_MIME,
        "Content-Length": String(bytes.byteLength),
      };
      const width = updates.width ?? sourceMeta.image.width;
      const height = updates.height ?? sourceMeta.image.height;
      if (width) headers["X-Annot-Width"] = String(width);
      if (height) headers["X-Annot-Height"] = String(height);
      if (sourceMeta.image.sourceUrl) headers["X-Annot-Source-Url"] = sourceMeta.image.sourceUrl;

      const created = await this.#api.postBytes<{ ok: true; image: ImageWire }>(
        `/api/images?path=${encodeURIComponent(path)}`,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        headers,
        path,
      );
      // Update the cache with the new id (the row's primary key
      // changed because we deleted + recreated). Use the
      // already-captured annotations / tags too.
      if (this.#cache) {
        await this.#cache.setBackendId(this.metadataNamespace(), path, created.image.id);
      }
      if (Object.keys(sourceMeta.image.tags).length > 0) {
        await this.#api.patchJson(
          `/api/images/${created.image.id}`,
          { tags: sourceMeta.image.tags },
          path,
        );
      }
      // If the caller didn't simultaneously update annotations,
      // re-PATCH the previous SVG so it survives the bake. We
      // skip when updates.annotationsSvg is set — it was already
      // applied above against the OLD id, which we just deleted;
      // re-apply to the new id.
      const annotationsRes = updates.annotationsSvg
        ? null
        : await this.#api.getBody(`/api/images/${id}/annotations`, path).catch(() => null);
      if (updates.annotationsSvg !== undefined) {
        const svgBytes = new TextEncoder().encode(updates.annotationsSvg);
        await this.#api.patchBytes(
          `/api/images/${created.image.id}/annotations`,
          svgBytes.buffer.slice(
            svgBytes.byteOffset,
            svgBytes.byteOffset + svgBytes.byteLength,
          ) as ArrayBuffer,
          { "Content-Type": "image/svg+xml" },
          path,
        );
      } else if (annotationsRes) {
        const text = await annotationsRes.text();
        if (text) {
          const svgBytes = new TextEncoder().encode(text);
          await this.#api.patchBytes(
            `/api/images/${created.image.id}/annotations`,
            svgBytes.buffer.slice(
              svgBytes.byteOffset,
              svgBytes.byteOffset + svgBytes.byteLength,
            ) as ArrayBuffer,
            { "Content-Type": "image/svg+xml" },
            path,
          );
        }
      }
      return;
    }

    // Metadata-only patches: tags / width / height / updatedAt.
    const body: Record<string, unknown> = {};
    if (updates.tags !== undefined) body.tags = updates.tags;
    if (updates.width !== undefined) body.width = updates.width;
    if (updates.height !== undefined) body.height = updates.height;
    if (Object.keys(body).length > 0) {
      await this.#api.patchJson(`/api/images/${id}`, body, path);
    }
  }

  async moveImage(path: string, newFolderPath: string): Promise<string> {
    const currentFolder = getParentPath(path);
    if (currentFolder === newFolderPath) return path;
    const id = await this.#resolveImageId(path);
    if (!id) throw new StorageNotFoundError(path);

    const filename = getFilename(path);
    const desiredPath = joinPath(newFolderPath, filename);
    // Auto-uniquify on collision (contract). Listing-based check
    // covers cross-resource collisions too.
    const finalFilename = await uniquifyFilenameAsync(filename, async (candidate) => {
      const candidatePath = joinPath(newFolderPath, candidate);
      if (candidatePath === path) return false;
      return await this.#pathTaken(candidatePath);
    });
    const finalPath = joinPath(newFolderPath, finalFilename);
    const _wasUniquified = finalPath !== desiredPath;
    await this.#api.patchJson(`/api/images/${id}`, { path: finalPath }, path);
    if (this.#cache) {
      await this.#cache.migrateEntry(this.metadataNamespace(), path, finalPath);
    }
    return finalPath;
  }

  async renameImage(path: string, newName: string): Promise<string> {
    if (newName === getFilename(path)) return path;
    validateName(newName);
    const id = await this.#resolveImageId(path);
    if (!id) throw new StorageNotFoundError(path);
    const finalPath = joinPath(getParentPath(path), newName);
    if (await this.#pathTaken(finalPath)) {
      throw new StorageConflictError(finalPath);
    }
    try {
      await this.#api.patchJson(`/api/images/${id}`, { path: finalPath }, path);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        throw new StorageConflictError(finalPath, err.body?.message);
      }
      throw err;
    }
    if (this.#cache) {
      await this.#cache.migrateEntry(this.metadataNamespace(), path, finalPath);
    }
    return finalPath;
  }

  async deleteImage(path: string): Promise<void> {
    const id = await this.#resolveImageId(path);
    if (!id) return; // Idempotent.
    await this.#api.deleteJson(`/api/images/${id}`, path);
    if (this.#cache) {
      await this.#cache.invalidatePath(this.metadataNamespace(), path);
      await this.#cache.removeListingEntry(this.metadataNamespace(), getParentPath(path), path);
    }
  }

  // ── StorageProvider: folders (virtual) ──────────────────────

  async createFolder(parentPath: string, name: string): Promise<string> {
    validateName(name);
    const fullPath = joinPath(parentPath, name);
    // Folders are virtual; check existence against listings +
    // phantom set. Conflict-on-existing matches the contract.
    if (await this.#folderExists(fullPath)) {
      throw new StorageConflictError(fullPath, `Folder already exists: ${fullPath}`);
    }
    this.#phantomFolders.add(fullPath);
    return fullPath;
  }

  async #folderExists(path: string): Promise<boolean> {
    if (!path) return false;
    if (this.#phantomFolders.has(path)) return true;
    // Derived check: any image or document under `path/`?
    const list = await this.#listImagesWire(path);
    if (list.images.length > 0) return true;
    const docs = await this.#listDocumentsWire(path);
    if (docs.documents.length > 0) return true;
    return false;
  }

  async listFolders(parentPath: string): Promise<FolderRecord[]> {
    // Enumerate every path in the workspace, derive folders that
    // are direct children of `parentPath`. Doing one big list
    // beats N folder-by-folder probes for typical workspace
    // sizes (worker default limit 500, max 500). For very large
    // workspaces this becomes expensive; revisit when usage data
    // suggests it.
    const [imageList, docList] = await Promise.all([
      this.#listImagesWire(""),
      this.#listDocumentsWire(""),
    ]);
    const folderNames = new Set<string>();
    const collect = (path: string) => {
      // Walk every ancestor that lives directly under parentPath.
      let current = getParentPath(path);
      while (current) {
        const parent = getParentPath(current);
        if (parent === parentPath) folderNames.add(getFilename(current));
        current = parent;
      }
    };
    for (const img of imageList.images) collect(img.path);
    for (const doc of docList.documents) collect(doc.path);
    // Phantom folders that live directly under parentPath.
    for (const phantom of this.#phantomFolders) {
      if (getParentPath(phantom) === parentPath) {
        folderNames.add(getFilename(phantom));
      }
    }
    const records: FolderRecord[] = [];
    for (const name of folderNames) {
      const folderPath = joinPath(parentPath, name);
      records.push({
        path: folderPath,
        parentPath,
        name,
        // No backend record for folders → no real createdAt.
        // Empty string matches the GitHubStore convention.
        createdAt: "",
      });
    }
    records.sort((a, b) => a.name.localeCompare(b.name));
    return records;
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
    if (!path) throw new StorageNotFoundError(path, "Cannot rename the root folder.");
    if (newName === getFilename(path)) return path;
    validateName(newName);
    const parent = getParentPath(path);
    const newPath = joinPath(parent, newName);
    if (await this.#folderExists(newPath)) {
      throw new StorageConflictError(newPath);
    }
    if (!(await this.#folderExists(path))) {
      throw new StorageNotFoundError(path);
    }
    await this.#renameFolderPrefix(path, newPath);
    return newPath;
  }

  async moveFolder(path: string, newParentPath: string): Promise<string> {
    if (!path) throw new StorageNotFoundError(path, "Cannot move the root folder.");
    if (getParentPath(path) === newParentPath) return path;
    if (newParentPath === path || newParentPath.startsWith(`${path}/`)) {
      throw new Error(`Cannot move folder into itself: ${path} → ${newParentPath}`);
    }
    const newPath = joinPath(newParentPath, getFilename(path));
    if (await this.#folderExists(newPath)) {
      throw new StorageConflictError(newPath);
    }
    if (!(await this.#folderExists(path))) {
      throw new StorageNotFoundError(path);
    }
    await this.#renameFolderPrefix(path, newPath);
    return newPath;
  }

  /** Shared prefix-rewrite: rename / move both reduce to "rewrite
   *  every descendant's path". Walks each list in turn, patching
   *  each row's path. */
  async #renameFolderPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    const [allImages, allDocs] = await Promise.all([
      this.#listImagesWire(""),
      this.#listDocumentsWire(""),
    ]);
    for (const img of allImages.images) {
      if (img.path === oldPrefix || img.path.startsWith(`${oldPrefix}/`)) {
        const newImgPath = rewritePathPrefix(img.path, oldPrefix, newPrefix);
        await this.#api.patchJson(`/api/images/${img.id}`, { path: newImgPath }, img.path);
      }
    }
    for (const doc of allDocs.documents) {
      if (doc.path === oldPrefix || doc.path.startsWith(`${oldPrefix}/`)) {
        const newDocPath = rewritePathPrefix(doc.path, oldPrefix, newPrefix);
        await this.#api.patchJson(`/api/documents/${doc.id}`, { path: newDocPath }, doc.path);
      }
    }
    // Migrate phantom folder paths in the same shape.
    for (const phantom of [...this.#phantomFolders]) {
      if (phantom === oldPrefix || phantom.startsWith(`${oldPrefix}/`)) {
        this.#phantomFolders.delete(phantom);
        this.#phantomFolders.add(rewritePathPrefix(phantom, oldPrefix, newPrefix));
      }
    }
    if (this.#cache) {
      await this.#cache.rewriteEntriesForPrefix(this.metadataNamespace(), oldPrefix, newPrefix);
    }
  }

  async deleteFolder(path: string): Promise<void> {
    if (!path) return;
    if (!(await this.#folderExists(path))) return;
    const [allImages, allDocs] = await Promise.all([
      this.#listImagesWire(""),
      this.#listDocumentsWire(""),
    ]);
    for (const img of allImages.images) {
      if (img.path === path || img.path.startsWith(`${path}/`)) {
        await this.#api.deleteJson(`/api/images/${img.id}`, img.path);
      }
    }
    for (const doc of allDocs.documents) {
      if (doc.path === path || doc.path.startsWith(`${path}/`)) {
        await this.#api.deleteJson(`/api/documents/${doc.id}`, doc.path);
      }
    }
    // Drop phantom folder + cache invalidation.
    for (const phantom of [...this.#phantomFolders]) {
      if (phantom === path || phantom.startsWith(`${path}/`)) {
        this.#phantomFolders.delete(phantom);
      }
    }
    if (this.#cache) {
      await this.#cache.invalidatePrefix(`${this.metadataNamespace()}:${path}`);
    }
  }

  async getBreadcrumb(path: string): Promise<FolderRecord[]> {
    if (!path) return [];
    const segments = path.split("/");
    const records: FolderRecord[] = [];
    let acc = "";
    for (const segment of segments) {
      acc = acc ? `${acc}/${segment}` : segment;
      if (await this.#folderExists(acc)) {
        records.push({
          path: acc,
          parentPath: getParentPath(acc),
          name: segment,
          createdAt: "",
        });
      }
    }
    return records;
  }

  // ── StorageWithDocuments ────────────────────────────────────

  async saveDocument(
    record: Omit<DocumentRecord, "path">,
    opts: { filename?: string } = {},
  ): Promise<string> {
    if (!this.#workspaceId) {
      throw new Error("AnnotCloudStore: init() must run before saveDocument()");
    }
    const folderPath = record.folderPath;
    const desired = opts.filename ?? `document-${Date.now()}.annot.html`;
    validateName(desired);
    const filename = await uniquifyFilenameAsync(desired, async (candidate) => {
      return await this.#pathTaken(joinPath(folderPath, candidate));
    });
    const finalPath = joinPath(folderPath, filename);

    const bodyBytes = new TextEncoder().encode(record.bytes);
    const headers: Record<string, string> = {
      "Content-Type": "text/html",
      "Content-Length": String(bodyBytes.byteLength),
    };
    if (record.title) headers["X-Annot-Title"] = record.title;
    if (record.blockCount) headers["X-Annot-Block-Count"] = String(record.blockCount);

    const created = await this.#api.postBytes<{ ok: true; document: DocumentWire }>(
      `/api/documents?path=${encodeURIComponent(finalPath)}`,
      bodyBytes.buffer.slice(
        bodyBytes.byteOffset,
        bodyBytes.byteOffset + bodyBytes.byteLength,
      ) as ArrayBuffer,
      headers,
      finalPath,
    );
    if (this.#cache) {
      await this.#cache.setBackendId(
        this.metadataNamespace(),
        `doc:${finalPath}`,
        created.document.id,
      );
    }
    this.#phantomFolders.delete(folderPath);
    return finalPath;
  }

  async getDocument(path: string): Promise<DocumentRecord | undefined> {
    const id = await this.#resolveDocumentId(path);
    if (!id) return undefined;
    const [metaRes, contentRes] = await Promise.all([
      this.#api.getJson<DocumentGetResponse>(`/api/documents/${id}`, path),
      this.#api.getBody(`/api/documents/${id}/content`, path),
    ]);
    if (!contentRes) return undefined;
    const bytes = await contentRes.text();
    return {
      path: metaRes.document.path,
      folderPath: getParentPath(metaRes.document.path),
      bytes,
      thumbnailDataUrl: "",
      title: metaRes.document.title ?? "",
      // `imageCount` isn't tracked server-side yet; clients that
      // need it can re-derive from `bytes` via the doc parser.
      imageCount: 0,
      blockCount: metaRes.document.blockCount ?? 0,
      createdAt: new Date(metaRes.document.createdAt).toISOString(),
      updatedAt: new Date(metaRes.document.updatedAt).toISOString(),
    };
  }

  async listDocuments(folderPath: string): Promise<DocumentRecord[]> {
    const list = await this.#listDocumentsWire(folderPath);
    if (this.#cache) {
      const ns = this.metadataNamespace();
      await Promise.all(
        list.documents.map((wire) => this.#cache!.setBackendId(ns, `doc:${wire.path}`, wire.id)),
      );
    }
    return list.documents
      .map((wire) => this.#toLightDocumentRecord(wire))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async updateDocument(path: string, updates: DocumentRecordUpdate): Promise<void> {
    const id = await this.#resolveDocumentId(path);
    if (!id) return;

    // Bytes change → PATCH /content with headers carrying the
    // updated title / blockCount in the same round-trip.
    if (updates.bytes !== undefined) {
      const bodyBytes = new TextEncoder().encode(updates.bytes);
      const headers: Record<string, string> = {
        "Content-Type": "text/html",
        "Content-Length": String(bodyBytes.byteLength),
      };
      if (updates.title !== undefined) headers["X-Annot-Title"] = updates.title;
      if (updates.blockCount !== undefined) {
        headers["X-Annot-Block-Count"] = String(updates.blockCount);
      }
      await this.#api.patchBytes(
        `/api/documents/${id}/content`,
        bodyBytes.buffer.slice(
          bodyBytes.byteOffset,
          bodyBytes.byteOffset + bodyBytes.byteLength,
        ) as ArrayBuffer,
        headers,
        path,
      );
      return;
    }

    // Metadata-only patch (title / blockCount).
    const body: Record<string, unknown> = {};
    if (updates.title !== undefined) body.title = updates.title;
    if (updates.blockCount !== undefined) body.blockCount = updates.blockCount;
    if (Object.keys(body).length > 0) {
      await this.#api.patchJson(`/api/documents/${id}`, body, path);
    }
  }

  // ── StorageWithThumbnailCache ───────────────────────────────

  thumbnailKey(path: string): string | undefined {
    if (!this.#workspaceId) return undefined;
    return `annotcloud:${this.#workspaceId}:${path}`;
  }

  thumbnailVersion(path: string): string {
    // No cheap-to-read version metadata client-side. Returning
    // `""` opts paths into the cache without an external mutation
    // signal — peer-tab updates won't auto-invalidate, but the
    // unified ThumbnailManager re-prefetches on
    // annot-thumbnail-ready dispatches and on explicit
    // `forceRefresh()` calls. This matches the documented
    // contract for stores without externally-observable
    // versioning.
    void path;
    return "";
  }

  async fetchThumbnailSource(path: string): Promise<Blob | undefined> {
    const id = await this.#resolveImageId(path);
    if (!id) return undefined;
    const res = await this.#api.getBody(`/api/images/${id}/original`, path);
    if (!res) return undefined;
    return await res.blob();
  }
}
