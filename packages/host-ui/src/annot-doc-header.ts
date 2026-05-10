/**
 * `<annot-doc-header>` — top-level chrome for the document
 * editor surface. Mirrors the shape of `<annot-editor-header>`
 * (image-side equivalent) so users learn the layout once:
 *
 *   [← Back] [Title*] [save-status] ━━ [↶ ↷] [+ Image] [View|Edit] [⋯]
 *
 * Phase 1 of `docs/plans/annot-html-document-ux-polish.md`.
 *
 * Replaces the imperative inline-styled header that used to live
 * inline in `packages/web/src/app.ts:openDocFromGallery` (~100
 * lines of `document.createElement` + inline `style.cssText`).
 * The new element is fully presentational + dispatches typed
 * events the host wires to the existing save / export / template
 * pipelines. Hosts opt out of individual buttons via the
 * `show*` boolean knobs (VSCode hides Back + save-status because
 * VSCode owns the dirty marker via tab badges; PWA shows
 * everything).
 *
 * Light DOM (Hybrid CSS) following the host-ui convention. The
 * styles ride along inline in the rendered template so the
 * element drops in without requiring the host to wire a
 * stylesheet.
 */

import { builtinIcon } from "@ingcreators/annot-core";
import "./annot-icon.js";
import { html, LitElement, nothing, type PropertyValues, type TemplateResult } from "./lit.js";
import "./save-status-indicator.js";
import type { AnnotSaveStatusElement } from "./save-status-indicator.js";

export type DocHeaderMode = "view" | "edit";

export type DocHeaderOverflowAction = "exportPptx" | "saveAsTemplate";

export interface DocHeaderOverflowItem {
  /** Stable id passed back via `onOverflowSelect`. */
  id: DocHeaderOverflowAction;
  /** Visible row label. */
  label: string;
  /** Disabled rows render dimmed and are not clickable. Used
   *  e.g. to gate "Export to PowerPoint…" until the document
   *  has at least one image block. */
  disabled?: boolean;
}

export interface DocHeaderCallbacks {
  /** "Back to gallery" — host decides what that means. PWA
   *  pushes the gallery URL; VSCode hides the button entirely
   *  via `showBack: false`. */
  onBack?: () => void;
  /** User pressed Undo (button OR Ctrl+Z handled by host). The
   *  header doesn't run undo itself — host owns the
   *  `<annot-doc-shell>` and knows whether the undo applies to
   *  the article or to the contentEditable focus. */
  onUndo?: () => void;
  /** User pressed Redo. Same reasoning as `onUndo`. */
  onRedo?: () => void;
  /** "+ Image" primary action — opens the OS file picker and
   *  inserts the chosen image at the end of the document. */
  onInsertImage?: () => void;
  /** "View" / "Edit" mode toggle — receives the next mode the
   *  user wants to switch to. */
  onModeChange?: (next: DocHeaderMode) => void;
  /** Document title was committed (Enter / blur). The header
   *  hands back the trimmed-but-not-yet-canonicalised string;
   *  the host runs whatever fallback applies (e.g. "Untitled"
   *  for empty). */
  onTitleCommit?: (next: string) => void;
  /** Overflow ⋯ menu pick. The header dispatches actions, the
   *  host runs them. */
  onOverflowSelect?: (action: DocHeaderOverflowAction) => void;
}

