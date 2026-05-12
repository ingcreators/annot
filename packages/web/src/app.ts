/**
 * Annot by ingcreators — main application.
 * File Manager (gallery) ↔ Editor switching with path-based StorageProvider.
 */

import type {
  DocumentRecord,
  ImageRecord,
  StorageProvider,
  StorageWithDocuments,
} from "@ingcreators/annot-core/storage";
import { supportsDocuments } from "@ingcreators/annot-core/storage";
import { assertNonNull } from "@ingcreators/annot-core/utils";
import { createThemeToggle } from "@ingcreators/annot-editor";
import { setTooltip } from "@ingcreators/annot-editor/tooltip";
import { DOC_SHORTCUT_GROUPS, installKeyboardHelp } from "@ingcreators/annot-host-ui";
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
  /** Phase 8 of `docs/plans/annot-html-document-ux-polish.md` —
   *  teardown handle for the global `?` keyboard-help listener
   *  installed in doc-mode. The teardown runs on
   *  `#tearDownDocMode` so the listener doesn't leak when the
   *  user navigates back to the gallery / image editor. */
  #docModeKeyboardHelpUninstall: (() => void) | null = null;
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
        // Surface "New Document" + "From Template…" only when the
        // active backend opts into `StorageWithDocuments` — otherwise
        // the menu entries would route to a backend that can't
        // persist what the user just created.
        ...(this.#storage && supportsDocuments(this.#storage)
          ? {
              onNewDocument: () => this.createNewDocument(),
              onNewFromTemplate: () => this.openTemplatePickerForNew(),
              // Phase 4 of card-procedure-template — gated on the
              // same `supportsDocuments` capability as the other
              // doc-creating entries. Gallery hides the menu
              // entry when this callback is omitted.
              onCreateCardDocument: (images) => this.createCardDocumentFromImages(images),
            }
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
   * `docs/plans/_done/annot-html-document.md`. Wired through the
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
   * Phase 4 of `docs/plans/_done/card-procedure-template.md` — generate
   * a card-style step document from the gallery's ordered image
   * selection. Pipeline:
   *
   *   1. Open `showCreateCardDocumentDialog` so the user can pick
   *      title / per-step layout / column count / numbering.
   *   2. Cancel / Esc → no-op.
   *   3. On OK: call `createCardDocumentFromImages` to build the
   *      `AnnotDocument` (one step block per image, in click
   *      order, with the chosen layout + numbering).
   *   4. Serialise + save via `storage.saveDocument` at the
   *      current folder path (same as `createNewDocument`).
   *   5. Navigate to the saved doc — the router-host's `?doc=`
   *      branch mounts the doc shell against the freshly-saved
   *      bytes.
   *
   * Mirrors `createNewDocument` / `openTemplatePickerForNew` for
   * the persist + navigate tail; differs in steps 1–3 (dialog +
   * generator). Errors surface via `showSaveError`.
   */
  async createCardDocumentFromImages(
    imagesInOrder: readonly import("@ingcreators/annot-core/storage").ImageRecord[],
  ): Promise<void> {
    if (!this.#storage) return;
    if (!supportsDocuments(this.#storage)) return;
    if (imagesInOrder.length === 0) return;
    const storage = this.#storage;
    const folderPath = this.#currentFolderPath;
    try {
      const { showCreateCardDocumentDialog } = await import(
        "@ingcreators/annot-host-ui/ui/create-card-document-dialog"
      );
      const result = await showCreateCardDocumentDialog({
        imageCount: imagesInOrder.length,
      });
      if (!result) return;
      // Phase 7d-polish: hydrate each image record so its
      // `originalDataUrl` is populated before we embed the
      // bytes into the generated step blocks. `listImages` on
      // some storage backends (DeviceStore, GitHubStore — every
      // backend whose listing is lazy) returns records with
      // `originalDataUrl: ""`; without this hydration step, the
      // generated SVG carries `<image href="">` and the cards
      // render as broken images. Browser storage happened to
      // work because its IndexedDB-backed listing returned the
      // full records eagerly.
      const hydratedImages: import("@ingcreators/annot-core/storage").ImageRecord[] = [];
      for (const img of imagesInOrder) {
        if (img.originalDataUrl) {
          hydratedImages.push(img);
          continue;
        }
        const full = await storage.getImage(img.path);
        if (full && full.originalDataUrl) {
          hydratedImages.push(full);
        } else {
          // Defensive: a record that can't be hydrated would
          // produce a broken card. Skip it with a console
          // hint; the user sees fewer cards than expected,
          // which is preferable to silent black squares.
          console.warn("[createCardDocumentFromImages] skipped image with no bytes:", img.path);
        }
      }
      if (hydratedImages.length === 0) {
        showSaveError("Couldn't load any of the selected images.");
        return;
      }
      const { createCardDocumentFromImages } = await import(
        "@ingcreators/annot-host-ui/gallery/create-card-document"
      );
      const annotDoc = createCardDocumentFromImages(hydratedImages, {
        title: result.title,
        layout: result.layout,
        columns: result.columns,
      });
      const { serializeDocument, extractDocumentThumbnailDataUrl } = await import(
        "@ingcreators/annot-doc"
      );
      const bytes = serializeDocument(annotDoc);
      const now = new Date().toISOString();
      const path = await storage.saveDocument({
        folderPath,
        bytes,
        thumbnailDataUrl: extractDocumentThumbnailDataUrl(annotDoc),
        title: annotDoc.title,
        imageCount: imagesInOrder.length,
        blockCount: annotDoc.blocks.length,
        createdAt: now,
        updatedAt: now,
      });
      pushRoute(docUrl(getStorageMode(), path));
      await this.#routerHost.handleRoute();
    } catch (err) {
      showSaveError(`Couldn't create the card document: ${(err as Error).message}`);
    }
  }

  /**
   * Phase 8d / 9b — open the template picker, then on
   * selection clone the chosen template into a fresh
   * document, persist it, and navigate. Wired through the
   * sidebar's "From Template…" entry when the active storage
   * backend opts into `StorageWithDocuments`. Pairs with
   * `createNewDocument` (which creates a blank doc).
   *
   * Behaviour:
   *
   *   1. Resolve `BUILTIN_TEMPLATES` (Tier A, in-memory) for
   *      the dialog's "Built-in" section. Phase 9a authored
   *      `manual` / `feature-guide` / `procedure` starters;
   *      Phase 9b (this method) consumes them.
   *   2. List `Templates/` via `storage.listDocuments`.
   *      Backends that don't have a Templates folder yet
   *      return an empty list — the dialog still opens
   *      (showing "No user templates yet") so the user
   *      sees the affordance.
   *   3. For each user-template entry, fetch its bytes via
   *      `storage.getDocument`, run `isTemplateFromHead` as a
   *      fast pre-filter, then `parseDocument` for survivors
   *      to extract `meta.template.{name, description, tags}`.
   *   4. Open `showTemplatePickerDialog` with the assembled
   *      built-in + user lists.
   *   5. On selection:
   *        - `kind: "user"` — `getDocument` → `parseDocument`
   *          → `cloneTemplate` → save → navigate.
   *        - `kind: "builtin"` — look up the in-memory source
   *          via `getBuiltinTemplate(id)`; the rest of the
   *          pipeline (parse → clone → save → navigate) is
   *          identical.
   *   6. Cancel / Esc / overlay-click → no-op.
   *
   * Errors at any stage surface via the existing
   * `showSaveError` toast.
   */
  async openTemplatePickerForNew(): Promise<void> {
    if (!this.#storage) return;
    if (!supportsDocuments(this.#storage)) return;
    const storage = this.#storage;
    const folderPath = this.#currentFolderPath;

    // Lazy-load — the doc package + the picker dialog are not
    // pulled into the gallery's first-paint chunk.
    const [
      {
        BUILTIN_TEMPLATES,
        getBuiltinTemplate,
        isTemplateFromHead,
        parseDocument,
        cloneTemplate,
        serializeDocument,
      },
      { showTemplatePickerDialog },
      _picker,
    ] = await Promise.all([
      import("@ingcreators/annot-doc"),
      import("@ingcreators/annot-host-ui/ui/template-picker-dialog"),
      // The picker self-registers via `customElements.define`
      // on module load; importing for side effects is enough.
      import("@ingcreators/annot-host-ui/annot-template-picker"),
    ]);
    void _picker;

    // Built-ins for the picker — shape-converted from the
    // Tier A `BUILTIN_TEMPLATES` to the picker's
    // `BuiltinTemplateEntry` (id / title / description /
    // optional thumbnail). The Tier A export carries `source`
    // too, but the picker doesn't render that — we look it
    // back up in the selection branch via
    // `getBuiltinTemplate`.
    const builtinTemplates: import("@ingcreators/annot-host-ui/annot-template-picker").BuiltinTemplateEntry[] =
      BUILTIN_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
      }));

    let userTemplates: import("@ingcreators/annot-host-ui/annot-template-picker").UserTemplateEntry[] =
      [];
    try {
      const entries = await storage.listDocuments("Templates");
      // Sequential awaits — the typical Templates folder is
      // small (5–20 entries). If it ever grows past that we
      // can `Promise.all` the bytes fetches; for now sequential
      // keeps the request rate predictable on rate-limited
      // backends (Drive / GitHub).
      for (const entry of entries) {
        try {
          const record = await storage.getDocument(entry.path);
          if (!record) continue;
          if (!isTemplateFromHead(record.bytes)) continue;
          const doc = parseDocument(record.bytes);
          const tpl = doc.meta.template;
          if (!tpl) continue;
          userTemplates.push({
            path: entry.path,
            title: tpl.name || entry.title,
            ...(tpl.description !== undefined ? { description: tpl.description } : {}),
            ...(tpl.tags !== undefined ? { tags: tpl.tags } : {}),
          });
        } catch (err) {
          // One bad file shouldn't abort the whole listing.
          // Log it (development) and continue.
          logger.warn("openTemplatePickerForNew: skipped malformed template", entry.path, err);
        }
      }
    } catch (err) {
      // listDocuments failure → still show the dialog so the
      // user gets feedback ("No user templates yet"). The
      // toast surfaces the underlying reason.
      showSaveError(`Couldn't list templates: ${(err as Error).message}`);
      userTemplates = [];
    }

    const detail = await showTemplatePickerDialog({
      userTemplates,
      builtinTemplates,
      title: "Choose a template",
    });
    if (!detail) return;

    // Resolve the source bytes — same pipeline downstream
    // regardless of where the bytes came from.
    let sourceBytes: string | null = null;
    try {
      if (detail.kind === "user") {
        const record = await storage.getDocument(detail.path);
        if (!record) {
          showSaveError("Template was removed before it could be opened.");
          return;
        }
        sourceBytes = record.bytes;
      } else {
        const builtin = getBuiltinTemplate(detail.id);
        if (!builtin) {
          // Stale recently-used chip pointing at a removed
          // built-in id; defensive — `BUILTIN_TEMPLATES` only
          // grows in practice, but the picker stores recents
          // by id so a future renumbering would surface here.
          showSaveError(`Built-in template "${detail.id}" is no longer available.`);
          return;
        }
        sourceBytes = builtin.source;
      }
    } catch (err) {
      showSaveError(`Couldn't load template: ${(err as Error).message}`);
      return;
    }

    try {
      const { extractDocumentThumbnailDataUrl } = await import("@ingcreators/annot-doc");
      const doc = parseDocument(sourceBytes);
      const cloned = cloneTemplate(doc);
      const bytes = serializeDocument(cloned);
      const now = new Date().toISOString();
      // Filename for the cloned doc: use the template's title.
      // Backend uniquifies on collision (`Foo (2).annot.html`).
      const desiredFilename = `${cloned.title || "Untitled"}.annot.html`;
      const newPath = await storage.saveDocument(
        {
          folderPath,
          bytes,
          // Pull the first image's data URL out of the cloned
          // doc as the gallery card's thumbnail. Empty string
          // when the template has no image blocks (the doc
          // card's CSS fallback shows a centered article icon).
          thumbnailDataUrl: extractDocumentThumbnailDataUrl(cloned),
          title: cloned.title,
          imageCount: cloned.blocks.filter((b) => b.kind === "image").length,
          blockCount: cloned.blocks.length,
          createdAt: now,
          updatedAt: now,
        },
        { filename: desiredFilename },
      );
      pushRoute(docUrl(getStorageMode(), newPath));
      await this.#routerHost.handleRoute();
    } catch (err) {
      showSaveError(`Couldn't create document from template: ${(err as Error).message}`);
    }
  }

  /**
   * Open an `.annot.html` document into the doc-shell.
   *
   * Phase 6b of `docs/plans/_done/annot-html-document.md`. Minimum-viable
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
    const [{ parseDocument }, { AnnotDocShellElement }, { AnnotDocHeaderElement }] =
      await Promise.all([
        import("@ingcreators/annot-doc"),
        // The shell self-registers via `customElements.define` on
        // module load; importing for side effects is enough.
        import("@ingcreators/annot-host-ui/annot-doc-shell"),
        // Phase 1 of `docs/plans/annot-html-document-ux-polish.md`
        // replaced the inline-styled header below with this
        // first-class Lit element. The header pulls in the save-
        // status indicator transitively.
        import("@ingcreators/annot-host-ui/annot-doc-header"),
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

    // The doc host MUST live OUTSIDE `#file-manager` — the
    // gallery's `#main-content` div is INSIDE `#file-manager`,
    // so appending the host there (the original Phase 6e mount
    // point) leaves it hidden the moment
    // `fileManagerEl.style.display = "none"` runs above. Append
    // to `document.body` directly (sibling of `#file-manager` /
    // `#canvas-container`) and position the host like
    // `#file-manager` itself: absolute fill below the gallery's
    // `#toolbar` strip (48px tall — see
    // `packages/core/styles/toolbar.css`). The toolbar stays
    // visible in doc mode because it carries the Annot brand
    // and the dark-mode toggle, both of which read fine here
    // too.
    let host = document.getElementById("annot-doc-host") as HTMLDivElement | null;
    if (!host) {
      host = document.createElement("div");
      host.id = "annot-doc-host";
      host.style.cssText =
        "position:absolute;top:48px;left:0;right:0;bottom:0;display:flex;flex-direction:column;background:var(--annot-doc-bg,#ffffff);overflow:auto;z-index:5;";
      document.body.appendChild(host);
    } else {
      host.innerHTML = "";
      host.style.display = "flex";
    }

    // Phase 1 of `docs/plans/annot-html-document-ux-polish.md` —
    // the doc-mode chrome is now `<annot-doc-header>` (a first-
    // class Lit element in `@ingcreators/annot-host-ui`). The
    // header carries: Back button, editable title, save-status
    // indicator, Undo / Redo, "+ Image" primary action, View /
    // Edit mode toggle, and an overflow menu hosting the export
    // + save-as-template entries that used to live as separate
    // top-level buttons. PWA owns the orchestration (save
    // lifecycle, mode toggle, image-insert dispatch); the header
    // is purely presentational.
    const header = document.createElement("annot-doc-header") as InstanceType<
      typeof AnnotDocHeaderElement
    >;
    header.documentTitle = parsed.title || "Untitled";
    header.mode = "edit";
    header.editableTitle = true;
    header.showBack = true;
    header.showSaveStatus = true;
    header.showModeToggle = true;
    header.canUndo = false;
    header.canRedo = false;
    const buildOverflowItems = (
      doc: typeof parsed,
    ): import("@ingcreators/annot-host-ui/annot-doc-header").DocHeaderOverflowItem[] => {
      // Phase 6 of `docs/plans/_done/card-procedure-template.md` —
      // step blocks become slides in the PPTX export alongside
      // image blocks, so the menu enable gate widens to count
      // both kinds. A pure card-procedure document (zero image
      // blocks but N step blocks) now exports cleanly.
      const hasExportableBlock = doc.blocks.some((b) => b.kind === "image" || b.kind === "step");
      return [
        {
          id: "exportPptx",
          label: "Export to PowerPoint…",
          // Disabled when the doc has no slide-producing blocks
          // (no slides → no usable export). Phase 11 of the
          // parent plan landed multi-slide PPTX; Phase 6 of
          // card-procedure-template extends slide emission to
          // step blocks.
          disabled: !hasExportableBlock,
        },
        { id: "saveAsTemplate", label: "Save as template…" },
        // Phase 11 of `annot-html-document-ux-polish.md` —
        // doc-level settings (title / lang / author / theme /
        // maxWidth). Always enabled (no preconditions).
        { id: "documentSettings", label: "Document settings…" },
        // Phase 12 — the static-HTML output the user can paste
        // into other tools / commit somewhere else. Always
        // enabled; the doc serialiser produces self-contained
        // HTML even for empty docs.
        { id: "copyDocHtml", label: "Copy document HTML" },
        // Phase 12 — opens the browser's print dialog with the
        // current article rendered.
        { id: "print", label: "Print…" },
      ];
    };
    header.overflowItems = buildOverflowItems(parsed);
    header.callbacks = {
      onBack: () => {
        pushRoute(galleryUrl(this.#currentFolderPath));
        void this.#routerHost.handleRoute();
      },
      onUndo: () => {
        shell.undo();
      },
      onRedo: () => {
        shell.redo();
      },
      onInsertImage: () => {
        // The shell owns the file-picker → data-URL → ImageBlock
        // pipeline. We just dispatch a synthetic `block-action`
        // with `insertImage` against the last block so the new
        // image lands at the end of the document — matching the
        // primary "+ Image" affordance's "add to end" semantics.
        const docNow = shell.document;
        if (!docNow) return;
        const lastIndex = Math.max(0, docNow.blocks.length - 1);
        const lastWrapper = shell.querySelector(
          `.annot-doc-block-host[data-block-index="${lastIndex}"]`,
        );
        const target = lastWrapper?.querySelector("annot-doc-block-toolbar");
        target?.dispatchEvent(
          new CustomEvent("block-action", {
            bubbles: true,
            composed: true,
            detail: { action: "insertImage" },
          }),
        );
      },
      onModeChange: (next) => {
        const editing = next === "edit";
        shell.editing = editing;
        header.mode = next;
      },
      onTitleCommit: (next) => {
        const current = shell.document;
        if (!current) return;
        const newTitle = next || "Untitled";
        if (newTitle === current.title) return;
        const updated = {
          ...current,
          title: newTitle,
          meta: { ...current.meta, title: newTitle },
        };
        shell.document = updated;
        header.setTitleText(newTitle);
        scheduleSave(updated);
      },
      onOverflowSelect: (action) => {
        const current = shell.document;
        if (!current) return;
        if (action === "exportPptx") {
          void this.#exportDocAsPptx(current);
        } else if (action === "saveAsTemplate") {
          void this.#saveCurrentDocAsTemplate(storage, current);
        } else if (action === "documentSettings") {
          void this.#openDocSettings(shell, header, scheduleSave);
        } else if (action === "copyDocHtml") {
          void this.#copyDocHtmlToClipboard(current);
        } else if (action === "print") {
          // Phase 12 — `window.print()` runs against the current
          // page chrome. Browsers respect the doc's
          // `injectDocumentStyles` print rules + the figure /
          // article styles, so the printed page reads as the
          // standalone-HTML viewer would.
          window.print();
        }
      },
    };
    host.appendChild(header);
    // Phase 8 of `annot-html-document-ux-polish.md` — install the
    // global `?` keyboard-help listener with the doc-mode shortcut
    // group appended. Idempotent: tearing down + re-mounting the
    // doc shell uninstalls the previous listener first so we
    // never stack two `?` listeners.
    this.#docModeKeyboardHelpUninstall?.();
    this.#docModeKeyboardHelpUninstall = installKeyboardHelp({
      extraGroups: () => DOC_SHORTCUT_GROUPS,
    });
    // Save-status indicator is a child of the header — pull the
    // ref out so the existing scheduleSave / runSave pipeline can
    // drive `.status` directly. The header's `firstUpdated` runs
    // synchronously during `appendChild`, so the indicator is
    // already mounted.
    const saveStatus =
      header.getSaveStatusIndicator() ??
      (() => {
        // Defensive fallback: if for any reason the indicator is
        // missing (e.g. `showSaveStatus = false` was flipped
        // after construction), build a detached one so the rest
        // of the pipeline keeps working. The detached element
        // doesn't render anywhere, but it preserves the
        // assignment shape (no `if (saveStatus)` guards needed
        // downstream).
        const fallback = document.createElement("annot-save-status") as HTMLElement & {
          status: "saved" | "pending" | "saving" | "error";
        };
        fallback.status = "saved";
        return fallback;
      })();
    // Phase 12 of `annot-html-document-ux-polish.md` — opt the
    // doc-mode save-status pill into the interactive Retry
    // affordance. Clicking the Retry button (only visible while
    // status === "error") fires a `retry-save` CustomEvent the
    // host listens to.
    //
    // Wait for the header's first render to complete before
    // assigning the property — `getSaveStatusIndicator()` queries
    // the rendered child, which Lit creates inside `firstUpdated`
    // (a microtask after `appendChild`). Without the await the
    // setter runs against the indicator's pre-construction
    // default and the attribute / property never reflect the
    // host's intent.
    void header.updateComplete.then(() => {
      const indicator = header.getSaveStatusIndicator();
      if (!indicator) return;
      (indicator as unknown as { interactive: boolean }).interactive = true;
      indicator.addEventListener("retry-save", () => {
        const latest = shell.document;
        if (latest) void runSave(latest);
      });
    });

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

    // Phase 6f — debounced save lifecycle:
    //   - On `doc-changed`: title sync, status → "pending", arm /
    //     re-arm a 1500 ms debounce timer.
    //   - When the timer fires: status → "saving", run the save,
    //     status → "saved" on success or "error" on failure.
    //   - If a `doc-changed` event arrives while a save is
    //     in-flight, set the queued-after-save flag so we issue a
    //     follow-up save the moment the in-flight one lands. This
    //     keeps a long backend write from dropping interim edits.
    //   - The error-bar surface (`showSaveError`) still fires for
    //     genuine save failures — the indicator's "error" state +
    //     the banner are complementary, not redundant.
    const SAVE_DEBOUNCE_MS = 1500;
    let pendingSave: Promise<void> | null = null;
    let dirtyAfterPending = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const runSave = async (current: typeof parsed): Promise<void> => {
      if (pendingSave) {
        dirtyAfterPending = true;
        return;
      }
      saveStatus.status = "saving";
      pendingSave = (async () => {
        try {
          const { extractDocumentThumbnailDataUrl, serializeDocument } = await import(
            "@ingcreators/annot-doc"
          );
          const bytes = serializeDocument(current);
          const imageCount = current.blocks.filter((b) => b.kind === "image").length;
          await storage.updateDocument(record.path, {
            bytes,
            title: current.title,
            imageCount,
            blockCount: current.blocks.length,
            // Refresh the gallery card's thumbnail from the
            // first image block. Auto-updates on every save:
            // the user adds an image → next save flips the
            // gallery card from "centered article icon" to a
            // proper preview. Empty when the doc has no images.
            thumbnailDataUrl: extractDocumentThumbnailDataUrl(current),
            updatedAt: new Date().toISOString(),
          });
          saveStatus.status = "saved";
        } catch (err) {
          saveStatus.status = "error";
          showSaveError(`Couldn't save document: ${(err as Error).message}`);
        } finally {
          pendingSave = null;
          if (dirtyAfterPending) {
            dirtyAfterPending = false;
            const latest = shell.document;
            if (latest) void runSave(latest);
          }
        }
      })();
    };
    const scheduleSave = (current: typeof parsed): void => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveStatus.status = "pending";
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void runSave(current);
      }, SAVE_DEBOUNCE_MS);
    };
    shell.addEventListener("doc-changed", () => {
      const latest = shell.document;
      if (!latest) return;
      // Phase 1 of `annot-html-document-ux-polish.md` — keep the
      // header's title + canUndo / canRedo + overflow-export
      // gating in sync with the live document. `setTitleText`
      // never overwrites a focused field, so the user's in-
      // progress edit survives.
      header.setTitleText(latest.title || "Untitled");
      header.canUndo = shell.canUndo();
      header.canRedo = shell.canRedo();
      header.overflowItems = buildOverflowItems(latest);
      scheduleSave(latest);
    });

    // Phase 4 of `annot-html-document-ux-polish.md` — empty-state
    // onboarding card "Use a template" bubbles its action up here.
    // The shell self-handles the other three (Start with heading /
    // Insert image / Paste hint). For Use Template we open the
    // existing template-picker dialog and REPLACE the current
    // empty document's content with the chosen template — the
    // path / save slot stay put so the user's mental model
    // ("this empty doc becomes that template") is honored.
    shell.addEventListener("empty-state-action", (e) => {
      const detail = (e as CustomEvent<{ action: string }>).detail;
      if (detail?.action !== "useTemplate") return;
      void this.#replaceCurrentDocFromTemplate(storage, shell, scheduleSave);
    });
  }

  /**
   * Phase 4 of `docs/plans/annot-html-document-ux-polish.md` —
   * empty-state Use Template handler.
   *
   * Lists templates from `Templates/`, shows the picker, then
   * on select parses + clones the chosen template and replaces
   * the current shell document's blocks + meta. The cloned
   * doc's title flows through the existing `scheduleSave` path
   * so the new content lands in the same file the user is
   * looking at — no navigation, no new file.
   */
  async #replaceCurrentDocFromTemplate(
    storage: StorageProvider & StorageWithDocuments,
    shell: import("@ingcreators/annot-host-ui/annot-doc-shell").AnnotDocShellElement,
    scheduleSave: (doc: import("@ingcreators/annot-doc").AnnotDocument) => void,
  ): Promise<void> {
    const [
      { BUILTIN_TEMPLATES, getBuiltinTemplate, isTemplateFromHead, parseDocument, cloneTemplate },
      { showTemplatePickerDialog },
      _picker,
    ] = await Promise.all([
      import("@ingcreators/annot-doc"),
      import("@ingcreators/annot-host-ui/ui/template-picker-dialog"),
      import("@ingcreators/annot-host-ui/annot-template-picker"),
    ]);
    void _picker;

    const builtinTemplates: import("@ingcreators/annot-host-ui/annot-template-picker").BuiltinTemplateEntry[] =
      BUILTIN_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
      }));

    let userTemplates: import("@ingcreators/annot-host-ui/annot-template-picker").UserTemplateEntry[] =
      [];
    try {
      const entries = await storage.listDocuments("Templates");
      for (const entry of entries) {
        try {
          const record = await storage.getDocument(entry.path);
          if (!record) continue;
          if (!isTemplateFromHead(record.bytes)) continue;
          const doc = parseDocument(record.bytes);
          const tpl = doc.meta.template;
          if (!tpl) continue;
          userTemplates.push({
            path: entry.path,
            title: tpl.name || entry.title,
            ...(tpl.description !== undefined ? { description: tpl.description } : {}),
            ...(tpl.tags !== undefined ? { tags: tpl.tags } : {}),
          });
        } catch (err) {
          logger.warn("replaceCurrentDocFromTemplate: skipped malformed template", entry.path, err);
        }
      }
    } catch (err) {
      showSaveError(`Couldn't list templates: ${(err as Error).message}`);
      userTemplates = [];
    }

    const detail = await showTemplatePickerDialog({
      userTemplates,
      builtinTemplates,
      title: "Choose a template",
    });
    if (!detail) return;

    let sourceBytes: string | null = null;
    try {
      if (detail.kind === "user") {
        const record = await storage.getDocument(detail.path);
        if (!record) {
          showSaveError("Template was removed before it could be opened.");
          return;
        }
        sourceBytes = record.bytes;
      } else {
        const builtin = getBuiltinTemplate(detail.id);
        if (!builtin) {
          showSaveError(`Built-in template "${detail.id}" is no longer available.`);
          return;
        }
        sourceBytes = builtin.source;
      }
    } catch (err) {
      showSaveError(`Couldn't load template: ${(err as Error).message}`);
      return;
    }

    try {
      const doc = parseDocument(sourceBytes);
      const cloned = cloneTemplate(doc);
      // Replace the live shell document — the save lifecycle's
      // `doc-changed` listener picks this up and pushes the new
      // bytes to the same file slot.
      shell.document = cloned;
      scheduleSave(cloned);
    } catch (err) {
      showSaveError(`Couldn't apply template: ${(err as Error).message}`);
    }
  }

  /**
   * Phase 8b — "Save as template…" handler.
   *
   * Opens `showSaveAsTemplateDialog`, then on OK:
   *   1. Stamps `meta.template = {name, description, tags}` on a
   *      shallow clone of the current document. The original
   *      `shell.document` is NOT mutated — the live editor
   *      session continues unaffected.
   *   2. Serialises the stamped clone (the canonical
   *      `serializeDocument` then automatically emits the three
   *      template markers the parser already round-trips:
   *      `data-annot-doc-template` on `<html>`,
   *      `<meta name="annot-template">` in `<head>`, and the
   *      `template` sub-object in the JSON sidecar).
   *   3. Persists under `Templates/<name>.annot.html` via
   *      `storage.saveDocument`. The backend's filename-uniqueness
   *      pass handles same-name collisions.
   *   4. Surfaces success via the save-status indicator
   *      (transient "saved" pulse) AND the existing error-bar
   *      surface for failures.
   *
   * The `Templates/` folder is implicit: every backend's
   * `saveDocument` accepts a `folderPath` and creates the folder
   * (or its equivalent) on demand. No explicit `createFolder`
   * call is needed.
   */
  async #saveCurrentDocAsTemplate(
    storage: StorageProvider & StorageWithDocuments,
    current: import("@ingcreators/annot-doc").AnnotDocument,
  ): Promise<void> {
    const { showSaveAsTemplateDialog } = await import(
      "@ingcreators/annot-host-ui/ui/save-as-template-dialog"
    );
    const input = await showSaveAsTemplateDialog({
      defaultName: current.title,
    });
    if (!input) return;
    try {
      const { serializeDocument } = await import("@ingcreators/annot-doc");
      // Build a stamped clone of the live document. The clone is
      // structurally identical to `current` except `meta.template`
      // is set + the `<title>` / sidecar `title` get reset to the
      // user-chosen name (so the resulting template's title matches
      // its picker label).
      const stamped: import("@ingcreators/annot-doc").AnnotDocument = {
        ...current,
        title: input.name,
        meta: {
          ...current.meta,
          title: input.name,
          template: input.description
            ? { name: input.name, description: input.description, tags: input.tags }
            : { name: input.name, tags: input.tags },
        },
      };
      const { extractDocumentThumbnailDataUrl } = await import("@ingcreators/annot-doc");
      const bytes = serializeDocument(stamped);
      const imageCount = stamped.blocks.filter((b) => b.kind === "image").length;
      const now = new Date().toISOString();
      await storage.saveDocument(
        {
          folderPath: "Templates",
          bytes,
          // First image block's data URL → gallery card thumb.
          // Empty when the source doc has no images yet.
          thumbnailDataUrl: extractDocumentThumbnailDataUrl(stamped),
          title: stamped.title,
          imageCount,
          blockCount: stamped.blocks.length,
          createdAt: now,
          updatedAt: now,
        },
        { filename: `${input.name}.annot.html` },
      );
    } catch (err) {
      showSaveError(`Couldn't save template: ${(err as Error).message}`);
    }
  }

  /**
   * Phase 11 — export the current document as a multi-slide
   * PPTX file. Each `ImageBlock` becomes one slide via the
   * shared `exportDocumentPptx` helper in
   * `@ingcreators/annot-render`; non-image blocks are silently
   * skipped (the plan reserves heading-as-title-slide as a
   * future "default off" option).
   *
   * Trigger: the doc-mode header's "Export to PowerPoint…"
   * button. Result: a `Blob` we download via the standard
   * `<a download>` trick. Errors surface via the existing
   * `showSaveError` toast.
   */
  async #exportDocAsPptx(current: import("@ingcreators/annot-doc").AnnotDocument): Promise<void> {
    try {
      const { exportDocumentPptx } = await import("@ingcreators/annot-render");
      const blob = exportDocumentPptx(current);
      if (!blob) {
        showSaveError("This document has no image blocks to export. Add a screenshot first.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stem = (current.title || "document").trim() || "document";
      a.href = url;
      a.download = `${stem}.pptx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showSaveError(`Couldn't export document: ${(err as Error).message}`);
    }
  }

  /**
   * Phase 12 of `docs/plans/annot-html-document-ux-polish.md` —
   * Copy-document-HTML overflow handler.
   *
   * Serialises the live document via the same path that
   * `runSave` uses + writes the bytes to the clipboard as
   * both `text/plain` (so paste-as-text works in editors that
   * don't speak HTML) and `text/html` (so paste into a rich-
   * text destination preserves formatting). Falls back to
   * `text/plain` only when the clipboard API doesn't accept
   * the multi-format `ClipboardItem` payload.
   */
  async #copyDocHtmlToClipboard(
    current: import("@ingcreators/annot-doc").AnnotDocument,
  ): Promise<void> {
    try {
      const { serializeDocument } = await import("@ingcreators/annot-doc");
      const bytes = serializeDocument(current);
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        try {
          const item = new ClipboardItem({
            "text/html": new Blob([bytes], { type: "text/html" }),
            "text/plain": new Blob([bytes], { type: "text/plain" }),
          });
          await navigator.clipboard.write([item]);
          return;
        } catch {
          // Fall through to text-only path on hosts that reject
          // multi-format clipboard items (older Safari).
        }
      }
      await navigator.clipboard.writeText(bytes);
    } catch (err) {
      showSaveError(`Couldn't copy document HTML: ${(err as Error).message}`);
    }
  }

  /**
   * Phase 11 of `docs/plans/annot-html-document-ux-polish.md` —
   * "Document settings…" overflow handler.
   *
   * Opens the settings dialog pre-populated with the current
   * doc's metadata, then on OK applies the diff to
   * `shell.document`. The result flows through the existing
   * `scheduleSave` path so the new bytes land in the same file
   * the user is editing, and the shell's own `doc-changed`
   * listener pushes a `DocumentHistory` snapshot so undo /
   * redo round-trip the change.
   *
   * Empty-string clears (e.g. clearing author) flow back as
   * `undefined` so the serialiser doesn't emit an empty
   * `<meta>` field.
   */
  async #openDocSettings(
    shell: import("@ingcreators/annot-host-ui/annot-doc-shell").AnnotDocShellElement,
    header: import("@ingcreators/annot-host-ui/annot-doc-header").AnnotDocHeaderElement,
    scheduleSave: (doc: import("@ingcreators/annot-doc").AnnotDocument) => void,
  ): Promise<void> {
    const current = shell.document;
    if (!current) return;
    const { showDocSettingsDialog } = await import(
      "@ingcreators/annot-host-ui/ui/doc-settings-dialog"
    );
    const result = await showDocSettingsDialog({
      defaultTitle: current.title,
      defaultLang: current.lang,
      defaultAuthor: current.meta.author,
      defaultTheme: current.meta.theme ?? "auto",
      defaultMaxWidth: current.meta.maxWidth ?? "medium",
      defaultCardColumns: current.meta.cardLayout?.columns,
      defaultCardStepLayout: current.meta.cardLayout?.defaultStepLayout ?? "image-top",
      defaultHeaderDescription: current.meta.header?.description ?? "",
      defaultHeaderIcon: current.meta.header?.icon ?? "",
      defaultNumberingSteps: current.meta.numbering?.steps === true,
      defaultNumberingStepLabel: current.meta.numbering?.stepLabel,
      defaultAppearanceTemplate: current.meta.appearance?.template,
    });
    if (!result) return;

    // Build the new document — title is required (defaults to
    // "Untitled" inside the dialog); the optional fields drop
    // when the user clears them so the serialiser doesn't emit
    // empty `<meta>` entries.
    //
    // The meta object is built field-by-field rather than as a
    // single spread + overrides because the conditional
    // author-drop case has to come BEFORE we apply
    // title / theme / maxWidth — otherwise the
    // current-meta-minus-author spread overwrites the new
    // values with the stale ones.
    const baseMeta =
      result.author !== undefined
        ? { ...current.meta, author: result.author }
        : (() => {
            const { author: _ignored, ...rest } = current.meta;
            return rest;
          })();
    // Phase 3b of card-procedure-template — cardLayout is
    // optional; only emit the field when at least one nested
    // setting differs from its implicit default. An empty
    // cardLayout object would round-trip as `undefined` per
    // `parseCardLayoutMeta`, but elide it here so the saved
    // sidecar stays minimal for users who haven't engaged with
    // the card-procedure feature.
    const cardLayout: import("@ingcreators/annot-doc").CardLayoutMeta = {
      ...(result.cardColumns !== undefined ? { columns: result.cardColumns } : {}),
      ...(result.cardDefaultStepLayout !== undefined && result.cardDefaultStepLayout !== "image-top"
        ? { defaultStepLayout: result.cardDefaultStepLayout }
        : {}),
    };
    const cardLayoutMaybe = Object.keys(cardLayout).length > 0 ? { cardLayout } : {};
    // Phase 7c — Scribe-style doc header opt-in. When the user
    // sets a description and/or icon, attach `meta.header`;
    // when both are empty (cleared) drop the field so the
    // sidecar stays minimal for non-card docs.
    // (Local name `headerMeta` to avoid collision with the
    // `header` parameter that points at the host's
    // `<annot-doc-header>` Lit element.)
    const headerMeta: import("@ingcreators/annot-doc").DocHeaderMeta = {
      ...(result.headerIcon && result.headerIcon.length > 0 ? { icon: result.headerIcon } : {}),
      ...(result.headerDescription && result.headerDescription.length > 0
        ? { description: result.headerDescription }
        : {}),
    };
    const headerMaybe = Object.keys(headerMeta).length > 0 ? { header: headerMeta } : {};
    // Phase 3 of card-step-auto-numbering.md — merge the step
    // numbering toggle into `meta.numbering`. Preserve existing
    // `headings` / `figures` / `figureLabel` so the dialog
    // doesn't accidentally drop unrelated numbering opt-ins.
    // Drop the `steps` / `stepLabel` keys when off so the
    // sidecar stays minimal; if no numbering field remains,
    // drop the whole `numbering` object too.
    const existingNumbering = baseMeta.numbering ?? {};
    const {
      steps: _staleSteps,
      stepLabel: _staleStepLabel,
      ...numberingWithoutSteps
    } = existingNumbering;
    const numberingNext: import("@ingcreators/annot-doc").NumberingMeta = {
      ...numberingWithoutSteps,
      ...(result.numberingSteps ? { steps: true as const } : {}),
      ...(result.numberingStepLabel !== undefined ? { stepLabel: result.numberingStepLabel } : {}),
    };
    const numberingMaybe =
      Object.keys(numberingNext).length > 0 ? { numbering: numberingNext } : {};

    // Phase 3 of card-document-themes.md — merge the appearance
    // template into `meta.appearance`. Preserves any existing
    // `customCss` / `fontFamily` fields (Phase 4 / 5 fill them
    // in). Setting an appearance template ALSO drops `meta.theme`
    // so the legacy keyword doesn't fight the new field at
    // render time.
    const existingAppearance = baseMeta.appearance ?? {};
    const { template: _staleTemplate, ...appearanceWithoutTemplate } = existingAppearance;
    const appearanceNext: import("@ingcreators/annot-doc").AppearanceMeta = {
      ...appearanceWithoutTemplate,
      ...(result.appearanceTemplate !== undefined ? { template: result.appearanceTemplate } : {}),
    };
    const appearanceMaybe =
      Object.keys(appearanceNext).length > 0 ? { appearance: appearanceNext } : {};
    const appearanceTemplateSet = result.appearanceTemplate !== undefined;

    // Strip any stale cardLayout / header / numbering / appearance
    // from the spread base before applying the new value (or
    // omission) so users who clear the columns dropdown /
    // description / numbering checkbox / appearance radio see the
    // field disappear.
    const {
      cardLayout: _staleCardLayout,
      header: _staleHeader,
      numbering: _staleNumbering,
      appearance: _staleAppearance,
      theme: _staleTheme,
      ...metaWithoutDerivedFields
    } = baseMeta;
    const updated: import("@ingcreators/annot-doc").AnnotDocument = {
      ...current,
      title: result.title,
      ...(result.lang !== undefined ? { lang: result.lang } : {}),
      meta: {
        ...metaWithoutDerivedFields,
        title: result.title,
        // When the user picks an appearance template the legacy
        // `meta.theme` keyword stops driving rendering — drop it
        // entirely so the sidecar tells a single story.
        // Otherwise (Appearance: Legacy radio) write the dropdown
        // value through.
        ...(appearanceTemplateSet ? {} : { theme: result.theme }),
        maxWidth: result.maxWidth,
        ...cardLayoutMaybe,
        ...headerMaybe,
        ...numberingMaybe,
        ...appearanceMaybe,
      },
    };
    shell.document = updated;
    header.setTitleText(result.title);
    scheduleSave(updated);
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
    // Phase 8 — release the doc-mode `?` listener so it doesn't
    // intercept keystrokes in the gallery / image editor.
    this.#docModeKeyboardHelpUninstall?.();
    this.#docModeKeyboardHelpUninstall = null;
  }
}
