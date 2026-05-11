/**
 * FileManager — orchestrates sidebar (storage tree) + main
 * content (breadcrumb + gallery grid). Path-based identification
 * throughout.
 *
 * Lit Phase 3 — the shell DOM construction moved into the
 * `<annot-sidebar>` and `<annot-file-manager-shell>` Lit
 * elements. `FileManager` keeps its orchestrator role: storage
 * + `<annot-gallery-page>` + sidebar wiring + breadcrumb / count refresh.
 */
import type { DocumentRecord, ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { supportsForceRefresh, supportsResync } from "@ingcreators/annot-core/storage";
import type { SidebarTab, StorageRegistration } from "../plugin-host-types.js";
import type { StorageMode } from "../storage-mode.js";
import type { ThumbnailManager } from "../thumbnail-manager.js";
import { showAlertDialog, showPromptDialog } from "../ui/dialog.js";
import "./file-manager-shell.js";
import type { AnnotGalleryPageElement } from "./annot-gallery-page.js";
import type { AnnotFileManagerShellElement, BreadcrumbEntry } from "./file-manager-shell.js";
import "./annot-gallery-page.js";
import "./sidebar.js";
import type {
  AnnotSidebarElement,
  NewMenuItem,
  SidebarCallbacks,
  SidebarSectionOrder,
} from "./sidebar.js";

export interface FileManagerCallbacks {
  onStorageSelect: (mode: StorageMode) => Promise<void>;
  onStorageReselect: (mode: StorageMode) => Promise<void>;
  onOpenImage: (record: ImageRecord) => void;
  /** Phase 6d of `docs/plans/annot-html-document.md`. Optional —
   *  hosts that don't yet support documents (no
   *  `StorageWithDocuments` opt-in) can omit it; the gallery hides
   *  document cards entirely when the storage doesn't list any. */
  onOpenDocument?: (record: DocumentRecord) => void;
  onFolderChange: (folderPath: string) => void;
  onNewFolder: () => Promise<void>;
  onUploadImage: () => void;
  onCaptureScreen: () => Promise<void>;
  onTimedCapture: () => Promise<void>;
  onPasteClipboard: () => Promise<void>;
  /** Create a new `.annot.html` document. Phase 6c of
   *  `docs/plans/annot-html-document.md`. Optional — when omitted,
   *  the sidebar's "New Document" entry doesn't render (i.e. the
   *  active host hasn't wired the document creation flow yet). */
  onNewDocument?: () => Promise<void>;
  /** Open the template picker for a new-document-from-template
   *  flow. Phase 8d of `docs/plans/annot-html-document.md`. The
   *  host loads `Templates/`, narrows via `isTemplateFromHead`,
   *  shows `showTemplatePickerDialog`, and on selection clones
   *  via `cloneTemplate` + persists + navigates. Optional —
   *  hidden when omitted (e.g. the host hasn't wired the picker
   *  yet, or the active storage doesn't opt into
   *  `StorageWithDocuments`). */
  onNewFromTemplate?: () => Promise<void>;
  /** Phase 4 of `docs/plans/card-procedure-template.md` — invoked
   *  when the user picks "Create card document from selection"
   *  from the gallery's image context menu. The host shows the
   *  generator dialog, builds the `.annot.html` document, and
   *  opens it in the doc shell as unsaved. Optional — gallery
   *  hides the menu entry when the host hasn't wired it. */
  onCreateCardDocument?: (imagesInOrder: readonly ImageRecord[]) => Promise<void>;
  /** Plugin-registered storage backends, fed through to the
   *  sidebar so plugin chips can render alongside the built-ins.
   *  Optional — desktop / embedded shells that don't load plugins
   *  can omit it and the sidebar falls back to built-ins-only. */
  getPluginStorages?: () => StorageRegistration[];
  /** Set of disabled built-in storage modes (from
   *  `App.init({ disableBuiltinStorage })`). Used to filter chips
   *  out of the sidebar strip. Optional. */
  isBuiltinDisabled?: (mode: string) => boolean;
  /** All registered sidebar tabs (built-in + plugin). The Views
   *  section is suppressed when this returns an empty list.
   *  Optional. */
  getSidebarTabs?: () => SidebarTab[];
  /** Section ordering override for the sidebar (Storage / Views /
   *  Folders). Optional. */
  getSidebarSectionOrder?: () => SidebarSectionOrder;
  /** Extra items to append to the New menu after the built-ins.
   *  Hosts (e.g. desktop's Window / Region capture + Open Browse
   *  Window) and plugins surface platform-specific entry points
   *  here. Optional. */
  getNewMenuExtras?: () => NewMenuItem[];
  /** Unified thumbnail cache manager. Threaded into the
   *  `<annot-gallery-page>` so cards can be hydrated from the
   *  cache and prefetches scheduled for misses. Optional —
   *  tests / Storybook may omit it (gallery still renders, just
   *  without cache participation). */
  getThumbnailManager?: () => ThumbnailManager | null;
}

export class FileManager {
  #sidebarEl: HTMLElement;
  #mainContentEl: HTMLElement;
  #sidebar: AnnotSidebarElement;
  #shell: AnnotFileManagerShellElement;
  #gallery: AnnotGalleryPageElement | null = null;
  #storage: StorageProvider | null = null;
  #storageMode: StorageMode = "browser";
  #currentFolderPath = "";
  #callbacks: FileManagerCallbacks;
  #searchInput: HTMLInputElement | null = null;
  #viewMode: "grid" | "list" = "grid";
  /** Tracks the most recent `#rebuildGallery()` so `refresh()` /
   *  `navigateToFolder()` calls that race a storage switch can
   *  await the gallery being available before refreshing it.
   *  Without this, the post-`setStorage` `refresh("")` in
   *  `handleStorageSelect` runs while `#gallery` is still null
   *  (Phase 3 made the rebuild async), and the new storage's
   *  files never appear. */
  #galleryReady: Promise<void> = Promise.resolve();

  constructor(sidebarEl: HTMLElement, mainContentEl: HTMLElement, callbacks: FileManagerCallbacks) {
    this.#sidebarEl = sidebarEl;
    this.#mainContentEl = mainContentEl;
    this.#callbacks = callbacks;

    this.#sidebarEl.innerHTML = "";
    const sidebar = document.createElement("annot-sidebar");
    const sidebarCallbacks: SidebarCallbacks = {
      onStorageSelect: (mode) => this.#callbacks.onStorageSelect(mode),
      onStorageReselect: (mode) => this.#callbacks.onStorageReselect(mode),
      onFolderSelect: (folderPath) => this.navigateToFolder(folderPath),
      onNewFolder: () => this.#callbacks.onNewFolder(),
      onUploadImage: () => this.#callbacks.onUploadImage(),
      onCaptureScreen: () => this.#callbacks.onCaptureScreen(),
      onTimedCapture: () => this.#callbacks.onTimedCapture(),
      onPasteClipboard: () => this.#callbacks.onPasteClipboard(),
      onNewDocument: this.#callbacks.onNewDocument
        ? () => this.#callbacks.onNewDocument?.()
        : undefined,
      onNewFromTemplate: this.#callbacks.onNewFromTemplate
        ? () => this.#callbacks.onNewFromTemplate?.()
        : undefined,
      getPluginStorages: this.#callbacks.getPluginStorages,
      isBuiltinDisabled: this.#callbacks.isBuiltinDisabled,
      getSidebarTabs: this.#callbacks.getSidebarTabs,
      getSidebarSectionOrder: this.#callbacks.getSidebarSectionOrder,
      getNewMenuExtras: this.#callbacks.getNewMenuExtras,
    };
    sidebar.callbacks = sidebarCallbacks;
    this.#sidebarEl.appendChild(sidebar);
    this.#sidebar = sidebar;

    this.#mainContentEl.innerHTML = "";
    const shell = document.createElement("annot-file-manager-shell");
    shell.callbacks = {
      onNavigate: (path) => this.navigateToFolder(path),
      onRefresh: () => this.refreshFromDisk(),
      onSetViewMode: (mode) => this.#setViewMode(mode),
      onClearSelection: () => this.#gallery?.clearSelection(),
      onDeleteSelection: () => this.#gallery?.deleteSelection(),
    };
    this.#mainContentEl.appendChild(shell);
    this.#shell = shell;
  }

  get sidebar(): AnnotSidebarElement {
    return this.#sidebar;
  }
  get currentFolderPath(): string {
    return this.#currentFolderPath;
  }
  get storage(): StorageProvider | null {
    return this.#storage;
  }

  setSearchInput(input: HTMLInputElement): void {
    this.#searchInput = input;
    if (this.#gallery) this.#gallery.setSearchInput(input);
    this.#updateSearchPlaceholder();
  }

  /** Update placeholder to reflect the current folder/storage context. */
  #updateSearchPlaceholder(): void {
    if (!this.#searchInput) return;
    const rootLabel = this.#rootLabel();
    const parts = this.#currentFolderPath ? this.#currentFolderPath.split("/") : [];
    const breadcrumb = [rootLabel, ...parts].join(" > ");
    this.#searchInput.placeholder = `Search in ${breadcrumb} and subfolders...`;
  }

  setStorage(storage: StorageProvider, mode: StorageMode, rootName?: string): void {
    this.#storage = storage;
    this.#storageMode = mode;
    this.#currentFolderPath = "";
    this.#sidebar.setActiveMode(mode);
    this.#sidebar.setStorage(storage, rootName);
    this.#sidebar.setActiveFolderPath("");

    // Capture the rebuild promise so callers' subsequent
    // `refresh` / `navigateToFolder` invocations can wait until
    // `#gallery` is wired before reading it. The shell renders
    // asynchronously (Lit's microtask), so reading
    // `#shell.getGridHost()` synchronously after `appendChild`
    // returns null on the very first mount.
    this.#galleryReady = this.#rebuildGallery();
    this.#updateSearchPlaceholder();
  }

  async refresh(folderPath?: string): Promise<void> {
    if (folderPath !== undefined) this.#currentFolderPath = folderPath;
    await this.#galleryReady;
    await this.#refreshBreadcrumbs();
    if (this.#gallery) {
      await this.#gallery.refresh(this.#currentFolderPath);
    }
  }

  /**
   * User-initiated full refresh. Forces the storage (if it supports it) to
   * re-validate every cached entry against disk. Then re-renders.
   */
  async refreshFromDisk(): Promise<void> {
    const s = this.#storage;
    if (s && supportsForceRefresh(s)) {
      try {
        await s.forceRefresh();
      } catch (e) {
        console.error("[refresh] forceRefresh error:", e);
      }
    } else if (s && supportsResync(s)) {
      try {
        await s.resync();
      } catch (e) {
        console.error("[refresh] resync error:", e);
      }
    }
    await this.#sidebar.refreshFolderTree();
    await this.refresh();
  }

  async navigateToFolder(folderPath: string): Promise<void> {
    this.#currentFolderPath = folderPath;
    this.#sidebar.setActiveFolderPath(folderPath);
    this.#callbacks.onFolderChange(folderPath);
    this.#updateSearchPlaceholder();
    await this.#galleryReady;
    await this.#refreshBreadcrumbs();
    if (this.#gallery) {
      await this.#gallery.refresh(folderPath);
    }
  }

  async createNewFolder(): Promise<void> {
    if (!this.#storage) return;
    const name = await showPromptDialog({
      title: "New folder",
      placeholder: "Folder name",
      okLabel: "Create",
    });
    if (!name?.trim()) return;
    try {
      await this.#storage.createFolder(this.#currentFolderPath, name.trim());
      await this.refresh();
      await this.#sidebar.refreshFolderTree();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || "Failed to create folder";
      await showAlertDialog({
        title: "Couldn't create folder",
        message: msg,
      });
    }
  }

  async #rebuildGallery(): Promise<void> {
    if (!this.#storage) return;
    // Wait for the shell's first render so its grid host exists.
    await this.#shell.updateComplete;
    const gridHost = this.#shell.getGridHost();
    if (!gridHost) return;

    // Tear down the previous gallery's document-level listeners
    // before replacing it.
    this.#gallery?.destroy();
    gridHost.innerHTML = "";
    const el = document.createElement("annot-gallery-page");
    el.storage = this.#storage;
    el.thumbnailManager = this.#callbacks.getThumbnailManager?.() ?? null;
    el.viewMode = this.#viewMode;
    el.canCreateCardDocument = this.#callbacks.onCreateCardDocument !== undefined;
    el.addEventListener("annot-gallery-open-image", (e) => {
      this.#callbacks.onOpenImage(e.detail.record);
    });
    el.addEventListener("annot-gallery-open-document", (e) => {
      this.#callbacks.onOpenDocument?.(e.detail.record);
    });
    el.addEventListener("annot-gallery-folder-change", (e) => {
      const folderPath = e.detail.folderPath;
      this.#currentFolderPath = folderPath;
      this.#sidebar.setActiveFolderPath(folderPath);
      this.#callbacks.onFolderChange(folderPath);
      this.#updateSearchPlaceholder();
      void this.#refreshBreadcrumbs();
      void this.#sidebar.refreshFolderTree();
    });
    el.addEventListener("annot-gallery-count-change", (e) => {
      const { total, filtered } = e.detail;
      this.#shell.countText =
        total === filtered
          ? `${total} image${total !== 1 ? "s" : ""}`
          : `${filtered} / ${total} images`;
    });
    el.addEventListener("annot-gallery-folders-changed", () => {
      void this.#sidebar.refreshFolderTree();
    });
    el.addEventListener("annot-gallery-selection-change", (e) => {
      const sel = e.detail.selection;
      const count = sel.images.length + sel.folders.length;
      this.#shell.selection =
        count > 0 ? { folders: sel.folders.length, images: sel.images.length } : null;
    });
    el.addEventListener("annot-gallery-create-card-document-request", (e) => {
      const onCreate = this.#callbacks.onCreateCardDocument;
      if (!onCreate) return;
      void onCreate(e.detail.imagesInOrder);
    });
    gridHost.appendChild(el);
    this.#gallery = el;

    if (this.#searchInput) el.setSearchInput(this.#searchInput);
  }

  async #refreshBreadcrumbs(): Promise<void> {
    if (!this.#storage) {
      this.#shell.breadcrumbs = [];
      return;
    }
    const entries: BreadcrumbEntry[] = [
      { label: this.#rootLabel(), path: "", active: this.#currentFolderPath === "" },
    ];
    if (this.#currentFolderPath) {
      try {
        const crumbs = await this.#storage.getBreadcrumb(this.#currentFolderPath);
        for (const folder of crumbs) {
          entries.push({
            label: folder.name,
            path: folder.path,
            active: folder.path === this.#currentFolderPath,
          });
        }
      } catch (e) {
        console.error("[file-manager] breadcrumb error:", e);
      }
    }
    this.#shell.breadcrumbs = entries;
  }

  #rootLabel(): string {
    switch (this.#storageMode) {
      case "device":
        return "Device";
      case "googledrive":
        return "Google Drive";
      case "github":
        return "GitHub";
      case "desktop":
        return "Desktop";
      default:
        return "Browser";
    }
  }

  #setViewMode(mode: "grid" | "list"): void {
    this.#viewMode = mode;
    this.#shell.viewMode = mode;
    if (this.#gallery) {
      this.#gallery.setViewMode(mode);
    }
  }
}
