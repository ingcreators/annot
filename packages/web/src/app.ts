/**
 * Annot by ingcreators — main application.
 * File Manager (gallery) ↔ Editor switching with path-based StorageProvider.
 */

import type { DocumentRecord, ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { supportsDocuments } from "@ingcreators/annot-core/storage";
import { assertNonNull } from "@ingcreators/annot-core/utils";
import { createThemeToggle } from "@ingcreators/annot-editor";
import { setTooltip } from "@ingcreators/annot-editor/tooltip";
// Section-id whitelists for the `disableBuiltinUISections`
// validator below. Static imports because both modules are
// already in the bundle via `EditorSession.setupEditor` —
// dynamic imports here just trip Vite's
// `[INEFFECTIVE_DYNAMIC_IMPORT]` warning without saving any
// bytes.
import { BUILTIN_DRAWER_SECTION_IDS } from "@ingcreators/annot-host-ui/annot-file-details-drawer";
import { createBuiltinIcon } from "@ingcreators/annot-host-ui/annot-icon-imperative";
import { FileManager } from "@ingcreators/annot-host-ui/gallery/file-manager";
import type { SidebarSectionOrder } from "@ingcreators/annot-host-ui/gallery/sidebar";
import { IndexedDBThumbnailCache } from "@ingcreators/annot-host-ui/idb-thumbnail-cache";
import { HeaderHost } from "@ingcreators/annot-host-ui/orchestrators/header-host";
import { SavePipeline } from "@ingcreators/annot-host-ui/orchestrators/save-pipeline";
import { StatusHost } from "@ingcreators/annot-host-ui/orchestrators/status-host";
import { BUILTIN_RIGHT_PANEL_SECTION_IDS } from "@ingcreators/annot-host-ui/right-panel";
import { ThumbnailManager } from "@ingcreators/annot-host-ui/thumbnail-manager";
import { CaptureHost, type OpenEditorArgs } from "./app/capture-host.js";
import { EditorSession } from "./app/editor-session.js";
import { ExtensionTransferHost } from "./app/extension-transfer-host.js";
import { loadImage } from "./app/image-utils.js";
import { type AnnotPlugin, PluginHost } from "./app/plugin-host.js";
import { githubExternalLinksPlugin } from "./app/plugins/github-external-links.js";
import { recentTabPlugin } from "./app/plugins/recent-tab.js";
import { RouterHost } from "./app/router-host.js";
import { SplitEditorHost } from "./app/split-editor-host.js";
import { StorageBridge } from "./app/storage-bridge.js";
import { pasteFromClipboard } from "./capture/pwa-capture.js";
import { ScratchpadStore } from "./editor/scratchpad-store.js";
import { logger } from "./logger.js";
import { docUrl, editUrl, galleryUrl, pushRoute } from "./router.js";
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
import { GitHubStore } from "./storage/github-store.js";
import { hideError, showSaveError } from "./ui/error-bar.js";

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
  /** Status host — owns the editor statusbar + zoom controls.
   *  Lazy-resolved against `#statusbar` because Phase 3 of
   *  `docs/plans/_done/host-convergence.md` lifted `StatusHost` into
   *  editor-shell with constructor-injected host element. The
   *  index.html-shipped `<div id="statusbar">` is in the DOM before
   *  `main.ts` runs `new App()`, so the field initializer resolves
   *  cleanly. */
  #statusHost: StatusHost = new StatusHost(
    assertNonNull(
      document.getElementById("statusbar"),
      "#statusbar missing — check index.html shell",
    ),
  );
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
      // Phase 3 / PR B of `docs/plans/_done/host-convergence.md` — the
      // SavePipeline orchestrator now lives in editor-shell and
      // takes its banner UI through callbacks. Wire the PWA's
      // `<annot-error-bar>` singleton (`./ui/error-bar.ts`) here.
      onSaveError: (message, retry) => showSaveError(message, retry),
      onSaveSuccess: () => hideError(),
    });
    this.#captureHost = new CaptureHost({
      getStorage: () => this.#storage,
      getCurrentFolderPath: () => this.#currentFolderPath,
      getFileManager: () => this.#fileManager,
      openEditor: (args) => this.#openEditorFor(args),
      getThumbnailManager: () => this.#thumbnailManager,
    });
    this.#headerHost = new HeaderHost(
      assertNonNull(
        document.getElementById("editor-header"),
        "#editor-header missing — check index.html shell",
      ),
      {
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
        // Phase 3 / PR C of `docs/plans/_done/host-convergence.md` — host
        // concerns lifted out of HeaderHost into deps callbacks so
        // editor-shell stays host-neutral. PWA wires:
        getRootLabel: () => {
          const mode = getStorageMode();
          return mode === "device"
            ? "Device"
            : mode === "googledrive"
              ? "Google Drive"
              : mode === "github"
                ? "GitHub"
                : "Browser";
        },
        pushEditRoute: (newPath) => pushRoute(editUrl(getStorageMode(), newPath)),
        fetchLastCommit: async (path) => {
          const storage = this.#storage;
          if (!(storage instanceof GitHubStore)) return null;
          const info = await storage.getLastCommit(path);
          if (!info) return null;
          return {
            authorName: info.authorName,
            authorAvatarUrl: info.authorAvatarUrl,
            messageHeadline: info.messageHeadline,
            date: info.date,
            shortSha: info.shortSha,
            url: info.url,
          };
        },
        openFile:
          typeof (window as unknown as { __annot_openFile?: () => void }).__annot_openFile ===
          "function"
            ? () => (window as unknown as { __annot_openFile: () => void }).__annot_openFile()
            : undefined,
      },
    );
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
      openDocFromGallery: (record) => this.openDocFromGallery(record),
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
    // Tear down doc-mode if active (Phase 6e). Idempotent —
    // no-op when not in doc-mode.
    this.#tearDownDocMode();
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
        onOpenDocument: (record) => {
          // Phase 6d: gallery double-click on a document card →
          // route through `/doc/<store>/<path>` so the existing
          // router-host doc branch handles the mount + edit
          // wiring. Same pattern `onOpenImage` uses above.
          pushRoute(docUrl(getStorageMode(), record.path));
          void this.#routerHost.handleRoute();
        },
        onFolderChange: (folderPath) => {
          this.#currentFolderPath = folderPath;
          saveLastFolder(folderPath);
        },
        onNewFolder: () => this.#fileManager!.createNewFolder(),
        onUploadImage: () => this.#captureHost.openFileDialog(),
        onCaptureScreen: () => this.#captureHost.captureScreenAndSave(),
        onTimedCapture: () => this.#captureHost.timedCaptureAndSave(),
        onPasteClipboard: () => this.#captureHost.pasteAndSave(),
        // Surface "New Document" only when the active backend opts
        // into `StorageWithDocuments` — otherwise the menu entry
        // would route to a backend that can't persist what the
        // user just created.
        ...(this.#storage && supportsDocuments(this.#storage)
          ? { onNewDocument: () => this.createNewDocument() }
          : {}),
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
    // Brand lockup matches the extension popup 1:1 — same 32×32
    // logo, same 18px wordmark, same 10px attribution line, same
    // letter-spacing — so users moving between popup and gallery
    // perceive a single brand identity. The editor header's
    // `.editor-header-brand` keeps its own 30×30 because it has
    // no accompanying text and lives in a different visual context
    // (just a back-to-gallery button).
    brand.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="7" r="3.5" fill="#7c9cff"/>
        <path d="M24 13 L13 38" stroke="#7ef0c5" stroke-width="4" stroke-linecap="round"/>
        <path d="M24 13 L35 38" stroke="#b391ff" stroke-width="4" stroke-linecap="round"/>
        <path d="M19 24 H29" stroke="#7c9cff" stroke-width="3.5" stroke-linecap="round"/>
      </svg>
      <span class="brand-stack">
        <span class="brand-text">Annot</span>
        <span class="brand-org">by ingcreators</span>
      </span>
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

    // Phase 6e — tear down doc-mode if active, since image-edit
    // and doc-edit are mutually exclusive view modes.
    this.#tearDownDocMode();

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

  /**
   * Create a blank `.annot.html` document and navigate to its
   * `/doc/...` URL. Phase 6c of
   * `docs/plans/annot-html-document.md`. Wired through the
   * sidebar's New menu when the active storage backend opts into
   * `StorageWithDocuments`. Behaviour:
   *
   *   1. Synthesise an empty document via `createEmptyDocument`.
   *   2. Serialise to canonical bytes via `serializeDocument`.
   *   3. Persist via `storage.saveDocument` (the backend assigns
   *      a unique filename inside the current folder).
   *   4. Navigate to `/doc/<store>/<assigned-path>` so the
   *      router-host's doc-route branch picks up + mounts the
   *      shell against the new record.
   *
   * Errors surface via the existing `showSaveError` toast; the
   * editor falls back to the gallery view.
   */
  async createNewDocument(): Promise<void> {
    if (!this.#storage) return;
    if (!supportsDocuments(this.#storage)) return;
    const storage = this.#storage;
    const folderPath = this.#currentFolderPath;
    try {
      const { createEmptyDocument, serializeDocument } = await import("@ingcreators/annot-doc");
      const doc = createEmptyDocument({ title: "Untitled" });
      const bytes = serializeDocument(doc);
      const now = new Date().toISOString();
      const path = await storage.saveDocument({
        folderPath,
        bytes,
        thumbnailDataUrl: "",
        title: doc.title,
        imageCount: 0,
        blockCount: doc.blocks.length,
        createdAt: now,
        updatedAt: now,
      });
      pushRoute(docUrl(getStorageMode(), path));
      await this.#routerHost.handleRoute();
    } catch (err) {
      showSaveError(`Couldn't create a new document: ${(err as Error).message}`);
    }
  }

  /**
   * Open an `.annot.html` document into the doc-shell.
   *
   * Phase 6b of `docs/plans/annot-html-document.md`. Minimum-viable
   * mount: the shell takes over a fixed-position overlay container
   * appended to `document.body`, and `doc-changed` events drive a
   * direct `storage.updateDocument` call (bypassing the per-image
   * `SavePipeline` orchestrator the editor uses — Phase 6c folds
   * documents into the same orchestrator, including dirty-tracking,
   * status-bar integration, and Save-As). The current implementation
   * deliberately doesn't tear down or hide the gallery's chrome —
   * it sits on top via `position: fixed` so the user can navigate
   * back via the URL or browser back button. Phase 6c replaces this
   * with proper view-mode switching matching `setupEditor`.
   *
   * Storage backend MUST opt into `StorageWithDocuments`; the
   * router-host narrows before invoking. The capability check here
   * is a defensive belt-and-braces — if the route was reached via a
   * channel that didn't narrow first, we hard-fail rather than
   * silently no-op.
   */
  async openDocFromGallery(record: DocumentRecord): Promise<void> {
    if (!this.#storage) return;
    if (!supportsDocuments(this.#storage)) {
      throw new Error("openDocFromGallery: active storage does not implement StorageWithDocuments");
    }
    const storage = this.#storage;

    // Lazy-load: parsing + the shell pull in the doc package + the
    // image-editor modal it transitively imports. Code-split here so
    // image-only sessions stay slim.
    const [{ parseDocument }, { AnnotDocShellElement }] = await Promise.all([
      import("@ingcreators/annot-doc"),
      // The shell self-registers via `customElements.define` on
      // module load; importing for side effects is enough.
      import("@ingcreators/annot-host-ui/annot-doc-shell"),
    ]);

    let parsed: ReturnType<typeof parseDocument>;
    try {
      parsed = parseDocument(record.bytes);
    } catch (err) {
      showSaveError(`Failed to parse document: ${(err as Error).message}`);
      return;
    }

    // Phase 6e — proper view-mode switching:
    //   - Push the canonical `/doc/...` URL.
    //   - Hide the gallery / canvas / statusbar surfaces (mirrors
    //     `setupEditor`'s gallery↔editor handoff so doc-mode +
    //     editor-mode stay mutually exclusive).
    //   - Mount the doc-shell into a dedicated `#annot-doc-host`
    //     element appended to `#main-content` (rather than the
    //     body overlay Phase 6b shipped) so the existing CSS
    //     layout system + responsive behaviour applies.
    //   - Wire a "Back to gallery" affordance so the user has an
    //     in-app exit path that doesn't depend on the browser's
    //     back button or URL-bar typing.
    pushRoute(docUrl(getStorageMode(), record.path));
    document.body.classList.add("annot-doc-mode");

    // Hide non-doc surfaces — same shape as `setupEditor`'s
    // gallery teardown, just inverted (we keep the editor surfaces
    // hidden and show our own).
    const fileManagerEl = document.getElementById("file-manager");
    if (fileManagerEl) fileManagerEl.style.display = "none";
    const canvasContainer = document.getElementById("canvas-container");
    if (canvasContainer) canvasContainer.style.display = "none";
    const statusbar = document.getElementById("statusbar");
    if (statusbar) statusbar.style.display = "none";

    const mainContent = document.getElementById("main-content");
    let host = document.getElementById("annot-doc-host") as HTMLDivElement | null;
    if (!host) {
      host = document.createElement("div");
      host.id = "annot-doc-host";
      host.style.cssText =
        "display:flex;flex-direction:column;width:100%;height:100%;background:var(--annot-doc-bg,#ffffff);overflow:auto;";
      // Mount alongside / inside `#file-manager`'s parent so the
      // existing layout grid handles it. `#main-content` is the
      // canonical mount point per the index.html shell.
      (mainContent ?? document.body).appendChild(host);
    } else {
      host.innerHTML = "";
      host.style.display = "flex";
    }

    // Header bar with title + Back button. Inline styles only —
    // tightly scoped to this view; if it grows we move to a
    // proper Lit element with a stylesheet.
    const header = document.createElement("div");
    header.className = "annot-doc-mode-header";
    header.style.cssText =
      "display:flex;align-items:center;gap:12px;padding:8px 16px;border-bottom:1px solid var(--annot-doc-muted,#6b7280);background:var(--annot-doc-bg,#ffffff);";
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.textContent = "← Back to gallery";
    backBtn.style.cssText =
      "padding:6px 10px;border:1px solid var(--annot-doc-muted,#6b7280);background:transparent;color:inherit;border-radius:4px;cursor:pointer;font-size:0.875rem;";
    backBtn.addEventListener("click", () => {
      pushRoute(galleryUrl(this.#currentFolderPath));
      void this.#routerHost.handleRoute();
    });
    const titleEl = document.createElement("div");
    titleEl.className = "annot-doc-mode-title";
    titleEl.textContent = parsed.title || "Untitled";
    titleEl.style.cssText = "font-weight:600;flex:1;";
    header.append(backBtn, titleEl);
    host.appendChild(header);

    const body = document.createElement("div");
    body.className = "annot-doc-mode-body";
    body.style.cssText = "flex:1;overflow:auto;padding:1rem;";
    host.appendChild(body);

    const shell = document.createElement("annot-doc-shell") as InstanceType<
      typeof AnnotDocShellElement
    >;
    shell.document = parsed;
    shell.editing = true;
    body.appendChild(shell);

    // Wire dirty → save. Phase 6c will route this through the
    // SavePipeline orchestrator so the toolbar's save status
    // indicator stays accurate; for v1 we save eagerly on every
    // mutation and report errors via the existing error-bar
    // surface.
    let pendingSave: Promise<void> | null = null;
    let dirtyAfterPending = false;
    const save = async (current: typeof parsed) => {
      if (pendingSave) {
        // A save is already in flight — note that we need another
        // pass after it lands and bail; the next iteration picks up
        // whatever the doc-shell ended up with.
        dirtyAfterPending = true;
        return;
      }
      pendingSave = (async () => {
        try {
          const { serializeDocument } = await import("@ingcreators/annot-doc");
          const bytes = serializeDocument(current);
          const imageCount = current.blocks.filter((b) => b.kind === "image").length;
          await storage.updateDocument(record.path, {
            bytes,
            title: current.title,
            imageCount,
            blockCount: current.blocks.length,
            updatedAt: new Date().toISOString(),
          });
        } catch (err) {
          showSaveError(`Couldn't save document: ${(err as Error).message}`);
        } finally {
          pendingSave = null;
          if (dirtyAfterPending) {
            dirtyAfterPending = false;
            const latest = shell.document;
            if (latest) void save(latest);
          }
        }
      })();
    };
    shell.addEventListener("doc-changed", () => {
      const latest = shell.document;
      if (!latest) return;
      // Keep the doc-mode header title in sync when the user edits
      // the H1 / sidecar metadata. The title shown is whatever the
      // shell's current document carries — if the shell ever stops
      // tracking title in `doc.title`, the header will show stale
      // text until a re-mount.
      titleEl.textContent = latest.title || "Untitled";
      void save(latest);
    });
  }

  /**
   * Phase 6e teardown helper — removes the doc-mode overlay + its
   * `body.annot-doc-mode` class so a subsequent `showGalleryView`
   * or `setupEditor` doesn't leak the doc surface on top of the
   * gallery / editor. Idempotent on no-doc-mode-active state.
   */
  #tearDownDocMode(): void {
    document.body.classList.remove("annot-doc-mode");
    const host = document.getElementById("annot-doc-host");
    if (host) host.remove();
  }
}
