/**
 * Annot by ingcreators — main application.
 * File Manager (gallery) ↔ Editor switching with path-based StorageProvider.
 */

import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { assertNonNull } from "@ingcreators/annot-core/utils";
import { createThemeToggle } from "@ingcreators/annot-editor";
import { setTooltip } from "@ingcreators/annot-editor/tooltip";
import { CaptureHost, type OpenEditorArgs } from "./app/capture-host.js";
import { EditorSession } from "./app/editor-session.js";
import { ExtensionTransferHost } from "./app/extension-transfer-host.js";
import { HeaderHost } from "./app/header-host.js";
import { loadImage } from "./app/image-utils.js";
import { type AnnotPlugin, PluginHost } from "./app/plugin-host.js";
import { githubExternalLinksPlugin } from "./app/plugins/github-external-links.js";
import { recentTabPlugin } from "./app/plugins/recent-tab.js";
import { RouterHost } from "./app/router-host.js";
import { SavePipeline } from "./app/save-pipeline.js";
import { SplitEditorHost } from "./app/split-editor-host.js";
import { StatusHost } from "./app/status-host.js";
import { StorageBridge } from "./app/storage-bridge.js";
import { pasteFromClipboard } from "./capture/pwa-capture.js";
import { ScratchpadStore } from "./editor/scratchpad-store.js";
import { FileManager } from "./gallery/file-manager.js";
import type { SidebarSectionOrder } from "./gallery/sidebar.js";
import { logger } from "./logger.js";
import { editUrl, galleryUrl, pushRoute } from "./router.js";
import {
  type BuiltInStorageMode,
  deleteExtensionImage,
  getStorage,
  getStorageMode,
  loadLastFolder,
  type StorageMode,
  saveLastFolder,
  setExtensionId,
  setStorageMode,
} from "./storage/bridge.js";
import { IndexedDBThumbnailCache } from "./storage/idb-thumbnail-cache.js";
import { ThumbnailManager } from "./storage/thumbnail-manager.js";
import { createBuiltinIcon } from "./ui/annot-icon-imperative.js";

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

  /** Scratchpad persistence — shared across editor sessions (the
   *  store itself is stateless, just a thin wrapper around IndexedDB). */
  #scratchpadStore = new ScratchpadStore();

  /** Unified thumbnail cache — shared across every storage backend
   *  that implements `StorageWithThumbnailCache`. Persistent IDB
   *  layer with an in-memory LRU front-cache. Phase 2 of
   *  [`docs/plans/_done/unified-thumbnail-cache.md`](../../../docs/plans/_done/unified-thumbnail-cache.md);
   *  built-in store integrations land in Phases 3–5. */
  #thumbnailManager = new ThumbnailManager(new IndexedDBThumbnailCache());

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
  /** Router host — owns `handleRoute` + Drive/handoff dispatch. */
  #routerHost: RouterHost;
  /** Storage bridge — owns boot-time restore, mode-switch wizard,
   *  sidebar status, and the `currentRootName` label. `#storage` /
   *  `#deviceStore` above are kept as read-cache mirrors so the
   *  many existing `this.#storage` call sites don't churn. */
  #storageBridge: StorageBridge;
  /** Extension transfer host — owns bulk + single-file transfer
   *  from the browser-extension IDB into the user's backend. */
  #extensionTransferHost: ExtensionTransferHost;
  /** Split-editor host — owns the overlay lifecycle + slice-apply
   *  persistence flow. */
  #splitEditorHost: SplitEditorHost;
  /** Plugin host — `PluginContext` dispatcher for external-link
   *  contributions + lifecycle events. Built-in + caller-supplied
   *  plugins are registered once from `init`. */
  #pluginHost = new PluginHost();
  /** Built-in storage modes the caller opted out of via
   *  `init({ disableBuiltinStorage })`. Read by `StorageBridge`
   *  on every `restoreOnBoot` / `handleStorageSelect`. */
  #disabledBuiltinStorage: ReadonlySet<string> = new Set();
  /** Sidebar section-order override from
   *  `init({ sidebarSectionOrder })`. Empty object means defaults
   *  apply (Storage 10 → Views 20 → Folders 30). */
  #sidebarSectionOrder: SidebarSectionOrder = {};
  /** Built-in UI section ids the deployment opted out of via
   *  `init({ disableBuiltinUISections })`. Phase 1 just stores +
   *  validates the set; rendering surfaces (drawer in Phase 2 /
   *  right-panel in Phase 3) consult it through the deps
   *  interface to filter their built-in section list. */
  #disabledBuiltinUISections: ReadonlySet<string> = new Set();

  constructor() {
    this.#savePipeline = new SavePipeline({
      getStorage: () => this.#storage,
      getCanvas: () => this.#editorSession.getCanvas(),
      getCurrentImagePath: () => this.#currentImagePath,
      getCurrentTags: () => this.#currentTags,
      getStatusIndicator: () => this.#headerHost.getSaveStatusIndicator(),
      notifyBeforeSave: (path, tags) =>
        this.#pluginHost.dispatchBeforeSave({ path, mode: getStorageMode(), tags }),
      onAfterSave: (path) => {
        this.#pluginHost.dispatchAfterSave({ path, mode: getStorageMode() });
      },
      getThumbnailManager: () => this.#thumbnailManager,
    });
    this.#captureHost = new CaptureHost({
      getStorage: () => this.#storage,
      getCurrentFolderPath: () => this.#currentFolderPath,
      getFileManager: () => this.#fileManager,
      openEditor: (args) => this.#openEditorFor(args),
      getThumbnailManager: () => this.#thumbnailManager,
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
      collectExternalLinks: (path) => this.#pluginHost.collectExternalLinks(path, this.#storage),
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
        notifyEditorReady: (ev) => this.#pluginHost.dispatchEditorReady(ev),
        getDrawerSections: () => this.#pluginHost.listDrawerSections(),
        getRightPanelSections: () => this.#pluginHost.listRightPanelSections(),
        isBuiltinUISectionDisabled: (id) => this.#disabledBuiltinUISections.has(id),
      },
      this.#headerHost,
      this.#statusHost,
      this.#savePipeline,
      this.#scratchpadStore,
    );
    this.#storageBridge = new StorageBridge({
      getFileManager: () => this.#fileManager,
      findPluginStorage: (mode) => this.#pluginHost.findStorageRegistration(mode),
      listPluginStorages: () => this.#pluginHost.listStorageRegistrations(),
      isBuiltinDisabled: (mode) => this.#disabledBuiltinStorage.has(mode),
    });
    this.#extensionTransferHost = new ExtensionTransferHost({
      getStorage: () => this.#storage,
      getCurrentFolderPath: () => this.#currentFolderPath,
      setCurrentImagePath: (p) => {
        this.#currentImagePath = p;
      },
      setCurrentTags: (t) => {
        this.#currentTags = t;
      },
      clearFileManager: () => {
        this.#fileManager = null;
      },
      getEditorSession: () => this.#editorSession,
    });
    this.#splitEditorHost = new SplitEditorHost({
      getStorage: () => this.#storage,
      showGallery: () => this.showGallery(),
    });
    this.#routerHost = new RouterHost({
      getStorage: () => this.#storage,
      getCurrentFolderPath: () => this.#currentFolderPath,
      setFileManager: (fm) => {
        this.#fileManager = fm;
      },
      showGalleryView: () => this.showGalleryView(),
      handleStorageSelect: (mode) => this.handleStorageSelect(mode),
      transferAllFromExtension: () => this.#extensionTransferHost.transferAll(),
      transferAndOpen: (record, extPath) =>
        this.#extensionTransferHost.transferAndOpen(record, extPath),
      openFromGallery: (record) => this.openFromGallery(record),
      setupSplitEditor: (records) => this.#splitEditorHost.setup(records),
      notifyRouteChange: (route) => this.#pluginHost.dispatchRouteChange({ route }),
    });
  }

  /** Sync the local `#storage` / `#deviceStore` mirrors from the
   *  storage bridge. Called after every operation that can change
   *  which backend is active. */
  #syncStorageFromBridge(): void {
    this.#storage = this.#storageBridge.getStorage();
    this.#deviceStore = this.#storageBridge.getDeviceStore();
  }

  async init(
    opts: {
      plugins?: AnnotPlugin[];
      /** Skip the listed built-in storage backends. Disabled
       *  built-ins don't appear in the sidebar, can't be selected,
       *  and `restoreOnBoot` falls back to `browser` if a disabled
       *  mode was the user's last selection. `"browser"` can never
       *  be disabled — it's the universal fallback every other
       *  backend's failure path lands on; passing `"browser"`
       *  throws here so the misconfiguration surfaces immediately. */
      disableBuiltinStorage?: BuiltInStorageMode[];
      /** Filter the built-in plugin list before registration.
       *  Currently the only built-in is `"github-external-links"`.
       *  Unknown names log a warning and no-op for forward-compat
       *  (so a deployment config doesn't break when a future Annot
       *  release renames a built-in). */
      disableBuiltinPlugins?: string[];
      /** Skip listed built-in sidebar tabs by tab id. Today the
       *  only built-in is `"recent"` (registered by the
       *  `recent-tab` plugin). Unknown ids log a warning + no-op
       *  for forward-compat. The whole plugin is skipped — its
       *  `onEditorReady` tracker doesn't run either, so there's
       *  no orphan localStorage write happening behind the
       *  scenes. */
      disableBuiltinTabs?: string[];
      /** Section ordering override. Merged over the defaults
       *  `{ storage: 10, views: 20, folders: 30 }`. Lower
       *  priority renders first; ties fall back to the fixed
       *  storage / views / folders order. */
      sidebarSectionOrder?: SidebarSectionOrder;
      /** Skip listed built-in drawer / right-panel sections by
       *  id. Today no built-ins use the `UISection` shape yet
       *  (Phase 2 / 3 of plugin-ui-slots migrate them); the
       *  option lands now so cloud / locked-down deployments
       *  can pre-configure their disable list against the
       *  documented built-in ids. Once the migrations land,
       *  passing `["drawer.last-commit"]` will hide that
       *  section. Unknown ids will warn + no-op for forward-
       *  compat — Phase 1 doesn't know any built-in ids yet, so
       *  the validation defers to the surfaces that consume the
       *  set in later phases. */
      disableBuiltinUISections?: string[];
    } = {},
  ): Promise<void> {
    // `"browser"` opt-out check — fail fast at init so the
    // misconfiguration is obvious rather than triggering at the
    // first storage failure when fallback is needed.
    if (opts.disableBuiltinStorage?.includes("browser")) {
      throw new Error(
        '`"browser"` cannot be disabled via disableBuiltinStorage — ' +
          "it's the universal fallback every other backend lands on.",
      );
    }
    this.#disabledBuiltinStorage = new Set(opts.disableBuiltinStorage ?? []);

    // Built-in tabs map their tab id → owning plugin so
    // `disableBuiltinTabs: ["recent"]` can drop the whole plugin
    // (including its `onEditorReady` tracker) instead of leaving
    // an orphan listener writing to localStorage with nothing on
    // screen to use it. Tab-id keys keep the public-facing name
    // distinct from internal plugin names.
    const builtinTabPlugins: Array<{ tabId: string; plugin: AnnotPlugin }> = [
      { tabId: "recent", plugin: recentTabPlugin },
    ];
    const disabledTabIds = new Set(opts.disableBuiltinTabs ?? []);
    const knownTabIds = new Set(builtinTabPlugins.map((b) => b.tabId));
    for (const id of disabledTabIds) {
      if (!knownTabIds.has(id)) {
        console.warn(`[init] disableBuiltinTabs: "${id}" is not a known built-in tab; ignoring.`);
      }
    }

    // Filter built-in plugins by name. Unknown names are tolerated
    // so a config that names a future-renamed built-in doesn't
    // crash on an older Annot.
    const allBuiltinPlugins: AnnotPlugin[] = [
      githubExternalLinksPlugin,
      ...builtinTabPlugins.filter((b) => !disabledTabIds.has(b.tabId)).map((b) => b.plugin),
    ];
    const disabledPluginNames = new Set(opts.disableBuiltinPlugins ?? []);
    const knownNames = new Set(allBuiltinPlugins.map((p) => p.name));
    for (const name of disabledPluginNames) {
      if (!knownNames.has(name)) {
        console.warn(
          `[init] disableBuiltinPlugins: "${name}" is not a known built-in plugin; ignoring.`,
        );
      }
    }
    const activeBuiltinPlugins = allBuiltinPlugins.filter((p) => !disabledPluginNames.has(p.name));

    // Stash the section-order override so the sidebar callbacks
    // can read it on every render. `App.init` is called once at
    // boot so we don't need a setter — a deployment that wants
    // to change ordering at runtime would re-init.
    this.#sidebarSectionOrder = opts.sidebarSectionOrder ?? {};
    // Validate `disableBuiltinUISections` against the known built-in
    // ids — drawer (Phase 2) + right-panel (Phase 3). Unknown
    // entries log a warning + no-op for forward-compat with
    // newer-than-config deployments.
    const { BUILTIN_DRAWER_SECTION_IDS } = await import("@ingcreators/annot-editor-shell/annot-file-details-drawer");
    const { BUILTIN_RIGHT_PANEL_SECTION_IDS } = await import("./editor/right-panel.js");
    const knownIds = new Set<string>([
      ...BUILTIN_DRAWER_SECTION_IDS,
      ...BUILTIN_RIGHT_PANEL_SECTION_IDS,
    ]);
    for (const id of opts.disableBuiltinUISections ?? []) {
      if (!knownIds.has(id)) {
        console.warn(
          `[init] disableBuiltinUISections: "${id}" is not a known built-in section id; ignoring.`,
        );
      }
    }
    this.#disabledBuiltinUISections = new Set(opts.disableBuiltinUISections ?? []);

    // Wire the sidebar refresh hook BEFORE plugin registration —
    // a plugin's `register()` may call `updateSidebarTab` (e.g. to
    // declare an initial active state) and we want that to fire
    // through the listener path on the very first render. The
    // listener no-ops while the file manager isn't mounted, so
    // there's no cost during the editor-only sessions.
    this.#pluginHost.onSidebarChange(() => {
      // The sidebar reads tabs / plugin storages via callbacks the
      // plugin host evaluates on render. Lit doesn't observe those
      // closures directly, so we ask the element for a manual
      // re-render after the host announces a change.
      this.#fileManager?.sidebar.requestUpdate();
    });

    // Register plugins first so every lifecycle event — including
    // the very first `restoreOnBoot` → `onRouteChange` — goes through
    // the plugin dispatch path. Built-in plugins come first; caller-
    // supplied plugins (`annot-cloud`, third parties) are appended so
    // they see the final state built-ins produced.
    this.#pluginHost.registerAll([...activeBuiltinPlugins, ...(opts.plugins ?? [])]);

    const { BrowserStore } = await import("./storage/browser-store.js");
    const browserStore = new BrowserStore();

    // Silently restore the filesystem handle (if previously granted)
    // then rehydrate whichever backend the user was last using. Falls
    // back to the BrowserStore when a persisted session can't be
    // reopened without prompting.
    await this.#storageBridge.restoreOnBoot(browserStore);
    this.#syncStorageFromBridge();

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

    window.addEventListener("popstate", () => this.#routerHost.handleRoute());

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

      logger.debug(
        "[annot/app] handoff record.pageMetadata:",
        record.pageMetadata ? `${record.pageMetadata.elements.length} elements` : "none",
      );
      this.#editorSession.setupEditor(record.originalDataUrl, w, h, undefined, record.pageMetadata);

      pushRoute(editUrl(getStorageMode(), savedPath));

      deleteExtensionImage(editPath);
    });

    await this.#routerHost.handleRoute();
  }

  // ---- File Manager (Gallery) ----

  private showGalleryView(): void {
    logger.debug(
      "[showGalleryView] mode:",
      getStorageMode(),
      "storage:",
      this.#storage?.constructor?.name,
    );
    // Tear down split editor if active (session → gallery).
    this.#splitEditorHost.unmount();
    const canvasContainer = assertNonNull(
      document.getElementById("canvas-container"),
      "#canvas-container missing — check index.html shell",
    );
    canvasContainer.style.display = "none";

    const fileManagerEl = assertNonNull(
      document.getElementById("file-manager"),
      "#file-manager missing — check index.html shell",
    );
    fileManagerEl.style.display = "";

    const statusbar = assertNonNull(
      document.getElementById("statusbar"),
      "#statusbar missing — check index.html shell",
    );
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
      const sidebarEl = assertNonNull(
        document.getElementById("sidebar"),
        "#sidebar missing — check index.html shell",
      );
      const mainContentEl = assertNonNull(
        document.getElementById("main-content"),
        "#main-content missing — check index.html shell",
      );

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
        getPluginStorages: () => this.#pluginHost.listStorageRegistrations(),
        isBuiltinDisabled: (mode) => this.#disabledBuiltinStorage.has(mode),
        getSidebarTabs: () => this.#pluginHost.listSidebarTabs(),
        getSidebarSectionOrder: () => this.#sidebarSectionOrder,
        getThumbnailManager: () => this.#thumbnailManager,
      });

      this.#storageBridge.updateSidebarStatus(getStorageMode());
    }

    this.buildFileManagerHeader();

    if (this.#storage) {
      if (this.#fileManager.storage !== this.#storage) {
        this.#fileManager.setStorage(
          this.#storage,
          getStorageMode(),
          this.#storageBridge.currentRootName(),
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
    await this.#savePipeline.flushPending();
    if (window.location.pathname !== galleryUrl()) {
      pushRoute(galleryUrl());
    }
    this.showGalleryView();
  }

  private buildFileManagerHeader(): void {
    const toolbarEl = assertNonNull(
      document.getElementById("toolbar"),
      "#toolbar missing — check index.html shell",
    );
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
    searchWrap.appendChild(createBuiltinIcon("search", "header-search-icon"));

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
    helpBtn.className = "header-info-btn";
    helpBtn.appendChild(createBuiltinIcon("help_outline"));
    setTooltip(helpBtn, "Help");
    helpBtn.setAttribute("aria-label", "Help");
    toolbarEl.appendChild(helpBtn);

    // Shared theme toggle factory (from @ingcreators/annot-core) — same behavior
    // as the editor toolbar's toggle so both stay in sync.
    toolbarEl.appendChild(createThemeToggle("header-info-btn"));
  }

  /** Display name for the root of the currently-active storage.
   *  Shown under the top-level FOLDERS node in the sidebar so the
   *  user sees WHICH device folder / Drive folder is in use. Null
   *  when the backend has no meaningful user-facing root (e.g.
   *  Browser/Local stores to per-origin IDB). */
  /**
   * Click-to-switch: delegated to `StorageBridge`. On a successful
   * switch, sync the local mirrors, clear the folder path, refresh
   * sidebar status, and reload the file manager's contents.
   */
  private async handleStorageSelect(mode: StorageMode, forcePicker = false): Promise<void> {
    const ok = await this.#storageBridge.handleStorageSelect(mode, forcePicker);
    if (!ok) return;
    this.#syncStorageFromBridge();
    this.#currentFolderPath = "";
    this.#storageBridge.updateSidebarStatus(getStorageMode());
    if (this.#fileManager && this.#storage) {
      this.#fileManager.setStorage(
        this.#storage,
        getStorageMode(),
        this.#storageBridge.currentRootName(),
      );
      this.#fileManager.refresh("");
    }
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
