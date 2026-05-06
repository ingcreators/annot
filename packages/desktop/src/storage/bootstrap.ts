/**
 * Phase 2 of `docs/plans/desktop-storage-provider-migration.md`:
 * mount the unified gallery (`FileManager` from
 * `@ingcreators/annot-web/gallery/file-manager`) against a
 * `DesktopStore` so the desktop renderer becomes a second consumer
 * of the PWA's gallery surface.
 *
 * This module is the "App.init analogue" the plan calls for —
 * it owns DesktopStore lifetime, the unified `ThumbnailManager`,
 * and the `FileManager` mount/teardown around the existing
 * gallery-view DOM. It does NOT re-implement the PWA's heavyweight
 * storage bridge (no auth flows, no plugin host, no router) —
 * the desktop is a single-storage host.
 *
 * Lifecycle: `bootstrapDesktopFsGallery(opts)` is called by
 * `app.ts` once `localStorage.annotDesktopStorageMode === "fs"`.
 * It hides the bespoke gallery DOM, ensures the FileManager
 * container DOM exists, mounts the gallery, and returns a handle
 * the caller can use to refresh / show / tear down.
 *
 * The bespoke gallery + project manager remain in place behind
 * the feature flag so QA can flip back without restarting; Phase 4
 * default-flips the flag and Phase 5 deletes the legacy code.
 */

import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { FileManager, type FileManagerCallbacks } from "@ingcreators/annot-web/gallery/file-manager";
import type { StorageMode } from "@ingcreators/annot-web/storage/bridge";
import { IndexedDBThumbnailCache } from "@ingcreators/annot-web/storage/idb-thumbnail-cache";
import { ThumbnailManager } from "@ingcreators/annot-web/storage/thumbnail-manager";
import { createElectronDesktopFs, type DesktopFs, type ElectronApi } from "./desktop-fs.js";
import { DesktopStore } from "./desktop-store.js";

/** Default top-level folder created on first launch so the gallery
 *  doesn't open into a totally empty tree. Phase 4's "no
 *  auto-import" decision means this is the only folder that
 *  exists at install time. */
const DEFAULT_INBOX_FOLDER = "Inbox";

export interface DesktopGalleryHandle {
  /** The mounted `FileManager` — exposed so the host can call
   *  `refresh` / `navigateToFolder` / etc. from its own event
   *  loops (extension capture handler, post-save reload, …). */
  readonly fileManager: FileManager;
  /** The store the file manager is bound to. Capture pipelines
   *  (Phase 3) call `saveImage` directly on this rather than
   *  going through the legacy `saveScreenshot` Tauri IPC. */
  readonly store: DesktopStore;
  /** Show the gallery view, hiding the bespoke gallery's DOM. */
  showGallery(): void;
  /** Hide the gallery view (when the editor takes over). */
  hideGallery(): void;
  /** Re-list folders / images from disk after an external mutation
   *  (e.g. extension capture lands a new file in `Inbox/`). */
  refresh(): Promise<void>;
}

export interface BootstrapOptions {
  /** Absolute path to the library root. Pass `undefined` and the
   *  bootstrap asks the Electron main process for it via
   *  `electronAPI.invoke('app.getLibraryRoot')`. Tests pass an
   *  explicit path + a custom `fs` to avoid touching the real
   *  filesystem. */
  libraryRoot?: string;
  /** Filesystem adapter override. Defaults to the Electron-backed
   *  `DesktopFs` (every primitive round-trips through
   *  `ipcRenderer.invoke('fs.*')`). Tests pass an in-memory
   *  adapter from `desktop-fs.test-mock.ts`. */
  fs?: DesktopFs;
  /** Callback fired when the user clicks an image card. The host's
   *  `app.ts` routes this into the existing `openEditor` flow. */
  onOpenImage: (record: ImageRecord) => void;
  /** Callbacks for the unified sidebar's "New" menu items (Capture
   *  Screen / Timed Capture / Paste Clipboard / Upload Image).
   *  Window / Region capture stay as desktop-only action-row
   *  buttons outside the unified gallery for the first cycle (per
   *  Phase 0 audit gap #1). */
  onCaptureScreen: () => Promise<void>;
  onTimedCapture: () => Promise<void>;
  onPasteClipboard: () => Promise<void>;
  onUploadImage: () => void;
}

/**
 * Resolve `<userData>/library/` via the Electron main process.
 * Phase 9 of `desktop-electron-migration.md` removed the Tauri
 * fallback; the legacy `appDataDir()` path is gone. Storybook /
 * test contexts pass an explicit `libraryRoot` to bypass this
 * call.
 */
async function resolveLibraryRoot(): Promise<string> {
  const api =
    typeof window !== "undefined"
      ? (window as unknown as { electronAPI?: ElectronApi }).electronAPI
      : undefined;
  if (!api) {
    throw new Error(
      "[desktop-bootstrap] window.electronAPI is missing — preload script " +
        "did not run? Re-launch via `pnpm dev`.",
    );
  }
  return api.invoke<string>("app.getLibraryRoot");
}

/** Ensure the library root + `Inbox/` exist on first launch. The
 *  plan's "Phase 4 creates `Inbox/` empty on first launch" item
 *  ships here in Phase 2 because the unified gallery needs SOME
 *  visible folder for the first-launch breadcrumb to settle on
 *  ("Desktop > Inbox"). The Inbox folder is recreated on next save
 *  if the user deletes it. */
async function ensureLibrarySkeleton(fs: DesktopFs): Promise<void> {
  await fs.mkdir("", { recursive: true });
  const inbox = await fs.stat(DEFAULT_INBOX_FOLDER);
  if (!inbox) {
    await fs.mkdir(DEFAULT_INBOX_FOLDER, { recursive: true });
  }
}

