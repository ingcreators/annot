/**
 * FileManager — orchestrates sidebar (storage tree) + main
 * content (breadcrumb + gallery grid). Path-based identification
 * throughout.
 *
 * Lit Phase 3 — the shell DOM construction moved into the
 * `<annot-sidebar>` and `<annot-file-manager-shell>` Lit
 * elements. `FileManager` keeps its orchestrator role: storage
 * + GalleryPage + sidebar wiring + breadcrumb / count refresh.
 */
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import type { SidebarTab, StorageRegistration } from "../app/plugin-host.js";
import type { StorageMode } from "../storage/bridge.js";
import { showAlertDialog, showPromptDialog } from "../ui/dialog.js";
import "./file-manager-shell.js";
import type {
  AnnotFileManagerShellElement,
  BreadcrumbEntry,
} from "./file-manager-shell.js";
import { GalleryPage } from "./gallery-page.js";
import "./sidebar.js";
import type {
  AnnotSidebarElement,
  SidebarCallbacks,
  SidebarSectionOrder,
} from "./sidebar.js";

export interface FileManagerCallbacks {
  onStorageSelect: (mode: StorageMode) => Promise<void>;
  onStorageReselect: (mode: StorageMode) => Promise<void>;
  onOpenImage: (record: ImageRecord) => void;
  onFolderChange: (folderPath: string) => void;
  onNewFolder: () => Promise<void>;
  onUploadImage: () => void;
  onCaptureScreen: () => Promise<void>;
  onTimedCapture: () => Promise<void>;
  onPasteClipboard: () => Promise<void>;
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
}

export class FileManager {
  #sidebarEl: HTMLElement;
  #mainContentEl: HTMLElement;
  #sidebar: AnnotSidebarElement;
  #shell: AnnotFileManagerShellElement;
  #gallery: GalleryPage | null = null;
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
      getPluginStorages: this.#callbacks.getPluginStorages,
      isBuiltinDisabled: this.#callbacks.isBuiltinDisabled,
      getSidebarTabs: this.#callbacks.getSidebarTabs,
      getSidebarSectionOrder: this.#callbacks.getSidebarSectionOrder,
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
    const s = this.#storage as unknown as { forceRefresh?: () => Promise<void> } | null;
    if (s?.forceRefresh) {
      try {
        await s.forceRefresh();
      } catch (e) {
        console.error("[refresh] forceRefresh error:", e);
      }
    } else if (this.#storage?.resync) {
      try {
        await this.#storage.resync();
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
    this.#gallery = new GalleryPage(gridHost, this.#storage);
    this.#gallery.onOpenImage = (record) => this.#callbacks.onOpenImage(record);
    this.#gallery.onFolderChange = (folderPath) => {
      this.#currentFolderPath = folderPath;
      this.#sidebar.setActiveFolderPath(folderPath);
      this.#callbacks.onFolderChange(folderPath);
      this.#updateSearchPlaceholder();
      void this.#refreshBreadcrumbs();
      void this.#sidebar.refreshFolderTree();
    };
    this.#gallery.onCountChange = (total, filtered) => {
      this.#shell.countText =
        total === filtered
          ? `${total} image${total !== 1 ? "s" : ""}`
          : `${filtered} / ${total} images`;
    };
    this.#gallery.onFoldersChanged = () => void this.#sidebar.refreshFolderTree();
    this.#gallery.onSelectionChange = (sel) => {
      const count = sel.images.length + sel.folders.length;
      this.#shell.selection =
        count > 0 ? { folders: sel.folders.length, images: sel.images.length } : null;
    };

    if (this.#searchInput) this.#gallery.setSearchInput(this.#searchInput);

    const grid = gridHost.querySelector(".gallery-grid");
    if (grid && this.#viewMode === "list") grid.classList.add("list-view");
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
    return this.#storageMode === "device"
      ? "Device"
      : this.#storageMode === "googledrive"
        ? "Google Drive"
        : this.#storageMode === "github"
          ? "GitHub"
          : "Browser";
  }

  #setViewMode(mode: "grid" | "list"): void {
    this.#viewMode = mode;
    this.#shell.viewMode = mode;
    if (this.#gallery) {
      this.#gallery.setViewMode(mode);
    }
  }
}
