/**
 * Shared storage types used by Extension, Web app, and Desktop.
 *
 * Images and folders are identified by their filesystem-style path.
 * Root folder is represented by the empty string "".
 */

import type { ElementTree } from "../element-tree/types.js";

export interface ImageRecord {
  /** Primary key: full path, e.g. "Screenshots/Mobile/image-123.png". */
  path: string;
  /** Parent folder path. Derived from `path` but stored for efficient indexing. */
  folderPath: string;
  originalDataUrl: string;
  thumbnailDataUrl: string;
  annotationsSvg: string;
  width: number;
  height: number;
  sourceUrl: string;
  tags: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  /** What created the image: `extension` / `desktop` / `web` /
   *  `vscode` / `annotator` / `mcp` / `playwright` / …. Persisted
   *  as `annot:producer` in the XMP packet (schema 2.0). Empty /
   *  undefined for records that predate 2.0. */
  producer?: string;
  /** `devicePixelRatio` (or display scale factor) at capture time.
   *  Persisted as `annot:dpr` (schema 2.0). Maps device-px image
   *  dimensions back to CSS px for sources without an ElementTree.
   *  0 / undefined when unknown. */
  dpr?: number;
  /** Canonical screen-capture tree captured alongside the
   *  screenshot. Source-agnostic: produced by the browser extension's
   *  MAIN-world walker, by Playwright's adapter, or by any future
   *  capture source (Figma adapter, OCR-derived, etc.). Undefined
   *  when the capture came from a non-DOM source (desktop screenshot,
   *  paste). Enables "click the Submit button → auto-annotate"
   *  features in the editor. See `@ingcreators/annot-core/element-tree`. */
  elementTree?: ElementTree;
}

/**
 * In-place updates allowed via `updateImage`. Note that `folderPath`
 * is intentionally NOT in this set — moving an image to a different
 * folder goes through {@link StorageProvider.moveImage}, which has
 * a clearer contract (returns the new path; `updateImage` doesn't).
 *
 * `thumbnailDataUrl` is also intentionally absent — thumbnail bytes
 * are owned by the host-side `ThumbnailManager` (see
 * [`docs/plans/_done/unified-thumbnail-cache.md`](../../../../docs/plans/_done/unified-thumbnail-cache.md));
 * callers seed the cache via `tm.write(provider, path, dataUrl,
 * dims)` rather than going through `updateImage`.
 *
 * `originalDataUrl` is included so callers that mutate the
 * underlying bitmap — currently the redact-burn-into-image
 * `EditorShell.applyAllRedactions` path
 * ([`_done/redact-burn-into-image.md`](../../../../docs/plans/_done/redact-burn-into-image.md))
 * and the destructive crop path (`EditorShell.applyCrop`) — can
 * persist the new bytes alongside the matching annotation SVG.
 * Backends that re-encode the file on save (XMP-based stores:
 * DeviceStore, DesktopStore, GoogleDriveStore, GitHubStore) MUST
 * honor a non-undefined `updates.originalDataUrl` by feeding it
 * into the file rebuild instead of the storage's cached / on-disk
 * value. Backends that store the bitmap separately (BrowserStore
 * via IDB) just `Object.assign` it onto the record, which the
 * next put writes back. Including this field on a normal
 * annotation save (no bitmap mutation) is unnecessary and — for
 * network-backed stores — wasteful, so the field is OPT-IN: leave
 * it undefined unless the bitmap actually changed.
 *
 * `width` / `height` are included for the same reason — the
 * destructive crop path replaces the bitmap with a smaller one
 * AND records the new pixel dimensions so the next reload
 * reconstructs the canvas at the cropped size. Like
 * `originalDataUrl` they are OPT-IN: only set when the bitmap
 * dimensions actually changed.
 */
export type ImageRecordUpdate = Partial<
  Pick<
    ImageRecord,
    "annotationsSvg" | "tags" | "updatedAt" | "originalDataUrl" | "width" | "height"
  >
>;