/**
 * Mount the unified gallery against `DesktopStore`. Caller is
 * responsible for ensuring the host DOM (`#sidebar` +
 * `#main-content` inside `#file-manager`, see `index.html`) exists
 * before calling. The ids mirror the PWA so file-manager.css's
 * id-scoped rules apply unchanged.
 *
 * Side effects:
 *   1. Resolves the library root (Electron `app.getPath('userData')`
 *      + `library/`) unless `opts.libraryRoot` overrides.
 *   2. Constructs `DesktopFs` (Electron-backed by default,
 *      caller-overridable for tests).
 *   3. Constructs `DesktopStore` and runs `init()` (loads index,
 *      backfills metadata, prunes orphans).
 *   4. Mounts `FileManager` against `#sidebar` + `#main-content`.
 *   5. Calls `setStorage` with `mode = "desktop"` so the sidebar
 *      chip strip + breadcrumb know which built-in is active.
 */
export async function bootstrapDesktopFsGallery(
  opts: BootstrapOptions,
): Promise<DesktopGalleryHandle> {
  const libraryRoot = opts.libraryRoot ?? (await resolveLibraryRoot());
  // The Electron-backed IPC handlers in
  // `packages/desktop/src-electron/ipc/fs.ts` resolve every path
  // server-side against the canonical library root, so the
  // renderer-side factory takes no `libraryRoot` argument.
  const fs = opts.fs ?? createElectronDesktopFs();

  await ensureLibrarySkeleton(fs);

  // The store's `rootName` flows into the sidebar's root subtitle
  // (under "Desktop") and the thumbnail-cache namespace. Use the
  // last path segment of `libraryRoot` for a short, recognizable
  // label — full paths get unwieldy on Windows.
  const rootName = leafNameOf(libraryRoot);

  const store = new DesktopStore(fs, rootName);
  await store.init();

  // Unified thumbnail cache shared with every other host; the
  // store's `StorageWithThumbnailCache` impl plugs straight into
  // `ThumbnailManager.attach`.
  const thumbnailManager = new ThumbnailManager(new IndexedDBThumbnailCache());

  const sidebarEl = document.getElementById("sidebar");
  const mainContentEl = document.getElementById("main-content");
  if (!sidebarEl || !mainContentEl) {
    throw new Error(
      "[desktop-bootstrap] expected #sidebar + #main-content " +
        "(inside #file-manager) in the host DOM — check index.html",
    );
  }

  // Forward declaration so the inline callbacks below can refer to
  // `fileManager` before the constructor finishes binding it.
  // Without the explicit `FileManager` annotation, tsc widens the
  // captured reference to `any` (`'fileManager' implicitly has type
  // 'any' because it does not have a type annotation and is
  // referenced directly or indirectly in its own initializer`).
  const callbacks: FileManagerCallbacks = {
    // Single-storage host: there's nothing to switch TO from the
    // chip strip. The desktop chip is the only one rendered
    // (`disableBuiltinStorage` filters out the rest), so a click
    // on it is effectively a refresh.
    onStorageSelect: async (_mode: StorageMode) => {
      await fileManager.refresh();
    },
    onStorageReselect: async (_mode: StorageMode) => {
      await fileManager.refresh();
    },
    onOpenImage: (record: ImageRecord) => opts.onOpenImage(record),
    onFolderChange: (_folderPath: string) => {
      /* no router; the file manager already tracks the active folder */
    },
    onNewFolder: () => fileManager.createNewFolder(),
    onUploadImage: () => opts.onUploadImage(),
    onCaptureScreen: () => opts.onCaptureScreen(),
    onTimedCapture: () => opts.onTimedCapture(),
    onPasteClipboard: () => opts.onPasteClipboard(),
    isBuiltinDisabled: (mode: string) => DISABLED_BUILTINS.has(mode),
    getThumbnailManager: () => thumbnailManager,
  };
  const fileManager: FileManager = new FileManager(sidebarEl, mainContentEl, callbacks);

  fileManager.setStorage(store, "desktop", rootName);
  // Land on root ("Desktop") so the user sees the `Inbox/` folder
  // alongside any other top-level folders they've added. The
  // breadcrumb starts as "Desktop"; one click drills into Inbox.
  await fileManager.refresh("");

  // The desktop's bespoke gallery sits under `#gallery-view` in
  // index.html; hide it so only the unified gallery is visible
  // when the FS-mode flag is on.
  const bespokeGallery = document.getElementById("gallery-view");
  if (bespokeGallery) bespokeGallery.style.display = "none";

  const galleryRoot = document.getElementById("desktop-shell");
  const showGallery = (): void => {
    if (galleryRoot) galleryRoot.style.display = "";
  };
  const hideGallery = (): void => {
    if (galleryRoot) galleryRoot.style.display = "none";
  };

  showGallery();

  return {
    fileManager,
    store,
    showGallery,
    hideGallery,
    refresh: () => fileManager.refresh(),
  };
}

/** Built-in storage modes the desktop intentionally hides — every
 *  PWA-native backend (Browser IDB, Device FSA, Drive, GitHub) and
 *  the extension proxy. Leaves only the new `desktop` chip
 *  visible. Per Phase 0 audit recommendation #4. */
const DISABLED_BUILTINS = new Set<string>([
  "browser",
  "device",
  "googledrive",
  "github",
  "extension",
]);

function leafNameOf(absolutePath: string): string {
  // Path may be Windows-style (`%APPDATA%\Annot\library`) or
  // POSIX-style — split on both.
  const segments = absolutePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? absolutePath;
}