const HEADER_CSS = `
.annot-doc-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--annot-doc-muted, #d1d5db);
  background: var(--annot-doc-bg, #ffffff);
  color: var(--annot-doc-fg, #1f2937);
  font-size: 0.875rem;
  min-height: 44px;
  position: relative;
}
.annot-doc-header-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--annot-doc-muted, #d1d5db);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.annot-doc-header-back:hover,
.annot-doc-header-back:focus-visible {
  background: var(--annot-doc-code-bg, #f3f4f6);
  outline: none;
}
.annot-doc-header-title {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  padding: 4px 6px;
  border-radius: 3px;
  outline: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.annot-doc-header-title:focus-visible {
  box-shadow: 0 0 0 2px var(--annot-doc-accent, #2563eb);
}
.annot-doc-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.annot-doc-header-action {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
.annot-doc-header-action:hover:not(:disabled),
.annot-doc-header-action:focus-visible:not(:disabled) {
  background: var(--annot-doc-code-bg, #f3f4f6);
  outline: none;
}
.annot-doc-header-action:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.annot-doc-header-action-primary {
  width: auto;
  padding: 4px 10px;
  gap: 4px;
}
.annot-doc-header-mode-toggle {
  display: inline-flex;
  border: 1px solid var(--annot-doc-muted, #d1d5db);
  border-radius: 4px;
  overflow: hidden;
}
.annot-doc-header-mode-toggle button {
  padding: 4px 10px;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  border-right: 1px solid var(--annot-doc-muted, #d1d5db);
}
.annot-doc-header-mode-toggle button:last-child {
  border-right: none;
}
.annot-doc-header-mode-toggle button[aria-pressed="true"] {
  background: var(--annot-doc-accent, #2563eb);
  color: #ffffff;
}
.annot-doc-header-mode-toggle button:hover:not([aria-pressed="true"]) {
  background: var(--annot-doc-code-bg, #f3f4f6);
}
.annot-doc-header-overflow-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 8px;
  min-width: 220px;
  background: var(--annot-doc-bg, #ffffff);
  color: var(--annot-doc-fg, #1f2937);
  border: 1px solid var(--annot-doc-muted, #d1d5db);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 10;
}
.annot-doc-header-overflow-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.annot-doc-header-overflow-item:hover:not(:disabled),
.annot-doc-header-overflow-item:focus-visible:not(:disabled) {
  background: var(--annot-doc-code-bg, #f3f4f6);
  outline: none;
}
.annot-doc-header-overflow-item:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
@media (hover: none) {
  /* Touch devices — bigger hit targets per the Phase 9 plan
     (mobile / responsive). Phase 1 establishes the pattern;
     Phase 9 will sweep across the rest of the doc surface. */
  .annot-doc-header-action {
    width: 40px;
    height: 40px;
  }
  .annot-doc-header-mode-toggle button {
    padding: 8px 14px;
  }
}
`;

/**
 * The doc-mode header element. See module-level JSDoc for the
 * layout sketch + design philosophy. Public API is:
 *
 *   - properties: `documentTitle`, `mode`, `canUndo`, `canRedo`,
 *     `overflowItems`, `editableTitle`, `showBack`,
 *     `showSaveStatus`, `showModeToggle`, `callbacks`
 *   - imperative: `getSaveStatusIndicator()` returns the child
 *     `<annot-save-status>` so the host can drive `.status`
 *     directly
 *   - events: none — all interactions surface as callback
 *     invocations on `callbacks` (matches `<annot-editor-header>`)
 */
export class AnnotDocHeaderElement extends LitElement {
  static override properties = {
    documentTitle: { type: String, attribute: "document-title" },
    mode: { type: String, attribute: "mode" },
    canUndo: { type: Boolean, attribute: "can-undo" },
    canRedo: { type: Boolean, attribute: "can-redo" },
    editableTitle: { type: Boolean, attribute: "editable-title" },
    showBack: { type: Boolean, attribute: "show-back" },
    showSaveStatus: { type: Boolean, attribute: "show-save-status" },
    showModeToggle: { type: Boolean, attribute: "show-mode-toggle" },
    overflowItems: { attribute: false },
    callbacks: { attribute: false },
    overflowOpen: { state: true },
  };

  declare documentTitle: string;
  declare mode: DocHeaderMode;
  declare canUndo: boolean;
  declare canRedo: boolean;
  declare editableTitle: boolean;
  declare showBack: boolean;
  declare showSaveStatus: boolean;
  declare showModeToggle: boolean;
  declare overflowItems: DocHeaderOverflowItem[];
  declare callbacks: DocHeaderCallbacks;
  declare overflowOpen: boolean;

  /** Cached reference to the title contentEditable div. We keep
   *  one DOM node across renders so the user's typing-cursor /
   *  IME state survives reactive property updates. */
  #titleEl: HTMLDivElement | null = null;