export interface FolderRecord {
  /** Primary key: full path, e.g. "Screenshots/Mobile". */
  path: string;
  /** Parent folder path. Derived from `path` but stored for efficient indexing. */
  parentPath: string;
  /** Last segment of `path`. */
  name: string;
  createdAt: string;
}

/**
 * Abstract storage provider — implemented by:
 * - IndexedDB (browser-extension, web-annotation local mode)
 * - Extension API bridge (web-annotation when extension is installed)
 * - File System Access API (web-annotation direct FS mode)
 * - Google Drive API (web-annotation Drive mode)
 *
 * The interface is **capability-narrowed**: only methods every backend
 * implements live here. Optional behaviours (resync, token refresh,
 * force-refresh of cached state) live on separate `StorageWith*`
 * interfaces below; use the matching `supports*()` type predicate to
 * narrow before calling.
 *
 * ## Error contract
 *
 * Read methods (`getImage`, `getFolder`, `listImages`, `listFolders`,
 * `getBreadcrumb`) return `undefined` / `[]` for missing paths
 * rather than throwing — "missing" is not a discriminable error
 * here, so callers handle the absence directly. Update / delete
 * methods are idempotent on missing source: `updateImage`,
 * `deleteImage`, and `deleteFolder` return silently when the target
 * path doesn't exist. `saveImage` and `moveImage` auto-uniquify
 * collisions with " (2)", " (3)" suffixes and never throw on
 * conflict.
 *
 * Mutation methods that DO throw discriminate failures via the
 * `StorageError` hierarchy in
 * `@ingcreators/annot-core/storage/errors`:
 *
 *   - `StorageConflictError` — a path collision the backend
 *     can't auto-resolve. `createFolder` throws on duplicate name;
 *     `renameImage`, `renameFolder`, and `moveFolder` throw on
 *     destination collision (they don't auto-uniquify because the
 *     caller picked the new name explicitly, so the conflict is
 *     surfaced for them to retry / prompt).
 *   - `StorageNotFoundError` — a `rename*` / `move*` couldn't
 *     find its source path. The idempotent methods above don't
 *     throw this.
 *   - `StoragePermissionError` — backend rejected the op for auth
 *     / ACL reasons (expired token, revoked scope, FSA permission
 *     lapse). Any mutating method may throw this.
 *   - `StorageQuotaError` — backend reports out-of-space or
 *     out-of-quota. Any mutating method may throw this.
 *
 * Other failure modes (network errors, parse errors, generic IO
 * errors) surface as plain `Error` and are NOT captured by
 * `instanceof StorageError`. Backend-specific subclasses
 * (`GitHubRateLimitError`, `DriveAuthError`, etc.) live inside each
 * backend file and don't extend the shared `StorageError` hierarchy
 * — they remain backend-internal concerns.
 *
 * Callers that want to react to a structured failure should
 * `instanceof`-check the subclass; never substring-match on
 * `e.message`.
 */
export interface StorageProvider {
  // ---- Images ----

  /**
   * Save a new image. The `record` carries every field of the
   * saved entity except its path (which the store assigns). When
   * `opts.filename` is provided the store uses it as the suggested
   * leaf name; when omitted the store picks one
   * (e.g. `image-<timestamp>.png`). On collision the store
   * uniquifies with " (2)", " (3)" suffixes — `saveImage` NEVER
   * throws `StorageConflictError`; the returned path IS the
   * post-uniquification path the caller should hand to subsequent
   * reads / writes.
   *
   * @returns the actual path assigned (post-uniquification).
   * @throws `StoragePermissionError` when the backend rejects the
   *   write for auth / ACL reasons (expired GitHub token, revoked
   *   Drive scope, FSA permission lapse).
   * @throws `StorageQuotaError` when the backend reports
   *   out-of-space or out-of-quota.
   * @throws `Error` for unstructured backend / IO / network
   *   failures.
   */
  saveImage(record: Omit<ImageRecord, "path">, opts?: { filename?: string }): Promise<string>;

