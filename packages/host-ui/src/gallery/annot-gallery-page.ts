import { builtinIcon } from "@ingcreators/annot-core";
import "../annot-icon.js";
/**
 * `<annot-gallery-page>` — folder + file grid that backs the file
 * manager's main pane. Path-based identification throughout.
 *
 * Interaction model (Google Drive-like):
 *   - Single click       → toggle select (clears prior selection)
 *   - Double click       → open (image → editor, folder → navigate)
 *   - Ctrl / Cmd + click → toggle single item in multi-selection
 *   - Shift + click      → range select from anchor to clicked item
 *   - Click empty area   → clear selection
 *
 * Lit completion Phase 4 — replaces the imperative `GalleryPage`
 * class. The parent (`file-manager.ts`) sets `.storage` /
 * `.viewMode` reactive properties and listens for the
 * `annot-gallery-open-image` / `annot-gallery-folder-change` /
 * `annot-gallery-count-change` / `annot-gallery-folders-changed` /
 * `annot-gallery-selection-change` CustomEvents. The pre-Lit
 * imperative API (`refresh()`, `clearSelection()`,
 * `deleteSelection()`, `createNewFolder()`, `getSelection()`,
 * `setSearchInput(input)`, `setViewMode(mode)`, `destroy()`) is
 * preserved as methods on the element.
 *
 * Light DOM (Hybrid CSS) so the existing `.gallery-panel` /
 * `.gallery-grid` / `.gallery-item` / `.gallery-folder-card`
 * rules in `file-manager.css` apply unchanged.
 */

import type {
  DocumentRecord,
  FolderRecord,
  ImageRecord,
  StorageProvider,
} from "@ingcreators/annot-core/storage";
import { getFilename, supportsDocuments, supportsResync } from "@ingcreators/annot-core/storage";
import { html, LitElement, nothing } from "../lit.js";
import type { ThumbnailManager } from "../thumbnail-manager.js";
import { showAlertDialog, showConfirmDialog, showPromptDialog } from "../ui/dialog.js";

// `logger` (PWA's centralised log shim from
// `packages/web/src/logger.ts`) is a host-side concern — editor-shell
// stays host-neutral, so the two `logger.{debug,error}` call sites
// below use `console` directly. If multiple shell modules ever need
// the level-control wrapper, add a `@ingcreators/annot-host-ui/logger`
// of our own (or accept one as a host dep).
const logger = {
  debug: (...args: unknown[]): void => console.debug(...args),
  error: (...args: unknown[]): void => console.error(...args),
};

import { type MenuItem, openContextMenu } from "./annot-context-menu.js";

export interface GallerySelection {
  images: ImageRecord[];
  folders: FolderRecord[];
}

export class AnnotGalleryPageElement extends LitElement {
  static override properties = {
    storage: { attribute: false },
    thumbnailManager: { attribute: false },
    viewMode: { attribute: false },
    images: { state: true },
    folders: { state: true },
    documents: { state: true },
    currentFolderPath: { state: true },
    query: { state: true },
    selectedImagePaths: { state: true },
    selectedFolderPaths: { state: true },
  };

  declare storage: StorageProvider | null;
  /** Optional unified thumbnail cache. When provided, the gallery
   *  calls `attach(provider, records)` after every list to hydrate
   *  thumbnails / dimensions from the cache and schedule prefetches
   *  for misses. Set by the host (`FileManager` constructor) once
   *  per session — null only in tests / Storybook. */
  declare thumbnailManager: ThumbnailManager | null;
  declare viewMode: "grid" | "list";
  declare images: ImageRecord[];
  declare folders: FolderRecord[];
  /** `.annot.html` documents in the current folder. Populated from
   *  `storage.listDocuments(...)` when the active backend opts into
   *  `StorageWithDocuments` (Phase 6a). Backends without the
   *  capability leave this array empty and the Documents section
   *  doesn't render. */
  declare documents: DocumentRecord[];
  declare currentFolderPath: string;
  declare query: string;
  declare selectedImagePaths: Set<string>;
  declare selectedFolderPaths: Set<string>;