  /** Outside-click handler installed while the overflow menu is
   *  open; cleans up on close. */
  #onDocClick: ((e: MouseEvent) => void) | null = null;

  constructor() {
    super();
    this.documentTitle = "";
    this.mode = "edit";
    this.canUndo = false;
    this.canRedo = false;
    this.editableTitle = true;
    this.showBack = true;
    this.showSaveStatus = true;
    this.showModeToggle = true;
    this.overflowItems = [];
    this.callbacks = {};
    this.overflowOpen = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#onDocClick) {
      document.removeEventListener("click", this.#onDocClick);
      this.#onDocClick = null;
    }
  }

  /** Returns the inline `<annot-save-status>` so the host can
   *  reach in and assign `.status` directly. Null when
   *  `showSaveStatus` is false. */
  getSaveStatusIndicator(): AnnotSaveStatusElement | null {
    return this.querySelector<AnnotSaveStatusElement>("annot-save-status");
  }

  /** Public setter for the title input. Useful when an external
   *  source (slash-menu metadata, Phase 11 settings panel)
   *  mutates the title — calling this from outside avoids a
   *  reactive-property re-render that would clobber the user's
   *  in-progress edit if their cursor is in the field. */
  setTitleText(next: string): void {
    this.documentTitle = next;
    if (this.#titleEl && document.activeElement !== this.#titleEl) {
      this.#titleEl.textContent = next;
    }
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    this.#titleEl = this.querySelector<HTMLDivElement>(".annot-doc-header-title");
    if (this.#titleEl) this.#titleEl.textContent = this.documentTitle;
  }

  protected override updated(changed: PropertyValues): void {
    // Re-attach the title ref if the showBack / editableTitle
    // toggles caused a re-render that recreated the div.
    const live = this.querySelector<HTMLDivElement>(".annot-doc-header-title");
    if (live && live !== this.#titleEl) {
      this.#titleEl = live;
      this.#titleEl.textContent = this.documentTitle;
    }
    // Sync the title contentEditable div imperatively — the
    // reactive `documentTitle` property feeds it but we never
    // overwrite the DOM if the user is mid-edit (focused). The
    // commit handler updates `documentTitle` first, then a host-
    // side update pushes the canonical form back via
    // `setTitleText` which respects focus.
    if (changed.has("documentTitle") && this.#titleEl) {
      if (document.activeElement !== this.#titleEl) {
        this.#titleEl.textContent = this.documentTitle;
      }
    }
  }

  override render(): TemplateResult {
    return html`
      <style>${HEADER_CSS}</style>
      <div class="annot-doc-header" role="banner">
        ${this.showBack ? this.#renderBack() : nothing}
        ${this.#renderTitle()}
        ${this.showSaveStatus ? html`<annot-save-status></annot-save-status>` : nothing}
        <span style="flex: 1 1 auto"></span>
        <div class="annot-doc-header-actions" role="toolbar" aria-label="Document actions">
          <button
            type="button"
            class="annot-doc-header-action"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            ?disabled=${!this.canUndo}
            @click=${() => this.callbacks.onUndo?.()}
          >
            <annot-icon .spec=${builtinIcon("undo")}></annot-icon>
          </button>
          <button
            type="button"
            class="annot-doc-header-action"
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
            ?disabled=${!this.canRedo}
            @click=${() => this.callbacks.onRedo?.()}
          >
            <annot-icon .spec=${builtinIcon("redo")}></annot-icon>
          </button>
          <button
            type="button"
            class="annot-doc-header-action annot-doc-header-action-primary"
            aria-label="Insert image"
            title="Insert image at end of document"
            @click=${() => this.callbacks.onInsertImage?.()}
          >
            <annot-icon .spec=${builtinIcon("add")}></annot-icon>
            <span>Image</span>
          </button>
          ${this.showModeToggle ? this.#renderModeToggle() : nothing}
          ${this.overflowItems.length > 0 ? this.#renderOverflowButton() : nothing}
        </div>
        ${this.overflowOpen ? this.#renderOverflowMenu() : nothing}
      </div>
    `;
  }

  #renderBack(): TemplateResult {
    return html`
      <button
        type="button"
        class="annot-doc-header-back"
        aria-label="Back to gallery"
        title="Back to gallery"
        @click=${() => this.callbacks.onBack?.()}
      >
        <span aria-hidden="true">←</span>
        <span>Back</span>
      </button>
    `;
  }