  /**
   * Read a single image by path. Missing is not an error here —
   * callers get `undefined` and handle it directly without
   * `try` / `catch`.
   *
   * @returns the image record, or `undefined` if no image exists
   *   at that path.
   * @throws `Error` for backend / IO / parse failures (e.g. an
   *   on-disk file is corrupt, a network request fails).
   */
  getImage(path: string): Promise<ImageRecord | undefined>;

  /**
   * List images directly inside `folderPath`. Use `""` for the
   * root folder. Does NOT recurse into subfolders.
   *
   * @returns image records for that folder. Returns `[]` when the
   *   folder is empty or missing — missing folders are not an
   *   error here.
   * @throws `Error` for backend / IO / parse failures.
   */
  listImages(folderPath: string): Promise<ImageRecord[]>;

  /**
   * In-place update of an existing image's annotations / tags /
   * thumbnail / `updatedAt`. Path stays the same — to relocate
   * the image, use {@link moveImage} or {@link renameImage}.
   *
   * Idempotent on missing source: returns silently when no image
   * exists at `path`. Callers that must distinguish "updated" from
   * "no-such-image" should `getImage` first.
   *
   * @throws `StoragePermissionError` for backend auth / ACL
   *   rejection.
   * @throws `StorageQuotaError` when the backend reports
   *   out-of-space.
   * @throws `Error` for unstructured backend / IO failures.
   */
  updateImage(path: string, updates: ImageRecordUpdate): Promise<void>;

  /**
   * Move an image to `newFolderPath`. Filename is preserved; only
   * the parent-folder portion of the path changes. The destination
   * folder must already exist (callers create it first via
   * {@link createFolder}). On collision (a file with the same name
   * already exists at the destination) the store auto-uniquifies
   * with " (2)", " (3)" suffixes — `moveImage` NEVER throws
   * `StorageConflictError`. No-op (returns the original path) when
   * `newFolderPath` matches the current folder.
   *
   * @returns the new path.
   * @throws `StorageNotFoundError` when no image exists at `path`.
   * @throws `StoragePermissionError` for backend auth / ACL
   *   rejection.
   * @throws `Error` for unstructured backend / IO failures.
   */
  moveImage(path: string, newFolderPath: string): Promise<string>;

  /**
   * Rename an image in place. Folder portion of the path stays the
   * same; only the leaf filename changes. No-op (returns the
   * original path) when `newName` matches the current filename.
   *
   * Unlike {@link moveImage}, `renameImage` does NOT auto-uniquify
   * — the caller picked the new name explicitly, so a conflict is
   * surfaced for them to handle (e.g. show a "name taken, choose
   * another?" prompt).
   *
   * @returns the new path.
   * @throws `StorageNotFoundError` when no image exists at `path`.
   * @throws `StorageConflictError` when an image already exists at
   *   the renamed path.
   * @throws `StoragePermissionError` for backend auth / ACL
   *   rejection.
   * @throws `Error` for unstructured backend / IO failures.
   */
  renameImage(path: string, newName: string): Promise<string>;

  /**
   * Delete an image.
   *
   * Idempotent on missing source: returns silently when no image
   * exists at `path`. Callers that must distinguish "deleted" from
   * "no-such-image" should `getImage` first.
   *
   * @throws `StoragePermissionError` for backend auth / ACL
   *   rejection.
   * @throws `Error` for unstructured backend / IO failures.
   */
  deleteImage(path: string): Promise<void>;

  // ---- Folders ----

  /**
   * Create a folder named `name` directly under `parentPath`. Use
   * `""` for `parentPath` to create at the root.
   *
   * Unlike {@link saveImage}, `createFolder` does NOT auto-uniquify
   * — the caller picked the name explicitly, so a conflict is
   * surfaced for them to handle.
   *
   * @returns the new folder's full path.
   * @throws `StorageConflictError` when a folder named `name`
   *   already exists under `parentPath`.
   * @throws `StoragePermissionError` for backend auth / ACL
   *   rejection.
   * @throws `Error` for unstructured backend / IO failures,
   *   including `parentPath` not existing on backends that
   *   validate it.
   */
  createFolder(parentPath: string, name: string): Promise<string>;