  /** Last clicked item (for shift-range select). */
  #selectionAnchor: { type: "image" | "folder"; path: string } | null = null;
  #searchInput: HTMLInputElement | null = null;
  #searchInputListener: ((e: Event) => void) | null = null;
  #searchTimer: number | undefined;
  #lastHadQuery = false;

  constructor() {
    super();
    this.storage = null;
    this.thumbnailManager = null;
    this.viewMode = "grid";
    this.images = [];
    this.folders = [];
    this.documents = [];
    this.currentFolderPath = "";
    this.query = "";
    this.selectedImagePaths = new Set();
    this.selectedFolderPaths = new Set();
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("gallery-panel");
    document.addEventListener("keydown", this.#onKeyDown);
    window.addEventListener("annot-thumbnail-ready", this.#onThumbnailReady);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("keydown", this.#onKeyDown);
    window.removeEventListener("annot-thumbnail-ready", this.#onThumbnailReady);
    this.#detachSearchInput();
    super.disconnectedCallback();
  }

  /** Pre-Lit API parity — file-manager calls `gallery.destroy()`
   *  during teardown. Equivalent to `this.remove()` since
   *  `disconnectedCallback` cleans up listeners. */
  destroy(): void {
    this.remove();
  }

  get totalSelectedCount(): number {
    return this.selectedImagePaths.size + this.selectedFolderPaths.size;
  }

  /** Current selection as records. */
  getSelection(): GallerySelection {
    return {
      images: this.images.filter((i) => this.selectedImagePaths.has(i.path)),
      folders: this.folders.filter((f) => this.selectedFolderPaths.has(f.path)),
    };
  }

  override render() {
    const filteredImages = this.query
      ? this.images.filter((img) => this.#matchFilter(img, this.query.trim().toLowerCase()))
      : this.images;
    const showFolders = !this.query;
    const showDocuments = !this.query;
    const docCount = showDocuments ? this.documents.length : 0;
    const filteredItems =
      (showFolders ? this.folders.length : 0) + docCount + filteredImages.length;
    const gridClass = `gallery-grid${this.viewMode === "list" ? " list-view" : ""}`;

    const empty =
      filteredItems === 0
        ? html`<div class="gallery-empty">
            ${
              this.images.length === 0 && this.folders.length === 0 && this.documents.length === 0
                ? "No items yet. Upload an image, capture with the extension, or create a new document."
                : "No matches found."
            }
          </div>`
        : nothing;

    return html`
      <div class=${gridClass} @click=${this.#onGridClick}>
        ${empty}
        ${
          showFolders && this.folders.length > 0
            ? html`
              <div class="gallery-section-header">Folders</div>
              <div class="gallery-folder-grid">
                ${this.folders.map((f) => this.#renderFolderCard(f))}
              </div>
            `
            : nothing
        }
        ${
          showDocuments && this.documents.length > 0
            ? html`
              <div class="gallery-section-header">Documents</div>
              <div class="gallery-document-grid">
                ${this.documents.map((d) => this.#renderDocumentCard(d))}
              </div>
            `
            : nothing
        }
        ${
          filteredImages.length > 0
            ? html`
              ${
                showFolders || (showDocuments && this.documents.length > 0)
                  ? html`<div class="gallery-section-header">Files</div>`
                  : nothing
              }
              <div class="gallery-image-grid">
                ${filteredImages.map((img) => this.#renderImageCard(img))}
              </div>
            `
            : nothing
        }
      </div>
    `;
  }

  protected override updated(_changed: Map<string, unknown>): void {
    // Fire count-change once per render to keep parent-side
    // counters in sync.
    const filteredImages = this.query
      ? this.images.filter((img) => this.#matchFilter(img, this.query.trim().toLowerCase()))
      : this.images;
    const showFolders = !this.query;
    const totalItems = (showFolders ? this.folders.length : 0) + this.images.length;
    const filteredItems = (showFolders ? this.folders.length : 0) + filteredImages.length;
    this.dispatchEvent(
      new CustomEvent<{ total: number; filtered: number }>("annot-gallery-count-change", {
        detail: { total: totalItems, filtered: filteredItems },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #renderFolderCard(folder: FolderRecord) {
    const selected = this.selectedFolderPaths.has(folder.path);
    return html`
      <div
        class=${`gallery-folder-card${selected ? " selected" : ""}`}
        data-folder-path=${folder.path}
        role="button"
        aria-label=${`Folder ${folder.name}. Enter to open, Space to toggle selection.`}
        aria-pressed=${selected ? "true" : "false"}
        tabindex="0"
        @click=${(e: MouseEvent) => this.#handleItemClick(e, "folder", folder.path)}
        @dblclick=${(e: MouseEvent) => this.#openFolder(e, folder)}
        @contextmenu=${(e: MouseEvent) => this.#onFolderContextMenu(e, folder)}
        @keydown=${(e: KeyboardEvent) => this.#onFolderKeydown(e, folder)}
      >
        <annot-icon
          class="gallery-folder-card-icon"
          .spec=${builtinIcon("folder")}
        ></annot-icon>
        <div class="gallery-folder-card-name" data-tooltip=${folder.name} aria-label=${folder.name}>
          ${folder.name}
        </div>
        <button type="button"
          class="gallery-card-more"
          data-tooltip="More actions"
          aria-label=${`Actions for folder ${folder.name}`}
          @click=${(e: MouseEvent) => this.#onFolderMore(e, folder)}>
            <annot-icon .spec=${builtinIcon("more_vert")}></annot-icon>
          </button>
      </div>
    `;
  }

  #renderDocumentCard(doc: DocumentRecord) {
    const filename = getFilename(doc.path) || doc.title || "Untitled document";
    const meta =
      doc.imageCount > 0
        ? `${doc.blockCount} blocks • ${doc.imageCount} image${doc.imageCount === 1 ? "" : "s"}`
        : `${doc.blockCount} block${doc.blockCount === 1 ? "" : "s"}`;
    return html`
      <div
        class="gallery-item gallery-document-item"
        data-document-path=${doc.path}
        role="button"
        aria-label=${`Document ${filename}. Enter or double-click to open.`}
        tabindex="0"
        @dblclick=${(e: MouseEvent) => this.#openDocument(e, doc)}
        @keydown=${(e: KeyboardEvent) => this.#onDocumentKeydown(e, doc)}
      >
        <div class="gallery-thumb">
          ${
            doc.thumbnailDataUrl
              ? html`<img src=${doc.thumbnailDataUrl} loading="lazy" alt="" />`
              : html`<annot-icon .spec=${builtinIcon("article")}></annot-icon>`
          }
        </div>
        <div class="gallery-item-info">
          <div class="gallery-item-name" data-tooltip=${doc.path} aria-label=${doc.path}>
            ${doc.title || filename}
          </div>
          <div class="gallery-item-meta">${meta} • ${this.#formatDate(doc.updatedAt)}</div>
        </div>
      </div>
    `;
  }

  #openDocument(e: Event | null, doc: DocumentRecord): void {
    e?.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ record: DocumentRecord }>("annot-gallery-open-document", {
        detail: { record: doc },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #onDocumentKeydown(e: KeyboardEvent, doc: DocumentRecord): void {
    if (e.key === "Enter") {
      e.preventDefault();
      this.#openDocument(null, doc);
    }
  }

  #renderImageCard(img: ImageRecord) {
    const filename = getFilename(img.path) || "Uploaded image";
    const selected = this.selectedImagePaths.has(img.path);
    const dims = img.width && img.height ? `${img.width}×${img.height} • ` : "";
    const tags = img.tags || {};
    const tagKeys = Object.keys(tags);
    return html`
      <div
        class=${`gallery-item${selected ? " selected" : ""}`}
        data-image-path=${img.path}
        role="button"
        aria-label=${`Image ${filename}. Enter to open, Space to toggle selection.`}
        aria-pressed=${selected ? "true" : "false"}
        tabindex="0"
        @click=${(e: MouseEvent) => this.#handleItemClick(e, "image", img.path)}
        @dblclick=${(e: MouseEvent) => this.#openImage(e, img)}
        @contextmenu=${(e: MouseEvent) => this.#onImageContextMenu(e, img)}
        @keydown=${(e: KeyboardEvent) => this.#onImageKeydown(e, img)}
      >
        <div class="gallery-thumb">
          ${
            img.thumbnailDataUrl
              ? html`<img src=${img.thumbnailDataUrl} loading="lazy" alt="" />`
              : nothing
          }
        </div>
        <div class="gallery-item-info">
          <div
            class="gallery-item-name"
            data-tooltip=${img.path}
            aria-label=${img.path}
          >
            ${getFilename(img.path) || this.#displayUrl(img.sourceUrl)}
          </div>
          <div class="gallery-item-meta">${dims}${this.#formatDate(img.createdAt)}</div>
          ${
            tagKeys.length > 0
              ? html`<div class="gallery-tag-chips">
                ${tagKeys
                  .slice(0, 3)
                  .map((k) => html`<span class="gallery-tag">${k}: ${tags[k]}</span>`)}
              </div>`
              : nothing
          }
        </div>
        <button type="button"
          class="gallery-card-more"
          data-tooltip="More actions"
          aria-label=${`Actions for image ${filename}`}
          @click=${(e: MouseEvent) => this.#onImageMore(e, img)}>
            <annot-icon .spec=${builtinIcon("more_vert")}></annot-icon>
          </button>
      </div>
    `;
  }

  // ---- Public API ----

  setViewMode(mode: "grid" | "list"): void {
    this.viewMode = mode;
  }

  setSearchInput(input: HTMLInputElement): void {
    this.#detachSearchInput();
    this.#searchInput = input;
    this.#lastHadQuery = (input.value || "").trim().length > 0;
    this.query = input.value || "";
    this.#searchInputListener = () => {
      window.clearTimeout(this.#searchTimer);
      this.#searchTimer = window.setTimeout(() => {
        const hasQuery = (input.value || "").trim().length > 0;
        if (hasQuery !== this.#lastHadQuery) {
          this.#lastHadQuery = hasQuery;
          this.query = input.value || "";
          void this.refresh();
        } else {
          this.query = input.value || "";
        }
      }, 300);
    };
    input.addEventListener("input", this.#searchInputListener);
  }

  #detachSearchInput(): void {
    if (this.#searchInput && this.#searchInputListener) {
      this.#searchInput.removeEventListener("input", this.#searchInputListener);
    }
    window.clearTimeout(this.#searchTimer);
    this.#searchInput = null;
    this.#searchInputListener = null;
  }

  async refresh(folderPath?: string): Promise<void> {
    if (folderPath !== undefined) this.currentFolderPath = folderPath;
    if (!this.storage) return;
    try {
      if (supportsResync(this.storage)) await this.storage.resync();

      const q = (this.#searchInput?.value || "").trim();
      let images: ImageRecord[];
      if (q) {
        // Search across the current folder and all subfolders so deeply
        // nested images can be found from any starting point.
        images = await this.#listImagesRecursive(this.currentFolderPath);
        this.folders = [];
      } else {
        images = await this.storage.listImages(this.currentFolderPath);
        this.folders = await this.storage.listFolders(this.currentFolderPath);
        // Phase 6d: list `.annot.html` documents alongside images
        // when the backend opts into `StorageWithDocuments`. Search
        // mode (the `q` branch above) intentionally skips documents
        // — the existing query path is image-only and document
        // search is its own design (filename + title fields).
        if (supportsDocuments(this.storage)) {
          try {
            this.documents = await this.storage.listDocuments(this.currentFolderPath);
          } catch (e) {
            logger.error("[gallery] listDocuments error:", e);
            this.documents = [];
          }
        } else {
          this.documents = [];
        }
      }
      // Hydrate thumbnails / dimensions from the unified cache and
      // schedule background prefetches for misses. No-op for stores
      // that don't implement `StorageWithThumbnailCache` (currently
      // every backend except Drive after Phase 3); Phases 4–5 add
      // GitHub / Browser / Device.
      //
      // Run BEFORE the `this.images` assignment: cache hits mutate
      // records in place, and Lit's reactive update is keyed off the
      // array-reference change, not deep-property mutation. Assigning
      // first would let Lit render the cards with empty thumbs during
      // the `attach()` await, leaving them blank until the next
      // unrelated re-render (selection change, etc.).
      if (this.thumbnailManager) {
        await this.thumbnailManager.attach(this.storage, images);
      }
      this.images = images;
      logger.debug(
        "[gallery] refresh: images:",
        this.images.length,
        "folders:",
        this.folders.length,
        "folderPath:",
        JSON.stringify(this.currentFolderPath),
      );
    } catch (e) {
      logger.error("[gallery] refresh error:", e);
      this.images = [];
      this.folders = [];
      this.documents = [];
    }
    // Drop stale selections that no longer exist
    const imgPaths = new Set(this.images.map((i) => i.path));
    const folderPaths = new Set(this.folders.map((f) => f.path));
    let mutated = false;
    const nextImgs = new Set(this.selectedImagePaths);
    for (const p of Array.from(nextImgs))
      if (!imgPaths.has(p)) {
        nextImgs.delete(p);
        mutated = true;
      }
    const nextFolders = new Set(this.selectedFolderPaths);
    for (const p of Array.from(nextFolders))
      if (!folderPaths.has(p)) {
        nextFolders.delete(p);
        mutated = true;
      }
    if (mutated) {
      this.selectedImagePaths = nextImgs;
      this.selectedFolderPaths = nextFolders;
    }
    this.#fireSelectionChange();
  }

  async createNewFolder(): Promise<void> {
    if (!this.storage) return;
    const name = await showPromptDialog({
      title: "New folder",
      placeholder: "Folder name",
      okLabel: "Create",
    });
    if (!name) return;
    try {
      await this.storage.createFolder(this.currentFolderPath, name);
      await this.refresh();
      this.#fireFoldersChanged();
    } catch (e) {
      const err = e as { message?: string };
      await showAlertDialog({
        title: "Couldn't create folder",
        message: err.message || "An unexpected error occurred.",
      });
    }
  }

  clearSelection(): void {
    if (this.totalSelectedCount === 0) return;
    this.selectedImagePaths = new Set();
    this.selectedFolderPaths = new Set();
    this.#selectionAnchor = null;
    this.#fireSelectionChange();
  }

  /** Delete all currently selected items. Returns count deleted. */
  async deleteSelection(): Promise<number> {
    if (!this.storage) return 0;
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
        await this.storage.deleteImage(img.path);
      } catch (e) {
        console.error(e);
      }
    }
    for (const folder of sel.folders) {
      try {
        await this.storage.deleteFolder(folder.path);
      } catch (e) {
        console.error(e);
      }
    }
    this.clearSelection();
    await this.refresh();
    if (sel.folders.length > 0) {
      this.#fireFoldersChanged();
    }
    return count;
  }

  // ---- Private helpers ----

  async #listImagesRecursive(rootPath: string): Promise<ImageRecord[]> {
    if (!this.storage) return [];
    const all: ImageRecord[] = [];
    const queue: string[] = [rootPath];
    const MAX_FOLDERS = 500;
    let visited = 0;
    while (queue.length && visited < MAX_FOLDERS) {
      const p = queue.shift()!;
      visited++;
      try {
        const imgs = await this.storage.listImages(p);
        all.push(...imgs);
        const subs = await this.storage.listFolders(p);
        for (const f of subs) queue.push(f.path);
      } catch (e) {
        console.warn("[gallery] recursive list error at", p, e);
      }
    }
    return all;
  }

  #onGridClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
    if (t.classList.contains("gallery-grid") || t === this) {
      this.clearSelection();
    }
  };

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (this.totalSelectedCount === 0) return;
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
    if (!this.offsetParent) return;
    e.preventDefault();
    this.clearSelection();
  };

  #onThumbnailReady = (e: Event): void => {
    const detail = (e as CustomEvent).detail as { path?: string; dataUrl?: string } | undefined;
    if (!detail?.path || !detail?.dataUrl) return;
    const record = this.images.find((r) => r.path === detail.path);
    if (record) {
      record.thumbnailDataUrl = detail.dataUrl;
      // Patch the matching card's <img src> in place so we don't
      // remount the whole grid for a single thumbnail.
      const card = this.querySelector<HTMLElement>(
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
    }
  };

  // ---- Folder card events ----

  #openFolder(e: MouseEvent, folder: FolderRecord): void {
    e.stopPropagation();
    this.clearSelection();
    this.currentFolderPath = folder.path;
    this.dispatchEvent(
      new CustomEvent<{ folderPath: string }>("annot-gallery-folder-change", {
        detail: { folderPath: folder.path },
        bubbles: true,
        composed: true,
      }),
    );
    void this.refresh();
  }

  #onFolderContextMenu = (e: MouseEvent, folder: FolderRecord): void => {
    e.preventDefault();
    if (!this.selectedFolderPaths.has(folder.path)) {
      this.selectedFolderPaths = new Set([folder.path]);
      this.selectedImagePaths = new Set();
      this.#fireSelectionChange();
    }
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: this.#folderMenuItems(folder),
    });
  };

  #onFolderKeydown = (e: KeyboardEvent, folder: FolderRecord): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      this.#openFolder(e as unknown as MouseEvent, folder);
    } else if (e.key === " ") {
      e.preventDefault();
      this.#handleItemClick(e as unknown as MouseEvent, "folder", folder.path);
    }
  };

  #onFolderMore = (e: MouseEvent, folder: FolderRecord): void => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openContextMenu({
      x: rect.right,
      y: rect.bottom,
      items: this.#folderMenuItems(folder),
    });
  };

  // ---- Image card events ----

  #openImage(e: MouseEvent, img: ImageRecord): void {
    e.stopPropagation();
    this.clearSelection();
    this.dispatchEvent(
      new CustomEvent<{ record: ImageRecord }>("annot-gallery-open-image", {
        detail: { record: img },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #onImageContextMenu = (e: MouseEvent, img: ImageRecord): void => {
    e.preventDefault();
    if (!this.selectedImagePaths.has(img.path)) {
      this.selectedImagePaths = new Set([img.path]);
      this.selectedFolderPaths = new Set();
      this.#fireSelectionChange();
    }
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: this.#imageMenuItems(img),
    });
  };

  #onImageKeydown = (e: KeyboardEvent, img: ImageRecord): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      this.#openImage(e as unknown as MouseEvent, img);
    } else if (e.key === " ") {
      e.preventDefault();
      this.#handleItemClick(e as unknown as MouseEvent, "image", img.path);
    }
  };

  #onImageMore = (e: MouseEvent, img: ImageRecord): void => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openContextMenu({
      x: rect.right,
      y: rect.bottom,
      items: this.#imageMenuItems(img),
    });
  };

  // ---- Context menu items ----

  #folderMenuItems(folder: FolderRecord): MenuItem[] {
    return [
      {
        icon: "open_in_new",
        label: "Open",
        action: () => {
          this.clearSelection();
          this.currentFolderPath = folder.path;
          this.dispatchEvent(
            new CustomEvent<{ folderPath: string }>("annot-gallery-folder-change", {
              detail: { folderPath: folder.path },
              bubbles: true,
              composed: true,
            }),
          );
          void this.refresh();
        },
      },
      {
        icon: "drive_file_rename_outline",
        label: "Rename",
        action: async () => {
          if (!this.storage) return;
          const newName = await showPromptDialog({
            title: "Rename folder",
            defaultValue: folder.name,
            okLabel: "Rename",
          });
          if (!newName || newName === folder.name) return;
          try {
            await this.storage.renameFolder(folder.path, newName);
            await this.refresh();
            this.#fireFoldersChanged();
          } catch (e) {
            const err = e as { message?: string };
            await showAlertDialog({
              title: "Couldn't rename folder",
              message: err.message || "An unexpected error occurred.",
            });
          }
        },
      },
      {
        icon: "delete",
        label: "Delete",
        danger: true,
        action: async () => {
          if (!this.storage) return;
          const ok = await showConfirmDialog({
            title: `Delete folder "${folder.name}"?`,
            message: "The folder and all its contents will be permanently removed.",
            okLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          await this.storage.deleteFolder(folder.path);
          await this.refresh();
          this.#fireFoldersChanged();
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
        action: () => {
          this.dispatchEvent(
            new CustomEvent<{ record: ImageRecord }>("annot-gallery-open-image", {
              detail: { record: img },
              bubbles: true,
              composed: true,
            }),
          );
        },
      },
      {
        icon: "drive_file_rename_outline",
        label: "Rename",
        action: async () => {
          if (!this.storage) return;
          const newName = await showPromptDialog({
            title: "Rename image",
            defaultValue: filename,
            okLabel: "Rename",
          });
          if (!newName || newName === filename) return;
          try {
            await this.storage.renameImage(img.path, newName);
            await this.refresh();
          } catch (e) {
            const err = e as { message?: string };
            await showAlertDialog({
              title: "Couldn't rename image",
              message: err.message || "An unexpected error occurred.",
            });
          }
        },
      },
      {
        icon: "delete",
        label: "Delete",
        danger: true,
        action: async () => {
          if (!this.storage) return;
          const ok = await showConfirmDialog({
            title: `Delete "${filename}"?`,
            message: "This cannot be undone.",
            okLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          await this.storage.deleteImage(img.path);
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

    let nextImages = new Set(this.selectedImagePaths);
    let nextFolders = new Set(this.selectedFolderPaths);

    if (rangeModifier && this.#selectionAnchor) {
      ({ nextImages, nextFolders } = this.#selectRange(this.#selectionAnchor, { type, path }));
    } else if (multiModifier) {
      const set = type === "image" ? nextImages : nextFolders;
      if (set.has(path)) set.delete(path);
      else set.add(path);
      this.#selectionAnchor = { type, path };
    } else {
      // Plain click: replace selection with just this item.
      nextImages = new Set();
      nextFolders = new Set();
      const set = type === "image" ? nextImages : nextFolders;
      set.add(path);
      this.#selectionAnchor = { type, path };
    }

    this.selectedImagePaths = nextImages;
    this.selectedFolderPaths = nextFolders;
    this.#fireSelectionChange();
  }

  #selectRange(
    anchor: { type: "image" | "folder"; path: string },
    target: { type: "image" | "folder"; path: string },
  ): { nextImages: Set<string>; nextFolders: Set<string> } {
    const flat: { type: "image" | "folder"; path: string }[] = [
      ...this.folders.map((f) => ({ type: "folder" as const, path: f.path })),
      ...this.images.map((i) => ({ type: "image" as const, path: i.path })),
    ];
    const anchorIdx = flat.findIndex((x) => x.type === anchor.type && x.path === anchor.path);
    const targetIdx = flat.findIndex((x) => x.type === target.type && x.path === target.path);
    const nextImages = new Set<string>();
    const nextFolders = new Set<string>();
    if (anchorIdx < 0 || targetIdx < 0) return { nextImages, nextFolders };
    const [lo, hi] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    for (let i = lo; i <= hi; i++) {
      const item = flat[i]!;
      const set = item.type === "image" ? nextImages : nextFolders;
      set.add(item.path);
    }
    return { nextImages, nextFolders };
  }

  #fireSelectionChange(): void {
    this.dispatchEvent(
      new CustomEvent<{ selection: GallerySelection }>("annot-gallery-selection-change", {
        detail: { selection: this.getSelection() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #fireFoldersChanged(): void {
    this.dispatchEvent(
      new CustomEvent("annot-gallery-folders-changed", {
        bubbles: true,
        composed: true,
      }),
    );
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

if (!customElements.get("annot-gallery-page")) {
  customElements.define("annot-gallery-page", AnnotGalleryPageElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-gallery-page": AnnotGalleryPageElement;
  }
  interface HTMLElementEventMap {
    "annot-gallery-open-image": CustomEvent<{ record: ImageRecord }>;
    "annot-gallery-open-document": CustomEvent<{ record: DocumentRecord }>;
    "annot-gallery-folder-change": CustomEvent<{ folderPath: string }>;
    "annot-gallery-count-change": CustomEvent<{ total: number; filtered: number }>;
    "annot-gallery-folders-changed": CustomEvent<void>;
    "annot-gallery-selection-change": CustomEvent<{ selection: GallerySelection }>;
  }
}
