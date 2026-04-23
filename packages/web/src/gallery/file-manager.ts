/**
 * FileManager — orchestrates sidebar (storage tree) + main content (breadcrumb + gallery grid).
 * Path-based identification throughout.
 */
import type {
  ImageRecord,
  StorageProvider,
} from "@ingcreators/annot-core/storage";
import type { StorageMode } from "../storage/bridge.js";
import { Sidebar, type SidebarCallbacks } from "./sidebar.js";
import { GalleryPage } from "./gallery-page.js";
import { showPromptDialog, showAlertDialog } from "../ui/dialog.js";
import { setTooltip } from "@ingcreators/annot-core/utils";

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
}

export class FileManager {
  #sidebarEl: HTMLElement;
  #mainContentEl: HTMLElement;
  #sidebar: Sidebar;
  #gallery: GalleryPage | null = null;
  #storage: StorageProvider | null = null;
  #storageMode: StorageMode = "local";
  #currentFolderPath: string = "";
  #callbacks: FileManagerCallbacks;
  #searchInput: HTMLInputElement | null = null;
  #viewMode: "grid" | "list" = "grid";

  // DOM refs
  #breadcrumbEl: HTMLElement | null = null;
  #gridContainer: HTMLElement | null = null;
  #countEl: HTMLElement | null = null;
  #headerEl: HTMLElement | null = null;
  #selectionBarEl: HTMLElement | null = null;
  #selectionCountEl: HTMLElement | null = null;

  constructor(
    sidebarEl: HTMLElement,
    mainContentEl: HTMLElement,
    callbacks: FileManagerCallbacks,
  ) {
    this.#sidebarEl = sidebarEl;
    this.#mainContentEl = mainContentEl;
    this.#callbacks = callbacks;

    const sidebarCallbacks: SidebarCallbacks = {
      onStorageSelect: (mode) => this.#callbacks.onStorageSelect(mode),
      onStorageReselect: (mode) => this.#callbacks.onStorageReselect(mode),
      onFolderSelect: (folderPath) => this.navigateToFolder(folderPath),
      onNewFolder: () => this.#callbacks.onNewFolder(),
      onUploadImage: () => this.#callbacks.onUploadImage(),
      onCaptureScreen: () => this.#callbacks.onCaptureScreen(),
      onTimedCapture: () => this.#callbacks.onTimedCapture(),
      onPasteClipboard: () => this.#callbacks.onPasteClipboard(),
    };
    this.#sidebar = new Sidebar(this.#sidebarEl, sidebarCallbacks);

    this.#buildMainContent();
  }