  /**
   * List subfolders directly inside `parentPath`. Use `""` for the
   * root folder. Does NOT recurse.
   *
   * @returns folder records sorted alphabetically by name. Returns
   *   `[]` when the folder is empty or missing — missing folders
   *   are not an error here.
   * @throws `Error` for backend / IO failures.
   */
  listFolders(parentPath: string): Promise<FolderRecord[]>;

  /**
   * Read a folder record by path. The root folder (`""`) is NOT a
   * record — `getFolder("")` returns `undefined` by contract.
   *
   * @returns the folder record, or `undefined` if no folder exists
   *   at that path. Missing paths are not an error here.
   * @throws `Error` for backend / IO failures.
   */
  getFolder(path: string): Promise<FolderRecord | undefined>;

  /**
   * Rename a folder in place. Parent stays the same; only the leaf
   * name changes. All descendant image and folder paths are
   * rewritten to share the new prefix. No-op (returns the original
   * path) when `newName` matches the current name.
   *
   * Does NOT auto-uniquify (same rationale as {@link renameImage}).
   *
   * @returns the new folder path.
   * @throws `StorageNotFoundError` when no folder exists at `path`.
   * @throws `StorageConflictError` when a folder with the new name
   *   already exists alongside the source.
   * @throws `StoragePermissionError` for backend auth / ACL
   *   rejection.
   * @throws `Error` for unstructured backend / IO failures.
   */
  renameFolder(path: string, newName: string): Promise<string>;

  /**
   * Move a folder to a new parent. Leaf name stays the same; only
   * the parent portion of the path changes. All descendant image
   * and folder paths are rewritten to share the new prefix. No-op
   * (returns the original path) when `newParentPath` matches the
   * current parent.
   *
   * Does NOT auto-uniquify (same rationale as {@link renameImage}).
   *
   * @returns the new folder path.
   * @throws `StorageNotFoundError` when no folder exists at `path`.
   * @throws `StorageConflictError` when a folder with the same
   *   leaf name already exists under `newParentPath`.
   * @throws `StoragePermissionError` for backend auth / ACL
   *   rejection.
   * @throws `Error` for unstructured backend / IO failures.
   */
  moveFolder(path: string, newParentPath: string): Promise<string>;

  /**
   * Recursively delete a folder and every image / subfolder under
   * it.
   *
   * Idempotent on missing source: returns silently when no folder
   * exists at `path`.
   *
   * @throws `StoragePermissionError` for backend auth / ACL
   *   rejection.
   * @throws `Error` for unstructured backend / IO failures.
   */
  deleteFolder(path: string): Promise<void>;

  /**
   * Read the chain of folder records from the root (exclusive)
   * down to `path` (inclusive). Used for breadcrumb UIs.
   *
   * @returns one record per existing ancestor, in root-to-leaf
   *   order. Returns `[]` for the root (`""`). Missing intermediate
   *   ancestors are silently skipped — `getBreadcrumb` never
   *   throws on a missing path.
   * @throws `Error` for backend / IO failures.
   */
  getBreadcrumb(path: string): Promise<FolderRecord[]>;
}

// `generateThumbnail` deliberately does NOT live on the contract:
// every backend's implementation now collapses to a 1-line delegate
// over the shared `generateThumbnailFromDataUrl` helper in
// `@ingcreators/annot-web/storage/image-thumbnail`. Callers that
// previously did `storage.generateThumbnail(...)` should import the
// free function directly. Storage backends are free to skip the
// delegate method entirely.

// ─── Capability interfaces ────────────────────────────────────────────
// These describe optional behaviour a store may implement on top of the
// core `StorageProvider`. Add `implements StorageProvider, StorageWithX`
// to the concrete class; callers use the matching `supportsX()` type
// predicate to narrow before invoking the method.

/**
 * Re-scan underlying storage for external changes. Useful for stores
 * whose backing state can mutate behind our back — local filesystems
 * (changes from another editor) and network-backed stores (changes
 * pushed from another client).
 */
