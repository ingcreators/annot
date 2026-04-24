/**
 * Annot (by ingcreators) — main application.
 * File Manager (gallery) ↔ Editor switching with path-based StorageProvider.
 */

import { createThemeToggle } from "@ingcreators/annot-core";
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { getFilename } from "@ingcreators/annot-core/storage";
import { newIdB58, setTooltip } from "@ingcreators/annot-core/utils";
import { ScratchpadStore } from "./editor/scratchpad-store.js";
import type { SplitEditor } from "./editor/split-editor.js";
import { loadEncodeOptions } from "./encode-options.js";
import { FileManager } from "./gallery/file-manager.js";
import {
  connectGitHub,
  connectGoogleDrive,
  deleteExtensionImage,
  getDeviceRootName,
  getGitHubRef,
  getStorage,
  getStorageMode,
  isDriveConnected,
  isGitHubConnected,
  loadLastFolder,
  loadLastStorage,
  openDeviceDirectory,
  restoreDevice,
  restoreGitHub,
  restoreGoogleDrive,
  type StorageMode,
  saveLastFolder,
  saveLastStorage,
  setExtensionId,
  setStorageMode,
} from "./storage/bridge.js";
import {
  type GitHubRepoRef,
  getAccessToken as getGitHubToken,
  isSignedIn as isGitHubSignedIn,
  loadRepoRef as loadGitHubRef,
} from "./storage/github-auth.js";
import { loadDriveRoot, saveDriveRoot, showFolderPicker, signIn } from "./storage/google-auth.js";
import { GoogleDriveStore } from "./storage/google-drive-store.js";
import { encodeCaptureInWorker } from "./workers/encode-client.js";
import { CaptureHost, type OpenEditorArgs } from "./app/capture-host.js";
import { EditorSession } from "./app/editor-session.js";
import { bumpFilenameSuffix, retryFsOp } from "./app/fs-utils.js";
import { HeaderHost } from "./app/header-host.js";
import { loadImage } from "./app/image-utils.js";
import { SavePipeline } from "./app/save-pipeline.js";
import { findSessionRecords } from "./app/session-slice.js";
import { StatusHost } from "./app/status-host.js";

import { pasteFromClipboard } from "./capture/pwa-capture.js";
import { editUrl, galleryUrl, parseRoute, pushRoute, sessionEditUrl } from "./router.js";
import { showAlertDialog } from "./ui/dialog.js";
import { showError, showInfo } from "./ui/error-bar.js";

export class App {
  #storage: StorageProvider | null = null;
  #deviceStore: StorageProvider | null = null;
  #fileManager: FileManager | null = null;

  #currentImagePath: string | null = null;
  /** Latest ImageRecord for the currently-open image (when available). Used
   *  by the file-details drawer to show createdAt/updatedAt/sourceUrl. Null
   *  for not-yet-saved images (e.g. a freshly captured but un-persisted one). */
  #currentImageRecord: ImageRecord | null = null;
  #currentTags: Record<string, string> = {};
  #currentFolderPath = "";
  #splitEditor: SplitEditor | null = null;

  /** Scratchpad persistence — shared across editor sessions (the
   *  store itself is stateless, just a thin wrapper around IndexedDB). */
  #scratchpadStore = new ScratchpadStore();

  /** Save pipeline — owns the annotation-save + thumbnail-regen debounce
   *  state machine. */
  #savePipeline: SavePipeline;
  /** Capture host — owns the screenshot / paste / file-upload flows.
   *  Routes the resulting image back through `#openEditorFor` so this
   *  file keeps owning the "editor setup + URL push" concern. */
  #captureHost: CaptureHost;
  /** Header host — owns the editor header bar, inline rename, external
   *  links, and the `SaveStatusIndicator`. */
  #headerHost: HeaderHost;
  /** Status host — owns the editor statusbar + zoom controls. */
  #statusHost: StatusHost = new StatusHost();
  /** Editor session — owns `setupEditor` + canvas/history/toolbar/
   *  right-panel/drawer/scratchpad lifecycle. */
  #editorSession: EditorSession;

