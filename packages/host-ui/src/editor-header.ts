import { builtinIcon } from "@ingcreators/annot-core";
import "./annot-icon.js";
/**
 * `<annot-editor-header>` — editor header bar:
 *
 *   [brand] [breadcrumb] › [filename] [info] [save-status]
 *                                                  [Open] [Copy] [Save▼] [help] [theme]
 *
 * Lit Phase 4 — replaces the imperative DOM construction that
 * used to live in `HeaderHost.build()`. The orchestrator class
 * (still named `HeaderHost`) owns the cross-cutting flows
 * (rename → drawer refresh, last-commit lookup, plugin external
 * links) and renders through this element.
 *
 * The breadcrumb uses the shared `.breadcrumb` CSS vocabulary
 * already defined for the gallery so the editor and gallery
 * share one visual language. The save status indicator
 * (`<annot-save-status>`) is rendered as a sibling so the
 * header host can read its element ref directly through the
 * Lit element's `getSaveStatusIndicator()` accessor.
 */

import { BRAND_MARK_SVG } from "./brand-mark.js";
import "./editable-filename.js";
import type { AnnotEditableFilenameElement } from "./editable-filename.js";
import { html, LitElement, nothing, unsafeHTML } from "./lit.js";
import "./save-status-indicator.js";
import type { AnnotSaveStatusElement } from "./save-status-indicator.js";
import { createSettingsButton } from "./ui/settings-button.js";

export interface EditorHeaderCallbacks {
  /** Click on the brand or any breadcrumb segment that resolves
   *  to a folder. The header passes the folder path; "" = root. */
  onNavigateToFolder: (folderPath: string) => void;
  /** Info button — toggle the file-details drawer. */
  onToggleInfo: () => void;
  /** Async rename via the inline filename input. The callback
   *  is expected to call storage.renameImage and feed the
   *  (possibly uniquified) name back via property updates. */
  onRename: (newName: string) => Promise<void>;
  /** Optional Open File handler — only rendered when set. */
  onOpenFile?: () => void;
  /** Copy current canvas (Ctrl+C). */
  onCopy: () => void;
  /** Quick save (Ctrl+S). */
  onSave: () => void;
  /** Open the save submenu — receives the wrap element so the
   *  Toolbar can position the dropdown against it. */
  onSaveMenu: (anchor: HTMLElement) => void;
}

interface BreadcrumbCrumb {
  label: string;
  path: string;
}

export class AnnotEditorHeaderElement extends LitElement {
  static override properties = {
    rootLabel: { type: String },
    crumbs: { attribute: false },
    filename: { type: String },
    fullPath: { type: String },
    callbacks: { attribute: false },
  };

  declare rootLabel: string;
  declare crumbs: BreadcrumbCrumb[];
  declare filename: string;
  declare fullPath: string;
  declare callbacks: EditorHeaderCallbacks;

  constructor() {
    super();
    this.rootLabel = "Browser";
    this.crumbs = [];
    this.filename = "";
    this.fullPath = "";
    this.callbacks = {
      onNavigateToFolder: () => {},
      onToggleInfo: () => {},
      onRename: async () => {},
      onCopy: () => {},
      onSave: () => {},
      onSaveMenu: () => {},
    };
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The host `#editor-header` div is `display: flex` and lays
    // out the brand / breadcrumb / filename / save-status /
    // file-actions cluster as direct flex children. With this
    // Lit element wrapping them, those children become flex
    // grandchildren — the flex container only sees one block-
    // level item (`<annot-editor-header>`) and stacks our chrome
    // vertically inside an unintended block. `display: contents`
    // makes the wrapper transparent to layout: the children are
    // re-parented for layout purposes into `#editor-header`,
    // restoring the original flex row.
    this.style.display = "contents";
  }

  /** Returns the `<annot-save-status>` child so the header host
   *  can hand its reference to `SavePipeline` for state updates. */
  getSaveStatusIndicator(): AnnotSaveStatusElement | null {
    return this.querySelector<AnnotSaveStatusElement>("annot-save-status");
  }

  /** Returns the `<annot-editable-filename>` child so the header
   *  host can update its filename after a successful rename. */
  getEditableFilename(): AnnotEditableFilenameElement | null {
    return this.querySelector<AnnotEditableFilenameElement>("annot-editable-filename");
  }