export interface StorageWithResync {
  resync(): Promise<void>;
}

/**
 * Force-refresh cached state from the source of truth, bypassing any
 * local cache. Stronger than `resync()`: where `resync` typically
 * picks up incremental changes, `forceRefresh` invalidates everything
 * the store knows about and re-fetches.
 */
export interface StorageWithForceRefresh {
  forceRefresh(): Promise<void>;
}

/**
 * Token-management hooks for network-backed stores. Bundles two
 * conceptually-related operations the host may need to invoke:
 *
 *   - `setToken(token)` directly injects a fresh access token —
 *     used after the host performs a silent refresh outside the
 *     store's own 401 path.
 *   - `setTokenRefresher(fn)` registers the host's 401 recovery
 *     callback. The refresher resolves to a new token string, or
 *     `null` if the user dismissed the auth banner / declined to
 *     re-auth. The store retries the failed request once with the
 *     new token and gives up if `null` came back.
 *
 * Today implemented by the network-backed built-ins (`GoogleDriveStore`,
 * `GitHubStore`); local stores (`BrowserStore`, `DeviceStore`, the
 * extension proxy) skip it. Plugin stores opt in by implementing
 * this interface and calling the registered refresher from their
 * own 401 path.
 */
export interface StorageWithTokenRefresher {
  setToken(token: string): void;
  setTokenRefresher(refresher: () => Promise<string | null>): void;
}

/**
 * Initialisation hook for stores whose lifecycle includes work that
 * can't run in the constructor — typically because it does I/O the
 * caller wants to await separately. `DeviceStore` uses this to load
 * its on-disk index, run crash-recovery scans, and reconcile against
 * the file tree. Stores whose construction is fully synchronous
 * (Browser, GitHub, Drive) skip this capability.
 */
export interface StorageWithInit {
  init(): Promise<void>;
}

/**
 * Rate-limit telemetry. Backends that surface a quota window (e.g.
 * GitHub's `X-RateLimit-Remaining`) implement this so the host can
 * render an advisory banner before requests start hard-failing.
 *
 * `getRateLimit()` is a synchronous read of the most recent values
 * the store has observed; `setRateLimitListener` registers a
 * push-notification callback the store fires when the budget drops
 * below an internal threshold (at most once per reset window).
 */
export interface StorageWithRateLimit {
  getRateLimit(): { remaining: number | null; resetAt: number | null };
  setRateLimitListener(
    listener: (info: { remaining: number; resetAt: number | null }) => void,
  ): void;
}

/**
 * Opt into the unified thumbnail cache (the host-side
 * `ThumbnailManager` + `ThumbnailCache` infrastructure introduced
 * by [`docs/plans/_done/unified-thumbnail-cache.md`](../../../../docs/plans/_done/unified-thumbnail-cache.md)).
 *
 * Stores that implement all three methods participate in the shared
 * cache: the host owns the prefetch lifecycle (in-flight dedup,
 * persistence, LRU eviction, `annot-thumbnail-ready` dispatch);
 * the store just answers "what's the stable key", "what's the
 * version", and "where do the source bytes live".
 *
 * Stores that don't implement this interface continue to populate
 * `record.thumbnailDataUrl` themselves (legacy inline-thumbnail
 * shape). The host's `ThumbnailManager.attach` is a no-op for
 * non-participating providers, so adoption is per-store.
 *
 * Built-in prefix conventions match the `StorageMode` strings used
 * in URL handoff and storage selection — `browser:` / `device:` /
 * `github:` / `googledrive:`. Plugin-registered providers must use
 * the `plugin:<pluginId>:` prefix the host enforces at registration.
 */
export interface StorageWithThumbnailCache {
  /**
   * Stable per-image identifier independent of path renames /
   * collision-suffixing. Returning `undefined` opts that path out
   * of the unified cache (the host treats it as a non-participating
   * record for that one item).
   */
  thumbnailKey(path: string): string | undefined;

