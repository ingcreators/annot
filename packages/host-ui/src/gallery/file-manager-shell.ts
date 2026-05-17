import { builtinIcon } from "@ingcreators/annot-core";
import "../annot-icon.js";
/**
 * `<annot-file-manager-shell>` — gallery main-content chrome:
 * breadcrumb + refresh button + view-mode toggle + selection bar
 * + footer count. The image grid itself stays vanilla
 * (`GalleryPage`) per the migration plan's Phase 3 boundary —
 * it's the highest-traffic render path in the gallery and
 * doesn't benefit from Lit's reactivity.
 *
 * Lit Phase 3 — split out of `FileManager.#buildMainContent` so
 * the shell renders declaratively. `FileManager` keeps its
 * orchestrator role (storage / GalleryPage / sidebar wiring) and
 * imperatively populates the `.gallery-grid-host` slot the shell
 * exposes.
 */

import { setTooltip } from "@ingcreators/annot-editor/tooltip";
import { html, LitElement, nothing } from "../lit.js";

/** Breadcrumb entry shown in the header. The shell renders the
 *  list declaratively; the file-manager populates it after a
 *  `getBreadcrumb` call settles. */
export interface BreadcrumbEntry {
  label: string;
  path: string;
  active: boolean;
}

export interface SelectionInfo {
  folders: number;
  images: number;
  /** Number of `.annot.html` documents in the current selection.
   *  Documents participate in the same multi-select model as
   *  images, so the selection bar can summarise mixed selections
   *  and the bulk Delete button removes all three kinds at once. */
  documents: number;
}

export interface FileManagerShellCallbacks {
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onSetViewMode: (mode: "grid" | "list") => void;
  onClearSelection: () => void;
  onDeleteSelection: () => void;
  /** Invoked when the user clicks the selection-bar's "Create
   *  card document" button. Host wires this to call
   *  `gallery.requestCreateCardDocument()`, which dispatches the
   *  existing `annot-gallery-create-card-document-request` event
   *  with the current ordered image selection. */
  onCreateCardDocument: () => void;
  /** Invoked when the user clicks the selection-bar's "Download"
   *  button. Host (`FileManager`) routes to the per-host download
   *  pipeline (XMP-embedded blob per image + raw bytes per document,
   *  packed into a single file or ZIP). */
  onDownloadSelection: () => void;
  /** Invoked when the user drops `File`s from the OS onto the
   *  shell. The host saves each file under the currently-viewed
   *  folder via its `importFiles` pipeline. Optional — when
   *  omitted, drag-drop is suppressed entirely (no overlay
   *  appears, no callback fires). */
  onImportFiles?: (files: readonly File[]) => void;
}

/** Label for the drop overlay's body line. Set by the host to
 *  reflect the currently-viewed folder so the user knows where
 *  the files will land. */
export type DropTargetLabel = string;

export class AnnotFileManagerShellElement extends LitElement {
  static override properties = {
    breadcrumbs: { attribute: false },
    viewMode: { state: true },
    countText: { state: true },
    selection: { state: true },
    canCreateCardDocument: { attribute: false },
    canDownloadSelection: { attribute: false },
    callbacks: { attribute: false },
    dropTargetLabel: { attribute: false },
    dragOver: { state: true },
  };

  declare breadcrumbs: BreadcrumbEntry[];
  declare viewMode: "grid" | "list";
  declare countText: string;
  declare selection: SelectionInfo | null;
  /** Set by the host (`FileManager`) based on whether the
   *  `onCreateCardDocument` host callback was wired. Gates the
   *  selection-bar's "Create card document" button — the button
   *  also requires images-only selection at runtime. */
  declare canCreateCardDocument: boolean;
  /** Set by the host (`FileManager`) based on whether the host's
   *  `onDownloadSelection` callback was wired. Gates the
   *  selection-bar's "Download" button — the button also requires
   *  at least one image or document in the selection at runtime
   *  (folders alone don't qualify). */
  declare canDownloadSelection: boolean;
  declare callbacks: FileManagerShellCallbacks;
  /** Human-readable name of the folder the user is currently
   *  viewing, used in the drop overlay's "Drop files to import
   *  to <folder>" hint. Defaults to "this folder" so the overlay
   *  works before the host populates it. */
  declare dropTargetLabel: DropTargetLabel;
  /** Internal — true while a drag containing files hovers the
   *  shell. Flipped by the document-level dragenter / dragleave
   *  pair below. The story reflects this state via a public
   *  setter for visual-regression coverage. */
  declare dragOver: boolean;