  constructor() {
    this.#savePipeline = new SavePipeline({
      getStorage: () => this.#storage,
      getCanvas: () => this.#editorSession.getCanvas(),
      getCurrentImagePath: () => this.#currentImagePath,
      setCurrentImagePath: (p) => {
        this.#currentImagePath = p;
      },
      getCurrentTags: () => this.#currentTags,
      getStatusIndicator: () => this.#headerHost.getSaveStatusIndicator(),
    });
    this.#captureHost = new CaptureHost({
      getStorage: () => this.#storage,
      getCurrentFolderPath: () => this.#currentFolderPath,
      getFileManager: () => this.#fileManager,
      openEditor: (args) => this.#openEditorFor(args),
    });
    this.#headerHost = new HeaderHost({
      getStorage: () => this.#storage,
      getCurrentImagePath: () => this.#currentImagePath,
      setCurrentImagePath: (p) => {
        this.#currentImagePath = p;
      },
      getCurrentImageRecord: () => this.#currentImageRecord,
      setCurrentImageRecord: (r) => {
        this.#currentImageRecord = r;
      },
      getCurrentTags: () => this.#currentTags,
      getCurrentImageDataUrl: () => this.#editorSession.getCurrentImageDataUrl(),
      getCurrentFolderPath: () => this.#currentFolderPath,
      setCurrentFolderPath: (p) => {
        this.#currentFolderPath = p;
      },
      getFileDetailsDrawer: () => this.#editorSession.getFileDetailsDrawer(),
      getToolbar: () => this.#editorSession.getToolbar(),
      getImageSize: () => this.#editorSession.getImageSize(),
      showGallery: () => this.showGallery(),
    });
    this.#editorSession = new EditorSession(
      {
        getStorage: () => this.#storage,
        getCurrentImagePath: () => this.#currentImagePath,
        getCurrentImageRecord: () => this.#currentImageRecord,
        getCurrentFolderPath: () => this.#currentFolderPath,
        getCurrentTags: () => this.#currentTags,
        setCurrentTags: (t) => {
          this.#currentTags = t;
        },
      },
      this.#headerHost,
      this.#statusHost,
      this.#savePipeline,
      this.#scratchpadStore,
    );
  }

  async init(): Promise<void> {
    const { BrowserStore } = await import("./storage/browser-store.js");
    const browserStore = new BrowserStore();
    this.#storage = browserStore;
    setStorageMode("browser");

    // Silently restore the filesystem handle if previously granted — this only
    // populates #deviceStore so the user can switch to Device without re-picking.
    // It must NOT override the user's last-selected storage mode.
    const restored = await restoreDevice();
    if (restored) {
      this.#deviceStore = restored;
    }

    // Respect the user's last-selected storage across reloads.
    const lastMode = loadLastStorage();
    if (lastMode === "device" && this.#deviceStore) {
      this.#storage = this.#deviceStore;
      setStorageMode("device");
    } else if (lastMode === "googledrive") {
      // If we have a persisted OAuth token AND a previously-picked
      // root folder, rehydrate the Drive store without prompting. A
      // stale token will surface as a failed API call later; users
      // can then re-select Drive to re-auth.
      const driveStore = restoreGoogleDrive();
      if (driveStore) {
        this.#storage = driveStore;
        setStorageMode("googledrive");
        // No boot-time root verification: under `drive.file` a
        // re-authorized session legitimately loses `files.get`
        // access to the previously-picked folder even when the
        // files INSIDE that folder are still fully usable (since
        // they're app-created and stay in scope). The gallery's
        // list queries work, saves work — but `files.get(rootId)`
        // 404s, which misfired as an "isn't accessible" banner
        // every page load. Real folder-loss scenarios (different
        // account, trashed root) still surface through operation
        // errors.
      } else {
        this.#storage = browserStore;
        setStorageMode("browser");
      }
    } else if (lastMode === "github") {
      // Same shape as Drive's restore: token + ref in localStorage
      // → instantiate the GitHubStore without prompting. Expired
      // PATs surface as a 401 on the first real API call, which
      // routes through the bridge's `refreshGithubToken` banner.
      const githubStore = restoreGitHub();
      if (githubStore) {
        this.#storage = githubStore;
        setStorageMode("github");
      } else {
        this.#storage = browserStore;
        setStorageMode("browser");
      }
    } else {
      // Default / "browser" / everything else → Browser (BrowserStore)
      this.#storage = browserStore;
      setStorageMode("browser");
    }

    // Restore last-viewed folder so extension captures in a fresh tab
    // land in the folder the user was last working in.
    this.#currentFolderPath = loadLastFolder();

    document.addEventListener("paste", async (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;
      if (this.#editorSession.getEditor()) return;
      const dataUrl = await pasteFromClipboard();
      if (dataUrl) {
        e.preventDefault();
        await this.#captureHost.saveDataUrlAndOpen(dataUrl);
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
      if (this.#savePipeline.hasPendingWork()) {
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

      if (!record?.originalDataUrl) return;

      let w = record.width;
      let h = record.height;
      if (!w || !h) {
        const img = await loadImage(record.originalDataUrl);
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

      console.log(
        "[annot/app] handoff record.pageMetadata:",
        record.pageMetadata ? `${record.pageMetadata.elements.length} elements` : "none",
      );
      this.#editorSession.setupEditor(record.originalDataUrl, w, h, undefined, record.pageMetadata);

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

  async #handleGoogleDriveHandoff(state: {
    action?: string;
    ids?: string[];
    folderId?: string;
  }): Promise<void> {
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
        message:
          'That file is outside your Annot workspace folder. Use the sidebar\'s "Change Drive folder" icon to point Annot at a folder that contains it.',
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
      const connected = await setExtensionId(
        route.extId,
        (route.store as StorageMode) || "extension",
      );
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
        const records = await findSessionRecords(
          this.#storage,
          this.#currentFolderPath,
          route.session,
        );
        const kind = records[0]?.tags?.sessionKind;
        if (records.length > 0 && (kind === "scroll" || kind === "perPage")) {
          // Rewrite the URL to the canonical `/edit/<store>?session=…` form
          // so reloads / popstate re-enter the split editor cleanly.
          pushRoute(sessionEditUrl(getStorageMode(), route.session));
          await this.setupSplitEditor(records);
          return;
        }
        if (records.length === 0) {
          console.warn(
            "[handleRoute] session has no records in current folder:",
            route.session,
            "folder=",
            this.#currentFolderPath,
          );
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

  // ---- File Manager (Gallery) ----

  private showGalleryView(): void {
    console.log(
      "[showGalleryView] mode:",
      getStorageMode(),
      "storage:",
      this.#storage?.constructor?.name,
    );
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
    // The save-status indicator lives on the header DOM we just
    // cleared; null HeaderHost's reference so the next session
    // creates a fresh one attached to the fresh header markup.
    this.#headerHost.reset();
    // Clear the sidebar toolbar DOM and release the editor session's
    // per-session UI (drawer, toolbar ref, right-panel, canvas /
    // selection listeners on the shared #svg-root element).
    const sidebarEl = document.getElementById("editor-sidebar");
    if (sidebarEl) sidebarEl.innerHTML = "";
    this.#editorSession.resetSessionUI();

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
        onUploadImage: () => this.#captureHost.openFileDialog(),
        onCaptureScreen: () => this.#captureHost.captureScreenAndSave(),
        onTimedCapture: () => this.#captureHost.timedCaptureAndSave(),
        onPasteClipboard: () => this.#captureHost.pasteAndSave(),
      });

      this.#updateSidebarStatus();
    }

    this.buildFileManagerHeader();

    if (this.#storage) {
      if (this.#fileManager.storage !== this.#storage) {
        this.#fileManager.setStorage(this.#storage, getStorageMode(), this.#currentRootName());
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
    await this.#savePipeline.flushPending();
    if (window.location.pathname !== galleryUrl()) {
      pushRoute(galleryUrl());
    }
    this.showGalleryView();
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
    brand.addEventListener("click", (e) => {
      e.preventDefault();
      void this.showGallery();
    });
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
    toolbarEl.appendChild(createThemeToggle("header-info-btn material-symbols-outlined"));
  }

  /** Display name for the root of the currently-active storage.
   *  Shown under the top-level FOLDERS node in the sidebar so the
   *  user sees WHICH device folder / Drive folder is in use. Null
   *  when the backend has no meaningful user-facing root (e.g.
   *  Browser/Local stores to per-origin IDB). */
  #currentRootName(): string | undefined {
    const mode = getStorageMode();
    if (mode === "device") return getDeviceRootName() || undefined;
    if (mode === "googledrive") return loadDriveRoot()?.name;
    if (mode === "github") {
      const ref = getGitHubRef();
      if (!ref) return undefined;
      // Show `owner/repo` with optional basePath + branch qualifier
      // so the sidebar subtitle conveys all three dimensions without
      // a second row.
      const base = ref.basePath ? `/${ref.basePath}` : "";
      return `${ref.owner}/${ref.repo}${base}@${ref.branch}`;
    }
    return undefined;
  }

  /**
   * Click-to-switch: if already connected, reuse the existing storage.
   * Use handleStorageReselect() to force a fresh picker.
   */
  private async handleStorageSelect(mode: StorageMode, forcePicker = false): Promise<void> {
    try {
      if (mode === "browser") {
        const { BrowserStore } = await import("./storage/browser-store.js");
        this.#storage = new BrowserStore();
        setStorageMode("browser");
        saveLastStorage("browser");
      } else if (mode === "device") {
        if (!forcePicker && this.#deviceStore) {
          // Reuse the previously selected folder
          this.#storage = this.#deviceStore;
          setStorageMode("device");
          saveLastStorage("device");
        } else {
          const store = await openDeviceDirectory();
          if (!store) return;
          this.#deviceStore = store;
          this.#storage = store;
          saveLastStorage("device");
        }
      } else if (mode === "googledrive") {
        try {
          // `forcePicker` means the user came in via the sidebar's
          // reselect icon ("Change Drive folder"). Escalate that
          // into Google's `select_account` prompt too so the user
          // can pick a different Google account in the same gesture
          // — without it, GIS silently reuses the last-used account
          // and there's no visible path to switch. Mirrors the
          // GitHub setup dialog's "Use a different personal access
          // token" escape hatch.
          const token = await signIn({ forceAccountPicker: forcePicker });
          // Reuse the previously-picked root when available — under
          // `drive.file` that picker result is the app's only handle
          // onto the user's Drive, so skipping the picker here just
          // skips an extra click, not an access grant.
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
      } else if (mode === "github") {
        // First-click: if we already have a persisted PAT + ref,
        // rehydrate without prompting. Reselect / no ref → open the
        // reconfigure menu so the user can change just the piece
        // they care about (repo / branch / base path) instead of
        // walking the full connect wizard every time.
        let ref: GitHubRepoRef | null = loadGitHubRef();
        const needsConnect = !ref || !isGitHubSignedIn();
        if (needsConnect) {
          // First connect or session expired → full wizard.
          const { connectGitHub: runConnect } = await import("./storage/github-setup-ui.js");
          ref = await runConnect();
          if (!ref) return;
        } else if (forcePicker) {
          // Reselect click. `needsConnect` is false so `ref` is
          // non-null, but TS can't narrow across the branch, so we
          // assert. The menu lets the user target a single
          // dimension (branch switch is the common "I want to
          // check another feature branch" case and used to require
          // redoing the whole wizard).
          const { showReconfigureMenu } = await import("./storage/github-setup-ui.js");
          const updated = await showReconfigureMenu(ref as GitHubRepoRef);
          if (!updated) return; // cancelled or no change
          ref = updated;
        }
        const token = getGitHubToken();
        if (!token) {
          showError({
            message: "GitHub sign-in is required. Please try again.",
            severity: "warning",
          });
          return;
        }
        const store = connectGitHub(token, ref!);
        this.#storage = store;
        saveLastStorage("github");
      }

      this.#currentFolderPath = "";
      this.#updateSidebarStatus();

      if (this.#fileManager && this.#storage) {
        this.#fileManager.setStorage(this.#storage, getStorageMode(), this.#currentRootName());
        this.#fileManager.refresh("");
      }
    } catch (e) {
      console.error("[app] Storage switch error:", e);
    }
  }

  #updateSidebarStatus(): void {
    if (!this.#fileManager) return;
    const sidebar = this.#fileManager.sidebar;
    sidebar.setStorageStatus("browser", true, "Local");
    sidebar.setStorageStatus("device", !!this.#deviceStore, getDeviceRootName() || "Not connected");
    const driveRoot = loadDriveRoot();
    sidebar.setStorageStatus(
      "googledrive",
      isDriveConnected(),
      isDriveConnected() ? (driveRoot?.name ?? "Connected") : "Not connected",
    );
    const ghRef = getGitHubRef();
    sidebar.setStorageStatus(
      "github",
      isGitHubConnected(),
      isGitHubConnected()
        ? ghRef
          ? `${ghRef.owner}/${ghRef.repo}@${ghRef.branch}`
          : "Connected"
        : "Not connected",
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

      const { BrowserStore } = await import("./storage/browser-store.js");
      // Transfer to the user's currently selected storage
      const browserStore = this.#storage || new BrowserStore();

      for (const img of rootImages) {
        try {
          const full = await extStorage.getImage(img.path);
          if (!full?.originalDataUrl) continue;

          let w = full.width;
          let h = full.height;
          if (!w || !h) {
            try {
              const imgEl = await loadImage(full.originalDataUrl);
              w = imgEl.naturalWidth;
              h = imgEl.naturalHeight;
            } catch {
              continue;
            }
          }

          const now = new Date().toISOString();
          // Preserve the extension's filename (not path — we re-home into the
          // user's currently-selected folder).
          const filename = img.path.includes("/")
            ? img.path.slice(img.path.lastIndexOf("/") + 1)
            : img.path;
          // Wrap in retry: rapid back-to-back saves into a fresh FS handle
          // can hit Chrome's "stale cached state" issue (InvalidStateError).
          await retryFsOp(() =>
            browserStore.saveImage({
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
            }),
          );

          deleteExtensionImage(img.path);
        } catch (e) {
          // Don't abort the whole batch on a single bad image — log and continue.
          console.error("[transfer] failed for", img.path, "(continuing):", e);
        }
      }

      console.log(
        "[transfer] Transferred",
        rootImages.length,
        "images to",
        getStorageMode(),
        "folder:",
        JSON.stringify(this.#currentFolderPath),
      );
    } catch (e) {
      console.error("[transfer] Error:", e);
    }
  }

  private async transferAndOpen(record: ImageRecord, extPath: string): Promise<void> {
    // Respect the user's currently selected storage
    const browserStore =
      this.#storage || new (await import("./storage/browser-store.js")).BrowserStore();

    let w = record.width;
    let h = record.height;
    if (!w || !h) {
      const img = await loadImage(record.originalDataUrl);
      w = img.naturalWidth;
      h = img.naturalHeight;
    }

    const now = new Date().toISOString();
    const savedPath = await browserStore.saveImage({
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

    this.#editorSession.setupEditor(
      record.originalDataUrl,
      w,
      h,
      record.annotationsSvg || undefined,
      record.pageMetadata,
    );

    deleteExtensionImage(extPath);
  }

  async openFromGallery(record: ImageRecord): Promise<void> {
    if (!this.#storage) return;

    const full = await this.#storage.getImage(record.path);
    if (!full) return;

    this.#currentImagePath = full.path;
    this.#currentImageRecord = full;
    this.#currentTags = full.tags || {};

    let w = full.width;
    let h = full.height;
    if ((!w || !h) && full.originalDataUrl) {
      const img = await loadImage(full.originalDataUrl);
      w = img.naturalWidth;
      h = img.naturalHeight;
    }

    pushRoute(editUrl(getStorageMode(), full.path));

    this.#editorSession.setupEditor(
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
      const savedPath = await retryFsOp(() =>
        storage.saveImage({
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
        }),
      );
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


  /** Post-capture / post-upload transition: set the "currently open
   *  image" state, switch to the editor view, and push the canonical
   *  edit URL. Invoked by `CaptureHost` once a freshly-saved image is
   *  ready to open. */
  #openEditorFor(args: OpenEditorArgs): void {
    this.#currentImagePath = args.path;
    this.#currentTags = args.tags;
    this.#editorSession.setupEditor(args.dataUrl, args.width, args.height, args.annotations);
    pushRoute(editUrl(getStorageMode(), args.path));
  }
}