  /**
   * Opaque "version" — must change whenever the file's bytes
   * change. Cache hits require a version match; mismatches trigger
   * eviction + re-prefetch. Stores that don't observe external
   * mutation may return `""` constant.
   */
  thumbnailVersion(path: string): string;

  /**
   * Cache-miss source fetcher. Returns the bytes the manager runs
   * through `generateThumbnailFromBlob`. Implementations should
   * pick the cheapest path that yields a renderable image — Drive
   * and GitHub bypass the full record decode and just stream the
   * raw bytes.
   *
   * @returns the source `Blob`, or `undefined` if the file no
   *   longer exists (deleted between listing and fetch).
   */
  fetchThumbnailSource(path: string): Promise<Blob | undefined>;
}

/**
 * Persistent document records — the storage shape for `.annot.html`
 * files (multi-image manuals authored via the doc shell). Sibling
 * to `ImageRecord`; backends opt in via `StorageWithDocuments`.
 *
 * Phase 6a of [`docs/plans/_done/annot-html-document.md`](../../../../docs/plans/_done/annot-html-document.md).
 * The whole plan series introducing the format lives there; the
 * Tier A surface (capability + record type + predicate) lands
 * before any single backend implements it so a consumer that
 * narrows a `StorageProvider` to `StorageWithDocuments` gets the
 * documented type-shape regardless of which implementations have
 * caught up.
 *
 * @example
 * ```ts
 * if (supportsDocuments(store)) {
 *   const docs = await store.listDocuments("");
 *   for (const doc of docs) {
 *     console.log(doc.title, doc.imageCount, "blocks:", doc.blockCount);
 *   }
 * }
 * ```
 */
export interface DocumentRecord {
  /** Primary key: full path, e.g. "Manuals/onboarding.annot.html". */
  path: string;
  /** Parent folder path. Derived from `path` but stored for
   *  efficient indexing. */
  folderPath: string;
  /** The on-disk `.annot.html` source. Self-contained: inlined
   *  CSS / fonts / images per the format spec. */
  bytes: string;
  /** Thumbnail of the document — strategy is implementation-
   *  defined. `BrowserStore` (Phase 6a) uses the first
   *  `ImageBlock`'s SVG rendered to a small bitmap; backends that
   *  opt into `StorageWithThumbnailCache` may answer this via the
   *  unified cache instead. Empty string when no preview is
   *  available. */
  thumbnailDataUrl: string;
  /** Document title, mirroring the JSON sidecar's `title` field
   *  (the format-spec contract enforces `<title>` ↔ `meta.title`
   *  equality on save). Cached here so listing UIs don't have to
   *  parse every document's bytes to render a name. */
  title: string;
  /** Number of image blocks in the document. Cached for the
   *  same reason as `title`. */
  imageCount: number;
  /** Number of top-level blocks. Cached for the same reason. */
  blockCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * In-place updates allowed via `updateDocument`. Note that
 * `path` and `folderPath` are intentionally NOT in this set —
 * relocating a document goes through {@link
 * StorageProvider.moveImage} / {@link StorageProvider.renameImage}
 * (the path-keyed model already covers any leaf file).
 *
 * The cached metadata fields (`title`, `imageCount`, `blockCount`,
 * `thumbnailDataUrl`) are part of the update set so callers that
 * re-derive them on save (e.g. by re-parsing the new `bytes`) can
 * keep the index consistent without a separate roundtrip.
 */
export type DocumentRecordUpdate = Partial<
  Pick<
    DocumentRecord,
    "bytes" | "thumbnailDataUrl" | "title" | "imageCount" | "blockCount" | "updatedAt"
  >
>;

/**
 * Opt into the multi-image document storage surface — the storage
 * half of the `.annot.html` document format
 * ([`docs/plans/_done/annot-html-document.md`](../../../../docs/plans/_done/annot-html-document.md)).
 *
 * Stores that implement this interface gain four document-shaped
 * methods. Delete / move / rename reuse the image-side equivalents
 * because the path-keyed model already covers any leaf file —
 * `deleteImage("a/b.annot.html")` deletes a document just as it
 * deletes an image; the discriminator is the file extension and
 * the receiving backend's storage layout (separate IDB store /
 * separate object key prefix / etc.). Stores MAY override that
 * behaviour internally if their layout demands it; consumers see
 * a uniform path-keyed surface.
 *
 * Stores that don't implement this interface narrow out via
 * `supportsDocuments(store) === false`; document UI code branches
 * on the predicate before showing document-related affordances.
 */
export interface StorageWithDocuments {
  /**
   * Save a new document. The `record` carries every field of the
   * saved entity except its path (which the store assigns). When
   * `opts.filename` is provided the store uses it as the suggested
   * leaf name; when omitted the store picks one (e.g.
   * `document-<timestamp>.annot.html`). On collision the store
   * uniquifies with " (2)", " (3)" suffixes — `saveDocument`
   * NEVER throws `StorageConflictError`; the returned path IS the
   * post-uniquification path.
   *
   * @returns the actual path assigned (post-uniquification).
   * @throws `StoragePermissionError` when the backend rejects the
   *   write for auth / ACL reasons.
   * @throws `StorageQuotaError` when the backend reports
   *   out-of-space or out-of-quota.
   * @throws `Error` for unstructured backend / IO / network
   *   failures.
   */
  saveDocument(record: Omit<DocumentRecord, "path">, opts?: { filename?: string }): Promise<string>;

