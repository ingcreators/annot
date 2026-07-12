/**
 * Google Drive storage provider — path-based interface.
 * Reads/writes image files to a user-selected Drive folder.
 * Annot-native captures are saved as `annot-<ts>.annot.jpg|png`;
 * images coming from outside (dropped into the folder by other tools,
 * or imported with an explicit filename) keep their original name.
 *
 * Internally maintains path↔Drive-ID maps because Drive is ID-native.
 * When two siblings share a name on Drive, the second is given a " (2)" suffix
 * in the exposed path (Drive-side name is unchanged).
 */
import type {
  DocumentRecord,
  DocumentRecordUpdate,
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  MetadataCache,
  StorageProvider,
  StorageWithDocuments,
  StorageWithInit,
  StorageWithMetadataCache,
  StorageWithResync,
  StorageWithThumbnailCache,
  StorageWithTokenRefresher,
} from "@ingcreators/annot-core/storage";
import {
  ancestorPaths,
  annotationsYamlPathFor,
  getFilename,
  getParentPath,
  joinPath,
  rewritePathPrefix,
  StorageConflictError,
  StorageNotFoundError,
  uniquifyFilename,
  validateName,
} from "@ingcreators/annot-core/storage";
import {
  defaultAnnotImageFilename,
  normalizeAnnotImageFilename,
} from "@ingcreators/annot-core/utils";
import { readEditableImage } from "@ingcreators/annot-core/xmp";
import {
  createGoogleDriveApiClient,
  type GoogleDriveApiClient,
} from "./google-drive-api-client.js";
import { buildEditableImageBlob } from "./image-encode.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** `appProperties` keys used to cache `.annot.html` document
 *  metadata on Drive. Reads are cheap (returned in `files.list`)
 *  so the gallery can show title / counts without downloading
 *  bytes. Phase 7c of `docs/plans/_done/annot-html-document.md`. */
const DOC_APP_PROP = {
  KIND: "annotDoc", // "1" marks the file as an Annot document
  TITLE: "annotDocTitle",
  BLOCKS: "annotDocBlockCount",
  IMAGES: "annotDocImageCount",
};
const DOC_EXTENSION = ".annot.html";

/**
 * Subset of the Drive v3 `files.list` resource this store reads. Only
 * the fields requested in `#listDrive`'s `fields` mask are populated;
 * everything past `id` / `name` is optional because Drive omits empty
 * values.
 */
interface DriveApiFile {
  id: string;
  name: string;
  mimeType?: string;
  createdTime?: string;
  modifiedTime?: string;
  imageMediaMetadata?: { width?: number; height?: number };
  parents?: string[];
}