  override render() {
    const hasFile = !!this.filename;
    return html`
      <button type="button"
        class="editor-header-brand"
        data-tooltip="Back to Gallery"
        aria-label="Back to Gallery"
        @click=${() => this.callbacks.onNavigateToFolder("")}
      >
        ${unsafeHTML(BRAND_MARK_SVG)}
      </button>

      <nav class="breadcrumb editor-header-path" aria-label="Return to gallery">
        ${this.#renderCrumb({ label: this.rootLabel, path: "" })}
        ${this.crumbs.map(
          (c) =>
            html`<span class="breadcrumb-sep" aria-hidden="true">\u203a</span>${this.#renderCrumb(c)}`,
        )}
        ${
          hasFile
            ? html`
              <span class="breadcrumb-sep" aria-hidden="true">\u203a</span>
              <annot-editable-filename
                .filename=${this.filename}
                .tooltip=${`${this.fullPath}\nDouble-click to rename`}
                .onCommit=${(name: string) => this.callbacks.onRename(name)}
              ></annot-editable-filename>
              <button
                type="button"
                class="editor-header-info-btn"
                data-tooltip="Show file details and all tags"
                aria-label="Show file details and all tags"
                @click=${() => this.callbacks.onToggleInfo()}
              >
                <annot-icon .spec=${builtinIcon("info")}></annot-icon>
              </button>
            `
            : nothing
        }
      </nav>

      <annot-save-status></annot-save-status>

      <span class="toolbar-spacer"></span>

      <div class="editor-header-file-actions">
        ${
          this.callbacks.onOpenFile
            ? html`
              <button type="button"
                class="header-info-btn"
                data-tooltip="Open File"
                aria-label="Open File"
                @click=${() => this.callbacks.onOpenFile?.()}>
            <annot-icon .spec=${builtinIcon("folder_open")}></annot-icon>
          </button>
            `
            : nothing
        }

        <button type="button"
          class="header-info-btn"
          data-tooltip="Copy (Ctrl+C)"
          aria-label="Copy"
          @click=${() => this.callbacks.onCopy()}>
            <annot-icon .spec=${builtinIcon("content_copy")}></annot-icon>
          </button>

        <div class="tool-btn-wrap header-save-wrap">
          <button type="button"
            class="header-info-btn"
            data-tooltip="Save (Ctrl+S)"
            aria-label="Save"
            @click=${() => this.callbacks.onSave()}>
            <annot-icon .spec=${builtinIcon("save")}></annot-icon>
          </button>
          <button type="button"
            class="tool-dropdown-arrow"
            data-tooltip="Save options"
            aria-label="Save options"
            @click=${(e: MouseEvent) => {
              e.stopPropagation();
              const wrap = (e.currentTarget as HTMLElement).parentElement;
              if (wrap) this.callbacks.onSaveMenu(wrap);
            }}>
            <annot-icon .spec=${builtinIcon("expand_more")}></annot-icon>
          </button>
        </div>
      </div>

      <button type="button"
        class="header-info-btn"
        data-tooltip="Help"
        aria-label="Help">
            <annot-icon .spec=${builtinIcon("help_outline")}></annot-icon>
          </button>

      ${this.#renderSettingsButton()}
    `;
  }

  #renderCrumb(crumb: BreadcrumbCrumb) {
    return html`
      <button
        type="button"
        class="breadcrumb-item"
        data-tooltip=${
          crumb.path ? `Open "${crumb.label}" in gallery` : `Open gallery root (${this.rootLabel})`
        }
        @click=${() => this.callbacks.onNavigateToFolder(crumb.path)}
      >
        ${crumb.label}
      </button>
    `;
  }

  /** Lazily mount the settings button once and reuse the same DOM
   *  node across re-renders so its event listener survives.
   *  `createSettingsButton` returns a vanilla button — wrap it in
   *  a no-op host so Lit's diff treats it as a stable child. */
  #settingsButtonEl: HTMLElement | null = null;
  #renderSettingsButton() {
    if (!this.#settingsButtonEl) {
      this.#settingsButtonEl = createSettingsButton("header-info-btn");
    }
    return this.#settingsButtonEl;
  }
}

if (!customElements.get("annot-editor-header")) {
  customElements.define("annot-editor-header", AnnotEditorHeaderElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-editor-header": AnnotEditorHeaderElement;
  }
}