  /**
   * Read a single document by path.
   *
   * @returns the document record, or `undefined` if no document
   *   exists at that path.
   * @throws `Error` for backend / IO / parse failures.
   */
  getDocument(path: string): Promise<DocumentRecord | undefined>;

  /**
   * List documents directly inside `folderPath`. Use `""` for the
   * root folder. Does NOT recurse into subfolders.
   *
   * @returns document records for that folder. Returns `[]` when
   *   the folder is empty or missing.
   * @throws `Error` for backend / IO / parse failures.
   */
  listDocuments(folderPath: string): Promise<DocumentRecord[]>;

  /**
   * In-place update of an existing document's bytes / cached
   * metadata / `updatedAt`. Path stays the same — to relocate
   * the document, use {@link StorageProvider.moveImage} or
   * {@link StorageProvider.renameImage} (path-keyed semantics
   * apply uniformly).
   *
   * Idempotent on missing source: returns silently when no
   * document exists at `path`. Callers that must distinguish
   * "updated" from "no-such-document" should `getDocument` first.
   *
   * @throws `StoragePermissionError` for backend auth / ACL
   *   rejection.
   * @throws `StorageQuotaError` when the backend reports
   *   out-of-space.
   * @throws `Error` for unstructured backend / IO failures.
   */
  updateDocument(path: string, updates: DocumentRecordUpdate): Promise<void>;

  /**
   * Read the annotations YAML sidecar paired with the image at
   * `pngPath`. The store derives the sidecar location internally
   * from the convention `<pngPath>.annotations.yaml` (so
   * `shots/login.png` →`shots/login.png.annotations.yaml`); callers
   * pass the PNG path only.
   *
   * Optional — stores that don't support sidecar yaml files may
   * omit this method. Callers gate on
   * {@link supportsAnnotationsYaml} before invoking.
   *
   * Introduced in Phase 4a of the
   * [living-spec authoring roadmap](../../../../docs/plans/living-spec-authoring-roadmap.md)
   * for the Annot editor's Overlay tool. Each entry in the yaml
   * follows the `AnnotationsFile` schema defined by
   * `@ingcreators/annot-product-docs` (Phase 2a).
   *
   * @returns the YAML source string, or `undefined` when no
   *   sidecar exists for that PNG.
   * @throws `Error` for backend / IO / parse failures.
   */
  getAnnotationsYaml?(pngPath: string): Promise<string | undefined>;