export class GoogleDriveStore
  implements
    StorageProvider,
    StorageWithInit,
    StorageWithResync,
    StorageWithTokenRefresher,
    StorageWithThumbnailCache,
    StorageWithDocuments,
    StorageWithMetadataCache
{
  /** HTTP layer — owns token, refresh, error mapping. Synthesised
   *  in the constructor; tests can inject a mock via the alternate
   *  `(token, rootFolderId, apiClient)` signature. */
  #api: GoogleDriveApiClient;
  #rootFolderId: string;

  // Path ↔ Drive ID maps
  #pathToFolderId = new Map<string, string>(); // "" -> rootFolderId
  #folderIdToPath = new Map<string, string>();
  #pathToFileId = new Map<string, string>();
  #fileIdToPath = new Map<string, string>();

  // Document maps (Phase 7c). Documents are tracked in their own
  // pair so they don't bleed into `listImages` and so the
  // capability methods can resolve a document by path without
  // sniffing extensions.
  #pathToDocumentId = new Map<string, string>();
  #documentIdToPath = new Map<string, string>();
  // Cache the `appProperties`-derived document metadata so
  // `listDocuments` / `getDocument` return title + counts without
  // re-fetching. Keyed by drive file id.
  #documentMeta = new Map<
    string,
    {
      title: string;
      blockCount: number;
      imageCount: number;
      createdTime?: string;
      modifiedTime?: string;
    }
  >();

  // Track children loaded per folder (for invalidation purposes)
  #loadedFolders = new Set<string>();

  // Token refresh + dedup live inside `#api`.

  constructor(token: string, rootFolderId: string, apiClient?: GoogleDriveApiClient) {
    this.#api = apiClient ?? createGoogleDriveApiClient(token);
    this.#rootFolderId = rootFolderId;
    this.#pathToFolderId.set("", rootFolderId);
    this.#folderIdToPath.set(rootFolderId, "");
  }

  setToken(token: string): void {
    this.#api.setToken(token);
  }

  /** Register the host's token-refresh callback. The refresher is
   *  expected to try silent renewal first and fall back to a user-
   *  facing sign-in popup only when Google says it's necessary.
   *  Resolves to `null` when recovery failed for good (user
   *  dismissed the popup, no network, scope revoked) — in that case
   *  the API client lets the 401 propagate. */
  setTokenRefresher(refresher: () => Promise<string | null>): void {
    this.#api.setTokenRefresher(refresher);
  }

  // ── MetadataCache integration ────────────────────────────────
  /**
   * Host-supplied metadata cache. Replaces the bespoke per-path
   * `#recordCache` Map (Phase 10 of the shared-metadata-cache
   * plan). Drive's other bespoke in-session caches —
   * `#pathToFolderId` / `#folderIdToPath` / `#pathToFileId` /
   * `#fileIdToPath` (path↔id maps), `#fileMeta` (per-fileId Drive
   * metadata), `#documentMeta` (per-document title / counts) —
   * remain in-memory because they're keyed by Drive ID rather
   * than path, and the path↔id resolution lives on every API
   * call's hot path.
   *
   * The cache also wires:
   *
   *   - `changesPageToken` namespace meta persists the Drive
   *     Changes API resume token across sessions (Phase 6).
   *   - Cross-tab listener: peer-tab token advances drop the
   *     local in-session caches so subsequent reads re-list
   *     against the real Drive state.
   */
  #cache?: MetadataCache;
  #onNsChangedBound?: (e: Event) => void;

  metadataNamespace(): string {
    return `googledrive:${this.#rootFolderId}`;
  }

  #ns(): string {
    return this.metadataNamespace();
  }

  attachMetadataCache(cache: MetadataCache): void {
    this.#cache = cache;
    if (typeof window !== "undefined") {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<{ ns: string; key: string }>).detail;
        if (!detail) return;
        if (detail.ns !== this.metadataNamespace()) return;
        if (detail.key !== "changesPageToken") return;
        // Peer tab advanced the changes page token — its in-session
        // caches are now ahead of ours. Drop our caches so the next
        // read sees fresh Drive state.
        this.#pathToFolderId.clear();
        this.#folderIdToPath.clear();
        this.#pathToFileId.clear();
        this.#fileIdToPath.clear();
        this.#loadedFolders.clear();
        // Record cache invalidation is fire-and-forget so the
        // sync `addEventListener` callback stays sync. Errors
        // here are non-fatal.
        void this.#cacheClearRecords();
        this.#pathToFolderId.set("", this.#rootFolderId);
        this.#folderIdToPath.set(this.#rootFolderId, "");
      };
      this.#onNsChangedBound = handler;
      window.addEventListener("annot-metadata-ns-changed", handler);
    }
  }

  /**
   * One-shot startup hook — seed the Drive Changes API page token
   * on first connect so a follow-up plan can apply changes since
   * the token instead of re-listing every folder. Best-effort:
   * network failure here leaves the cache empty and the store
   * still operates against Drive directly.
   */
  async init(): Promise<void> {
    if (!this.#cache) return;
    const ns = this.metadataNamespace();
    try {
      const existing = await this.#cache.getNamespaceMeta(ns, "changesPageToken");
      if (existing) return;
      const startToken = await this.#fetchStartPageToken();
      if (startToken) {
        await this.#cache.putNamespaceMeta(ns, "changesPageToken", startToken);
      }
    } catch {
      /* best-effort */
    }
  }

  /**
   * `GET /drive/v3/changes/startPageToken` — the cheap seed call
   * the Changes API recommends running once when an app first
   * connects. Returns `null` on failure so callers can degrade
   * gracefully.
   */
  async #fetchStartPageToken(): Promise<string | null> {
    try {
      const resp = await this.#api.request(
        "https://www.googleapis.com/drive/v3/changes/startPageToken",
      );
      const body = (await resp.json()) as { startPageToken?: string };
      return body?.startPageToken ?? null;
    } catch {
      return null;
    }
  }

  async resync(): Promise<void> {
    this.#pathToFolderId.clear();
    this.#folderIdToPath.clear();
    this.#pathToFileId.clear();
    this.#fileIdToPath.clear();
    this.#loadedFolders.clear();
    await this.#cacheClearRecords();
    this.#pathToFolderId.set("", this.#rootFolderId);
    this.#folderIdToPath.set(this.#rootFolderId, "");
  }

  /**
   * Given a Drive file ID, walk its parents chain up to the user's
   * Annot root folder and return the relative path. Registers every
   * folder + file encountered along the way in the internal maps so
   * subsequent `getImage` / `listImages` calls hit the cache.
   *
   * Returns `null` if the file lives outside the Annot root. Under
   * `drive.file` the app technically has access to the file itself
   * (Drive UI granted it) but not to ancestor folders that aren't
   * in our root — we surface that case as "not in workspace" rather
   * than trying to open something the gallery UI couldn't navigate
   * back to.
   *
   * Used by the Drive UI Integration handoff route (`/handoff/googledrive`)
   * to translate a Drive-granted file ID into an editor URL.
   */
  async resolveFileIdToPath(fileId: string): Promise<string | null> {
    // Fetch name + parents for the target file first.
    const fileResp = await this.#fetch(
      `${DRIVE_API}/files/${fileId}?fields=id,name,parents,mimeType,createdTime`,
    );
    const file = await fileResp.json();
    if (!file?.name || !Array.isArray(file.parents) || file.parents.length === 0) return null;

    // Walk up the parents chain from the file toward the root. Each
    // step fetches the parent's metadata if we haven't cached it.
    // We stop when we reach the root or leave Annot's scope.
    const chain: { id: string; name: string }[] = [];
    let currentParentId: string | undefined = file.parents[0];
    const MAX_DEPTH = 64; // generous cap against pathological loops
    let step = 0;
    while (currentParentId && step < MAX_DEPTH) {
      if (currentParentId === this.#rootFolderId) break;
      if (this.#folderIdToPath.has(currentParentId)) {
        // We already know this ancestor's path; prepend it and stop walking.
        const knownPath = this.#folderIdToPath.get(currentParentId)!;
        // Rebuild ancestor chain from the known path so the caller's
        // result path is complete.
        if (knownPath) {
          const segments = knownPath.split("/");
          let acc = "";
          for (const seg of segments) {
            acc = acc ? `${acc}/${seg}` : seg;
            const id = this.#pathToFolderId.get(acc);
            if (id) chain.unshift({ id, name: seg });
          }
        }
        currentParentId = undefined;
        break;
      }
      const parentResp = await this.#fetch(
        `${DRIVE_API}/files/${currentParentId}?fields=id,name,parents`,
      );
      const parent = await parentResp.json();
      if (!parent?.name) return null;
      chain.unshift({ id: parent.id, name: parent.name });
      currentParentId = Array.isArray(parent.parents) && parent.parents[0];
      step += 1;
    }
    if (step >= MAX_DEPTH) return null;
    // If we exited the loop without hitting the root, the file is
    // outside Annot's scope.
    if (currentParentId !== undefined && currentParentId !== this.#rootFolderId) return null;

    // Register every folder we learned about, building paths as we go.
    let folderPath = "";
    for (const node of chain) {
      const nextPath = folderPath ? `${folderPath}/${node.name}` : node.name;
      if (!this.#pathToFolderId.has(nextPath)) {
        this.#pathToFolderId.set(nextPath, node.id);
        this.#folderIdToPath.set(node.id, nextPath);
      }
      folderPath = nextPath;
    }
    const filePath = folderPath ? `${folderPath}/${file.name}` : file.name;
    this.#pathToFileId.set(filePath, file.id);
    this.#fileIdToPath.set(file.id, filePath);
    if (file.createdTime) {
      this.#fileMeta.set(file.id, {
        id: file.id,
        name: file.name,
        createdTime: file.createdTime,
      });
    }
    return filePath;
  }

  // ---- Drive API helpers ----

  /** Thin alias keeping every call site short and readable. The
   *  actual fetch / 401-retry / error-mapping logic lives in
   *  `GoogleDriveApiClient` (see `./google-drive-api-client.ts`). */
  #fetch(url: string, init?: RequestInit): Promise<Response> {
    return this.#api.request(url, init);
  }

  async #listDrive(
    query: string,
    fields = "files(id,name,mimeType,createdTime,modifiedTime,imageMediaMetadata,parents)",
  ): Promise<DriveApiFile[]> {
    const q = encodeURIComponent(query);
    const f = encodeURIComponent(fields);
    const resp = await this.#fetch(
      `${DRIVE_API}/files?q=${q}&fields=${f}&orderBy=createdTime desc&pageSize=200`,
    );
    const data = await resp.json();
    return data.files || [];
  }

  // ---- Path resolution ----

  /** Ensure the path's Drive ID is cached. Walks from nearest cached ancestor. */
  async #resolveFolderId(path: string): Promise<string | undefined> {
    if (this.#pathToFolderId.has(path)) return this.#pathToFolderId.get(path);
    if (!path) return this.#rootFolderId;

    // Find nearest ancestor that's cached
    const parts = path.split("/");
    let acc = "";
    let startIdx = 0;
    for (let i = 0; i < parts.length; i++) {
      // Loop bound matches `parts.length`; `parts[i]` is always defined.
      const candidate = acc ? `${acc}/${parts[i]}` : parts[i]!;
      if (this.#pathToFolderId.has(candidate)) {
        acc = candidate;
        startIdx = i + 1;
      } else {
        break;
      }
    }

    // Walk remaining segments
    for (let i = startIdx; i < parts.length; i++) {
      const parentId = this.#pathToFolderId.get(acc)!;
      const children = await this.#listDrive(
        `'${parentId}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
        "files(id,name)",
      );
      // Register all children with uniquified paths
      this.#registerFolderChildren(acc, children);
      acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
      if (!this.#pathToFolderId.has(acc)) return undefined;
    }
    return this.#pathToFolderId.get(path);
  }

  /** Populate cache for all children of `parentPath` from API results. */
  #registerFolderChildren(parentPath: string, driveChildren: { id: string; name: string }[]): void {
    const used = new Set<string>();
    // First pass: collect existing cached names (to avoid recollision)
    for (const [p] of this.#pathToFolderId) {
      if (getParentPath(p) === parentPath && p) used.add(getFilename(p));
    }
    for (const child of driveChildren) {
      if (this.#folderIdToPath.has(child.id)) continue;
      const name = uniquifyFilename(child.name, (c) => used.has(c));
      used.add(name);
      const childPath = joinPath(parentPath, name);
      this.#pathToFolderId.set(childPath, child.id);
      this.#folderIdToPath.set(child.id, childPath);
    }
  }

  #registerFileChildren(
    parentPath: string,
    driveChildren: { id: string; name: string; appProperties?: Record<string, string> }[],
  ): void {
    const used = new Set<string>();
    for (const [p] of this.#pathToFileId) {
      if (getParentPath(p) === parentPath) used.add(getFilename(p));
    }
    for (const [p] of this.#pathToDocumentId) {
      if (getParentPath(p) === parentPath) used.add(getFilename(p));
    }
    for (const child of driveChildren) {
      if (this.#fileIdToPath.has(child.id) || this.#documentIdToPath.has(child.id)) continue;
      const name = uniquifyFilename(child.name, (c) => used.has(c));
      used.add(name);
      const childPath = joinPath(parentPath, name);
      // Phase 7c — discriminate documents from images by file
      // extension OR explicit `appProperties.annotDoc === "1"`
      // marker (so renamed-without-extension files still route
      // correctly when they were created by Annot).
      const props = child.appProperties || {};
      const looksLikeDoc =
        name.toLowerCase().endsWith(DOC_EXTENSION) || props[DOC_APP_PROP.KIND] === "1";
      if (looksLikeDoc) {
        this.#pathToDocumentId.set(childPath, child.id);
        this.#documentIdToPath.set(child.id, childPath);
        this.#documentMeta.set(child.id, {
          title: props[DOC_APP_PROP.TITLE] || stripDocExtension(name),
          blockCount: Number.parseInt(props[DOC_APP_PROP.BLOCKS] || "0", 10) || 0,
          imageCount: Number.parseInt(props[DOC_APP_PROP.IMAGES] || "0", 10) || 0,
        });
      } else {
        this.#pathToFileId.set(childPath, child.id);
        this.#fileIdToPath.set(child.id, childPath);
      }
    }
  }

  // ---- Images ----

  async saveImage(data: Omit<ImageRecord, "path">, opts?: { filename?: string }): Promise<string> {
    const folderPath = data.folderPath || "";
    const parentId = await this.#resolveFolderId(folderPath);
    if (!parentId) throw new Error(`Folder not found: ${folderPath}`);

    const isJpeg = data.originalDataUrl.startsWith("data:image/jpeg");
    const desired = opts?.filename
      ? normalizeAnnotImageFilename(opts.filename)
      : defaultAnnotImageFilename(data.originalDataUrl);
    validateName(desired);

    // Uniquify against current cache + live siblings
    await this.#ensureFolderListed(folderPath);
    const existingNames = new Set<string>();
    for (const [p] of this.#pathToFileId) {
      if (getParentPath(p) === folderPath) existingNames.add(getFilename(p));
    }
    const filename = uniquifyFilename(desired, (c) => existingNames.has(c));
    const path = joinPath(folderPath, filename);

    const blob = await this.#buildXmpBlob(
      {
        originalDataUrl: data.originalDataUrl,
        annotationsSvg: data.annotationsSvg,
        width: data.width,
        height: data.height,
        tags: data.tags,
      },
      isJpeg ? "jpg" : "png",
    );
    const driveId = await this.#uploadFile(filename, blob, parentId);
    this.#pathToFileId.set(path, driveId);
    this.#fileIdToPath.set(driveId, path);
    // Seed the record cache so the first edit on a freshly saved
    // image doesn't have to round-trip to Drive for the original
    // data. Thumbnail bytes are owned by the unified
    // `ThumbnailManager` (the host calls `tm.write(provider, path,
    // …)` in the save flow); we leave `thumbnailDataUrl` empty
    // here — the gallery hydrates from the manager separately.
    const now = new Date().toISOString();
    await this.#cachePutRecord(path, {
      path,
      folderPath,
      originalDataUrl: data.originalDataUrl,
      thumbnailDataUrl: data.thumbnailDataUrl || "",
      annotationsSvg: data.annotationsSvg || "",
      width: data.width,
      height: data.height,
      sourceUrl: data.sourceUrl || "",
      tags: data.tags || {},
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
    });
    return path;
  }

  async #ensureFolderListed(folderPath: string): Promise<void> {
    if (this.#loadedFolders.has(folderPath)) return;
    const parentId = await this.#resolveFolderId(folderPath);
    if (!parentId) return;
    const children = await this.#listDrive(
      `'${parentId}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
      "files(id,name,createdTime,modifiedTime,imageMediaMetadata,appProperties)",
    );
    this.#registerFileChildren(folderPath, children);
    // Cache per-file metadata (createdTime / modifiedTime /
    // imageMediaMetadata.width|height) in a side map so
    // `listImages`, `thumbnailVersion`, and the gallery's
    // dimension hydration can read it without an extra fetch.
    // For documents (Phase 7c), also populate `#documentMeta`'s
    // mtime/createdTime fields so listDocuments has accurate
    // updatedAt without an extra fetch.
    for (const f of children) {
      this.#fileMeta.set(f.id, f);
      const docMeta = this.#documentMeta.get(f.id);
      if (docMeta) {
        docMeta.createdTime = f.createdTime;
        docMeta.modifiedTime = f.modifiedTime;
      }
    }
    this.#loadedFolders.add(folderPath);
  }

  #fileMeta = new Map<string, DriveApiFile>();

  /**
   * Per-path `ImageRecord` cache. Crucial for edit-loop
   * performance: `updateImage` internally calls `getImage` to pull
   * the immutable original image data, and without this cache
   * every annotation save would round-trip the Drive download
   * endpoint before re-uploading.
   *
   * Phase 10 of the shared-metadata-cache plan migrated this off
   * a bespoke in-memory Map onto the shared `MetadataCache`.
   * Version is the constant `RECORD_VERSION` — Drive's per-file
   * `modifiedTime` would let us version-gate properly, but it's
   * keyed by Drive ID in `#fileMeta` and isn't always populated
   * by the time we cache (e.g. fresh saves write the record
   * before the upload response with `modifiedTime` returns). The
   * constant-version model mirrors the old `Map`-keyed shape:
   * cache hits invalidate explicitly via the mutation paths
   * below; cross-tab broadcasts also invalidate per the IDB
   * cache's standard pattern.
   */
  static readonly #RECORD_VERSION = "v1";

  /** Read a cached `ImageRecord` by path. Returns `undefined` when
   *  no cache is attached (no-op fallback) or the cache misses. */
  async #cacheGetRecord(path: string): Promise<ImageRecord | undefined> {
    if (!this.#cache) return undefined;
    return await this.#cache.getImage(this.#ns(), path, GoogleDriveStore.#RECORD_VERSION);
  }

  /** Write an `ImageRecord` to the cache, no-op when not attached. */
  async #cachePutRecord(path: string, record: ImageRecord): Promise<void> {
    if (!this.#cache) return;
    await this.#cache.putImage(this.#ns(), path, GoogleDriveStore.#RECORD_VERSION, record);
  }

  /** Drop a cached record at `path`. */
  async #cachePurgeRecord(path: string): Promise<void> {
    if (!this.#cache) return;
    await this.#cache.invalidatePath(this.#ns(), path);
  }

  /** Rename a cached entry under a path change. The transform
   *  callback rewrites `.path` / `.folderPath` on the value so the
   *  cached record stays consistent with its new key. */
  async #cacheMigrateRecord(
    oldPath: string,
    newPath: string,
    transformRecord?: (rec: ImageRecord) => ImageRecord,
  ): Promise<void> {
    if (!this.#cache) return;
    await this.#cache.migrateEntry(this.#ns(), oldPath, newPath);
    if (!transformRecord) return;
    const moved = await this.#cache.getImage(this.#ns(), newPath, GoogleDriveStore.#RECORD_VERSION);
    if (moved) {
      await this.#cache.putImage(
        this.#ns(),
        newPath,
        GoogleDriveStore.#RECORD_VERSION,
        transformRecord(moved),
      );
    }
  }

  /** Bulk-rewrite cached entries under `oldPrefix` to live under
   *  `newPrefix` (folder rename / move). After the migrate, walk
   *  the in-session path↔id map to find every key under the new
   *  prefix and rewrite the in-record `path` / `folderPath`. */
  async #cacheRewriteRecordPrefix(
    oldPrefix: string,
    newPrefix: string,
    transformRecord?: (rec: ImageRecord, newPath: string) => ImageRecord,
  ): Promise<void> {
    if (!this.#cache) return;
    await this.#cache.rewriteEntriesForPrefix(this.#ns(), oldPrefix, newPrefix);
    if (!transformRecord) return;
    for (const path of this.#pathToFileId.keys()) {
      if (path !== newPrefix && !path.startsWith(`${newPrefix}/`)) continue;
      const rec = await this.#cache.getImage(this.#ns(), path, GoogleDriveStore.#RECORD_VERSION);
      if (rec) {
        await this.#cache.putImage(
          this.#ns(),
          path,
          GoogleDriveStore.#RECORD_VERSION,
          transformRecord(rec, path),
        );
      }
    }
  }

  /** Drop every cached record in this namespace. Used by
   *  `resync()` / `forceRefresh()`. */
  async #cacheClearRecords(): Promise<void> {
    if (!this.#cache) return;
    await this.#cache.invalidatePrefix(`${this.#ns()}:`);
  }

  async getImage(path: string): Promise<ImageRecord | undefined> {
    const cached = await this.#cacheGetRecord(path);
    if (cached) return cached;

    const folderPath = getParentPath(path);
    await this.#ensureFolderListed(folderPath);
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) return undefined;

    try {
      const metaResp = await this.#fetch(
        `${DRIVE_API}/files/${driveId}?fields=id,name,createdTime,parents`,
      );
      const meta = await metaResp.json();

      const binResp = await this.#fetch(`${DRIVE_API}/files/${driveId}?alt=media`);
      const arrayBuf = await binResp.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);

      const xmp = readEditableImage(bytes);
      const dataUrl = xmp?.originalImageDataUrl || (await this.#blobToDataUrl(new Blob([bytes])));

      // Thumbnail bytes for the gallery are now owned by the
      // unified `ThumbnailManager` — the gallery's
      // `ThumbnailManager.attach` call hydrates them separately
      // via `fetchThumbnailSource`. The editor doesn't need a
      // thumbnail on the in-flight `ImageRecord`, so we leave
      // the field empty.
      const record: ImageRecord = {
        path,
        folderPath,
        originalDataUrl: dataUrl,
        thumbnailDataUrl: "",
        annotationsSvg: xmp?.annotationsSvg || "",
        width: xmp?.width || 0,
        height: xmp?.height || 0,
        sourceUrl: "",
        tags: xmp?.tags || {},
        createdAt: meta.createdTime || "",
        updatedAt: meta.createdTime || "",
      };
      await this.#cachePutRecord(path, record);
      return record;
    } catch {
      return undefined;
    }
  }

  async listImages(folderPath: string): Promise<ImageRecord[]> {
    await this.#ensureFolderListed(folderPath);
    const results: ImageRecord[] = [];
    for (const [path] of this.#pathToFileId) {
      if (getParentPath(path) !== folderPath) continue;
      const driveId = this.#pathToFileId.get(path)!;
      const m: Partial<DriveApiFile> = this.#fileMeta.get(driveId) ?? {};
      // Thumbnail bytes are owned by the unified
      // `ThumbnailManager`. The gallery calls `tm.attach` after
      // this returns and fills `thumbnailDataUrl` from the cache
      // (or schedules a prefetch on miss). Dimensions come from
      // Drive's `imageMediaMetadata` so the gallery's
      // `WxH • date` line lights up immediately even before any
      // thumbnail prefetch completes.
      const imd = m.imageMediaMetadata || {};
      results.push({
        path,
        folderPath,
        originalDataUrl: "",
        thumbnailDataUrl: "",
        annotationsSvg: "",
        width: imd.width || 0,
        height: imd.height || 0,
        sourceUrl: "",
        tags: {},
        createdAt: m.createdTime || "",
        updatedAt: m.createdTime || "",
      });
    }
    results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return results;
  }

  // ── StorageWithThumbnailCache ────────────────────────────────

  /**
   * Stable per-image identifier for the unified thumbnail cache.
   * Drive IDs are stable across resyncs (they don't change with
   * filename collision suffixes the way exposed paths do) and
   * unique within Drive itself, so the
   * `googledrive:<rootFolderId>:<driveId>` shape survives every
   * mutation that doesn't actually delete-and-recreate the file.
   */
  thumbnailKey(path: string): string | undefined {
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) return undefined;
    return `googledrive:${this.#rootFolderId}:${driveId}`;
  }

  /**
   * Drive's `modifiedTime` advances whenever the file's bytes
   * change. We pull it from `#fileMeta` (populated by
   * `#ensureFolderListed`'s `files.list` field set). Empty when
   * the file hasn't been listed yet — the manager treats `""`
   * as a constant version, which means the first listing's
   * thumbnail is cached forever until external mutation lands;
   * once the user opens the gallery again after an external
   * edit, `resync` repopulates `#fileMeta` and the new
   * `modifiedTime` evicts the stale entry.
   */
  thumbnailVersion(path: string): string {
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) return "";
    return this.#fileMeta.get(driveId)?.modifiedTime || "";
  }

  /**
   * Stream the file's bytes via `alt=media`. The manager runs
   * `generateThumbnailFromBlob` on the result; we don't go
   * through the full `getImage` decode because the manager
   * doesn't need `originalDataUrl` / `annotationsSvg`.
   */
  async fetchThumbnailSource(path: string): Promise<Blob | undefined> {
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) return undefined;
    try {
      const resp = await this.#fetch(`${DRIVE_API}/files/${driveId}?alt=media`);
      const arrayBuf = await resp.arrayBuffer();
      return new Blob([new Uint8Array(arrayBuf)]);
    } catch {
      return undefined;
    }
  }

  async updateImage(path: string, updates: ImageRecordUpdate): Promise<void> {
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) return;

    // `updates.thumbnailDataUrl` is intentionally NOT handled here.
    // Thumbnails are owned by the unified `ThumbnailManager` —
    // callers seed it via `tm.write(provider, path, dataUrl, dims)`,
    // which dispatches the `annot-thumbnail-ready` event the
    // gallery listens for. Phase 5 of the unified-thumbnail-cache
    // plan removes the field from `ImageRecordUpdate` entirely.

    // Rewrite file if annotations / tags / underlying bitmap changed.
    // `originalDataUrl` carries the new bitmap when the redact-burn
    // path explicitly mutates the base image (see
    // `_done/redact-burn-into-image.md`); without it in the gate
    // condition, a bitmap-only update would skip the upload and
    // the new bytes never reach Drive.
    if (
      updates.annotationsSvg !== undefined ||
      updates.tags !== undefined ||
      updates.originalDataUrl !== undefined ||
      updates.width !== undefined ||
      updates.height !== undefined
    ) {
      const record = await this.getImage(path);
      if (!record?.originalDataUrl) return;

      const annotationsSvg = updates.annotationsSvg ?? record.annotationsSvg;
      const tags = updates.tags ?? record.tags;
      const originalDataUrl = updates.originalDataUrl ?? record.originalDataUrl;
      const width = updates.width ?? record.width;
      const height = updates.height ?? record.height;
      const isJpeg = originalDataUrl.startsWith("data:image/jpeg");

      const blob = await this.#buildXmpBlob(
        { ...record, annotationsSvg, tags, originalDataUrl, width, height },
        isJpeg ? "jpg" : "png",
      );

      await this.#fetch(`${UPLOAD_API}/files/${driveId}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": blob.type },
        body: blob,
      });

      // Keep the cached record coherent so the next edit doesn't
      // pull a pre-edit version from the cache.
      await this.#cachePutRecord(path, {
        ...record,
        annotationsSvg,
        tags,
        originalDataUrl,
        width,
        height,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async moveImage(path: string, newFolderPath: string): Promise<string> {
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) throw new StorageNotFoundError(path, `Image not found: ${path}`);
    if (newFolderPath === getParentPath(path)) return path;

    const newParentId = await this.#resolveFolderId(newFolderPath);
    if (!newParentId) throw new Error(`Folder not found: ${newFolderPath}`);

    // Remove from old parent
    const metaResp = await this.#fetch(`${DRIVE_API}/files/${driveId}?fields=parents`);
    const metaData = await metaResp.json();
    const oldParents = (metaData.parents || []).join(",");
    await this.#fetch(
      `${DRIVE_API}/files/${driveId}?addParents=${newParentId}&removeParents=${oldParents}`,
      { method: "PATCH" },
    );

    // Update local cache
    const newPath = joinPath(newFolderPath, getFilename(path));
    this.#pathToFileId.delete(path);
    this.#pathToFileId.set(newPath, driveId);
    this.#fileIdToPath.set(driveId, newPath);
    await this.#cacheMigrateRecord(path, newPath, (rec) => ({
      ...rec,
      path: newPath,
      folderPath: newFolderPath,
    }));
    return newPath;
  }

  async renameImage(path: string, newName: string): Promise<string> {
    validateName(newName);
    const driveId = this.#pathToFileId.get(path);
    if (!driveId) throw new StorageNotFoundError(path, `Image not found: ${path}`);
    const folderPath = getParentPath(path);
    const newPath = joinPath(folderPath, newName);
    if (newPath === path) return path;
    if (this.#pathToFileId.has(newPath)) {
      throw new StorageConflictError(newPath, `Image already exists: ${newPath}`);
    }

    await this.#fetch(`${DRIVE_API}/files/${driveId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    this.#pathToFileId.delete(path);
    this.#pathToFileId.set(newPath, driveId);
    this.#fileIdToPath.set(driveId, newPath);
    await this.#cacheMigrateRecord(path, newPath, (rec) => ({
      ...rec,
      path: newPath,
    }));
    return newPath;
  }

  async deleteImage(path: string): Promise<void> {
    // Phase 7c — `deleteImage` is the path-keyed delete primitive
    // per the `StorageWithDocuments` contract. Routes to whichever
    // map holds the path; documents and images share Drive's
    // `files.delete` endpoint.
    const imageId = this.#pathToFileId.get(path);
    const docId = this.#pathToDocumentId.get(path);
    const driveId = imageId ?? docId;
    if (!driveId) return;
    await this.#fetch(`${DRIVE_API}/files/${driveId}`, { method: "DELETE" });
    if (imageId) {
      this.#pathToFileId.delete(path);
      this.#fileIdToPath.delete(imageId);
      this.#fileMeta.delete(imageId);
      await this.#cachePurgeRecord(path);
    }
    if (docId) {
      this.#pathToDocumentId.delete(path);
      this.#documentIdToPath.delete(docId);
      this.#documentMeta.delete(docId);
      this.#fileMeta.delete(docId);
    }
    // Thumbnail entry in the unified cache becomes orphan; the
    // host's `ThumbnailManager.invalidatePrefix` is the right
    // call site if a caller wants to free space immediately, but
    // the LRU sweep will reclaim it eventually. Skipping it here
    // keeps the store free of any reference to the cache layer.
  }

  // ---- Documents (Phase 7c) ─────────────────────────────────
  // `.annot.html` files upload as `text/html`. Cached metadata
  // (title / blockCount / imageCount) lives in Drive's
  // `appProperties` so `listDocuments` returns full listing rows
  // without downloading bytes.

  async saveDocument(
    data: Omit<DocumentRecord, "path">,
    opts?: { filename?: string },
  ): Promise<string> {
    const folderPath = data.folderPath || "";
    const parentId = await this.#resolveFolderId(folderPath);
    if (!parentId) throw new Error(`Folder not found: ${folderPath}`);

    const desired = opts?.filename || `document-${Date.now()}.annot.html`;
    validateName(desired);

    await this.#ensureFolderListed(folderPath);
    const existingNames = new Set<string>();
    for (const [p] of this.#pathToFileId) {
      if (getParentPath(p) === folderPath) existingNames.add(getFilename(p));
    }
    for (const [p] of this.#pathToDocumentId) {
      if (getParentPath(p) === folderPath) existingNames.add(getFilename(p));
    }
    const filename = uniquifyFilename(desired, (c) => existingNames.has(c));
    const path = joinPath(folderPath, filename);

    const blob = new Blob([data.bytes], { type: "text/html" });
    const driveId = await this.#uploadFile(filename, blob, parentId, {
      [DOC_APP_PROP.KIND]: "1",
      [DOC_APP_PROP.TITLE]: data.title,
      [DOC_APP_PROP.BLOCKS]: String(data.blockCount),
      [DOC_APP_PROP.IMAGES]: String(data.imageCount),
    });
    this.#pathToDocumentId.set(path, driveId);
    this.#documentIdToPath.set(driveId, path);
    const now = new Date().toISOString();
    this.#documentMeta.set(driveId, {
      title: data.title,
      blockCount: data.blockCount,
      imageCount: data.imageCount,
      createdTime: data.createdAt || now,
      modifiedTime: data.updatedAt || now,
    });
    return path;
  }

  async getDocument(path: string): Promise<DocumentRecord | undefined> {
    const folderPath = getParentPath(path);
    await this.#ensureFolderListed(folderPath);
    const driveId = this.#pathToDocumentId.get(path);
    if (!driveId) return undefined;
    const meta = this.#documentMeta.get(driveId) ?? {
      title: stripDocExtension(getFilename(path)),
      blockCount: 0,
      imageCount: 0,
    };
    let bytes: string;
    try {
      const resp = await this.#fetch(`${DRIVE_API}/files/${driveId}?alt=media`);
      bytes = await resp.text();
    } catch {
      return undefined;
    }
    return {
      path,
      folderPath,
      bytes,
      thumbnailDataUrl: "",
      title: meta.title,
      imageCount: meta.imageCount,
      blockCount: meta.blockCount,
      createdAt: meta.createdTime || "",
      updatedAt: meta.modifiedTime || meta.createdTime || "",
    };
  }

  async listDocuments(folderPath: string): Promise<DocumentRecord[]> {
    await this.#ensureFolderListed(folderPath);
    const out: DocumentRecord[] = [];
    for (const [path, driveId] of this.#pathToDocumentId) {
      if (getParentPath(path) !== folderPath) continue;
      const meta = this.#documentMeta.get(driveId) ?? {
        title: stripDocExtension(getFilename(path)),
        blockCount: 0,
        imageCount: 0,
      };
      out.push({
        path,
        folderPath,
        bytes: "",
        thumbnailDataUrl: "",
        title: meta.title,
        imageCount: meta.imageCount,
        blockCount: meta.blockCount,
        createdAt: meta.createdTime || "",
        updatedAt: meta.modifiedTime || meta.createdTime || "",
      });
    }
    out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return out;
  }

  async updateDocument(path: string, updates: DocumentRecordUpdate): Promise<void> {
    const driveId = this.#pathToDocumentId.get(path);
    if (!driveId) return;
    const meta = this.#documentMeta.get(driveId) ?? {
      title: stripDocExtension(getFilename(path)),
      blockCount: 0,
      imageCount: 0,
    };
    if (updates.bytes !== undefined) {
      const blob = new Blob([updates.bytes], { type: "text/html" });
      // Upload-API media replace; same endpoint shape as
      // `updateImage` uses for re-encoding the bitmap.
      await this.#fetch(`${UPLOAD_API}/files/${driveId}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": "text/html" },
        body: await blob.arrayBuffer(),
      });
    }
    if (updates.title !== undefined) meta.title = updates.title;
    if (updates.blockCount !== undefined) meta.blockCount = updates.blockCount;
    if (updates.imageCount !== undefined) meta.imageCount = updates.imageCount;
    // Push the latest cached metadata into Drive's appProperties
    // so a fresh `files.list` (after resync / new session)
    // surfaces it without a getDocument round-trip. Drive
    // `appProperties` are scoped to our OAuth client; setting them
    // doesn't conflict with other apps that might be inspecting
    // the same files.
    if (
      updates.title !== undefined ||
      updates.blockCount !== undefined ||
      updates.imageCount !== undefined
    ) {
      await this.#fetch(`${DRIVE_API}/files/${driveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appProperties: {
            [DOC_APP_PROP.TITLE]: meta.title,
            [DOC_APP_PROP.BLOCKS]: String(meta.blockCount),
            [DOC_APP_PROP.IMAGES]: String(meta.imageCount),
          },
        }),
      });
    }
    meta.modifiedTime = new Date().toISOString();
    this.#documentMeta.set(driveId, meta);
  }

  // ---- Annotations YAML sidecar (Phase 4a) ─────────────────────
  // Sidecars are auxiliary files (not images, not documents), so
  // they don't participate in the existing path→ID maps. Lookups
  // happen on demand via `files.list` keyed on the sidecar's
  // canonical name within the PNG's parent folder.

  async getAnnotationsYaml(pngPath: string): Promise<string | undefined> {
    const sidecarPath = annotationsYamlPathFor(pngPath);
    const folderPath = getParentPath(sidecarPath);
    const sidecarName = getFilename(sidecarPath);
    const parentId = await this.#resolveFolderId(folderPath);
    if (!parentId) return undefined;
    const driveId = await this.#findChildIdByName(parentId, sidecarName);
    if (!driveId) return undefined;
    try {
      const resp = await this.#fetch(`${DRIVE_API}/files/${driveId}?alt=media`);
      return await resp.text();
    } catch {
      return undefined;
    }
  }

  async setAnnotationsYaml(pngPath: string, content: string): Promise<void> {
    const sidecarPath = annotationsYamlPathFor(pngPath);
    const folderPath = getParentPath(sidecarPath);
    const sidecarName = getFilename(sidecarPath);
    const parentId = await this.#resolveFolderId(folderPath);
    if (!parentId) throw new Error(`Folder not found: ${folderPath}`);
    const existingId = await this.#findChildIdByName(parentId, sidecarName);
    const blob = new Blob([content], { type: "text/yaml" });
    if (existingId) {
      // Replace contents in place via the upload API.
      await this.#fetch(`${UPLOAD_API}/files/${existingId}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": "text/yaml" },
        body: await blob.arrayBuffer(),
      });
    } else {
      await this.#uploadFile(sidecarName, blob, parentId);
    }
  }

  /** Look up a Drive file by exact name within a parent folder. */
  async #findChildIdByName(parentId: string, name: string): Promise<string | undefined> {
    const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const files = await this.#listDrive(
      `'${parentId}' in parents and name = '${escaped}' and trashed = false`,
      "files(id,name)",
    );
    return files[0]?.id;
  }

  // ---- Folders ----

  async createFolder(parentPath: string, name: string): Promise<string> {
    validateName(name);
    const parentId = await this.#resolveFolderId(parentPath);
    if (!parentId) throw new Error(`Parent folder not found: ${parentPath}`);

    const fullPath = joinPath(parentPath, name);
    if (this.#pathToFolderId.has(fullPath)) {
      throw new StorageConflictError(fullPath, `Folder already exists: ${fullPath}`);
    }

    const resp = await this.#fetch(`${DRIVE_API}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    const data = await resp.json();
    this.#pathToFolderId.set(fullPath, data.id);
    this.#folderIdToPath.set(data.id, fullPath);
    return fullPath;
  }

  async listFolders(parentPath: string): Promise<FolderRecord[]> {
    const parentId = await this.#resolveFolderId(parentPath);
    if (!parentId) return [];
    const children = await this.#listDrive(
      `'${parentId}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
      "files(id,name,createdTime)",
    );
    this.#registerFolderChildren(parentPath, children);
    const results: FolderRecord[] = children.map((f: DriveApiFile) => {
      const path = this.#folderIdToPath.get(f.id)!;
      return {
        path,
        parentPath,
        name: getFilename(path),
        createdAt: f.createdTime || "",
      };
    });
    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  async getFolder(path: string): Promise<FolderRecord | undefined> {
    if (!path) return undefined;
    const driveId = await this.#resolveFolderId(path);
    if (!driveId) return undefined;
    return {
      path,
      parentPath: getParentPath(path),
      name: getFilename(path),
      createdAt: "",
    };
  }

  async renameFolder(path: string, newName: string): Promise<string> {
    validateName(newName);
    const driveId = this.#pathToFolderId.get(path);
    if (!driveId) throw new StorageNotFoundError(path, `Folder not found: ${path}`);
    const parentPath = getParentPath(path);
    const newPath = joinPath(parentPath, newName);
    if (newPath === path) return path;
    if (this.#pathToFolderId.has(newPath)) {
      throw new StorageConflictError(newPath, `Folder already exists: ${newPath}`);
    }

    await this.#fetch(`${DRIVE_API}/files/${driveId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    await this.#rewriteDescendantPaths(path, newPath);
    return newPath;
  }

  async moveFolder(path: string, newParentPath: string): Promise<string> {
    const driveId = this.#pathToFolderId.get(path);
    if (!driveId) throw new StorageNotFoundError(path, `Folder not found: ${path}`);
    const newParentId = await this.#resolveFolderId(newParentPath);
    if (!newParentId) throw new Error(`Parent folder not found: ${newParentPath}`);

    const newPath = joinPath(newParentPath, getFilename(path));
    if (newPath === path) return path;
    if (this.#pathToFolderId.has(newPath)) {
      throw new StorageConflictError(newPath, `Folder already exists: ${newPath}`);
    }

    // Get current parents
    const metaResp = await this.#fetch(`${DRIVE_API}/files/${driveId}?fields=parents`);
    const metaData = await metaResp.json();
    const oldParents = (metaData.parents || []).join(",");
    await this.#fetch(
      `${DRIVE_API}/files/${driveId}?addParents=${newParentId}&removeParents=${oldParents}`,
      { method: "PATCH" },
    );
    await this.#rewriteDescendantPaths(path, newPath);
    return newPath;
  }

  async #rewriteDescendantPaths(oldPath: string, newPath: string): Promise<void> {
    // Rewrite folder entries
    const folderEntries = Array.from(this.#pathToFolderId.entries());
    for (const [p, driveId] of folderEntries) {
      if (p === oldPath || p.startsWith(`${oldPath}/`)) {
        const np = rewritePathPrefix(p, oldPath, newPath);
        this.#pathToFolderId.delete(p);
        this.#pathToFolderId.set(np, driveId);
        this.#folderIdToPath.set(driveId, np);
      }
    }
    // Rewrite file entries
    const fileEntries = Array.from(this.#pathToFileId.entries());
    for (const [p, driveId] of fileEntries) {
      if (p === oldPath || p.startsWith(`${oldPath}/`)) {
        const np = rewritePathPrefix(p, oldPath, newPath);
        this.#pathToFileId.delete(p);
        this.#pathToFileId.set(np, driveId);
        this.#fileIdToPath.set(driveId, np);
      }
    }
    // Rewrite record cache entries (same prefix migration) — the
    // shared MetadataCache handles the key transfer atomically;
    // the transform callback updates `path` / `folderPath` on
    // each moved record so the cached value stays consistent
    // with its new key.
    await this.#cacheRewriteRecordPrefix(oldPath, newPath, (rec, np) => ({
      ...rec,
      path: np,
      folderPath: getParentPath(np),
    }));
    // Rewrite loaded folders set
    const loaded = Array.from(this.#loadedFolders);
    this.#loadedFolders.clear();
    for (const p of loaded) {
      this.#loadedFolders.add(rewritePathPrefix(p, oldPath, newPath));
    }
  }

  async deleteFolder(path: string): Promise<void> {
    if (!path) return;
    const driveId = this.#pathToFolderId.get(path);
    if (!driveId) return;
    // Drive delete with folder deletes contents recursively
    await this.#fetch(`${DRIVE_API}/files/${driveId}`, { method: "DELETE" });
    // Clean up cache
    for (const [p] of Array.from(this.#pathToFolderId)) {
      if (p === path || p.startsWith(`${path}/`)) {
        const id = this.#pathToFolderId.get(p)!;
        this.#pathToFolderId.delete(p);
        this.#folderIdToPath.delete(id);
      }
    }
    for (const [p] of Array.from(this.#pathToFileId)) {
      if (p === path || p.startsWith(`${path}/`)) {
        const id = this.#pathToFileId.get(p)!;
        this.#pathToFileId.delete(p);
        this.#fileIdToPath.delete(id);
        this.#fileMeta.delete(id);
      }
    }
    // Drop every cached record under this folder's prefix in one
    // namespace-scoped call.
    if (this.#cache) {
      await this.#cache.invalidatePrefix(`${this.#ns()}:${path}`);
    }
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

  async #uploadFile(
    filename: string,
    blob: Blob,
    parentId: string,
    appProperties?: Record<string, string>,
  ): Promise<string> {
    const metaPayload: Record<string, unknown> = { name: filename, parents: [parentId] };
    if (appProperties) metaPayload.appProperties = appProperties;
    const metadata = JSON.stringify(metaPayload);
    const boundary = `annot_boundary_${Date.now()}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${blob.type}\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
    const footer = `\r\n--${boundary}--`;
    // Use FileReader.readAsDataURL to base64-encode the blob. Spreading
    // a Uint8Array into String.fromCharCode(...bytes) blows the argument
    // stack for anything larger than a few hundred KiB, which is every
    // real screenshot.
    const dataUrl = await this.#blobToDataUrl(blob);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const fullBody = body + base64 + footer;
    const resp = await this.#fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: fullBody,
    });
    const data = await resp.json();
    return data.id;
  }

  async #buildXmpBlob(record: Partial<ImageRecord>, format: "jpg" | "png"): Promise<Blob> {
    return buildEditableImageBlob(record, format);
  }

  #blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }
}

/** Strip the canonical `.annot.html` suffix from a filename when
 *  deriving a fallback document title. Falls back to the raw name
 *  for non-canonical extensions. */
function stripDocExtension(name: string): string {
  if (name.toLowerCase().endsWith(DOC_EXTENSION)) {
    return name.slice(0, -DOC_EXTENSION.length);
  }
  return name;
}