  /** Counter so nested children's dragenter / dragleave events
   *  don't make the overlay flicker. Increment on `dragenter`,
   *  decrement on `dragleave`; only flip `dragOver` when the
   *  count crosses zero. */
  #dragDepth = 0;

  constructor() {
    super();
    this.breadcrumbs = [];
    this.viewMode = "grid";
    this.countText = "";
    this.selection = null;
    this.canCreateCardDocument = false;
    this.canDownloadSelection = false;
    this.dropTargetLabel = "this folder";
    this.dragOver = false;
    this.callbacks = {
      onNavigate: () => {},
      onRefresh: () => {},
      onSetViewMode: () => {},
      onClearSelection: () => {},
      onDeleteSelection: () => {},
      onCreateCardDocument: () => {},
      onDownloadSelection: () => {},
    };
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The host `#main-content` div is `display: flex; flex-
    // direction: column;` and lays out [header] [selection-bar]
    // [body] [footer] as direct flex children — the body uses
    // `flex: 1` to consume available height between the fixed
    // header + footer. With this Lit wrapper sitting in between,
    // the flex column would only see ONE block-level item and
    // the body would no longer grow as intended. `display:
    // contents` makes the wrapper transparent to layout.
    this.style.display = "contents";

    // Drag-drop listeners. `display: contents` makes the element
    // transparent to layout but it still participates in event
    // dispatch — so the host element is a fine listener target.
    // Only respond to drags carrying `Files`; in-app DnD (folder
    // moves, gallery selection drag) uses different transfer
    // types and would otherwise trigger our overlay on every
    // grab.
    this.addEventListener("dragenter", this.#onDragEnter);
    this.addEventListener("dragover", this.#onDragOver);
    this.addEventListener("dragleave", this.#onDragLeave);
    this.addEventListener("drop", this.#onDrop);
  }

  override disconnectedCallback(): void {
    this.removeEventListener("dragenter", this.#onDragEnter);
    this.removeEventListener("dragover", this.#onDragOver);
    this.removeEventListener("dragleave", this.#onDragLeave);
    this.removeEventListener("drop", this.#onDrop);
    super.disconnectedCallback();
  }

  #dragHasFiles(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    // Array-like in some browsers, string-list in others — handle
    // both.
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "Files") return true;
    }
    return false;
  }

  #onDragEnter = (e: DragEvent): void => {
    if (!this.callbacks.onImportFiles) return;
    if (!this.#dragHasFiles(e)) return;
    e.preventDefault();
    this.#dragDepth += 1;
    if (this.#dragDepth === 1) this.dragOver = true;
  };

  #onDragOver = (e: DragEvent): void => {
    if (!this.callbacks.onImportFiles) return;
    if (!this.#dragHasFiles(e)) return;
    // Required to enable `drop` — without `preventDefault` the
    // browser's default "open this file in the tab" behaviour
    // kicks in.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  #onDragLeave = (e: DragEvent): void => {
    if (!this.callbacks.onImportFiles) return;
    if (!this.#dragHasFiles(e)) return;
    this.#dragDepth = Math.max(0, this.#dragDepth - 1);
    if (this.#dragDepth === 0) this.dragOver = false;
  };

  #onDrop = (e: DragEvent): void => {
    const cb = this.callbacks.onImportFiles;
    if (!cb) return;
    if (!this.#dragHasFiles(e)) return;
    e.preventDefault();
    this.#dragDepth = 0;
    this.dragOver = false;
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) cb(files);
  };

  /** The container the file-manager appends `<annot-gallery-page>`
   *  into. Stable across re-renders because Lit reuses the same
   *  DOM node when the template structure doesn't change.
   *
   *  Lookup is id-based for historical reasons: pre-Lit
   *  `GalleryPage`'s constructor used to overwrite the
   *  container's `className` to `"gallery-panel"`, which would
   *  wipe the `.file-manager-grid-host` class on the second
   *  mount and make a class-based query miss the existing host.
   *  The Phase 4 Lit migration moved that class onto the gallery
   *  element itself, so the constraint is gone — but the id
   *  selector is still preferred for stability. */
  getGridHost(): HTMLElement | null {
    return this.querySelector<HTMLElement>("#gallery-container");
  }

  override render() {
    const hasSelection = !!this.selection;
    return html`
      <div class="main-content-header" style=${hasSelection ? "display: none" : ""}>
        <nav class="breadcrumb" aria-label="Folder breadcrumb">
          ${this.breadcrumbs.map((entry, idx) =>
            idx === 0
              ? this.#renderCrumb(entry)
              : html`<span class="breadcrumb-sep">\u203a</span>${this.#renderCrumb(entry)}`,
          )}
        </nav>
        <button type="button"
          class="header-refresh-btn"
          data-tooltip="Refresh"
          aria-label="Refresh gallery"
          @click=${() => this.callbacks.onRefresh()}>
            <annot-icon .spec=${builtinIcon("refresh")}></annot-icon>
          </button>
        <div class="view-toggle" role="group" aria-label="View mode">
          <button type="button"
            class=${this.viewMode === "grid" ? "view-toggle-btn active" : "view-toggle-btn"}
            data-tooltip="Grid view"
            aria-label="Grid view"
            aria-pressed=${this.viewMode === "grid" ? "true" : "false"}
            @click=${() => this.callbacks.onSetViewMode("grid")}
          >
            <annot-icon .spec=${builtinIcon("grid_view")}></annot-icon>
          </button>
          <button
            type="button"
            class=${this.viewMode === "list" ? "view-toggle-btn active" : "view-toggle-btn"}
            data-tooltip="List view"
            aria-label="List view"
            aria-pressed=${this.viewMode === "list" ? "true" : "false"}
            @click=${() => this.callbacks.onSetViewMode("list")}
          >
            <annot-icon .spec=${builtinIcon("view_list")}></annot-icon>
          </button>
        </div>
      </div>

      <div
        class="selection-bar"
        role="toolbar"
        aria-label="Selection actions"
        style=${hasSelection ? "" : "display: none"}
      >
        <button
          type="button"
          class="selection-bar-close"
          data-tooltip="Clear selection"
          aria-label="Clear selection"
          @click=${() => this.callbacks.onClearSelection()}
        >
          <annot-icon .spec=${builtinIcon("close")}></annot-icon>
        </button>
        <span class="selection-bar-count" aria-live="polite"
          >${this.#renderSelectionCount()}</span
        >
        <div class="selection-bar-spacer"></div>
        ${this.#renderCreateCardDocumentButton()}
        ${this.#renderDownloadButton()}
        <button
          type="button"
          class="selection-bar-btn selection-bar-btn-danger"
          data-tooltip="Delete selected"
          aria-label="Delete selected items"
          @click=${() => this.callbacks.onDeleteSelection()}
        >
          <annot-icon aria-hidden="true" .spec=${builtinIcon("delete")}></annot-icon>Delete
        </button>
      </div>

      <div class="main-content-body file-manager-body">
        <div id="gallery-container" class="file-manager-grid-host"></div>
        ${this.dragOver ? this.#renderDropOverlay() : nothing}
      </div>

      <div class="main-content-footer">
        <span class="gallery-footer-text">${this.countText}</span>
      </div>
    `;
  }

  #renderDropOverlay() {
    return html`
      <div
        class="file-manager-drop-overlay"
        role="presentation"
        aria-hidden="true"
      >
        <div class="file-manager-drop-overlay-card">
          <annot-icon .spec=${builtinIcon("upload")}></annot-icon>
          <div class="file-manager-drop-overlay-title">Drop files to import</div>
          <div class="file-manager-drop-overlay-subtitle">
            into ${this.dropTargetLabel}
          </div>
        </div>
      </div>
    `;
  }

  #renderCrumb(entry: BreadcrumbEntry) {
    return html`
      <button
        class=${entry.active ? "breadcrumb-item active" : "breadcrumb-item"}
        @click=${() => this.callbacks.onNavigate(entry.path)}
      >
        ${entry.label}
      </button>
    `;
  }

  #renderSelectionCount(): string {
    const sel = this.selection;
    if (!sel) return "";
    const count = sel.folders + sel.images + sel.documents;
    const parts: string[] = [];
    if (sel.folders) parts.push(`${sel.folders} folder${sel.folders !== 1 ? "s" : ""}`);
    if (sel.documents) parts.push(`${sel.documents} document${sel.documents !== 1 ? "s" : ""}`);
    if (sel.images) parts.push(`${sel.images} image${sel.images !== 1 ? "s" : ""}`);
    return `${count} selected (${parts.join(", ")})`;
  }

  #renderCreateCardDocumentButton() {
    const sel = this.selection;
    if (!this.canCreateCardDocument) return nothing;
    if (!sel) return nothing;
    // Mirrors the image context menu's gating
    // (`annot-gallery-page.ts:1007`): visible only when the
    // selection is images-only — no folders, no other documents.
    if (sel.images < 1 || sel.folders > 0 || sel.documents > 0) return nothing;
    const label =
      sel.images === 1 ? "Create card document" : `Create card document (${sel.images} images)`;
    return html`
      <button
        type="button"
        class="selection-bar-btn"
        data-tooltip="Create card document from selected images"
        aria-label=${label}
        @click=${() => this.callbacks.onCreateCardDocument()}
      >
        <annot-icon aria-hidden="true" .spec=${builtinIcon("view_carousel")}></annot-icon>${label}
      </button>
    `;
  }

  #renderDownloadButton() {
    const sel = this.selection;
    if (!this.canDownloadSelection) return nothing;
    if (!sel) return nothing;
    // Folders alone don't qualify — they have no single-file
    // representation. Mixed selections (some files + some folders)
    // proceed with folders silently skipped on the host side.
    const fileCount = sel.images + sel.documents;
    if (fileCount < 1) return nothing;
    const label = fileCount === 1 ? "Download" : `Download (${fileCount} items)`;
    return html`
      <button
        type="button"
        class="selection-bar-btn"
        data-tooltip="Download selected files"
        aria-label=${label}
        @click=${() => this.callbacks.onDownloadSelection()}
      >
        <annot-icon aria-hidden="true" .spec=${builtinIcon("download")}></annot-icon>${label}
      </button>
    `;
  }

  protected override updated(): void {
    // Tooltips ride through `setTooltip` in the rest of the
    // codebase to keep both `data-tooltip` (custom CSS tooltip)
    // and `aria-label` in sync. The buttons in this template
    // already declare both attributes inline, but the helper is
    // the canonical way — apply it on first paint so future
    // dynamic-label changes can flow through one entry point.
    for (const btn of this.querySelectorAll<HTMLElement>(
      ".header-refresh-btn, .selection-bar-close, .selection-bar-btn, .view-toggle-btn",
    )) {
      const tip = btn.getAttribute("data-tooltip");
      if (tip) setTooltip(btn, tip);
    }
  }
}

if (!customElements.get("annot-file-manager-shell")) {
  customElements.define("annot-file-manager-shell", AnnotFileManagerShellElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-file-manager-shell": AnnotFileManagerShellElement;
  }
}