  #renderTitle(): TemplateResult {
    return html`
      <div
        class="annot-doc-header-title"
        role="textbox"
        aria-label="Document title"
        contenteditable=${this.editableTitle ? "true" : "false"}
        spellcheck="false"
        @keydown=${this.#onTitleKeydown}
        @blur=${this.#onTitleBlur}
      ></div>
    `;
  }

  #renderModeToggle(): TemplateResult {
    const editingPressed = this.mode === "edit";
    const viewingPressed = this.mode === "view";
    return html`
      <div class="annot-doc-header-mode-toggle" role="group" aria-label="View / Edit mode">
        <button
          type="button"
          aria-pressed=${viewingPressed ? "true" : "false"}
          title="Switch to read-only view"
          @click=${() => this.callbacks.onModeChange?.("view")}
        >
          View
        </button>
        <button
          type="button"
          aria-pressed=${editingPressed ? "true" : "false"}
          title="Switch to edit mode"
          @click=${() => this.callbacks.onModeChange?.("edit")}
        >
          Edit
        </button>
      </div>
    `;
  }

  #renderOverflowButton(): TemplateResult {
    return html`
      <button
        type="button"
        class="annot-doc-header-action"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded=${this.overflowOpen ? "true" : "false"}
        title="More actions"
        @click=${this.#toggleOverflow}
      >
        <annot-icon .spec=${builtinIcon("more_vert")}></annot-icon>
      </button>
    `;
  }

  #renderOverflowMenu(): TemplateResult {
    return html`
      <div class="annot-doc-header-overflow-menu" role="menu">
        ${this.overflowItems.map(
          (item) => html`
            <button
              type="button"
              class="annot-doc-header-overflow-item"
              role="menuitem"
              ?disabled=${item.disabled}
              @click=${() => this.#onOverflowItemClick(item)}
            >
              ${item.label}
            </button>
          `,
        )}
      </div>
    `;
  }

  #toggleOverflow = (e: MouseEvent): void => {
    e.stopPropagation();
    if (this.overflowOpen) {
      this.#closeOverflow();
    } else {
      this.overflowOpen = true;
      // Outside-click closes. Defer registration to the next
      // microtask so the click that opened the menu doesn't
      // trip it. "Inside" is the menu itself OR the ⋯ toggle
      // button — clicking any other header chrome (mode toggle,
      // image insert, …) closes the menu so the user doesn't
      // have to dismiss manually before reaching a sibling
      // action.
      queueMicrotask(() => {
        this.#onDocClick = (ev: MouseEvent) => {
          const target = ev.target as Node | null;
          if (!target) {
            this.#closeOverflow();
            return;
          }
          const menu = this.querySelector(".annot-doc-header-overflow-menu");
          const trigger = this.querySelector('[aria-label="More actions"]');
          if (menu?.contains(target)) return;
          if (trigger?.contains(target)) return;
          this.#closeOverflow();
        };
        document.addEventListener("click", this.#onDocClick);
      });
    }
  };

  #closeOverflow(): void {
    this.overflowOpen = false;
    if (this.#onDocClick) {
      document.removeEventListener("click", this.#onDocClick);
      this.#onDocClick = null;
    }
  }

  #onOverflowItemClick(item: DocHeaderOverflowItem): void {
    if (item.disabled) return;
    this.#closeOverflow();
    this.callbacks.onOverflowSelect?.(item.id);
  }

  #onTitleKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
  };

  #onTitleBlur = (e: FocusEvent): void => {
    const el = e.currentTarget as HTMLElement;
    const next = (el.textContent ?? "").trim();
    if (next === this.documentTitle) return;
    this.callbacks.onTitleCommit?.(next);
  };
}

if (!customElements.get("annot-doc-header")) {
  customElements.define("annot-doc-header", AnnotDocHeaderElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-doc-header": AnnotDocHeaderElement;
  }
}
