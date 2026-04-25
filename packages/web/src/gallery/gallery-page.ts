/**
 * Gallery page — displays folders and images from StorageProvider.
 * Path-based identification throughout.
 *
 * Interaction model (Google Drive-like):
 *   - Single click       → toggle select (clears prior selection)
 *   - Double click       → open (image → editor, folder → navigate)
 *   - Ctrl / Cmd + click → toggle single item in multi-selection
 *   - Shift + click      → range select from anchor to clicked item
 *   - Click empty area   → clear selection
 */
import type { FolderRecord, ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { getFilename, supportsResync } from "@ingcreators/annot-core/storage";
import { setTooltip } from "@ingcreators/annot-core/editor/tooltip";
import { logger } from "../logger.js";
import { showAlertDialog, showConfirmDialog, showPromptDialog } from "../ui/dialog.js";
import { type MenuItem, openContextMenu } from "./context-menu.js";

export interface Selection {
  images: ImageRecord[];
  folders: FolderRecord[];
}

export class GalleryPage {
  #container: HTMLElement;
  #grid: HTMLElement;
  #storage: StorageProvider;
  #searchInput: HTMLInputElement | null = null;
  #images: ImageRecord[] = [];
  #folders: FolderRecord[] = [];
  #currentFolderPath = "";

  #selectedImagePaths = new Set<string>();
  #selectedFolderPaths = new Set<string>();
  /** Last clicked item (for shift-range select). */
  #selectionAnchor: { type: "image" | "folder"; path: string } | null = null;

  onOpenImage?: (record: ImageRecord) => void;
  onCountChange?: (total: number, filtered: number) => void;
  onFolderChange?: (folderPath: string) => void;
  onSelectionChange?: (sel: Selection) => void;
  /** Fired whenever the folder tree structure changes (create / delete / move). */
  onFoldersChanged?: () => void | Promise<void>;

  get currentFolderPath() {
    return this.#currentFolderPath;
  }
  get totalSelectedCount() {
    return this.#selectedImagePaths.size + this.#selectedFolderPaths.size;
  }
  get storage() {
    return this.#storage;
  }

  /** Current selection as records. */
  getSelection(): Selection {
    return {
      images: this.#images.filter((i) => this.#selectedImagePaths.has(i.path)),
      folders: this.#folders.filter((f) => this.#selectedFolderPaths.has(f.path)),
    };
  }

  constructor(container: HTMLElement, storage: StorageProvider) {
    this.#container = container;
    this.#storage = storage;
    this.#container.innerHTML = "";
    this.#container.className = "gallery-panel";
    this.#grid = document.createElement("div");
    this.#grid.className = "gallery-grid";
    this.#container.appendChild(this.#grid);

    // Click on empty grid area clears selection
    this.#grid.addEventListener("click", (e) => {
      if (e.target === this.#grid) this.clearSelection();
    });
    this.#container.addEventListener("click", (e) => {
      if (e.target === this.#container) this.clearSelection();
    });

    // Esc clears selection (skipped while typing, while gallery is hidden, or in editor)
    document.addEventListener("keydown", this.#onKeyDown);

    // Stores that can't return thumbnails synchronously (GitHub) emit
    // `annot-thumbnail-ready` once each image is fetched and downscaled
    // in the background. Patch the matching card's `<img src>` in
    // place so the gallery fills in as thumbnails land.
    window.addEventListener("annot-thumbnail-ready", this.#onThumbnailReady);
  }

  /** Clean up document-level listeners. Call before discarding the instance. */
  destroy(): void {
    document.removeEventListener("keydown", this.#onKeyDown);
    window.removeEventListener("annot-thumbnail-ready", this.#onThumbnailReady);
  }

  #onThumbnailReady = (e: Event): void => {
    const detail = (e as CustomEvent).detail as { path?: string; dataUrl?: string } | undefined;
    if (!detail?.path || !detail?.dataUrl) return;
    const card = this.#grid.querySelector<HTMLElement>(
      `.gallery-item[data-image-path="${CSS.escape(detail.path)}"] .gallery-thumb`,
    );
    if (!card) return;
    let img = card.querySelector<HTMLImageElement>("img");
    if (!img) {
      img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      card.appendChild(img);
    }
    img.src = detail.dataUrl;
    // Also mutate the in-memory record so a later refilter / re-render
    // keeps the thumbnail without re-fetching.
    const record = this.#images.find((r) => r.path === detail.path);
    if (record) record.thumbnailDataUrl = detail.dataUrl;
  };

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (this.totalSelectedCount === 0) return;
    // Ignore while typing in form controls (search box, etc.)
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      (t && (t as HTMLElement).isContentEditable)
    ) {
      return;
    }
    // Only handle when the gallery is actually visible
    if (!this.#container.offsetParent) return;
    e.preventDefault();
    this.clearSelection();
  };

  setViewMode(mode: "grid" | "list"): void {
    this.#grid.classList.toggle("list-view", mode === "list");
  }

  setSearchInput(input: HTMLInputElement): void {
    this.#searchInput = input;
    let timer: number;
    let lastHadQuery = (input.value || "").trim().length > 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const hasQuery = (input.value || "").trim().length > 0;
        // If query presence toggled, reload images (recursive <-> current folder)
        if (hasQuery !== lastHadQuery) {
          lastHadQuery = hasQuery;
          this.refresh();
        } else {
          this.#applyFilter();
        }
      }, 300);
    });
  }

  async refresh(folderPath?: string): Promise<void> {
    if (folderPath !== undefined) this.#currentFolderPath = folderPath;
    try {
      if (supportsResync(this.#storage)) await this.#storage.resync();

      const q = (this.#searchInput?.value || "").trim();
      if (q) {
        // Search across the current folder and all subfolders so deeply
        // nested images can be found from any starting point.
        this.#images = await this.#listImagesRecursive(this.#currentFolderPath);
        this.#folders = [];
      } else {
        this.#images = await this.#storage.listImages(this.#currentFolderPath);
        this.#folders = await this.#storage.listFolders(this.#currentFolderPath);
      }
      logger.debug(
        "[gallery] refresh: images:",
        this.#images.length,
        "folders:",
        this.#folders.length,
        "folderPath:",
        JSON.stringify(this.#currentFolderPath),
      );
    } catch (e) {
      logger.error("[gallery] refresh error:", e);
      this.#images = [];
      this.#folders = [];
    }
    // Drop stale selections that no longer exist
    const imgPaths = new Set(this.#images.map((i) => i.path));
    const folderPaths = new Set(this.#folders.map((f) => f.path));
    for (const p of Array.from(this.#selectedImagePaths))
      if (!imgPaths.has(p)) this.#selectedImagePaths.delete(p);
    for (const p of Array.from(this.#selectedFolderPaths))
      if (!folderPaths.has(p)) this.#selectedFolderPaths.delete(p);
    this.#applyFilter();
    this.#fireSelectionChange();
  }

  async createNewFolder(): Promise<void> {
    const name = await showPromptDialog({
      title: "New folder",
      placeholder: "Folder name",
      okLabel: "Create",
    });
    if (!name) return;
    try {
      await this.#storage.createFolder(this.#currentFolderPath, name);
      await this.refresh();
      await this.onFoldersChanged?.();
    } catch (e: any) {
      await showAlertDialog({
        title: "Couldn't create folder",
        message: e.message || "An unexpected error occurred.",
      });
    }
  }

  clearSelection(): void {
    if (this.totalSelectedCount === 0) return;
    this.#selectedImagePaths.clear();
    this.#selectedFolderPaths.clear();
    this.#selectionAnchor = null;
    this.#updateSelectionVisuals();
    this.#fireSelectionChange();
  }

  /** Delete all currently selected items. Returns count deleted. */
  async deleteSelection(): Promise<number> {
    const sel = this.getSelection();
    const count = sel.images.length + sel.folders.length;
    if (count === 0) return 0;
    const label =
      count === 1
        ? getFilename(sel.images[0]?.path || sel.folders[0]?.path || "") || "this item"
        : `${count} items`;
    const ok = await showConfirmDialog({
      title: count === 1 ? `Delete "${label}"?` : `Delete ${label}?`,
      message:
        sel.folders.length > 0
          ? "Folders and their contents will be permanently removed."
          : "This cannot be undone.",
      okLabel: "Delete",
      danger: true,
    });
    if (!ok) return 0;
    for (const img of sel.images) {
      try {
        await this.#storage.deleteImage(img.path);
      } catch (e) {
        console.error(e);
      }
    }
    for (const folder of sel.folders) {
      try {
        await this.#storage.deleteFolder(folder.path);
      } catch (e) {
        console.error(e);
      }
    }
    this.clearSelection();
    await this.refresh();
    // If any folders were deleted, notify so the sidebar tree can refresh
    if (sel.folders.length > 0) {
      await this.onFoldersChanged?.();
    }
    return count;
  }

  /** Walk current folder + all descendants, flattening images into one list. */
  async #listImagesRecursive(rootPath: string): Promise<ImageRecord[]> {
    const all: ImageRecord[] = [];
    const queue: string[] = [rootPath];
    // Defensive cap — avoid runaway traversal on very deep hierarchies
    const MAX_FOLDERS = 500;
    let visited = 0;
    while (queue.length && visited < MAX_FOLDERS) {
      const p = queue.shift()!;
      visited++;
      try {
        const imgs = await this.#storage.listImages(p);
        all.push(...imgs);
        const subs = await this.#storage.listFolders(p);
        for (const f of subs) queue.push(f.path);
      } catch (e) {
        console.warn("[gallery] recursive list error at", p, e);
      }
    }
    return all;
  }

  #applyFilter(): void {
    this.#renderGrid(this.#searchInput?.value || "");
  }

  #renderGrid(filter: string): void {
    this.#grid.innerHTML = "";
    const q = filter.trim().toLowerCase();
    const filteredImages = q
      ? this.#images.filter((img) => this.#matchFilter(img, q))
      : this.#images;

    const showFolders = !q;
    const totalItems = (showFolders ? this.#folders.length : 0) + this.#images.length;
    const filteredItems = (showFolders ? this.#folders.length : 0) + filteredImages.length;
    this.onCountChange?.(totalItems, filteredItems);

    if (filteredItems === 0) {
      const empty = document.createElement("div");
      empty.className = "gallery-empty";
      empty.textContent =
        this.#images.length === 0 && this.#folders.length === 0
          ? "No images yet. Upload an image or capture with the extension."
          : "No matches found.";
      this.#grid.appendChild(empty);
      return;
    }

    if (showFolders && this.#folders.length > 0) {
      const folderHeader = document.createElement("div");
      folderHeader.className = "gallery-section-header";
      folderHeader.textContent = "Folders";
      this.#grid.appendChild(folderHeader);

      const folderGrid = document.createElement("div");
      folderGrid.className = "gallery-folder-grid";
      for (const f of this.#folders) folderGrid.appendChild(this.#createFolderCard(f));
      this.#grid.appendChild(folderGrid);
    }

    if (filteredImages.length > 0) {
      // Always show the "Files" section header when not searching, so the
      // grid's structure is consistent regardless of whether folders exist.
      if (showFolders) {
        const imgHeader = document.createElement("div");
        imgHeader.className = "gallery-section-header";
        imgHeader.textContent = "Files";
        this.#grid.appendChild(imgHeader);
      }
      const imgGrid = document.createElement("div");
      imgGrid.className = "gallery-image-grid";
      for (const img of filteredImages) imgGrid.appendChild(this.#createImageCard(img));
      this.#grid.appendChild(imgGrid);
    }
  }

  #createFolderCard(folder: FolderRecord): HTMLElement {
    const card = document.createElement("div");
    card.className = "gallery-folder-card";
    card.dataset.folderPath = folder.path;
    card.setAttribute("role", "button");
    card.setAttribute(
      "aria-label",
      `Folder ${folder.name}. Enter to open, Space to toggle selection.`,
    );
    card.tabIndex = 0;
    if (this.#selectedFolderPaths.has(folder.path)) {
      card.classList.add("selected");
      card.setAttribute("aria-pressed", "true");
    } else {
      card.setAttribute("aria-pressed", "false");
    }

    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined gallery-folder-card-icon";
    icon.textContent = "folder";
    icon.setAttribute("aria-hidden", "true");
    card.appendChild(icon);

    const name = document.createElement("div");
    name.className = "gallery-folder-card-name";
    name.textContent = folder.name;
    setTooltip(name, folder.name);
    card.appendChild(name);

    // 3-dot menu
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "gallery-card-more material-symbols-outlined";
    moreBtn.textContent = "more_vert";
    setTooltip(moreBtn, "More actions");
    moreBtn.setAttribute("aria-label", `Actions for folder ${folder.name}`);
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = moreBtn.getBoundingClientRect();
      openContextMenu({
        x: rect.right,
        y: rect.bottom,
        items: this.#folderMenuItems(folder),
      });
    });
    card.appendChild(moreBtn);

    const open = () => {
      this.clearSelection();
      this.#currentFolderPath = folder.path;
      this.onFolderChange?.(folder.path);
      this.refresh();
    };

    card.addEventListener("click", (e) => this.#handleItemClick(e, "folder", folder.path));
    card.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      open();
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // If right-clicking on an unselected item, select just this one
      if (!this.#selectedFolderPaths.has(folder.path)) {
        this.#selectedFolderPaths.clear();
        this.#selectedImagePaths.clear();
        this.#selectedFolderPaths.add(folder.path);
        this.#updateSelectionVisuals();
        this.#fireSelectionChange();
      }
      openContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: this.#folderMenuItems(folder),
      });
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        open();
      } else if (e.key === " ") {
        e.preventDefault();
        this.#handleItemClick(e as unknown as MouseEvent, "folder", folder.path);
      }
    });

    return card;
  }

  #createImageCard(img: ImageRecord): HTMLElement {
    const filename = getFilename(img.path) || "Uploaded image";
    const card = document.createElement("div");
    card.className = "gallery-item";
    card.dataset.imagePath = img.path;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Image ${filename}. Enter to open, Space to toggle selection.`);
    card.tabIndex = 0;
    if (this.#selectedImagePaths.has(img.path)) {
      card.classList.add("selected");
      card.setAttribute("aria-pressed", "true");
    } else {
      card.setAttribute("aria-pressed", "false");
    }

    const thumb = document.createElement("div");
    thumb.className = "gallery-thumb";
    if (img.thumbnailDataUrl) {
      const el = document.createElement("img");
      el.src = img.thumbnailDataUrl;
      el.loading = "lazy";
      el.alt = "";
      thumb.appendChild(el);
    }
    card.appendChild(thumb);

    const info = document.createElement("div");
    info.className = "gallery-item-info";

    const name = document.createElement("div");
    name.className = "gallery-item-name";
    name.textContent = getFilename(img.path) || this.#displayUrl(img.sourceUrl);
    setTooltip(name, img.path);
    info.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "gallery-item-meta";
    const dims = img.width && img.height ? `${img.width}\u00d7${img.height} \u2022 ` : "";
    meta.textContent = `${dims}${this.#formatDate(img.createdAt)}`;
    info.appendChild(meta);

    const tags = img.tags || {};
    const tagKeys = Object.keys(tags);
    if (tagKeys.length > 0) {
      const chipsEl = document.createElement("div");
      chipsEl.className = "gallery-tag-chips";
      for (const k of tagKeys.slice(0, 3)) {
        const chip = document.createElement("span");
        chip.className = "gallery-tag";
        chip.textContent = `${k}: ${tags[k]}`;
        chipsEl.appendChild(chip);
      }
      info.appendChild(chipsEl);
    }

    card.appendChild(info);

    // 3-dot menu
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "gallery-card-more material-symbols-outlined";
    moreBtn.textContent = "more_vert";
    setTooltip(moreBtn, "More actions");
    moreBtn.setAttribute("aria-label", `Actions for image ${filename}`);
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = moreBtn.getBoundingClientRect();
      openContextMenu({
        x: rect.right,
        y: rect.bottom,
        items: this.#imageMenuItems(img),
      });
    });
    card.appendChild(moreBtn);

    card.addEventListener("click", (e) => this.#handleItemClick(e, "image", img.path));
    card.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.clearSelection();
      this.onOpenImage?.(img);
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!this.#selectedImagePaths.has(img.path)) {
        this.#selectedImagePaths.clear();
        this.#selectedFolderPaths.clear();
        this.#selectedImagePaths.add(img.path);
        this.#updateSelectionVisuals();
        this.#fireSelectionChange();
      }
      openContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: this.#imageMenuItems(img),
      });
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.clearSelection();
        this.onOpenImage?.(img);
      } else if (e.key === " ") {
        e.preventDefault();
        this.#handleItemClick(e as unknown as MouseEvent, "image", img.path);
      }
    });
    return card;
  }

  // ---- Context menu items ----

  #folderMenuItems(folder: FolderRecord): MenuItem[] {
    return [
      {
        icon: "open_in_new",
        label: "Open",
        action: () => {
          this.clearSelection();
          this.#currentFolderPath = folder.path;
          this.onFolderChange?.(folder.path);
          this.refresh();
        },
      },
      {
        icon: "drive_file_rename_outline",
        label: "Rename",
        action: async () => {
          const newName = await showPromptDialog({
            title: "Rename folder",
            defaultValue: folder.name,
            okLabel: "Rename",
          });
          if (!newName || newName === folder.name) return;
          try {
            await this.#storage.renameFolder(folder.path, newName);
            await this.refresh();
            await this.onFoldersChanged?.();
          } catch (e: any) {
            await showAlertDialog({
              title: "Couldn't rename folder",
              message: e.message || "An unexpected error occurred.",
            });
          }
        },
      },
      {
        icon: "delete",
        label: "Delete",
        danger: true,
        action: async () => {
          const ok = await showConfirmDialog({
            title: `Delete folder "${folder.name}"?`,
            message: "The folder and all its contents will be permanently removed.",
            okLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          await this.#storage.deleteFolder(folder.path);
          await this.refresh();
          await this.onFoldersChanged?.();
        },
      },
    ];
  }

  #imageMenuItems(img: ImageRecord): MenuItem[] {
    const filename = getFilename(img.path);
    return [
      {
        icon: "open_in_new",
        label: "Open",
        action: () => this.onOpenImage?.(img),
      },
      {
        icon: "drive_file_rename_outline",
        label: "Rename",
        action: async () => {
          const newName = await showPromptDialog({
            title: "Rename image",
            defaultValue: filename,
            okLabel: "Rename",
          });
          if (!newName || newName === filename) return;
          try {
            await this.#storage.renameImage(img.path, newName);
            await this.refresh();
          } catch (e: any) {
            await showAlertDialog({
              title: "Couldn't rename image",
              message: e.message || "An unexpected error occurred.",
            });
          }
        },
      },
      {
        icon: "delete",
        label: "Delete",
        danger: true,
        action: async () => {
          const ok = await showConfirmDialog({
            title: `Delete "${filename}"?`,
            message: "This cannot be undone.",
            okLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          await this.#storage.deleteImage(img.path);
          await this.refresh();
        },
      },
    ];
  }

  // ---- Selection handling ----

  #handleItemClick(e: MouseEvent, type: "image" | "folder", path: string): void {
    e.stopPropagation();
    const isMac = navigator.platform.toUpperCase().startsWith("MAC");
    const multiModifier = isMac ? e.metaKey : e.ctrlKey;
    const rangeModifier = e.shiftKey;

    if (rangeModifier && this.#selectionAnchor) {
      this.#selectRange(this.#selectionAnchor, { type, path });
    } else if (multiModifier) {
      this.#toggleSelection(type, path);
      this.#selectionAnchor = { type, path };
    } else {
      // Plain click: replace selection with just this item.
      // (Re-clicking does NOT deselect — keeping selection stable lets the
      // follow-up dblclick navigate without the highlight flickering off.
      // Click on empty grid area is the way to clear selection.)
      const set = type === "image" ? this.#selectedImagePaths : this.#selectedFolderPaths;
      this.#selectedImagePaths.clear();
      this.#selectedFolderPaths.clear();
      set.add(path);
      this.#selectionAnchor = { type, path };
    }

    this.#updateSelectionVisuals();
    this.#fireSelectionChange();
  }

  #toggleSelection(type: "image" | "folder", path: string): void {
    const set = type === "image" ? this.#selectedImagePaths : this.#selectedFolderPaths;
    if (set.has(path)) set.delete(path);
    else set.add(path);
  }

  /** Select all items between anchor and target (inclusive), across folder+image lists. */
  #selectRange(
    anchor: { type: "image" | "folder"; path: string },
    target: { type: "image" | "folder"; path: string },
  ): void {
    // Build flat ordered list: folders first, then images (matches render order)
    const flat: { type: "image" | "folder"; path: string }[] = [
      ...this.#folders.map((f) => ({ type: "folder" as const, path: f.path })),
      ...this.#images.map((i) => ({ type: "image" as const, path: i.path })),
    ];
    const anchorIdx = flat.findIndex((x) => x.type === anchor.type && x.path === anchor.path);
    const targetIdx = flat.findIndex((x) => x.type === target.type && x.path === target.path);
    if (anchorIdx < 0 || targetIdx < 0) return;
    const [lo, hi] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    this.#selectedImagePaths.clear();
    this.#selectedFolderPaths.clear();
    for (let i = lo; i <= hi; i++) {
      const item = flat[i]!;
      const set = item.type === "image" ? this.#selectedImagePaths : this.#selectedFolderPaths;
      set.add(item.path);
    }
  }

  #updateSelectionVisuals(): void {
    for (const card of this.#grid.querySelectorAll<HTMLElement>(".gallery-item")) {
      const p = card.dataset.imagePath;
      card.classList.toggle("selected", !!p && this.#selectedImagePaths.has(p));
    }
    for (const card of this.#grid.querySelectorAll<HTMLElement>(".gallery-folder-card")) {
      const p = card.dataset.folderPath;
      card.classList.toggle("selected", !!p && this.#selectedFolderPaths.has(p));
    }
  }

  #fireSelectionChange(): void {
    this.onSelectionChange?.(this.getSelection());
  }

  #matchFilter(img: ImageRecord, query: string): boolean {
    const terms = query.split(/\s+/).filter(Boolean);
    const tags = img.tags || {};
    return terms.every((term) => {
      const ci = term.indexOf(":");
      if (ci > 0) {
        const key = term.slice(0, ci);
        const val = term.slice(ci + 1);
        const tv = tags[key];
        if (tv == null) return false;
        return tv.toLowerCase().includes(val);
      }
      if ((img.sourceUrl || "").toLowerCase().includes(term)) return true;
      if (img.path.toLowerCase().includes(term)) return true;
      for (const [k, v] of Object.entries(tags)) {
        if (k.toLowerCase().includes(term) || v.toLowerCase().includes(term)) return true;
      }
      return false;
    });
  }

  #displayUrl(url: string): string {
    if (!url) return "Uploaded image";
    try {
      const u = new URL(url);
      return u.hostname + (u.pathname === "/" ? "" : u.pathname.slice(0, 30));
    } catch {
      return url.slice(0, 40);
    }
  }

  #formatDate(iso: string): string {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    } catch {
      return "";
    }
  }
}
