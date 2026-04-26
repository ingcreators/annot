/**
 * Shared storage types used by Extension, Web app, and Desktop.
 *
 * Images and folders are identified by their filesystem-style path.
 * Root folder is represented by the empty string "".
 */

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
  /** Optional DOM structure metadata captured alongside the screenshot
   *  by the browser extension. Enables "click the Submit button →
   *  auto-annotate" features in the editor. Undefined when the
   *  capture came from a non-DOM source (desktop screenshot, paste,
   *  etc.). Shape may evolve; see `PageMetadata.version`. */
  pageMetadata?: PageMetadata;
}

/**
 * In-place updates allowed via `updateImage`. Note that `folderPath`
 * is intentionally NOT in this set — moving an image to a different
 * folder goes through {@link StorageProvider.moveImage}, which has
 * a clearer contract (returns the new path; `updateImage` doesn't).
 */
export type ImageRecordUpdate = Partial<
  Pick<ImageRecord, "annotationsSvg" | "tags" | "thumbnailDataUrl" | "updatedAt">
>;

// =============================================================================
// Page metadata — DOM structure captured alongside a browser screenshot.
// Used by the editor for smart-annotation features:
//   - "Elements" sidebar showing detected interactive elements
//   - Hover in sidebar → highlight on canvas
//   - Click in sidebar → auto-draw rectangle + label annotation
//
// The metadata is best-effort: it's only present for browser-extension
// captures (not desktop screenshots or pasted images), and only when
// the user has opted in. Elements are filtered to INTERACTIVE /
// LABELED items so the list is actionable rather than a full DOM dump.
// =============================================================================

export interface PageMetadata {
  /** Schema version — bump on breaking changes so consumers can
   *  gracefully handle old records. Current: 1. */
  version: 1;
  /** Source URL at capture time (also stored on ImageRecord.sourceUrl
   *  but duplicated here so metadata is self-contained). */
  url: string;
  /** Viewport size at capture time, in CSS pixels (not device pixels).
   *  Used to compute the scale factor when mapping bboxes onto the
   *  screenshot (which is in device pixels). */
  viewport: { width: number; height: number };
  /** `window.devicePixelRatio` at capture time. */
  devicePixelRatio: number;
  /** For scroll / per-page captures: the scroll offset at capture
   *  time. Single-viewport captures use `{ x: 0, y: 0 }`. Bboxes in
   *  `elements` are in document coordinates; subtract this offset +
   *  add again per-segment for stitched captures. */
  scrollOffset: { x: number; y: number };
  /** The rectangle of the document that the SCREENSHOT actually
   *  covers, in CSS pixels, document coordinates. Used by the editor
   *  to (a) FILTER `elements` to those visible in the screenshot
   *  and (b) MAP element bboxes from doc coords → screenshot coords
   *  via `(elBbox - captureRect.origin) * devicePixelRatio`.
   *  - visible capture: equals viewport at capture time (scrollX/Y +
   *    viewport size)
   *  - area capture: the user-selected sub-region, offset by scroll
   *  - scroll / per-page: full document (or per-segment) */
  captureRect: { x: number; y: number; width: number; height: number };
  /** ISO timestamp of when the metadata snapshot was taken (usually
   *  within a few ms of the screenshot). */
  capturedAt: string;
  /** Detected elements. Filtered to interactive / labeled items (see
   *  `interactiveRole` predicate in the content script). */
  elements: PageElement[];
}

export interface PageElement {
  /** Stable id within this capture — references across annotations. */
  id: string;
  /** Tag name in lowercase (e.g. "button", "a", "input"). */
  tag: string;
  /** ARIA role or implicit role ("button", "link", "textbox", ...). */
  role?: string;
  /** Visible text — textContent for button/link, label text for input. */
  text?: string;
  /** `aria-label` — explicit accessibility label, prefer over `text`
   *  when present since it's the a11y ground truth. */
  ariaLabel?: string;
  /** For form inputs: the input type (text / email / submit / …). */
  inputType?: string;
  /** For inputs: placeholder text. */
  placeholder?: string;
  /** For links: the href destination. */
  href?: string;
  /** Element id attribute (if any) — useful for stable selection. */
  domId?: string;
  /** Bounding box in DOCUMENT (not viewport) coordinates at capture
   *  time, in CSS pixels. To draw on the screenshot: multiply by
   *  devicePixelRatio. [x, y, width, height]. */
  bbox: [number, number, number, number];
  /** CSS selector (best effort) for re-locating the element later. */
  selector?: string;
  /** True if element was (partially) visible at capture time. */
  visible: boolean;
}

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
 */
export interface StorageProvider {
  // ---- Images ----

  /**
   * Save a new image. The `record` argument carries every field of
   * the saved entity except its path (which the store assigns).
   * The optional `opts.filename` lets the caller suggest a filename;
   * when omitted, the store picks one (e.g.
   * `image-<timestamp>.png`). If the resulting path already exists,
   * the store uniquifies with " (2)", " (3)" suffixes.
   *
   * Returns the actual path assigned (post-uniquification).
   */
  saveImage(
    record: Omit<ImageRecord, "path">,
    opts?: { filename?: string },
  ): Promise<string>;

  getImage(path: string): Promise<ImageRecord | undefined>;

  /** List images within a folder. Use `""` for the root folder. */
  listImages(folderPath: string): Promise<ImageRecord[]>;

  /**
   * Update an image's annotations / tags / thumbnail / updatedAt
   * in place. Path stays the same — to move the image, use
   * {@link moveImage}.
   */
  updateImage(path: string, updates: ImageRecordUpdate): Promise<void>;

  /**
   * Move an image to a different folder. Returns the new path
   * (filename unchanged; only the folder portion changes). The
   * destination folder must already exist. No-op (returns the
   * original path) when `newFolderPath` matches the current folder.
   */
  moveImage(path: string, newFolderPath: string): Promise<string>;

  /** Rename image in place. Returns the new path. */
  renameImage(path: string, newName: string): Promise<string>;

  deleteImage(path: string): Promise<void>;

  // ---- Folders ----

  /** Create a folder. Throws if a folder with the same name already exists. */
  createFolder(parentPath: string, name: string): Promise<string>;

  /** List subfolders of `parentPath`. Use `""` for the root folder. */
  listFolders(parentPath: string): Promise<FolderRecord[]>;

  getFolder(path: string): Promise<FolderRecord | undefined>;

  /** Rename folder in place. Returns the new path. */
  renameFolder(path: string, newName: string): Promise<string>;

  /** Move folder to a new parent. Returns the new path. */
  moveFolder(path: string, newParentPath: string): Promise<string>;

  /** Delete folder and all nested content (images + subfolders). */
  deleteFolder(path: string): Promise<void>;

  /** Return folder records from root down to `path` (inclusive). Empty for root. */
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

export function supportsInit(
  store: StorageProvider,
): store is StorageProvider & StorageWithInit {
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
