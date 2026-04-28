import { builtinIcon } from "@ingcreators/annot-core";
import "../ui/annot-icon.js";
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
import { html, LitElement } from "../lit.js";

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
}

export interface FileManagerShellCallbacks {
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onSetViewMode: (mode: "grid" | "list") => void;
  onClearSelection: () => void;
  onDeleteSelection: () => void;
}

export class AnnotFileManagerShellElement extends LitElement {
  static override properties = {
    breadcrumbs: { attribute: false },
    viewMode: { state: true },
    countText: { state: true },
    selection: { state: true },
    callbacks: { attribute: false },
  };

  declare breadcrumbs: BreadcrumbEntry[];
  declare viewMode: "grid" | "list";
  declare countText: string;
  declare selection: SelectionInfo | null;
  declare callbacks: FileManagerShellCallbacks;

  constructor() {
    super();
    this.breadcrumbs = [];
    this.viewMode = "grid";
    this.countText = "";
    this.selection = null;
    this.callbacks = {
      onNavigate: () => {},
      onRefresh: () => {},
      onSetViewMode: () => {},
      onClearSelection: () => {},
      onDeleteSelection: () => {},
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
  }

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

      <div class="main-content-body">
        <div id="gallery-container" class="file-manager-grid-host"></div>
      </div>

      <div class="main-content-footer">
        <span class="gallery-footer-text">${this.countText}</span>
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
    const count = sel.folders + sel.images;
    const parts: string[] = [];
    if (sel.folders) parts.push(`${sel.folders} folder${sel.folders !== 1 ? "s" : ""}`);
    if (sel.images) parts.push(`${sel.images} file${sel.images !== 1 ? "s" : ""}`);
    return `${count} selected (${parts.join(", ")})`;
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
