/**
 * `<annot-doc-selection-toolbar>` — floating inline-format
 * toolbar that anchors to the active text selection inside an
 * editable block of `<annot-doc-shell>`.
 *
 * Phase 3 of `docs/plans/annot-html-document-ux-polish.md`.
 *
 * The toolbar surfaces three interactions today:
 *
 *   - **B / I / U** — toggle inline bold / italic / underline via
 *     `document.execCommand`. The browser already supports the
 *     same operations through Ctrl+B / Ctrl+I / Ctrl+U on a
 *     contentEditable, but those keystrokes are invisible — Phase
 *     3 makes the affordance discoverable.
 *   - **¶ ▼** — block-kind conversion. Opens a small dropdown
 *     listing the text-bearing block kinds (paragraph, H1, H2,
 *     H3, bulleted list, numbered list, quote, callout
 *     info / warn / note). Picking an entry dispatches a
 *     `block-kind-change` event with `{kind, opts}` payload the
 *     shell handles by replacing the block in the document model.
 *
 * The toolbar is mounted to `document.body` via the static
 * `openFor(rect, ctx)` factory and re-positioned on resize /
 * scroll. The shell drives open / close based on
 * `selectionchange`. Light DOM (Hybrid CSS) following the
 * host-ui convention.
 */

import { html, LitElement, type TemplateResult } from "./lit.js";

export type SelectionBlockKind = "paragraph" | "heading" | "list" | "quote" | "callout";

export interface BlockKindOption {
  /** Stable id for tests / aria. */
  readonly id: string;
  /** Visible label. */
  readonly label: string;
  /** Discriminator for the resulting block. */
  readonly kind: SelectionBlockKind;
  /** Heading level — only for `heading`. */
  readonly level?: 1 | 2 | 3;
  /** Whether the list is ordered — only for `list`. */
  readonly listOrdered?: boolean;
  /** Callout tone — only for `callout`. */
  readonly tone?: "info" | "warn" | "note";
}

export const SELECTION_BLOCK_KIND_OPTIONS: readonly BlockKindOption[] = [
  { id: "paragraph", label: "Paragraph", kind: "paragraph" },
  { id: "h1", label: "Heading 1", kind: "heading", level: 1 },
  { id: "h2", label: "Heading 2", kind: "heading", level: 2 },
  { id: "h3", label: "Heading 3", kind: "heading", level: 3 },
  { id: "ul", label: "Bulleted list", kind: "list", listOrdered: false },
  { id: "ol", label: "Numbered list", kind: "list", listOrdered: true },
  { id: "quote", label: "Quote", kind: "quote" },
  { id: "callout-info", label: "Callout — Info", kind: "callout", tone: "info" },
  { id: "callout-warn", label: "Callout — Warning", kind: "callout", tone: "warn" },
  { id: "callout-note", label: "Callout — Note", kind: "callout", tone: "note" },
];

export interface SelectionFormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Whether the active selection is INSIDE an existing
   *  inline link. Drives the `aria-pressed` state on the
   *  Link button so users can tell at a glance that the
   *  click will edit the existing link rather than create
   *  a new one. */
  link: boolean;
}

export interface SelectionToolbarContext {
  /** Anchor rect — usually the bounding rect of the user's
   *  selection range. The toolbar positions itself just above
   *  the rect (or just below if there's no room above). */
  rect: DOMRect | { top: number; left: number; right: number; bottom: number };
  /** Current B / I / U state at the selection — drives the
   *  `aria-pressed` flag on each button. */
  format: SelectionFormatState;
  /** Active block kind (`paragraph`, `heading-2`, …) so the
   *  block-kind dropdown can highlight the current entry. */
  currentBlockKindId?: string;
}

export interface BlockKindChangeDetail {
  option: BlockKindOption;
}

export interface FormatChangeDetail {
  command: "bold" | "italic" | "underline";
}

/** Detail payload for the `link-request` event. The toolbar
 *  dispatches this when the Link button is clicked; the
 *  shell opens the link dialog, restores the selection
 *  afterwards, and applies the user's choice via
 *  `document.execCommand`. */
export interface LinkRequestDetail {
  /** Whether the active selection is currently inside an
   *  inline `<a>` — drives the dialog's "Edit" vs. "Create"
   *  mode. */
  editing: boolean;
}