  /**
   * Atomically create or replace the annotations YAML sidecar
   * paired with the image at `pngPath`. The store derives the
   * sidecar location internally from the convention
   * `<pngPath>.annotations.yaml`.
   *
   * Optional — stores that don't support sidecar yaml files may
   * omit this method. Callers gate on
   * {@link supportsAnnotationsYaml} before invoking.
   *
   * The write does NOT touch the PNG bytes or any sibling MDX
   * file — only the sidecar yaml is mutated. Idempotent on
   * unchanged input (same `content` twice produces the same
   * on-disk bytes).
   *
   * Introduced in Phase 4a of the
   * [living-spec authoring roadmap](../../../../docs/plans/living-spec-authoring-roadmap.md).
   *
   * @throws `StoragePermissionError` for backend auth / ACL
   *   rejection.
   * @throws `StorageQuotaError` when the backend reports
   *   out-of-space.
   * @throws `Error` for unstructured backend / IO failures.
   */
  setAnnotationsYaml?(pngPath: string, content: string): Promise<void>;
}

// ─── Capability predicates ────────────────────────────────────────────
// Use these instead of `if (store.method)` so the narrow is type-safe
// and the optional behaviour is documented at the call site.

export function supportsResync(
  store: StorageProvider,
): store is StorageProvider & StorageWithResync {
  return typeof (store as Partial<StorageWithResync>).resync === "function";
}

export function supportsForceRefresh(
  store: StorageProvider,
): store is StorageProvider & StorageWithForceRefresh {
  return typeof (store as Partial<StorageWithForceRefresh>).forceRefresh === "function";
}

export function supportsTokenRefresher(
  store: StorageProvider,
): store is StorageProvider & StorageWithTokenRefresher {
  return (
    typeof (store as Partial<StorageWithTokenRefresher>).setTokenRefresher === "function" &&
    typeof (store as Partial<StorageWithTokenRefresher>).setToken === "function"
  );
}

export function supportsInit(store: StorageProvider): store is StorageProvider & StorageWithInit {
  return typeof (store as Partial<StorageWithInit>).init === "function";
}

export function supportsRateLimit(
  store: StorageProvider,
): store is StorageProvider & StorageWithRateLimit {
  return (
    typeof (store as Partial<StorageWithRateLimit>).getRateLimit === "function" &&
    typeof (store as Partial<StorageWithRateLimit>).setRateLimitListener === "function"
  );
}

export function supportsThumbnailCache(
  store: StorageProvider,
): store is StorageProvider & StorageWithThumbnailCache {
  const s = store as Partial<StorageWithThumbnailCache>;
  return (
    typeof s.thumbnailKey === "function" &&
    typeof s.thumbnailVersion === "function" &&
    typeof s.fetchThumbnailSource === "function"
  );
}

export function supportsDocuments(
  store: StorageProvider,
): store is StorageProvider & StorageWithDocuments {
  const s = store as Partial<StorageWithDocuments>;
  return (
    typeof s.saveDocument === "function" &&
    typeof s.getDocument === "function" &&
    typeof s.listDocuments === "function" &&
    typeof s.updateDocument === "function"
  );
}

/**
 * Narrows a store to one that exposes the Phase 4a annotations
 * YAML sidecar surface (`getAnnotationsYaml` + `setAnnotationsYaml`).
 *
 * Use instead of `if (store.getAnnotationsYaml)` so the narrow is
 * type-safe and the optional behaviour is documented at the call
 * site. The methods sit on
 * {@link StorageWithDocuments} as optional members; this predicate
 * is the dedicated capability check for callers that need both
 * sides of the read / write pair.
 */
export function supportsAnnotationsYaml(store: StorageProvider): store is StorageProvider &
  StorageWithDocuments & {
    getAnnotationsYaml: NonNullable<StorageWithDocuments["getAnnotationsYaml"]>;
    setAnnotationsYaml: NonNullable<StorageWithDocuments["setAnnotationsYaml"]>;
  } {
  const s = store as Partial<StorageWithDocuments>;
  return typeof s.getAnnotationsYaml === "function" && typeof s.setAnnotationsYaml === "function";
}