  get sidebar(): Sidebar { return this.#sidebar; }
  get currentFolderPath(): string { return this.#currentFolderPath; }
  get storage(): StorageProvider | null { return this.#storage; }

  setSearchInput(input: HTMLInputElement): void {
    this.#searchInput = input;
    if (this.#gallery) this.#gallery.setSearchInput(input);
    this.#updateSearchPlaceholder();
  }

  /** Update placeholder to reflect the current folder/storage context. */
  #updateSearchPlaceholder(): void {
    if (!this.#searchInput) return;
    const rootLabel = this.#storageMode === "filesystem" ? "Device"
      : this.#storageMode === "googledrive" ? "Google Drive"
      : "Browser";
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

    this.#rebuildGallery();
    this.#updateSearchPlaceholder();
  }

  async refresh(folderPath?: string): Promise<void> {
    if (folderPath !== undefined) this.#currentFolderPath = folderPath;
    await this.#buildBreadcrumb();
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
      try { await s.forceRefresh(); } catch (e) { console.error("[refresh] forceRefresh error:", e); }
    } else if (this.#storage?.resync) {
      try { await this.#storage.resync(); } catch (e) { console.error("[refresh] resync error:", e); }
    }
    await this.#sidebar.refreshFolderTree();
    await this.refresh();
  }

  async navigateToFolder(folderPath: string): Promise<void> {
    this.#currentFolderPath = folderPath;
    this.#sidebar.setActiveFolderPath(folderPath);
    this.#callbacks.onFolderChange(folderPath);
    this.#updateSearchPlaceholder();
    await this.#buildBreadcrumb();
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
    } catch (e: any) {
      await showAlertDialog({
        title: "Couldn't create folder",
        message: e?.message || "Failed to create folder",
      });
    }
  }

  #buildMainContent(): void {
    this.#mainContentEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "main-content-header";
    this.#headerEl = header;

    this.#breadcrumbEl = document.createElement("nav");
    this.#breadcrumbEl.className = "breadcrumb";
    this.#breadcrumbEl.setAttribute("aria-label", "Folder breadcrumb");
    header.appendChild(this.#breadcrumbEl);

    // Refresh button — re-scan the active storage for external edits
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "header-refresh-btn material-symbols-outlined";
    refreshBtn.textContent = "refresh";
    setTooltip(refreshBtn, "Refresh");
    refreshBtn.setAttribute("aria-label", "Refresh gallery");
    refreshBtn.addEventListener("click", () => this.refreshFromDisk());
    header.appendChild(refreshBtn);

    const viewToggle = document.createElement("div");
    viewToggle.className = "view-toggle";
    viewToggle.setAttribute("role", "group");
    viewToggle.setAttribute("aria-label", "View mode");

    const gridBtn = document.createElement("button");
    gridBtn.type = "button";
    gridBtn.className = "view-toggle-btn material-symbols-outlined active";
    gridBtn.textContent = "grid_view";
    setTooltip(gridBtn, "Grid view");
    gridBtn.setAttribute("aria-label", "Grid view");
    gridBtn.setAttribute("aria-pressed", "true");
    gridBtn.addEventListener("click", () => this.#setViewMode("grid", gridBtn, listBtn));

    const listBtn = document.createElement("button");
    listBtn.type = "button";
    listBtn.className = "view-toggle-btn material-symbols-outlined";
    listBtn.textContent = "view_list";
    setTooltip(listBtn, "List view");
    listBtn.setAttribute("aria-label", "List view");
    listBtn.setAttribute("aria-pressed", "false");
    listBtn.addEventListener("click", () => this.#setViewMode("list", gridBtn, listBtn));

    viewToggle.appendChild(gridBtn);
    viewToggle.appendChild(listBtn);
    header.appendChild(viewToggle);

    this.#mainContentEl.appendChild(header);

    // Selection action bar (shown only when items are selected)
    this.#selectionBarEl = document.createElement("div");
    this.#selectionBarEl.className = "selection-bar";
    this.#selectionBarEl.setAttribute("role", "toolbar");
    this.#selectionBarEl.setAttribute("aria-label", "Selection actions");
    this.#selectionBarEl.style.display = "none";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "selection-bar-close material-symbols-outlined";
    clearBtn.textContent = "close";
    setTooltip(clearBtn, "Clear selection");
    clearBtn.setAttribute("aria-label", "Clear selection");
    clearBtn.addEventListener("click", () => this.#gallery?.clearSelection());
    this.#selectionBarEl.appendChild(clearBtn);

    this.#selectionCountEl = document.createElement("span");
    this.#selectionCountEl.className = "selection-bar-count";
    this.#selectionCountEl.setAttribute("aria-live", "polite");
    this.#selectionBarEl.appendChild(this.#selectionCountEl);

    const spacer = document.createElement("div");
    spacer.className = "selection-bar-spacer";
    this.#selectionBarEl.appendChild(spacer);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "selection-bar-btn selection-bar-btn-danger";
    deleteBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">delete</span>Delete';
    setTooltip(deleteBtn, "Delete selected");
    deleteBtn.setAttribute("aria-label", "Delete selected items");
    deleteBtn.addEventListener("click", () => this.#gallery?.deleteSelection());
    this.#selectionBarEl.appendChild(deleteBtn);

    this.#mainContentEl.appendChild(this.#selectionBarEl);

    const body = document.createElement("div");
    body.className = "main-content-body";
    this.#gridContainer = document.createElement("div");
    this.#gridContainer.id = "gallery-container";
    body.appendChild(this.#gridContainer);
    this.#mainContentEl.appendChild(body);

    const footer = document.createElement("div");
    footer.className = "main-content-footer";
    this.#countEl = document.createElement("span");
    this.#countEl.className = "gallery-footer-text";
    footer.appendChild(this.#countEl);
    this.#mainContentEl.appendChild(footer);
  }

  #rebuildGallery(): void {
    if (!this.#storage || !this.#gridContainer) return;

    // Tear down the previous gallery's document-level listeners before replacing it
    this.#gallery?.destroy();
    this.#gridContainer.innerHTML = "";
    this.#gallery = new GalleryPage(this.#gridContainer, this.#storage);
    this.#gallery.onOpenImage = (record) => this.#callbacks.onOpenImage(record);
    this.#gallery.onFolderChange = (folderPath) => {
      this.#currentFolderPath = folderPath;
      this.#sidebar.setActiveFolderPath(folderPath);
      this.#callbacks.onFolderChange(folderPath);
      this.#updateSearchPlaceholder();
      this.#buildBreadcrumb();
      this.#sidebar.refreshFolderTree();
    };
    this.#gallery.onCountChange = (total, filtered) => {
      if (this.#countEl) {
        this.#countEl.textContent = total === filtered
          ? `${total} image${total !== 1 ? "s" : ""}`
          : `${filtered} / ${total} images`;
      }
    };
    this.#gallery.onFoldersChanged = () => this.#sidebar.refreshFolderTree();
    this.#gallery.onSelectionChange = (sel) => {
      const count = sel.images.length + sel.folders.length;
      const active = count > 0;
      // Swap the header for the selection bar so total height is constant
      // and items below don't shift (prevents dblclick misfires).
      if (this.#selectionBarEl) this.#selectionBarEl.style.display = active ? "" : "none";
      if (this.#headerEl) this.#headerEl.style.display = active ? "none" : "";
      if (this.#selectionCountEl) {
        const parts: string[] = [];
        if (sel.folders.length) parts.push(`${sel.folders.length} folder${sel.folders.length !== 1 ? "s" : ""}`);
        if (sel.images.length) parts.push(`${sel.images.length} file${sel.images.length !== 1 ? "s" : ""}`);
        this.#selectionCountEl.textContent = `${count} selected (${parts.join(", ")})`;
      }
    };

    if (this.#searchInput) this.#gallery.setSearchInput(this.#searchInput);

    const grid = this.#gridContainer.querySelector(".gallery-grid");
    if (grid && this.#viewMode === "list") grid.classList.add("list-view");
  }

  async #buildBreadcrumb(): Promise<void> {
    if (!this.#breadcrumbEl || !this.#storage) return;
    this.#breadcrumbEl.innerHTML = "";

    const rootLabel = this.#storageMode === "filesystem" ? "Device"
      : this.#storageMode === "googledrive" ? "Google Drive"
      : "Browser";

    const rootItem = document.createElement("button");
    rootItem.className = "breadcrumb-item" + (this.#currentFolderPath === "" ? " active" : "");
    rootItem.textContent = rootLabel;
    rootItem.addEventListener("click", () => this.navigateToFolder(""));
    this.#breadcrumbEl.appendChild(rootItem);

    if (this.#currentFolderPath) {
      try {
        const crumbs = await this.#storage.getBreadcrumb(this.#currentFolderPath);
        for (const folder of crumbs) {
          const chevron = document.createElement("span");
          chevron.className = "breadcrumb-sep";
          chevron.textContent = "\u203a";
          this.#breadcrumbEl.appendChild(chevron);

          const item = document.createElement("button");
          item.className = "breadcrumb-item" + (folder.path === this.#currentFolderPath ? " active" : "");
          item.textContent = folder.name;
          item.addEventListener("click", () => this.navigateToFolder(folder.path));
          this.#breadcrumbEl.appendChild(item);
        }
      } catch (e) {
        console.error("[file-manager] breadcrumb error:", e);
      }
    }
  }

  #setViewMode(mode: "grid" | "list", gridBtn: HTMLElement, listBtn: HTMLElement): void {
    this.#viewMode = mode;
    gridBtn.classList.toggle("active", mode === "grid");
    listBtn.classList.toggle("active", mode === "list");
    gridBtn.setAttribute("aria-pressed", String(mode === "grid"));
    listBtn.setAttribute("aria-pressed", String(mode === "list"));

    if (this.#gallery) {
      this.#gallery.setViewMode(mode);
    }
  }
}
