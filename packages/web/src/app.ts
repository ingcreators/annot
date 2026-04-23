/**
 * Annot (by ingcreators) — main application.
 * File Manager (gallery) ↔ Editor switching with path-based StorageProvider.
 */
import {
  CanvasManager,
  History,
  SelectionManager,
  Toolbar,
  openAnchoredPopover,
  createThemeToggle,
  readEditableImage,
  exportAnnotationsSvgForIdb,
  getPngDataUrl,
  ANNOT_SVG_VERSION,
  readAnnotVersion,
} from "@ingcreators/annot-core";
import { EditorRightPanel } from "./editor/right-panel.js";
import { installKeyboardHelp } from "./editor/keyboard-help.js";
import { ScratchpadSection } from "./editor/scratchpad-section.js";
import { ScratchpadStore } from "./editor/scratchpad-store.js";
import {
  serializeSelection,
  renderThumbnail,
} from "./editor/scratchpad-utils.js";
import { ScratchpadPasteTool } from "./editor/scratchpad-paste-tool.js";
import type { ToolOptions } from "@ingcreators/annot-core";
import type {
  ImageRecord,
  StorageProvider,
} from "@ingcreators/annot-core/storage";
import { getFilename } from "@ingcreators/annot-core/storage";
import { FileDetailsDrawer, estimateDataUrlBytes, validateFilename } from "./editor/file-details-drawer.js";
import { SaveStatusIndicator } from "./editor/save-status-indicator.js";
import { newIdB58, setTooltip } from "@ingcreators/annot-core/utils";
import {
  getStorage,
  setExtensionId,
  setStorageMode,
  openFileSystemDirectory,
  restoreFileSystem,
  connectGoogleDrive,
  restoreGoogleDrive,
  isDriveConnected,
  getStorageMode,
  deleteExtensionImage,
  getFsRootName,
  saveLastStorage,
  loadLastStorage,
  saveLastFolder,
  loadLastFolder,
  type StorageMode,
} from "./storage/bridge.js";
import { signIn, showFolderPicker, saveDriveRoot, loadDriveRoot } from "./storage/google-auth.js";
import { GoogleDriveStore } from "./storage/google-drive-store.js";
import { FileManager } from "./gallery/file-manager.js";
import type { SplitEditor } from "./editor/split-editor.js";
import { encodeCaptureInWorker } from "./workers/encode-client.js";
import { loadEncodeOptions } from "./encode-options.js";

/**
 * Append " (n)" before the file extension to uniquify a colliding filename.
 * Mirrors the convention used by the storage layer's own `uniquifyFilename`.
 *   "image-X-p5.png", 2  → "image-X-p5 (2).png"
 *   "image-X-p5.png", 3  → "image-X-p5 (3).png"
 */
function bumpFilenameSuffix(filename: string, n: number): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return `${filename} (${n})`;
  return `${filename.slice(0, dot)} (${n})${filename.slice(dot)}`;
}

/**
 * Retry a File System Access API call when Chrome reports
 * `InvalidStateError` ("state cached in interface object… changed since
 * read from disk") or `InvalidModificationError`. Both fire when a
 * directory handle's internal entry cache goes stale after rapid
 * delete + create cycles, and a small backoff usually clears them.
 */
async function retryFsOp<T>(op: () => Promise<T>, maxRetries = 4): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await op();
    } catch (e: any) {
      lastErr = e;
      const name = e?.name || "";
      const msg = String(e?.message || "");
      const isStaleHandle =
        name === "InvalidStateError" ||
        name === "InvalidModificationError" ||
        msg.includes("state had changed since it was read from disk");
      if (!isStaleHandle || attempt === maxRetries) throw e;
      // Backoff: 50ms, 120ms, 220ms, 350ms — gives Chrome time to refresh
      // its cached directory entries.
      await new Promise((r) => setTimeout(r, 50 + attempt * 70));
    }
  }
  throw lastErr;
}
import { showAlertDialog } from "./ui/dialog.js";
import { parseRoute, editUrl, galleryUrl, pushRoute, sessionEditUrl } from "./router.js";
import { showSaveError, showAuthError, hideError, showError, showInfo } from "./ui/error-bar.js";
import { captureScreen, pasteFromClipboard, startIntervalCapture } from "./capture/pwa-capture.js";
import { showIntervalCaptureDialog, showIntervalCaptureProgress, loadCursorPreference, saveCursorPreference } from "./capture/interval-dialog.js";

export class App {
  #storage: StorageProvider | null = null;
  #fsStore: StorageProvider | null = null;
  #fileManager: FileManager | null = null;