const TOOLBAR_CSS = `
.annot-doc-selection-toolbar-host {
  position: fixed;
  z-index: 1000;
  display: flex;
  align-items: stretch;
  padding: 2px;
  gap: 1px;
  background: var(--annot-doc-bg, #ffffff);
  color: var(--annot-doc-fg, #1f2937);
  border: 1px solid var(--annot-doc-muted, #d1d5db);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  font-size: 0.875rem;
}
.annot-doc-selection-toolbar-button {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
}
.annot-doc-selection-toolbar-button:hover:not([disabled]),
.annot-doc-selection-toolbar-button:focus-visible:not([disabled]) {
  background: var(--annot-doc-code-bg, #f3f4f6);
  outline: none;
}
.annot-doc-selection-toolbar-button[aria-pressed="true"] {
  background: var(--annot-doc-accent, #2563eb);
  color: #ffffff;
}
.annot-doc-selection-toolbar-button-bold { font-weight: 700; }
.annot-doc-selection-toolbar-button-italic { font-style: italic; }
.annot-doc-selection-toolbar-button-underline { text-decoration: underline; }
.annot-doc-selection-toolbar-divider {
  width: 1px;
  background: var(--annot-doc-muted, #d1d5db);
  margin: 4px 2px;
}
.annot-doc-selection-toolbar-kind-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 30px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}
.annot-doc-selection-toolbar-kind-button:hover,
.annot-doc-selection-toolbar-kind-button:focus-visible {
  background: var(--annot-doc-code-bg, #f3f4f6);
  outline: none;
}
.annot-doc-selection-toolbar-kind-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 180px;
  padding: 4px;
  background: var(--annot-doc-bg, #ffffff);
  border: 1px solid var(--annot-doc-muted, #d1d5db);
  border-radius: 6px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.16);
  z-index: 1001;
}
.annot-doc-selection-toolbar-kind-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 10px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: inherit;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}
.annot-doc-selection-toolbar-kind-item:hover,
.annot-doc-selection-toolbar-kind-item:focus-visible {
  background: var(--annot-doc-code-bg, #f3f4f6);
  outline: none;
}
.annot-doc-selection-toolbar-kind-item[aria-checked="true"] {
  font-weight: 600;
  color: var(--annot-doc-accent, #2563eb);
}
`;

let activeToolbar: AnnotDocSelectionToolbarElement | null = null;

export class AnnotDocSelectionToolbarElement extends LitElement {
  static override properties = {
    format: { attribute: false },
    currentBlockKindId: { type: String, attribute: "current-block-kind-id" },
    options: { attribute: false },
    kindMenuOpen: { state: true },
  };

  declare format: SelectionFormatState;
  declare currentBlockKindId: string | undefined;
  declare options: readonly BlockKindOption[];
  declare kindMenuOpen: boolean;

  /** Anchor rect; cached so reposition() can read it without
   *  re-querying the source selection. */
  #rect: { top: number; left: number; right: number; bottom: number } | null = null;
  #onReposition: (() => void) | null = null;

