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

/** Updates allowed via `updateImage`. Set `folderPath` to move the image. */
export type ImageRecordUpdate = Partial<
  Pick<ImageRecord, "annotationsSvg" | "tags" | "thumbnailDataUrl" | "folderPath" | "updatedAt">
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
 */
export interface StorageProvider {
  // ---- Images ----

  /**
   * Save a new image. If `filename` is omitted, the store picks one
   * (e.g. `image-<timestamp>.png`). If the resulting path already exists,
   * the store uniquifies with " (2)", " (3)" suffixes.
   * Returns the actual path assigned.
   */
  saveImage(data: Omit<ImageRecord, "path"> & { filename?: string }): Promise<string>;

  getImage(path: string): Promise<ImageRecord | undefined>;

  /** List images within a folder. Use `""` for the root folder. */
  listImages(folderPath: string): Promise<ImageRecord[]>;

  /**
   * Update image. If `updates.folderPath` is set, moves the image and
   * returns the new path. Otherwise returns the original path.
   */
  updateImage(path: string, updates: ImageRecordUpdate): Promise<string>;

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

  // ---- Utility ----

  generateThumbnail(dataUrl: string, maxWidth?: number): Promise<string>;

  /** Optional: re-scan underlying storage for external changes. */
  resync?(): Promise<void>;
}