  #currentEditor: {
    canvas: CanvasManager;
    history: History;
    selection: SelectionManager;
  } | null = null;

  /** ResizeObserver that keeps the canvas fitted to the viewport
   *  while "Fit to window" mode is active. Observes #canvas-container
   *  so panel open/close, window resize, and toolbar height changes
   *  all re-trigger the fit. */
  #fitObserver: ResizeObserver | null = null;

  /** Tear down the previous editor session's DOM listeners so they
   *  don't accumulate on the reused #svg-root element. Without this,
   *  each reopen adds another SelectionManager/CanvasManager listening
   *  to the same pointer events — dragging a shape would apply
   *  #moveElement N times per mouse tick and the shape appears to
   *  move N× faster than the cursor. */
  #disposePreviousEditor(): void {
    if (!this.#currentEditor) return;
    this.#currentEditor.selection.destroy();
    this.#currentEditor.canvas.destroy();
    this.#currentEditor = null;
    this.#fitObserver?.disconnect();
    this.#fitObserver = null;
  }

  #currentImagePath: string | null = null;
  /** `writeAnnotationsToStorage` concurrency gate. `saveInFlight` is
   *  true while an upload is running; edits that land during that
   *  window flip `savePending` instead of starting a second upload
   *  in parallel (slow backends like Drive otherwise pile up saves
   *  and freeze the UI). See `writeAnnotationsToStorage` below. */
  #saveInFlight = false;
  #savePending = false;
  /** Debounce timer for the annotation autosave. Lifted to an
   *  instance field so `flushPendingSave()` can cancel-and-fire it
   *  on navigation boundaries. */
  #autoSaveTimer: number | undefined;
  /** Same story for the thumbnail regeneration timer. */
  #thumbTimer: number | undefined;
  /** Latest ImageRecord for the currently-open image (when available). Used
   *  by the file-details drawer to show createdAt/updatedAt/sourceUrl. Null
   *  for not-yet-saved images (e.g. a freshly captured but un-persisted one). */
  #currentImageRecord: ImageRecord | null = null;
  /** Latest original data URL — used to approximate file size for the drawer. */
  #currentImageDataUrl: string = "";
  /** The file-details drawer, created per editor session. */
  #fileDetailsDrawer: FileDetailsDrawer | null = null;
  /** Save status indicator, rebuilt per editor session. */
  #saveStatusIndicator: SaveStatusIndicator | null = null;
  /** Current editor toolbar. Kept around so the header-level Save /
   *  Copy actions can delegate to the toolbar's canonical implementation
   *  (saveNow, copyNow, showSaveMenu) instead of re-implementing them. */
  #editorToolbar: Toolbar | null = null;
  /** Right-side property panel (tool properties + selection properties).
   *  Rebuilt per editor session. */
  #editorRightPanel: EditorRightPanel | null = null;
  /** DOM-element metadata captured alongside the current screenshot
   *  (browser-extension captures only). Drives the Elements sidebar
   *  panel / smart-annotation features in the editor. Null when the
   *  image has no metadata (paste, desktop capture, legacy). */
  #pageMetadata: import("@ingcreators/annot-core").PageMetadata | null = null;
  /** Teardown for the global `?` keyboard-help listener. Installed
   *  once at editor boot; removed on destroy. */
  #keyboardHelpUninstall: (() => void) | null = null;
  /** Scratchpad persistence — shared across editor sessions (the
   *  store itself is stateless, just a thin wrapper around IndexedDB). */
  #scratchpadStore = new ScratchpadStore();
  /** Reference to the Scratchpad toolbar button — kept so future hooks
   *  (e.g. highlighting when armed) have a stable anchor. */
  #scratchpadToolbarBtn: HTMLButtonElement | null = null;
  /** Live ScratchpadSection instance while its popover is open; null
   *  otherwise. Lets external events (selection change, tool change)
   *  push state in even if the popover is currently closed (they just
   *  become no-ops). */
  #openScratchpadSection: ScratchpadSection | null = null;
  /** Cached "is selection non-empty in Select mode" so a freshly
   *  opened scratchpad popover can reflect the save-enabled state
   *  without waiting for the next selection event. */
  #scratchpadCanSave = false;
  /** Id of the scratchpad item currently armed for paste (if any).
   *  Persists across popover open/close cycles so reopening shows the
   *  same active thumbnail. */
  #armedScratchpadItemId: string | null = null;
  #currentTags: Record<string, string> = {};
  #currentFolderPath: string = "";
  #splitEditor: SplitEditor | null = null;

  async init(): Promise<void> {
    const { LocalStore } = await import("./storage/local-store.js");
    const localStore = new LocalStore();
    this.#storage = localStore;
    setStorageMode("local");

    // Silently restore the filesystem handle if previously granted — this only
    // populates #fsStore so the user can switch to Device without re-picking.
    // It must NOT override the user's last-selected storage mode.
    const restored = await restoreFileSystem();
    if (restored) {
      this.#fsStore = restored;
    }

    // Respect the user's last-selected storage across reloads.
    const lastMode = loadLastStorage();
    if (lastMode === "filesystem" && this.#fsStore) {
      this.#storage = this.#fsStore;
      setStorageMode("filesystem");
    } else if (lastMode === "googledrive") {
      // If we have a persisted OAuth token AND a previously-picked
      // root folder, rehydrate the Drive store without prompting. A
      // stale token will surface as a failed API call later; users
      // can then re-select Drive to re-auth.
      const driveStore = restoreGoogleDrive();
      if (driveStore) {
        this.#storage = driveStore;
        setStorageMode("googledrive");
      } else {
        this.#storage = localStore;
        setStorageMode("local");
      }
    } else {
      // Default / "local" / everything else → Browser (LocalStore)
      this.#storage = localStore;
      setStorageMode("local");
    }

    // Restore last-viewed folder so extension captures in a fresh tab
    // land in the folder the user was last working in.
    this.#currentFolderPath = loadLastFolder();

    document.addEventListener("paste", async (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (this.#currentEditor) return;
      const dataUrl = await pasteFromClipboard();
      if (dataUrl) {
        e.preventDefault();
        await this.saveDataUrlAndOpen(dataUrl);
      }
    });

    window.addEventListener("popstate", () => this.handleRoute());

    // beforeunload: warn the user when closing a tab with a save
    // still pending or in flight. Browsers no longer honor custom
    // messages (they show a generic localized string), but setting
    // returnValue is still required to trigger the prompt. When
    // everything is clean we leave the handler silent so non-editing
    // tabs close without friction.
    window.addEventListener("beforeunload", (e) => {
      if (this.#autoSaveTimer !== undefined || this.#saveInFlight || this.#savePending) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    // Listen for Extension capture events (editPath delivered via detail)
    window.addEventListener("annot-capture", async (e: any) => {
      const { editPath, extId } = e.detail || {};
      if (!editPath) return;

      // Remember the user's selected mode; setExtensionId may switch it to "extension"
      const savedMode = getStorageMode();
      if (extId) await setExtensionId(extId);

      // Read image from extension via bridge
      const extBridge = await getStorage();
      const record = await extBridge.getImage(editPath);

      // Restore the user's selected mode (extension was a transient read target)
      setStorageMode(savedMode);

      if (!record || !record.originalDataUrl) return;

      let w = record.width;
      let h = record.height;
      if (!w || !h) {
        const img = await this.loadImage(record.originalDataUrl);
        w = img.naturalWidth;
        h = img.naturalHeight;
      }

      // Respect the user's currently selected storage (Browser / Device / Drive)
      const targetStore = this.#storage!;
      const now = new Date().toISOString();
      const savedPath = await targetStore.saveImage({
        originalDataUrl: record.originalDataUrl,
        thumbnailDataUrl: record.thumbnailDataUrl || "",
        annotationsSvg: "",
        width: w,
        height: h,
        sourceUrl: record.sourceUrl || "",
        tags: record.tags || {},
        folderPath: this.#currentFolderPath,
        createdAt: now,
        updatedAt: now,
        // Carry DOM element metadata through the extension → app
        // hand-off so smart annotations (Elements sidebar) work on
        // freshly-captured screenshots, not just reloads.
        pageMetadata: record.pageMetadata,
      });

      this.#currentImagePath = savedPath;
      this.#currentTags = record.tags || {};
      this.#fileManager = null;

      console.log("[annot/app] handoff record.pageMetadata:",
        record.pageMetadata ? `${record.pageMetadata.elements.length} elements` : "none");
      this.setupEditor(record.originalDataUrl, w, h, undefined, record.pageMetadata);

      pushRoute(editUrl(getStorageMode(), savedPath));

      deleteExtensionImage(editPath);
    });

    await this.handleRoute();
  }

  /**
   * Translate a `/handoff/<source>` external-entry URL into a regular
   * editor URL and re-dispatch. Keeps the handoff URL from sticking
   * in history (uses `replaceState`) so the user's Back button lands
   * on the gallery, not an opaque state blob.
   *
   * Currently only `googledrive` is implemented; future OneDrive /
   * GitHub sources will plug in here.
   */
  async #handleHandoff(source: string, rawState: string): Promise<void> {
    if (!rawState) {
      showError({
        message: "Drive handoff: missing state parameter.",
        severity: "warning",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.showGalleryView();
      return;
    }
    let state: { action?: string; ids?: string[]; folderId?: string };
    try {
      state = JSON.parse(rawState);
    } catch {
      showError({
        message: "Drive handoff: state parameter is not valid JSON.",
        severity: "warning",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.showGalleryView();
      return;
    }

    if (source === "googledrive") {
      await this.#handleGoogleDriveHandoff(state);
      return;
    }

    showError({
      message: `Handoff source "${source}" is not supported yet.`,
      severity: "warning",
    });
    window.history.replaceState({}, "", galleryUrl());
    this.showGalleryView();
  }

  async #handleGoogleDriveHandoff(state: { action?: string; ids?: string[]; folderId?: string }): Promise<void> {
    // Make sure the Drive store is the active one. If the user isn't
    // signed in yet, the `handleStorageSelect` flow below takes care
    // of it (sign-in + reuse of persisted root + store creation).
    if (getStorageMode() !== "googledrive" || !(this.#storage instanceof GoogleDriveStore)) {
      await this.handleStorageSelect("googledrive");
    }
    if (!(this.#storage instanceof GoogleDriveStore)) {
      showError({
        message: "Drive handoff: couldn't connect to Google Drive.",
        severity: "error",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.showGalleryView();
      return;
    }

    const action = state.action || (state.ids?.length ? "open" : "create");

    if (action === "create") {
      showInfo(
        "Creating a new annotation from Drive's New menu isn't implemented yet. Please capture via the extension or paste an image in Annot.",
      );
      window.history.replaceState({}, "", galleryUrl());
      this.showGalleryView();
      return;
    }

    if (action !== "open" || !state.ids || state.ids.length === 0) {
      showError({
        message: "Drive handoff: unsupported action or missing file id.",
        severity: "warning",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.showGalleryView();
      return;
    }

    const fileId = state.ids[0]!;
    let resolvedPath: string | null = null;
    try {
      resolvedPath = await this.#storage.resolveFileIdToPath(fileId);
    } catch (e) {
      console.error("[handoff/googledrive] resolve failed:", e);
      showError({
        message: "Drive handoff: couldn't read the file from Drive.",
        severity: "error",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.showGalleryView();
      return;
    }

    if (!resolvedPath) {
      // File exists but lives outside the user's Annot root folder.
      // Under `drive.file` we could technically operate on it, but the
      // gallery UI is path-rooted and wouldn't know how to display
      // "a file outside the workspace", so tell the user how to recover.
      showError({
        message: "That file is outside your Annot workspace folder. Use the sidebar's \"Change Drive folder\" icon to point Annot at a folder that contains it.",
        severity: "warning",
      });
      window.history.replaceState({}, "", galleryUrl());
      this.showGalleryView();
      return;
    }

    // Replace the handoff URL with the canonical edit URL (so Back
    // goes to gallery, not to the opaque handoff), then let the
    // regular route handler open the file.
    window.history.replaceState({}, "", editUrl("googledrive", resolvedPath));
    await this.handleRoute();
  }

  async handleRoute(): Promise<void> {
    const route = parseRoute();
    console.log("[handleRoute]", route);

    // Handoff from Drive UI Integration (and future OneDrive / GitHub
    // sources). Resolve the incoming file into a path the editor
    // understands, then replace the URL with the canonical edit URL.
    if (route.type === "handoff") {
      await this.#handleHandoff(route.handoffSource || "", route.handoffState || "");
      return;
    }

    let transferred = false;
    if (route.extId) {
      // Remember the user's selected mode; connecting to extension is transient
      const savedMode = getStorageMode();
      const connected = await setExtensionId(route.extId, route.store as StorageMode || "extension");
      if (connected) {
        await this.transferAllFromExtension();
        transferred = true;
        this.#fileManager = null;
        const url = new URL(window.location.href);
        url.searchParams.delete("extId");
        window.history.replaceState({}, "", url.pathname + url.search || url.pathname);
      }
      // Restore user's selected mode after extension read
      setStorageMode(savedMode);
    }

    // Capture session: open the Split Editor for scroll / perPage sessions.
    // Other session kinds (click / hotkey / interval) still carry session
    // tags for future grouping features but currently fall through to the
    // gallery view.
    if (route.session && this.#storage) {
      try {
        const records = await this.#findSessionRecords(route.session);
        const kind = records[0]?.tags?.sessionKind;
        if (records.length > 0 && (kind === "scroll" || kind === "perPage")) {
          // Rewrite the URL to the canonical `/edit/<store>?session=…` form
          // so reloads / popstate re-enter the split editor cleanly.
          pushRoute(sessionEditUrl(getStorageMode(), route.session));
          await this.setupSplitEditor(records);
          return;
        }
        if (records.length === 0) {
          console.warn("[handleRoute] session has no records in current folder:", route.session, "folder=", this.#currentFolderPath);
        }
      } catch (e) {
        console.error("[handleRoute] session lookup error:", e);
      }
    }

    if (route.type === "edit" && route.path && this.#storage) {
      try {
        // Try direct lookup first
        let record = await this.#storage.getImage(route.path);
        // If the route came from the extension and a bulk-transfer just ran,
        // the image was re-homed into the current folder — look it up there.
        if (!record && transferred && this.#currentFolderPath) {
          const filename = route.path.includes("/")
            ? route.path.slice(route.path.lastIndexOf("/") + 1)
            : route.path;
          const candidate = `${this.#currentFolderPath}/${filename}`;
          record = await this.#storage.getImage(candidate);
          if (record) {
            // Fix up the URL so it matches the actual stored path
            pushRoute(editUrl(getStorageMode(), record.path));
          }
        }
        if (record?.originalDataUrl) {
          if (route.store === "extension" && !transferred) {
            await this.transferAndOpen(record, route.path);
          } else {
            await this.openFromGallery(record);
          }
          return;
        }
      } catch (e) {
        console.error("[handleRoute] getImage error:", e);
      }
    }

    this.showGalleryView();
  }

  /**
   * Locate all images in the current folder that carry `tags.session === sessionId`.
   * Returns them sorted by sessionIndex (numeric, asc) so the filmstrip
   * presents frames in capture order.
   */
  async #findSessionRecords(sessionId: string): Promise<ImageRecord[]> {
    if (!this.#storage) return [];
    const folderPath = this.#currentFolderPath;
    const all = await this.#storage.listImages(folderPath);
    const matched = all.filter((r) => r.tags?.session === sessionId);
    matched.sort((a, b) => {
      const ai = Number(a.tags?.sessionIndex ?? 0);
      const bi = Number(b.tags?.sessionIndex ?? 0);
      if (ai !== bi) return ai - bi;
      // Fallback: compare path for stable ordering
      return a.path.localeCompare(b.path);
    });
    return matched;
  }

  // ---- File Manager (Gallery) ----

  private showGalleryView(): void {
    console.log("[showGalleryView] mode:", getStorageMode(), "storage:", this.#storage?.constructor?.name);
    // Tear down split editor if active (session → gallery).
    if (this.#splitEditor) {
      this.#splitEditor.unmount();
      this.#splitEditor = null;
    }
    const canvasContainer = document.getElementById("canvas-container")!;
    canvasContainer.style.display = "none";

    const fileManagerEl = document.getElementById("file-manager")!;
    fileManagerEl.style.display = "";

    const statusbar = document.getElementById("statusbar")!;
    statusbar.style.display = "none";

    // Tear down editor chrome: remove the body.editor-mode class (hides
    // #editor-header and restores the gallery layout), clear the header
    // content, and destroy the file-details drawer so it doesn't leak
    // into the next editor session.
    document.body.classList.remove("editor-mode");
    const editorHeaderEl = document.getElementById("editor-header");
    if (editorHeaderEl) editorHeaderEl.innerHTML = "";
    this.#fileDetailsDrawer?.destroy();
    this.#fileDetailsDrawer = null;
    // The save-status indicator is owned by the editor header DOM we
    // just cleared; null the reference so the next session creates a
    // fresh one attached to the fresh header markup.
    this.#saveStatusIndicator = null;
    // Same for the sidebar toolbar — DOM is cleared via .innerHTML.
    const sidebarEl = document.getElementById("editor-sidebar");
    if (sidebarEl) sidebarEl.innerHTML = "";
    this.#editorToolbar = null;
    // Release the canvas/selection event listeners so they don't
    // pile up on the shared #svg-root element across sessions.
    this.#disposePreviousEditor();
    // Right panel: destroy() clears its DOM and removes the
    // body.has-right-panel class so the canvas reclaims the space.
    this.#editorRightPanel?.destroy();
    this.#editorRightPanel = null;

    if (!this.#fileManager) {
      const sidebarEl = document.getElementById("sidebar")!;
      const mainContentEl = document.getElementById("main-content")!;

      this.#fileManager = new FileManager(sidebarEl, mainContentEl, {
        onStorageSelect: (mode) => this.handleStorageSelect(mode),
        onStorageReselect: (mode) => this.handleStorageSelect(mode, true),
        onOpenImage: (record) => this.openFromGallery(record),
        onFolderChange: (folderPath) => {
          this.#currentFolderPath = folderPath;
          saveLastFolder(folderPath);
        },
        onNewFolder: () => this.#fileManager!.createNewFolder(),
        onUploadImage: () => this.openFileDialog(),
        onCaptureScreen: () => this.captureScreenAndSave(),
        onTimedCapture: () => this.timedCaptureAndSave(),
        onPasteClipboard: () => this.pasteAndSave(),
      });

      this.#updateSidebarStatus();
    }

    this.buildFileManagerHeader();

    if (this.#storage) {
      if (this.#fileManager.storage !== this.#storage) {
        this.#fileManager.setStorage(
          this.#storage,
          getStorageMode(),
          this.#currentRootName(),
        );
      }
      this.#fileManager.navigateToFolder(this.#currentFolderPath);
    }
  }

  async showGallery(): Promise<void> {
    // Flush any in-flight / debounced save before leaving the editor
    // so the user doesn't lose the last few edits between a pending
    // autosave timer and the navigation. Returns immediately on
    // Local / Device where the flush is essentially free; on Drive
    // this may briefly show "Saving…" before the gallery renders.
    await this.#flushPendingSave();
    if (window.location.pathname !== galleryUrl()) {
      pushRoute(galleryUrl());
    }
    this.showGalleryView();
  }

  /**
   * Resolve once (a) no debounced save is scheduled, (b) no upload is
   * running, and (c) no catch-up save is queued. Safe to call while
   * not editing — it no-ops.
   *
   * Called from every in-app navigation boundary (gallery button,
   * brand click, session cleanup) and from `beforeunload` so the
   * user doesn't silently lose a pending edit.
   */
  async #flushPendingSave(): Promise<void> {
    // If a debounce timer is armed, cancel it and run the save now.
    if (this.#autoSaveTimer !== undefined) {
      clearTimeout(this.#autoSaveTimer);
      this.#autoSaveTimer = undefined;
      await this.writeAnnotationsToStorage();
    }
    // Wait for any in-flight save + catch-up save to settle. Polling
    // with a short interval is ugly but this only runs at navigation
    // boundaries, never in the hot edit path.
    while (this.#saveInFlight || this.#savePending) {
      await new Promise((r) => setTimeout(r, 50));
    }
    // Also flush the thumbnail regen so the gallery tile that's
    // about to be rendered shows the latest state.
    if (this.#thumbTimer !== undefined) {
      clearTimeout(this.#thumbTimer);
      this.#thumbTimer = undefined;
      await this.writeThumbnailToStorage();
    }
  }

  private buildFileManagerHeader(): void {
    const toolbarEl = document.getElementById("toolbar")!;
    toolbarEl.innerHTML = "";

    const brand = document.createElement("a");
    brand.className = "brand";
    brand.href = "#";
    // Logo dimensions (30×30) and left offset (via CSS padding) match
    // the editor header's .editor-header-brand, so the logo stays at
    // the exact same x/y position when navigating between file-manager
    // and editor views. Navigation landmarks must not jump between
    // views — cf. Figma / Miro / Google Drive, all of which keep the
    // brand mark pinned to a single absolute position. 30×30 sits in
    // the visual sweet spot for a 48px header (~62% fill ratio),
    // giving the brand clear presence without crowding the adjacent
    // controls.
    brand.innerHTML = `
      <svg width="30" height="30" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="7" r="3.5" fill="#7c9cff"/>
        <path d="M24 13 L13 38" stroke="#7ef0c5" stroke-width="4" stroke-linecap="round"/>
        <path d="M24 13 L35 38" stroke="#b391ff" stroke-width="4" stroke-linecap="round"/>
        <path d="M19 24 H29" stroke="#7c9cff" stroke-width="3.5" stroke-linecap="round"/>
      </svg>
      <span class="brand-text">Annot</span>
    `;
    brand.addEventListener("click", (e) => { e.preventDefault(); void this.showGallery(); });
    toolbarEl.appendChild(brand);

    const searchWrap = document.createElement("div");
    searchWrap.className = "header-search-wrap";
    const searchIcon = document.createElement("span");
    searchIcon.className = "material-symbols-outlined header-search-icon";
    searchIcon.textContent = "search";
    searchWrap.appendChild(searchIcon);

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search... (e.g. screen:login)";
    search.className = "header-search";
    search.setAttribute("aria-label", "Search images and tags");
    searchWrap.appendChild(search);
    toolbarEl.appendChild(searchWrap);

    if (this.#fileManager) this.#fileManager.setSearchInput(search);

    const spacer = document.createElement("div");
    spacer.className = "toolbar-spacer";
    toolbarEl.appendChild(spacer);

    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "header-info-btn material-symbols-outlined";
    helpBtn.textContent = "help_outline";
    setTooltip(helpBtn, "Help");
    helpBtn.setAttribute("aria-label", "Help");
    toolbarEl.appendChild(helpBtn);

    // Shared theme toggle factory (from @ingcreators/annot-core) — same behavior
    // as the editor toolbar's toggle so both stay in sync.
    toolbarEl.appendChild(
      createThemeToggle("header-info-btn material-symbols-outlined"),
    );
  }

  /** Display name for the root of the currently-active storage.
   *  Shown under the top-level FOLDERS node in the sidebar so the
   *  user sees WHICH device folder / Drive folder is in use. Null
   *  when the backend has no meaningful user-facing root (e.g.
   *  Browser/Local stores to per-origin IDB). */
  #currentRootName(): string | undefined {
    const mode = getStorageMode();
    if (mode === "filesystem") return getFsRootName() || undefined;
    if (mode === "googledrive") return loadDriveRoot()?.name;
    return undefined;
  }

  /**
   * Click-to-switch: if already connected, reuse the existing storage.
   * Use handleStorageReselect() to force a fresh picker.
   */
  private async handleStorageSelect(mode: StorageMode, forcePicker = false): Promise<void> {
    try {
      if (mode === "local") {
        const { LocalStore } = await import("./storage/local-store.js");
        this.#storage = new LocalStore();
        setStorageMode("local");
        saveLastStorage("local");
      } else if (mode === "filesystem") {
        if (!forcePicker && this.#fsStore) {
          // Reuse the previously selected folder
          this.#storage = this.#fsStore;
          setStorageMode("filesystem");
          saveLastStorage("filesystem");
        } else {
          const store = await openFileSystemDirectory();
          if (!store) return;
          this.#fsStore = store;
          this.#storage = store;
          saveLastStorage("filesystem");
        }
      } else if (mode === "googledrive") {
        try {
          const token = await signIn();
          // Reuse the previously-picked root when available — under
          // `drive.file` that picker result is the app's only handle
          // onto the user's Drive, so skipping the picker here just
          // skips an extra click, not an access grant.
          // `forcePicker` is wired to the sidebar's reselect icon so
          // the user can switch the Drive root the same way Device
          // lets them switch folders.
          let folder = forcePicker ? null : loadDriveRoot();
          if (!folder) {
            folder = await showFolderPicker();
            if (!folder) return;
            saveDriveRoot(folder);
          }
          const store = connectGoogleDrive(token, folder.id);
          this.#storage = store;
          saveLastStorage("googledrive");
        } catch (e) {
          console.error("[app] Drive connection failed:", e);
          return;
        }
      }

      this.#currentFolderPath = "";
      this.#updateSidebarStatus();

      if (this.#fileManager && this.#storage) {
        this.#fileManager.setStorage(
          this.#storage,
          getStorageMode(),
          this.#currentRootName(),
        );
        this.#fileManager.refresh("");
      }
    } catch (e) {
      console.error("[app] Storage switch error:", e);
    }
  }

  #updateSidebarStatus(): void {
    if (!this.#fileManager) return;
    const sidebar = this.#fileManager.sidebar;
    sidebar.setStorageStatus("local", true, "Local");
    sidebar.setStorageStatus("filesystem", !!this.#fsStore, getFsRootName() || "Not connected");
    const driveRoot = loadDriveRoot();
    sidebar.setStorageStatus(
      "googledrive",
      isDriveConnected(),
      isDriveConnected() ? (driveRoot?.name ?? "Connected") : "Not connected",
    );
    sidebar.setActiveMode(getStorageMode());
  }

  // ---- Editor ----

  private async transferAllFromExtension(): Promise<void> {
    try {
      const extStorage = await getStorage();
      // Extension root images only — walking all folders would be expensive
      const rootImages = await extStorage.listImages("");
      if (rootImages.length === 0) return;

      console.log("[transfer] Found", rootImages.length, "images in Extension IDB root");

      const { LocalStore } = await import("./storage/local-store.js");
      // Transfer to the user's currently selected storage
      const localStore = this.#storage || new LocalStore();

      for (const img of rootImages) {
        try {
          const full = await extStorage.getImage(img.path);
          if (!full || !full.originalDataUrl) continue;

          let w = full.width;
          let h = full.height;
          if (!w || !h) {
            try {
              const imgEl = await this.loadImage(full.originalDataUrl);
              w = imgEl.naturalWidth;
              h = imgEl.naturalHeight;
            } catch { continue; }
          }

          const now = new Date().toISOString();
          // Preserve the extension's filename (not path — we re-home into the
          // user's currently-selected folder).
          const filename = img.path.includes("/") ? img.path.slice(img.path.lastIndexOf("/") + 1) : img.path;
          // Wrap in retry: rapid back-to-back saves into a fresh FS handle
          // can hit Chrome's "stale cached state" issue (InvalidStateError).
          await retryFsOp(() => localStore.saveImage({
            originalDataUrl: full.originalDataUrl,
            thumbnailDataUrl: full.thumbnailDataUrl || "",
            annotationsSvg: full.annotationsSvg || "",
            width: w,
            height: h,
            sourceUrl: full.sourceUrl || "",
            tags: full.tags || {},
            folderPath: this.#currentFolderPath,
            filename,
            createdAt: full.createdAt || now,
            updatedAt: now,
            // Carry DOM element metadata through the extension → app
            // hand-off so the Elements sidebar works on captures that
            // came in through this bulk-transfer path (which is how
            // the extension typically hands screenshots over).
            pageMetadata: full.pageMetadata,
          }));

          deleteExtensionImage(img.path);
        } catch (e) {
          // Don't abort the whole batch on a single bad image — log and continue.
          console.error("[transfer] failed for", img.path, "(continuing):", e);
        }
      }

      console.log("[transfer] Transferred", rootImages.length, "images to", getStorageMode(), "folder:", JSON.stringify(this.#currentFolderPath));
    } catch (e) {
      console.error("[transfer] Error:", e);
    }
  }

  private async transferAndOpen(record: ImageRecord, extPath: string): Promise<void> {
    // Respect the user's currently selected storage
    const localStore = this.#storage || new (await import("./storage/local-store.js")).LocalStore();

    let w = record.width;
    let h = record.height;
    if (!w || !h) {
      const img = await this.loadImage(record.originalDataUrl);
      w = img.naturalWidth;
      h = img.naturalHeight;
    }

    const now = new Date().toISOString();
    const savedPath = await localStore.saveImage({
      originalDataUrl: record.originalDataUrl,
      thumbnailDataUrl: record.thumbnailDataUrl || "",
      annotationsSvg: record.annotationsSvg || "",
      width: w,
      height: h,
      sourceUrl: record.sourceUrl || "",
      tags: record.tags || {},
      folderPath: this.#currentFolderPath,
      createdAt: now,
      updatedAt: now,
    });

    this.#currentImagePath = savedPath;
    this.#currentTags = record.tags || {};
    this.#fileManager = null;

    pushRoute(editUrl(getStorageMode(), savedPath));

    this.setupEditor(record.originalDataUrl, w, h, record.annotationsSvg || undefined, record.pageMetadata);

    deleteExtensionImage(extPath);
  }

  async openFromGallery(record: ImageRecord): Promise<void> {
    if (!this.#storage) return;

    const full = await this.#storage.getImage(record.path);
    if (!full) return;

    this.#currentImagePath = full.path;
    this.#currentImageRecord = full;
    this.#currentImageDataUrl = full.originalDataUrl;
    this.#currentTags = full.tags || {};

    let w = full.width;
    let h = full.height;
    if ((!w || !h) && full.originalDataUrl) {
      const img = await this.loadImage(full.originalDataUrl);
      w = img.naturalWidth;
      h = img.naturalHeight;
    }

    pushRoute(editUrl(getStorageMode(), full.path));

    this.setupEditor(
      full.originalDataUrl,
      w,
      h,
      full.annotationsSvg || undefined,
      full.pageMetadata,
    );
  }

  /**
   * Mount the Split Editor for a `perPage` or `scroll` capture session.
   * The editor stacks all session frames vertically (forming a virtual
   * continuous page) and lets the user drag, add, or remove page-break
   * lines. On Apply the images are re-sliced to the new boundaries and
   * persisted (delete-all + save-N); the session may end up with a
   * different number of images than it started with.
   */
  async setupSplitEditor(records: ImageRecord[]): Promise<void> {
    if (records.length === 0 || !this.#storage) return;

    // Tear down any previous instance
    if (this.#splitEditor) {
      this.#splitEditor.unmount();
      this.#splitEditor = null;
    }

    // `listImages` on FileSystem / Drive / some extension-bridged stores
    // returns lazy records with `originalDataUrl: ""` for performance. The
    // split editor needs the full pixel data, so load each record via
    // `getImage()` which forces the full read.
    const storage = this.#storage;
    const fullRecords: ImageRecord[] = [];
    for (const r of records) {
      if (r.originalDataUrl) {
        fullRecords.push(r);
        continue;
      }
      try {
        const full = await storage.getImage(r.path);
        if (full?.originalDataUrl) {
          fullRecords.push(full);
        } else {
          console.warn("[split-editor] getImage returned no data for:", r.path);
          fullRecords.push(r); // push placeholder so index/count stays stable; mount() will throw with a clear message
        }
      } catch (e) {
        console.error("[split-editor] getImage failed for:", r.path, e);
        fullRecords.push(r);
      }
    }
    records = fullRecords;

    const sessionId = records[0]!.tags?.session || "";

    // Hide the single-image editor chrome so the SplitEditor owns the screen.
    const canvasContainer = document.getElementById("canvas-container")!;
    canvasContainer.style.display = "none";
    const statusbar = document.getElementById("statusbar")!;
    statusbar.style.display = "none";
    const fileManagerEl = document.getElementById("file-manager")!;
    fileManagerEl.style.display = "none";

    const closeAndGoHome = () => {
      this.#splitEditor?.unmount();
      this.#splitEditor = null;
      canvasContainer.style.display = "";
      statusbar.style.display = "";
      void this.showGallery();
    };

    try {
      const { SplitEditor } = await import("./editor/split-editor.js");
      this.#splitEditor = new SplitEditor(records, {
        onCancel: () => closeAndGoHome(),
        onApply: async (slices) => {
          try {
            await this.#applySlicesToStorage(records, slices, sessionId);
            // After apply, session content changed — go back to gallery in
            // the folder that owned the session.
            closeAndGoHome();
          } catch (e: any) {
            console.error("[split-editor] apply failed:", e);
            await showAlertDialog({
              title: "Couldn't apply splits",
              message: e?.message || "An error occurred while saving the new slices.",
            });
          }
        },
      });
      await this.#splitEditor.mount();
    } catch (e: any) {
      console.error("[split-editor] mount failed:", e);
      await showAlertDialog({
        title: "Couldn't open split editor",
        message: e?.message || "Failed to load session frames.",
      });
      closeAndGoHome();
    }
  }

  /**
   * Persist a new list of slices as replacement frames for the given
   * session. All original records are deleted first, then N fresh records
   * are saved. Output count may differ from input count (splits can be
   * added or removed). Preserves session id and sessionKind; assigns fresh
   * captureIds and re-sequences sessionIndex/page/sessionTotal.
   */
  async #applySlicesToStorage(
    records: ImageRecord[],
    slices: import("./editor/split-editor.js").SplitEditorSlice[],
    sessionId: string,
  ): Promise<void> {
    if (!this.#storage) throw new Error("Storage is not available");
    if (slices.length === 0) throw new Error("No slices to save");
    const storage = this.#storage;
    const now = new Date().toISOString();
    const total = slices.length;

    // Derive a stable base filename stem from the first record (strip any
    // trailing "-p<n>" so re-splits don't accumulate suffixes).
    const first = records[0]!;
    const firstName = getFilename(first.path);
    const dot = firstName.lastIndexOf(".");
    let stem = dot >= 0 ? firstName.slice(0, dot) : firstName;
    stem = stem.replace(/-p\d+$/, "");

    // The split editor outputs lossless PNG slices. Run them through the
    // shared encoder so each slice respects the user's format preference
    // (PNG-8 smart fallback by default — same logic as initial captures).
    const encodeOptions = loadEncodeOptions();

    // Inherit shared metadata from the first record
    const inheritedTags = { ...(first.tags || {}) };
    // Drop per-frame keys that we'll re-assign
    delete inheritedTags.captureId;
    delete inheritedTags.page;
    delete inheritedTags.sessionIndex;
    delete inheritedTags.sessionTotal;
    inheritedTags.session = sessionId;

    // Add a `.split-<timestamp>-` prefix to slice filenames so they never
    // collide with the originals we're about to remove. We rename them back
    // (drop the prefix) only AFTER all originals are safely deleted.
    const tempPrefix = `.split-${Date.now()}-`;

    // 1) Save all N new slices first (with disambiguated filenames). This
    //    ensures the user never loses data if a delete fails partway.
    const pad = String(total).length;
    const savedSlicePaths: string[] = [];
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i]!;
      // Re-encode the slice (PNG → PNG-8 / PNG / JPEG per options).
      const encoded = await encodeCaptureInWorker(slice.dataUrl, encodeOptions);
      const finalDataUrl = encoded.dataUrl;
      const ext = encoded.chosen === "jpeg" ? ".jpg" : ".png";
      const thumb = await storage.generateThumbnail(finalDataUrl);
      const page = String(i + 1).padStart(pad, "0");
      const tmpFilename = `${tempPrefix}${stem}-p${page}${ext}`;
      const savedPath = await retryFsOp(() => storage.saveImage({
        originalDataUrl: finalDataUrl,
        thumbnailDataUrl: thumb,
        annotationsSvg: "",
        width: slice.width,
        height: slice.height,
        sourceUrl: first.sourceUrl || "",
        tags: {
          ...inheritedTags,
          captureId: newIdB58(),
          page: String(i + 1),
          sessionIndex: String(i),
          sessionTotal: String(total),
        },
        folderPath: first.folderPath,
        filename: tmpFilename,
        createdAt: first.createdAt || now,
        updatedAt: now,
      }));
      savedSlicePaths.push(savedPath);
    }

    // 2) Now that all slices are safely saved, delete every original record.
    for (const rec of records) {
      try {
        await retryFsOp(() => storage.deleteImage(rec.path));
      } catch (e) {
        console.warn("[split-editor] delete failed (continuing):", rec.path, e);
      }
    }

    // 3) Rename slices to drop the temporary prefix so the user sees the
    //    expected names. If a same-named file already exists in the folder
    //    (e.g. orphaned output from a prior split that wasn't cleaned up),
    //    uniquify with " (2)", " (3)" etc. so we never lose the slice.
    for (const tmpPath of savedSlicePaths) {
      const tmpName = getFilename(tmpPath);
      if (!tmpName.startsWith(tempPrefix)) continue;
      const baseFinalName = tmpName.slice(tempPrefix.length);
      let finalName = baseFinalName;
      let success = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await retryFsOp(() => storage.renameImage(tmpPath, finalName));
          success = true;
          break;
        } catch (e: any) {
          const msg = String(e?.message || "");
          if (msg.includes("already exists") || e?.name === "ConstraintError") {
            // Bump the suffix and retry: "name.png" → "name (2).png" → "name (3).png" ...
            finalName = bumpFilenameSuffix(baseFinalName, attempt + 2);
            continue;
          }
          throw e;
        }
      }
      if (!success) {
        console.warn("[split-editor] rename failed after retries (keeping temp name):", tmpPath);
      }
    }
  }

  setupEditor(
    dataUrl: string,
    width: number,
    height: number,
    annotations?: string,
    pageMetadata?: import("@ingcreators/annot-core").PageMetadata,
  ): void {
    this.#currentImageDataUrl = dataUrl;
    this.#pageMetadata = pageMetadata ?? null;

    // Clean up any previous editor session's listeners before creating
    // new CanvasManager / SelectionManager. Critical because the
    // #svg-root element is reused across sessions.
    this.#disposePreviousEditor();

    const canvasContainer = document.getElementById("canvas-container")!;
    const fileManagerEl = document.getElementById("file-manager")!;
    fileManagerEl.style.display = "none";
    canvasContainer.style.display = "";

    const statusbar = document.getElementById("statusbar")!;
    statusbar.style.display = "";

    let svg = document.getElementById("svg-root") as unknown as SVGSVGElement | null;
    if (!svg) {
      canvasContainer.innerHTML = "";
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
      svg.id = "svg-root";
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      canvasContainer.appendChild(svg);
    } else {
      svg.innerHTML = "";
      svg.removeAttribute("style");
    }
    canvasContainer.querySelector(".property-panel")?.remove();

    const canvas = new CanvasManager(svg, dataUrl, width, height);
    const history = new History(canvas.annotations);
    const selection = new SelectionManager(canvas, history);

    // Keep "Fit to window" tracking the viewport size: re-fit whenever
    // #canvas-container resizes. This covers window resize, right-panel
    // open/close (future), devtools toggle, etc. — the user picks Fit
    // once and the canvas keeps matching the viewport.
    this.#fitObserver?.disconnect();
    this.#fitObserver = new ResizeObserver(() => canvas.refitIfFitMode());
    this.#fitObserver.observe(canvasContainer);

    // Mark the body as "editor mode" so the editor-header becomes visible
    // and the toolbar / canvas offsets account for it.
    // showGalleryView() removes this class.
    document.body.classList.add("editor-mode");

    // Tear down any drawer from a previous editor session and build a
    // fresh one for this image. Attached to document.body so it uses the
    // same absolute-positioning coordinate space as toolbar/canvas/statusbar.
    this.#fileDetailsDrawer?.destroy();
    this.#fileDetailsDrawer = new FileDetailsDrawer(document.body, {
      filename: this.#currentImagePath ? getFilename(this.#currentImagePath) : "(untitled)",
      folderPath: this.#currentImageRecord?.folderPath ?? this.#currentFolderPath,
      width,
      height,
      fileSizeBytes: estimateDataUrlBytes(dataUrl),
      createdAt: this.#currentImageRecord?.createdAt,
      updatedAt: this.#currentImageRecord?.updatedAt,
      sourceUrl: this.#currentImageRecord?.sourceUrl,
      tags: this.#currentTags,
    });
    this.#fileDetailsDrawer.onRename = (newName) => this.#renameCurrentImage(newName);
    this.#fileDetailsDrawer.onTagsChange = (t) => {
      this.#currentTags = t;
      this.writeAnnotationsToStorage();
    };

    this.#buildEditorHeader();
    this.buildEditorStatusbar(canvas, width, height);

    // The editor toolbar moves from the top bar to a left vertical
    // sidebar (Draw.io / Figma pattern). Theme toggle + gallery button
    // live in the editor header; save/copy/open move there too as
    // document-level actions. Tool ▼ dropdowns are suppressed because
    // the right panel renders tool properties persistently instead.
    const sidebarEl = document.getElementById("editor-sidebar")!;
    sidebarEl.innerHTML = "";
    const toolbar = new Toolbar(
      sidebarEl,
      canvas,
      history,
      selection,
      (toolName, toolId) => {
        const el = document.getElementById("status-tool");
        if (el) el.textContent = toolName;
        // Show the active tool's properties in the right panel
        // (or hide the tool section when switching to Select).
        this.#editorRightPanel?.showToolProperties(toolId);
        // Any toolbar tool change also cancels a pending scratchpad
        // paste — clear the armed-thumbnail highlight so the user
        // isn't led to believe the scratchpad item is still waiting
        // to drop. (The popover may not currently be open; the
        // section instance is tracked separately so we can still
        // clear its state if the user reopens it.)
        this.#openScratchpadSection?.setActiveItem(null);
        this.#armedScratchpadItemId = null;
      },
      {
        orientation: "vertical",
        showThemeToggle: false,
        showGalleryButton: false,
        showSaveGroup: false,
        // Variant flyouts (shape / arrow / text / draw / redact) open
        // a compact icon-chip row from the ▼ arrow. Full property
        // editing still lives in the right panel — the flyout only
        // shortcuts "pick sub-shape → start drawing".
        hideToolDropdowns: false,
        // Direct-download filenames preserve the opened image's base
        // name (see `buildDownloadName` in core). Freshly-captured
        // images without a stored path fall back to the timestamp
        // default inside the export functions.
        getCurrentFilename: () => this.#currentImagePath
          ? getFilename(this.#currentImagePath)
          : undefined,
      },
    );
    this.#editorToolbar = toolbar;

    // Scratchpad library lives on the toolbar (consistent with other
    // "add to canvas" actions). The popover is rendered against the
    // button via core's shared popover helper.
    const scratchpadBtn = toolbar.registerExtraToolButton({
      id: "scratchpad",
      icon: "collections_bookmark",
      title: "Scratchpad",
      onClick: (anchor) => this.#openScratchpadPopover(
        anchor, canvas, selection, history,
      ),
    });
    this.#scratchpadToolbarBtn = scratchpadBtn;

    // Right property panel — now pure context (tool defaults +
    // selection properties). Scratchpad moved to the toolbar as its
    // own library popover so the right panel has a single clean
    // responsibility: "edit the thing the user is focused on".
    const rightPanelEl = document.getElementById("editor-right-panel")!;
    this.#editorRightPanel?.destroy();
    this.#editorRightPanel = new EditorRightPanel(
      rightPanelEl,
      toolbar,
      canvas,
      history,
      selection,
    );
    // Push DOM-element metadata (captured by the browser extension)
    // into the right panel so the Elements section appears for
    // browser-sourced screenshots. Null/undefined hides the section
    // gracefully for paste / desktop / legacy captures.
    this.#editorRightPanel.setPageMetadata(this.#pageMetadata);

    // Global `?` key → open the keyboard-shortcut help modal. Idempotent
    // — if a prior editor session installed a listener, tear it down
    // first so we don't stack handlers across re-opens.
    this.#keyboardHelpUninstall?.();
    this.#keyboardHelpUninstall = installKeyboardHelp();

    selection.onChange = () => {
      const els = selection.selectedElements;
      // Selection-based properties only show while Select is active;
      // during a drawing tool, we keep the tool's defaults visible
      // even if a shape was momentarily selected by the creation flow.
      if (els.length > 0 && !canvas.activeTool) {
        this.#editorRightPanel?.showSelectionProperties(els);
      } else {
        this.#editorRightPanel?.showSelectionProperties([]);
      }
      // Scratchpad "+ Save" button is enabled only while something
      // is selected in Select mode (serializeSelection needs at
      // least one element). Stored so the popover can consult it when
      // it opens later.
      this.#scratchpadCanSave = els.length > 0 && !canvas.activeTool;
      this.#openScratchpadSection?.setSaveEnabled(this.#scratchpadCanSave);
    };

    history.onStateChange = () => {
      // Reflect "edits made" immediately — the debounce hides latency
      // but the user should know something will be saved soon.
      this.#saveStatusIndicator?.setStatus("pending");
      clearTimeout(this.#autoSaveTimer);
      // Network-backed stores (Drive) get a longer debounce so rapid
      // +/- clicks on a slider coalesce into a single upload. Local
      // stores are cheap enough to keep the tight 500ms window.
      const saveDebounceMs = getStorageMode() === "googledrive" ? 1500 : 500;
      this.#autoSaveTimer = window.setTimeout(() => {
        this.#autoSaveTimer = undefined;
        void this.writeAnnotationsToStorage();
      }, saveDebounceMs);
      clearTimeout(this.#thumbTimer);
      this.#thumbTimer = window.setTimeout(() => {
        this.#thumbTimer = undefined;
        void this.writeThumbnailToStorage();
      }, 2000);
    };

    if (annotations) {
      this.restoreAnnotations(canvas, annotations);
      history.save();
    } else if (
      this.#currentTags["click.x"] !== undefined &&
      this.#currentTags["click.y"] !== undefined &&
      this.#currentTags["click.marker"] !== "added"
    ) {
      // First-time open of a click-captured image — draw a target marker
      // at the recorded click position so the user sees where the click was.
      this.#addClickMarker(canvas);
      this.#currentTags["click.marker"] = "added";
      history.save();
      // Persist the marker so we don't re-add it on next open,
      // and so the thumbnail gets refreshed with the marker included.
      this.writeAnnotationsToStorage();
    }

    this.#currentEditor = { canvas, history, selection };
  }

  buildEditorStatusbar(canvas: CanvasManager, width: number, height: number): void {
    const statusbar = document.getElementById("statusbar")!;
    statusbar.innerHTML = "";

    const zoomEl = document.createElement("div");
    zoomEl.id = "status-zoom";
    statusbar.appendChild(zoomEl);
    this.buildZoomControls(canvas, zoomEl);

    const sizeEl = document.createElement("span");
    sizeEl.textContent = `${width} \u00d7 ${height}`;
    setTooltip(sizeEl, "Image dimensions (width × height in pixels)");
    statusbar.appendChild(sizeEl);

    // Spacer pushes the tool indicator to the far right. Tags and the
    // breadcrumb live in #editor-header, so this statusbar stays focused
    // on canvas-state info only:
    //   [zoom] [dimensions] ───── [current tool]
    const spacer = document.createElement("span");
    spacer.className = "toolbar-spacer";
    statusbar.appendChild(spacer);

    const toolEl = document.createElement("span");
    toolEl.id = "status-tool";
    setTooltip(toolEl, "Current tool — press V or Esc to return to Select");
    toolEl.textContent = "Select";
    statusbar.appendChild(toolEl);
  }

  /**
   * Single-row editor header (industry-standard compact layout, ~48px):
   *
   *   [A]  Device › test › image-1776...png  ⓘ             [?] [☀]
   *
   * Rationale:
   *   - Filename is the last segment of a file's PATH. Treating it as
   *     the final breadcrumb segment (bold, non-clickable) reflects
   *     the semantic reality and matches Google Drive / Finder / VS Code.
   *   - A single row at 48px leaves more room for the canvas than
   *     the previous 64px 2-row layout, without losing any info —
   *     tags already moved to the file-details drawer.
   *   - Overflow is solved by flex-shrink priority: ancestor breadcrumb
   *     segments shrink first (ellipsis), while the FILENAME segment
   *     refuses to shrink (flex-shrink: 0). A very long path shows
   *     "Device › … › folder › image.png" — filename is always visible.
   */
  #buildEditorHeader(): void {
    const headerEl = document.getElementById("editor-header");
    if (!headerEl) return;
    headerEl.innerHTML = "";

    // Brand — A icon, click → gallery root
    const brandBtn = document.createElement("button");
    brandBtn.type = "button";
    brandBtn.className = "editor-header-brand";
    setTooltip(brandBtn, "Back to Gallery");
    brandBtn.setAttribute("aria-label", "Back to Gallery");
    // Logo is 30×30 — matches the file-manager header's .brand SVG
    // so the logo stays at the exact same x/y position when the user
    // navigates between gallery and editor views. 30px fills ~62% of
    // the 48px header, which is the sweet spot used by Figma / Slack /
    // Notion (all ≈ 28–32px in an equivalent-height chrome).
    brandBtn.innerHTML = `
      <svg width="30" height="30" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="7" r="3.5" fill="#7c9cff"/>
        <path d="M24 13 L13 38" stroke="#7ef0c5" stroke-width="4" stroke-linecap="round"/>
        <path d="M24 13 L35 38" stroke="#b391ff" stroke-width="4" stroke-linecap="round"/>
        <path d="M19 24 H29" stroke="#7c9cff" stroke-width="3.5" stroke-linecap="round"/>
      </svg>
    `;
    brandBtn.addEventListener("click", () => {
      this.#currentFolderPath = "";
      void this.showGallery();
    });
    headerEl.appendChild(brandBtn);

    // Breadcrumb — folder path. Appends filename as the active final
    // segment + info button, so the full path reads as one unit.
    const breadcrumb = this.#buildEditorBreadcrumb();
    breadcrumb.classList.add("editor-header-path");

    if (this.#currentImagePath) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "\u203a";
      sep.setAttribute("aria-hidden", "true");
      breadcrumb.appendChild(sep);

      // Filename is the "active" final breadcrumb segment. Double-click
      // enters inline rename mode (Finder / Notion convention). Single
      // click leaves the text selectable so users can copy the name.
      const filenameEl = document.createElement("span");
      filenameEl.className = "breadcrumb-item breadcrumb-filename active";
      filenameEl.textContent = getFilename(this.#currentImagePath);
      setTooltip(filenameEl, `${this.#currentImagePath}\nDouble-click to rename`);
      filenameEl.addEventListener("dblclick", () => {
        this.#startHeaderFilenameRename(filenameEl);
      });
      breadcrumb.appendChild(filenameEl);

      const infoBtn = document.createElement("button");
      infoBtn.type = "button";
      infoBtn.className = "editor-header-info-btn material-symbols-outlined";
      infoBtn.textContent = "info";
      setTooltip(infoBtn, "Show file details and all tags");
      infoBtn.setAttribute("aria-label", "Show file details and all tags");
      infoBtn.addEventListener("click", () => {
        this.#fileDetailsDrawer?.toggle();
      });
      breadcrumb.appendChild(infoBtn);
    }
    headerEl.appendChild(breadcrumb);

    // Save status indicator — sits directly after the filename.
    // Rationale: save state is a property OF this file; keeping it next
    // to the file identifier lets the eye read "image.png · Saved" as a
    // single unit. Industry pattern: Figma, Notion, VS Code, macOS
    // title bar all place edit/save status beside the title, not at
    // the far right of the window.
    this.#saveStatusIndicator = new SaveStatusIndicator(headerEl);

    // Spacer then pushes global actions to the far right.
    const spacer = document.createElement("span");
    spacer.className = "toolbar-spacer";
    headerEl.appendChild(spacer);

    // File action cluster (Open / Copy / Save ▼) — document-level
    // actions that used to live in the top toolbar's right group. We
    // render them as standard toolbar buttons in the header and
    // delegate to the canonical Toolbar implementation so keyboard
    // shortcuts (Ctrl+S, Ctrl+C) + click both go through one path.
    this.#appendHeaderFileActions(headerEl);

    // Help (placeholder — future keyboard-shortcuts / feature overlay)
    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "header-info-btn material-symbols-outlined";
    helpBtn.textContent = "help_outline";
    setTooltip(helpBtn, "Help");
    helpBtn.setAttribute("aria-label", "Help");
    headerEl.appendChild(helpBtn);

    // Theme toggle
    headerEl.appendChild(
      createThemeToggle("header-info-btn material-symbols-outlined"),
    );
  }

  /**
   * Rename the currently-open image. Called from both the drawer's
   * inline edit and the header's double-click-to-rename flow so the
   * two entry points share exactly one code path.
   *
   * The storage layer may uniquify ("foo (2).png") if the desired name
   * collides with a sibling; we trust the path it returns and refresh
   * the UI (URL, header breadcrumb, drawer contents) to match.
   */
  /**
   * Build the header's right-side file action cluster: Open (optional),
   * Copy, and Save with dropdown. Delegates all behavior to the current
   * Toolbar instance so there's a single source of truth for what "save"
   * and "copy" mean — the header buttons are a UI alias, not a second
   * implementation.
   */
  #appendHeaderFileActions(headerEl: HTMLElement): void {
    const group = document.createElement("div");
    group.className = "editor-header-file-actions";

    // Open — only in contexts where the host wires up an opener.
    if (typeof (window as any).__anno_openFile === "function") {
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "header-info-btn material-symbols-outlined";
      openBtn.textContent = "folder_open";
      setTooltip(openBtn, "Open File");
      openBtn.setAttribute("aria-label", "Open File");
      openBtn.addEventListener("click", () => (window as any).__anno_openFile());
      group.appendChild(openBtn);
    }

    // Copy
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "header-info-btn material-symbols-outlined";
    copyBtn.textContent = "content_copy";
    setTooltip(copyBtn, "Copy (Ctrl+C)");
    copyBtn.setAttribute("aria-label", "Copy");
    copyBtn.addEventListener("click", () => {
      this.#editorToolbar?.copyNow().catch((e) => console.error("[copy]", e));
    });
    group.appendChild(copyBtn);

    // Save + dropdown
    const saveWrap = document.createElement("div");
    saveWrap.className = "tool-btn-wrap header-save-wrap";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "header-info-btn material-symbols-outlined";
    saveBtn.textContent = "save";
    setTooltip(saveBtn, "Save (Ctrl+S)");
    saveBtn.setAttribute("aria-label", "Save");
    saveBtn.addEventListener("click", () => {
      this.#editorToolbar?.saveNow();
    });
    saveWrap.appendChild(saveBtn);

    const saveArrow = document.createElement("button");
    saveArrow.type = "button";
    saveArrow.className = "tool-dropdown-arrow material-symbols-outlined";
    saveArrow.textContent = "expand_more";
    setTooltip(saveArrow, "Save options");
    saveArrow.setAttribute("aria-label", "Save options");
    saveArrow.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#editorToolbar?.showSaveMenu(saveWrap);
    });
    saveWrap.appendChild(saveArrow);

    group.appendChild(saveWrap);
    headerEl.appendChild(group);
  }

  /**
   * Swap the breadcrumb filename span with an inline input so the user
   * can rename the file without opening the details drawer. Commits on
   * Enter / blur, cancels on Escape. Same validation + storage rename
   * path as the drawer (#renameCurrentImage).
   */
  #startHeaderFilenameRename(filenameEl: HTMLElement): void {
    if (!this.#currentImagePath) return;
    const oldName = getFilename(this.#currentImagePath);
    const input = document.createElement("input");
    input.type = "text";
    input.value = oldName;
    input.className = "breadcrumb-filename-input";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "File name, editable");

    const parent = filenameEl.parentElement!;
    parent.replaceChild(input, filenameEl);
    input.focus();
    // Select just the base name so the extension is preserved by default.
    const dot = oldName.lastIndexOf(".");
    setTimeout(() => {
      input.setSelectionRange(0, dot > 0 ? dot : oldName.length);
    }, 0);

    let committing = false;
    const restore = () => {
      if (input.parentElement) input.replaceWith(filenameEl);
    };
    const commit = async () => {
      if (committing) return;
      committing = true;
      const next = input.value.trim();
      if (!next || next === oldName) {
        restore();
        return;
      }
      const err = validateFilename(next);
      if (err) {
        input.setCustomValidity(err);
        input.reportValidity();
        input.focus();
        committing = false;
        return;
      }
      try {
        input.disabled = true;
        await this.#renameCurrentImage(next);
        // #renameCurrentImage rebuilds the header, so the input is
        // already gone by the time this resolves — nothing to restore.
      } catch (e: any) {
        console.error("[rename] header:", e);
        restore();
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        input.value = oldName;
        restore();
      }
    });
    input.addEventListener("blur", () => { commit(); });
  }

  /**
   * Serialize the current selection into the scratchpad so the user
   * can paste it back later. Uses scratchpad-utils' serializeSelection
   * (wraps elements in an origin-anchored <g> + computes bbox) and
   * renderThumbnail (blob URL → <img> → <canvas> → PNG) for preview.
   */
  async #saveSelectionToScratchpad(
    _canvas: CanvasManager,
    selection: SelectionManager,
    _history: History,
  ): Promise<void> {
    const els = selection.selectedElements;
    if (els.length === 0) return;

    const serialized = serializeSelection(els);
    if (!serialized) return;

    try {
      const thumbnail = await renderThumbnail(serialized.svgMarkup, 80);
      const item = await this.#scratchpadStore.save({
        svgMarkup: serialized.svgMarkup,
        thumbnail,
        width: serialized.width,
        height: serialized.height,
      });
      await this.#openScratchpadSection?.addItem(item);
    } catch (e) {
      console.error("[scratchpad] save failed:", e);
    }
  }

  /**
   * Open the Scratchpad library popover anchored to the toolbar
   * button. Reuses the existing ScratchpadSection (thumbnail grid +
   * save button) — just in a popover instead of the right panel.
   *
   * The section is stored on `this.#openScratchpadSection` while the
   * popover is open so save/insert callbacks, selection changes, and
   * tool-change events can still push state in; on close, the ref is
   * cleared.
   */
  #openScratchpadPopover(
    anchor: HTMLElement,
    canvas: CanvasManager,
    selection: SelectionManager,
    history: History,
  ): void {
    openAnchoredPopover(anchor, (root) => {
      const section = new ScratchpadSection(root, this.#scratchpadStore);
      section.onSaveRequested = () => {
        void this.#saveSelectionToScratchpad(canvas, selection, history);
      };
      section.onInsert = (item) => {
        this.#armScratchpadPaste(canvas, selection, history, item);
        this.#armedScratchpadItemId = item.id;
        section.setActiveItem(item.id);
      };
      section.setSaveEnabled(this.#scratchpadCanSave);
      section.setActiveItem(this.#armedScratchpadItemId);
      this.#openScratchpadSection = section;
      // Cleanup when the popover closes — the MutationObserver on
      // <body> catches the helper's `remove()` regardless of WHY the
      // popover closed (outside click, Escape, resize-kill, etc).
      const obs = new MutationObserver(() => {
        if (!root.isConnected) {
          this.#openScratchpadSection = null;
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: false });
    }, { placement: "right", className: "tool-flyout-scratchpad" });
  }

  /**
   * Arm a scratchpad-paste tool. Clicking the thumbnail doesn't
   * insert immediately — it puts the editor into a short-lived
   * "placement mode" where the next click on the canvas drops the
   * item at that exact position.
   *
   * This matches the gesture model of drawing tools (Rectangle, Arrow,
   * Sticky, …) where a tool is armed and then a canvas click creates
   * the shape. Users get precise placement without dragging tiny
   * thumbnails, and the mental model stays consistent across the
   * whole sidebar.
   *
   * Escape cancels placement without inserting. After insertion or
   * cancel, the toolbar returns to Select mode and (on success) the
   * inserted elements become the current selection so the user can
   * immediately re-drag them if the first placement wasn't perfect.
   */
  #armScratchpadPaste(
    canvas: CanvasManager,
    selection: SelectionManager,
    history: History,
    item: { svgMarkup: string; width: number; height: number },
  ): void {
    // Clear the previous selection before entering placement mode.
    // Keeping the old selection handles visible while the user is
    // about to place a NEW item is confusing — handles imply "this
    // is the subject of my next action", which conflicts with the
    // paste tool's "click to drop a fresh object" semantics.
    selection.select(null);

    // ScratchpadPasteTool doesn't actually use ToolOptions, but
    // ToolBase requires them. Pass neutral defaults.
    const opts: ToolOptions = {
      strokeColor: "#ff0000",
      fillColor: "none",
      strokeWidth: 2,
      fontSize: 16,
      strokeDasharray: "",
      fillOpacity: 1,
    };
    const tool = new ScratchpadPasteTool(canvas, history, opts, item);
    tool.onInsert = (inserted) => {
      if (inserted.length === 1) {
        selection.select(inserted[0]);
      } else if (inserted.length > 1) {
        selection.selectMultiple(inserted);
      }
    };
    tool.onShapeComplete = () => {
      // Return the toolbar to Select mode so its UI reflects the
      // canvas state after the one-shot paste finishes (or is
      // canceled via Escape). onToolChange fires inside activateSelectMode
      // and the app-level handler clears the armed-thumbnail highlight.
      this.#editorToolbar?.activateSelectMode();
    };
    canvas.setActiveTool(tool);

    // Sync the toolbar UI + footer status with the now-armed paste tool:
    // no toolbar button highlighted, footer shows "Scratchpad".
    // The label matches the sidebar area the armed item came from so the
    // user can identify the context at a glance.
    this.#editorToolbar?.setExternalToolActive("Scratchpad", null);
  }

  async #renameCurrentImage(newName: string): Promise<void> {
    if (!this.#storage || !this.#currentImagePath) {
      throw new Error("No active file to rename.");
    }
    const oldPath = this.#currentImagePath;
    const newPath = await this.#storage.renameImage(oldPath, newName);
    this.#currentImagePath = newPath;
    if (this.#currentImageRecord) {
      this.#currentImageRecord = { ...this.#currentImageRecord, path: newPath };
    }
    pushRoute(editUrl(getStorageMode(), newPath));
    this.#buildEditorHeader();
    const canvas = this.#currentEditor?.canvas;
    this.#fileDetailsDrawer?.setData({
      filename: getFilename(newPath),
      folderPath: this.#currentImageRecord?.folderPath ?? this.#currentFolderPath,
      width: canvas?.imageWidth ?? 0,
      height: canvas?.imageHeight ?? 0,
      fileSizeBytes: estimateDataUrlBytes(this.#currentImageDataUrl),
      createdAt: this.#currentImageRecord?.createdAt,
      updatedAt: this.#currentImageRecord?.updatedAt,
      sourceUrl: this.#currentImageRecord?.sourceUrl,
      tags: this.#currentTags,
    });
  }

  /**
   * Build a clickable breadcrumb for the editor statusbar, e.g.:
   *
   *   Device › Screenshots › Mobile
   *
   * - The root segment ("Device" / "Browser" / "Google Drive") returns to
   *   the gallery at the storage root.
   * - Each path segment returns to the gallery focused on that folder.
   * - Reuses the .breadcrumb / .breadcrumb-item CSS already defined for
   *   the gallery so the two views use one visual vocabulary.
   */
  #buildEditorBreadcrumb(): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "breadcrumb";
    nav.setAttribute("aria-label", "Return to gallery");

    const mode = getStorageMode();
    const rootLabel =
      mode === "filesystem" ? "Device" :
      mode === "googledrive" ? "Google Drive" :
      "Browser";

    const makeItem = (label: string, folderPath: string): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "breadcrumb-item";
      btn.textContent = label;
      setTooltip(btn, folderPath
        ? `Open "${label}" in gallery`
        : `Open gallery root (${rootLabel})`);
      btn.addEventListener("click", () => {
        this.#currentFolderPath = folderPath;
        void this.showGallery();
      });
      return btn;
    };

    nav.appendChild(makeItem(rootLabel, ""));

    if (this.#currentFolderPath) {
      const segments = this.#currentFolderPath.split("/").filter(Boolean);
      let acc = "";
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg;
        const sep = document.createElement("span");
        sep.className = "breadcrumb-sep";
        sep.textContent = "\u203a";
        sep.setAttribute("aria-hidden", "true");
        nav.appendChild(sep);
        nav.appendChild(makeItem(seg, acc));
      }
    }

    return nav;
  }

  static ZOOM_OPTIONS: { label: string; value: number | "fit" }[] = [
    { label: "Fit to window", value: "fit" },
    { label: "25%", value: 0.25 },
    { label: "50%", value: 0.5 },
    { label: "75%", value: 0.75 },
    { label: "100%", value: 1 },
    { label: "150%", value: 1.5 },
    { label: "200%", value: 2 },
    { label: "300%", value: 3 },
  ];

  buildZoomControls(canvas: CanvasManager, holder: HTMLElement): void {
    const wrap = document.createElement("div");
    wrap.id = "zoom-controls";

    const outBtn = document.createElement("button");
    outBtn.className = "zoom-btn material-symbols-outlined";
    outBtn.textContent = "remove";
    setTooltip(outBtn, "Zoom out (−10%)");
    outBtn.setAttribute("aria-label", "Zoom out");
    outBtn.addEventListener("click", () => canvas.setZoom(canvas.zoom - 0.1));
    wrap.appendChild(outBtn);

    const labelWrap = document.createElement("div");
    labelWrap.className = "zoom-select-wrap";

    const label = document.createElement("button");
    label.className = "zoom-label";
    setTooltip(label, "Zoom level — click to choose a preset");
    label.setAttribute("aria-label", "Zoom level — click to choose a preset");
    // Label reflects the ACTIVE zoom state. In Fit mode we show
    // "Fit" instead of the raw percentage so the user can tell at a
    // glance that the canvas will track viewport changes.
    const refreshLabel = () => {
      label.textContent = canvas.isFitMode
        ? "Fit"
        : `${Math.round(canvas.zoom * 100)}%`;
    };
    refreshLabel();

    const menu = document.createElement("div");
    menu.className = "zoom-menu";
    menu.style.display = "none";

    const renderMenu = () => {
      menu.innerHTML = "";
      for (const opt of App.ZOOM_OPTIONS) {
        if (opt.value === "fit") {
          const item = document.createElement("button");
          item.className = "zoom-menu-item";
          if (canvas.isFitMode) item.classList.add("active");
          item.textContent = "Fit to window";
          item.addEventListener("click", () => { canvas.fitToView(); menu.style.display = "none"; });
          menu.appendChild(item);
          const sep = document.createElement("div");
          sep.className = "zoom-menu-sep";
          menu.appendChild(sep);
        } else {
          const item = document.createElement("button");
          item.className = "zoom-menu-item";
          // Highlight a numeric preset only when NOT in fit mode —
          // otherwise the "Fit" item is the source of truth.
          if (
            !canvas.isFitMode
            && Math.round(canvas.zoom * 100) === Math.round((opt.value as number) * 100)
          ) {
            item.classList.add("active");
          }
          item.textContent = opt.label;
          item.addEventListener("click", () => { canvas.setZoom(opt.value as number); menu.style.display = "none"; });
          menu.appendChild(item);
        }
      }
    };

    label.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.style.display === "none") { renderMenu(); menu.style.display = "block"; }
      else { menu.style.display = "none"; }
    });

    labelWrap.appendChild(label);
    labelWrap.appendChild(menu);
    wrap.appendChild(labelWrap);

    const inBtn = document.createElement("button");
    inBtn.className = "zoom-btn material-symbols-outlined";
    inBtn.textContent = "add";
    setTooltip(inBtn, "Zoom in (+10%)");
    inBtn.setAttribute("aria-label", "Zoom in");
    inBtn.addEventListener("click", () => canvas.setZoom(canvas.zoom + 0.1));
    wrap.appendChild(inBtn);

    holder.appendChild(wrap);

    canvas.onZoomChange = (_z) => { refreshLabel(); };

    document.addEventListener("click", () => { menu.style.display = "none"; });
  }

  restoreAnnotations(canvas: CanvasManager, svgString: string): void {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const svgRoot = doc.documentElement;

    // Inspect the Annot format version stamp. Today only version "1"
    // exists (and "0" = unstamped legacy); we read-through both
    // without branching. When a breaking schema change lands, this
    // is the hook point where migration runs before the element
    // adoption loop. Keep the lookup unconditional so the surface
    // stays visible in the code even in the "no migration needed"
    // era — it's the lever we committed to in docs/svg-format.md.
    const version = readAnnotVersion(svgRoot);
    if (version !== ANNOT_SVG_VERSION && version !== "0") {
      // Newer-than-known file (e.g. written by a future Annot).
      // Parse leniently — we still understand the container shape,
      // only unfamiliar annotation types might render degenerately.
      console.warn(
        `[annot] SVG stamped with version "${version}" (this build expects "${ANNOT_SVG_VERSION}"). Rendering with forward-compat fallback.`,
      );
    }

    for (const child of Array.from(svgRoot.children)) {
      const tag = child.tagName;
      if (tag === "defs" || (tag === "image" && !child.closest("g"))) continue;
      if (child.id === "ui-overlay") continue;
      if (child.id === "annotations") {
        for (const anno of Array.from(child.children)) {
          canvas.annotations.appendChild(document.importNode(anno, true));
        }
        continue;
      }
      canvas.annotations.appendChild(document.importNode(child, true));
    }
  }

  /**
   * Draw click indicators using tags recorded at capture time:
   *   - `click.rect.*` → rectangle outlining the clicked element
   *   - `click.x` / `click.y` → precise click point (dot + ring)
   * Coordinates are already in image-pixel space (dpr-multiplied).
   */
  #addClickMarker(canvas: CanvasManager): void {
    const ns = "http://www.w3.org/2000/svg";
    const color = "#ff3b3b";

    const rx = parseFloat(this.#currentTags["click.rect.x"]);
    const ry = parseFloat(this.#currentTags["click.rect.y"]);
    const rw = parseFloat(this.#currentTags["click.rect.w"]);
    const rh = parseFloat(this.#currentTags["click.rect.h"]);
    const hasRect = isFinite(rx) && isFinite(ry) && isFinite(rw) && isFinite(rh) && rw > 0 && rh > 0;

    if (hasRect) {
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", String(rx));
      rect.setAttribute("y", String(ry));
      rect.setAttribute("width", String(rw));
      rect.setAttribute("height", String(rh));
      rect.setAttribute("fill", color);
      rect.setAttribute("fill-opacity", "0.12");
      rect.setAttribute("stroke", color);
      rect.setAttribute("stroke-width", "3");
      rect.setAttribute("rx", "4");
      rect.setAttribute("ry", "4");
      canvas.annotations.appendChild(rect);
    }

    const x = parseFloat(this.#currentTags["click.x"]);
    const y = parseFloat(this.#currentTags["click.y"]);
    if (!isFinite(x) || !isFinite(y)) return;

    // Outer ring (smaller when we also have a rect, since the rect gives context)
    const ring = document.createElementNS(ns, "circle");
    ring.setAttribute("cx", String(x));
    ring.setAttribute("cy", String(y));
    ring.setAttribute("r", hasRect ? "14" : "28");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", color);
    ring.setAttribute("stroke-width", hasRect ? "3" : "4");
    ring.setAttribute("opacity", "0.9");
    canvas.annotations.appendChild(ring);

    // Inner dot
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", hasRect ? "5" : "7");
    dot.setAttribute("fill", color);
    dot.setAttribute("stroke", "#fff");
    dot.setAttribute("stroke-width", "2");
    canvas.annotations.appendChild(dot);
  }

  // ---- Storage ----

  async writeAnnotationsToStorage(): Promise<void> {
    if (!this.#currentEditor || !this.#storage) return;
    if (!this.#currentImagePath) return;

    // Concurrency gate: if a save is already in flight, just mark
    // that another one is needed once the current one completes.
    // Without this, rapid edits on a slow backend (Drive) kick off
    // overlapping multi-second uploads and freeze the UI.
    if (this.#saveInFlight) {
      this.#savePending = true;
      return;
    }

    this.#saveInFlight = true;
    const annotationsSvg = exportAnnotationsSvgForIdb(this.#currentEditor.canvas);
    const updates = { annotationsSvg, tags: { ...this.#currentTags } };

    // Every save goes through this method, so this is the single place
    // that drives the save-status indicator through its full lifecycle:
    // saving → saved on success, saving → error on failure.
    this.#saveStatusIndicator?.setStatus("saving");

    try {
      const newPath = await this.#storage.updateImage(this.#currentImagePath, updates);
      // Path may change if we ever call updateImage with { folderPath }
      this.#currentImagePath = newPath;
      hideError();
      this.#saveStatusIndicator?.setStatus("saved");
    } catch (e: any) {
      this.#saveStatusIndicator?.setStatus("error");
      console.error("[save] Error:", e);
      if (e.status === 401) {
        showAuthError(() => {
          signIn().then((token) => {
            if (this.#storage && "setToken" in this.#storage) {
              (this.#storage as any).setToken(token);
            }
            hideError();
            this.writeAnnotationsToStorage();
          }).catch(() => {});
        });
      } else if (e.status === 403) {
        showSaveError("Permission denied. You may not have write access to this folder.");
      } else if (e.status === 404) {
        showSaveError("File or folder not found. It may have been deleted.");
      } else if (!navigator.onLine) {
        showSaveError("You are offline. Changes will be lost.", () => this.writeAnnotationsToStorage());
      } else {
        showSaveError(
          `Save failed: ${e.message || "Unknown error"}`,
          () => this.writeAnnotationsToStorage(),
        );
      }
    } finally {
      this.#saveInFlight = false;
      // Catch-up save: if edits arrived while we were uploading,
      // flush them now. Clearing the flag first so the nested call
      // actually runs instead of bouncing on the gate.
      if (this.#savePending) {
        this.#savePending = false;
        void this.writeAnnotationsToStorage();
      }
    }
  }

  async writeThumbnailToStorage(): Promise<void> {
    if (!this.#currentEditor || !this.#storage || !this.#currentImagePath) return;
    const renderedDataUrl = await getPngDataUrl(this.#currentEditor.canvas);
    const thumbnailDataUrl = await this.#storage.generateThumbnail(renderedDataUrl);
    await this.#storage.updateImage(this.#currentImagePath, { thumbnailDataUrl });
  }

  // ---- PWA Capture ----

  async captureScreenAndSave(): Promise<void> {
    // Use last-chosen cursor preference; defaults to "always".
    const dataUrl = await captureScreen(loadCursorPreference());
    if (!dataUrl) return;
    await this.saveDataUrlAndOpen(dataUrl);
  }

  async timedCaptureAndSave(): Promise<void> {
    if (!this.#storage) return;
    const cfg = await showIntervalCaptureDialog();
    if (!cfg) return;
    // Remember the cursor choice for next captures (single + timed)
    saveCursorPreference(cfg.cursor);

    const progress = showIntervalCaptureProgress(cfg.count);
    const storage = this.#storage;
    const folderPath = this.#currentFolderPath;
    const sessionId = newIdB58();
    const total = cfg.count;
    let savedFrames = 0;

    const handle = await startIntervalCapture({
      intervalSec: cfg.intervalSec,
      count: cfg.count,
      cursor: cfg.cursor,
      onProgress: (captured, total) => progress.update(captured, total),
      onError: (err) => console.error("[timed-capture] frame error:", err),
      onFrame: async (dataUrl, index) => {
        try {
          const img = await this.loadImage(dataUrl);
          const thumbnailDataUrl = await storage.generateThumbnail(dataUrl);
          const now = new Date().toISOString();
          const sec = String(index + 1).padStart(3, "0");
          await storage.saveImage({
            originalDataUrl: dataUrl,
            thumbnailDataUrl,
            annotationsSvg: "",
            width: img.naturalWidth,
            height: img.naturalHeight,
            sourceUrl: "",
            tags: {
              timed: "1",
              seq: sec,
              captureId: newIdB58(),
              session: sessionId,
              sessionKind: "interval",
              sessionIndex: String(index),
              sessionTotal: String(total),
            },
            folderPath,
            filename: `capture-${now.replace(/[:.]/g, "-")}-${sec}.jpg`,
            createdAt: now,
            updatedAt: now,
          });
          savedFrames++;
        } catch (e) {
          console.error("[timed-capture] save error:", e);
        }
      },
    });

    if (!handle) {
      progress.complete();
      return;
    }

    progress.setOnCancel(() => handle.cancel());

    await handle.done;
    progress.complete();

    // Return focus to this tab (which initiated the capture).
    // Chrome may require a recent user gesture; try multiple paths.
    try {
      window.focus();
      // If the tab is hidden, try flashing title to draw attention as a fallback.
      if (document.visibilityState !== "visible") {
        const originalTitle = document.title;
        document.title = "✔ Capture complete — " + originalTitle;
        const restore = () => {
          document.title = originalTitle;
          document.removeEventListener("visibilitychange", restore);
        };
        document.addEventListener("visibilitychange", restore);
      }
    } catch { /* ignore */ }

    // Interval capture frames are tagged with a session id for future
    // grouping, but we don't auto-open any editor — just refresh the
    // gallery so the new frames are visible.
    if (this.#fileManager) {
      await this.#fileManager.refresh(this.#currentFolderPath);
    }
    // Silence the unused-var warning for `savedFrames` / `sessionId` while
    // still keeping the ids attached to the stored tags for later features.
    void savedFrames;
    void sessionId;
  }

  async pasteAndSave(): Promise<void> {
    const dataUrl = await pasteFromClipboard();
    if (!dataUrl) {
      showSaveError("No image found in clipboard.");
      return;
    }
    await this.saveDataUrlAndOpen(dataUrl);
  }

  private async saveDataUrlAndOpen(dataUrl: string): Promise<void> {
    if (!this.#storage) return;
    const img = await this.loadImage(dataUrl);
    const thumbnailDataUrl = await this.#storage.generateThumbnail(dataUrl);
    const now = new Date().toISOString();
    const path = await this.#storage.saveImage({
      originalDataUrl: dataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width: img.naturalWidth,
      height: img.naturalHeight,
      sourceUrl: "",
      tags: {},
      folderPath: this.#currentFolderPath,
      createdAt: now,
      updatedAt: now,
    });
    this.#currentImagePath = path;
    this.#currentTags = {};
    this.setupEditor(dataUrl, img.naturalWidth, img.naturalHeight);
    pushRoute(editUrl(getStorageMode(), path));
  }

  // ---- File upload ----

  openFileDialog(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".jpg,.jpeg,.png,.svg";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (file) await this.openFile(file);
    });
    input.click();
  }

  async openFile(file: File): Promise<void> {
    if (!this.#storage) return;
    const dataUrl = await this.fileToDataUrl(file);
    const img = await this.loadImage(dataUrl);

    const arrayBuf = await file.arrayBuffer();
    const meta = readEditableImage(new Uint8Array(arrayBuf));

    let originalUrl = dataUrl;
    let annotations = "";
    let tags: Record<string, string> = {};
    let w = img.naturalWidth;
    let h = img.naturalHeight;

    if (meta && meta.annotationsSvg) {
      originalUrl = meta.originalImageDataUrl || dataUrl;
      annotations = meta.annotationsSvg;
      tags = meta.tags || {};
      w = meta.width || w;
      h = meta.height || h;
    }

    const thumbnailDataUrl = await this.#storage.generateThumbnail(originalUrl);
    const now = new Date().toISOString();
    const path = await this.#storage.saveImage({
      originalDataUrl: originalUrl,
      thumbnailDataUrl,
      annotationsSvg: annotations,
      width: w,
      height: h,
      sourceUrl: "",
      tags,
      folderPath: this.#currentFolderPath,
      filename: file.name || undefined,
      createdAt: now,
      updatedAt: now,
    });

    this.#currentImagePath = path;
    this.#currentTags = tags;
    this.setupEditor(originalUrl, w, h, annotations || undefined);
    pushRoute(editUrl(getStorageMode(), path));
  }

  // ---- Helpers ----

  private loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  }
}