  constructor() {
    super();
    this.format = { bold: false, italic: false, underline: false, link: false };
    this.currentBlockKindId = undefined;
    this.options = SELECTION_BLOCK_KIND_OPTIONS;
    this.kindMenuOpen = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Open or move the toolbar to anchor at `ctx.rect`. The
   *  toolbar is a singleton — opening while one is already
   *  visible repositions the existing instance. Returns the
   *  element so the caller can read `getBoundingClientRect()`
   *  if needed. */
  static openFor(ctx: SelectionToolbarContext): AnnotDocSelectionToolbarElement {
    if (!activeToolbar) {
      activeToolbar = document.createElement(
        "annot-doc-selection-toolbar",
      ) as AnnotDocSelectionToolbarElement;
      document.body.appendChild(activeToolbar);
    }
    const tb = activeToolbar;
    tb.format = ctx.format;
    tb.currentBlockKindId = ctx.currentBlockKindId;
    tb.#rect = ctx.rect;
    tb.kindMenuOpen = false;
    queueMicrotask(() => tb.#reposition());
    return tb;
  }

  static closeActive(): void {
    if (!activeToolbar) return;
    activeToolbar.remove();
    activeToolbar = null;
  }

  static getActive(): AnnotDocSelectionToolbarElement | null {
    return activeToolbar;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#onReposition = () => this.#reposition();
    window.addEventListener("resize", this.#onReposition);
    window.addEventListener("scroll", this.#onReposition, { capture: true });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#onReposition) {
      window.removeEventListener("resize", this.#onReposition);
      window.removeEventListener("scroll", this.#onReposition, { capture: true });
      this.#onReposition = null;
    }
    if (activeToolbar === this) activeToolbar = null;
  }

  override render(): TemplateResult {
    return html`
      <style>${TOOLBAR_CSS}</style>
      <div
        class="annot-doc-selection-toolbar-host"
        role="toolbar"
        aria-label="Format selected text"
        @mousedown=${this.#onSelfMousedown}
      >
        ${this.#renderFormatButton("bold", "B", "bold", "Bold (Ctrl+B)")}
        ${this.#renderFormatButton("italic", "I", "italic", "Italic (Ctrl+I)")}
        ${this.#renderFormatButton("underline", "U", "underline", "Underline (Ctrl+U)")}
        ${this.#renderLinkButton()}
        <span class="annot-doc-selection-toolbar-divider" aria-hidden="true"></span>
        <button
          type="button"
          class="annot-doc-selection-toolbar-kind-button"
          aria-haspopup="menu"
          aria-expanded=${this.kindMenuOpen ? "true" : "false"}
          aria-label="Convert block kind"
          title="Convert block kind"
          @click=${this.#toggleKindMenu}
        >
          <span aria-hidden="true">¶</span>
          <span aria-hidden="true">▾</span>
        </button>
        ${this.kindMenuOpen ? this.#renderKindMenu() : ""}
      </div>
    `;
  }

  #renderLinkButton(): TemplateResult {
    const pressed = this.format.link;
    const title = pressed ? "Edit link" : "Insert link (Ctrl+K)";
    // The link button shows a generic link glyph (🔗 isn't
    // available in every host font and emoji rendering is
    // inconsistent across operating systems; the ASCII chain
    // "∞" was considered but reads as infinity). The "↗"
    // diagonal arrow reads unambiguously as "go to external"
    // without depending on an emoji font.
    return html`
      <button
        type="button"
        class="annot-doc-selection-toolbar-button annot-doc-selection-toolbar-button-link"
        aria-label=${title}
        aria-pressed=${pressed ? "true" : "false"}
        title=${title}
        data-format="link"
        @click=${this.#dispatchLinkRequest}
      >
        <span aria-hidden="true">↗</span>
      </button>
    `;
  }

  #renderFormatButton(
    cmd: FormatChangeDetail["command"],
    label: string,
    style: "bold" | "italic" | "underline",
    title: string,
  ): TemplateResult {
    const pressed = this.format[cmd];
    return html`
      <button
        type="button"
        class="annot-doc-selection-toolbar-button annot-doc-selection-toolbar-button-${style}"
        aria-label=${title}
        aria-pressed=${pressed ? "true" : "false"}
        title=${title}
        data-format=${cmd}
        @click=${() => this.#dispatchFormat(cmd)}
      >
        ${label}
      </button>
    `;
  }

  #renderKindMenu(): TemplateResult {
    return html`
      <div class="annot-doc-selection-toolbar-kind-menu" role="menu">
        ${this.options.map(
          (opt) => html`
            <button
              type="button"
              class="annot-doc-selection-toolbar-kind-item"
              role="menuitemradio"
              aria-checked=${opt.id === this.currentBlockKindId ? "true" : "false"}
              data-kind-id=${opt.id}
              @click=${() => this.#pickKind(opt)}
            >
              ${opt.label}
            </button>
          `,
        )}
      </div>
    `;
  }

  #onSelfMousedown = (e: MouseEvent): void => {
    // The contentEditable's selectionchange fires whenever the
    // active selection moves OR loses focus. Clicking a toolbar
    // button would normally blur the contentEditable, collapsing
    // the selection just before our click handler runs. Calling
    // `preventDefault` on `mousedown` keeps the selection alive
    // through the click → execCommand round-trip.
    e.preventDefault();
  };

  #toggleKindMenu = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.kindMenuOpen = !this.kindMenuOpen;
  };

  #pickKind = (option: BlockKindOption): void => {
    this.kindMenuOpen = false;
    this.dispatchEvent(
      new CustomEvent<BlockKindChangeDetail>("block-kind-change", {
        bubbles: true,
        composed: true,
        detail: { option },
      }),
    );
  };

  #dispatchFormat = (command: FormatChangeDetail["command"]): void => {
    this.dispatchEvent(
      new CustomEvent<FormatChangeDetail>("format-change", {
        bubbles: true,
        composed: true,
        detail: { command },
      }),
    );
  };

  #dispatchLinkRequest = (): void => {
    this.dispatchEvent(
      new CustomEvent<LinkRequestDetail>("link-request", {
        bubbles: true,
        composed: true,
        detail: { editing: this.format.link },
      }),
    );
  };

  #reposition(): void {
    const rect = this.#rect;
    if (!rect) return;
    const host = this.querySelector(".annot-doc-selection-toolbar-host") as HTMLElement | null;
    if (!host) return;
    // Try to position above the selection, falling back to below
    // if there's no room. The host is `position: fixed` so all
    // coordinates are viewport-relative.
    const hostRect = host.getBoundingClientRect();
    const margin = 8;
    let top = rect.top - hostRect.height - margin;
    if (top < 8) top = rect.bottom + margin;
    const centeredLeft = (rect.left + rect.right) / 2 - hostRect.width / 2;
    const left = Math.max(8, Math.min(centeredLeft, window.innerWidth - hostRect.width - 8));
    host.style.top = `${top}px`;
    host.style.left = `${left}px`;
  }
}

if (!customElements.get("annot-doc-selection-toolbar")) {
  customElements.define("annot-doc-selection-toolbar", AnnotDocSelectionToolbarElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-doc-selection-toolbar": AnnotDocSelectionToolbarElement;
  }
}
