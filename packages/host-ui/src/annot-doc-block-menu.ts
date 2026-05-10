/**
 * `<annot-doc-block-menu>` — slash-menu / block-kind picker for
 * `<annot-doc-shell>` editing mode.
 *
 * Phase 4b of `docs/plans/annot-html-document.md`. Opens when the
 * user types `/` in an empty contentEditable text block; the
 * shell anchors the menu to the editable element and the user
 * picks the kind of block they want next. The plan calls for
 * "reusing the existing `<annot-tool-flyout>` chrome"; this
 * implementation borrows the styling shape (light DOM popup with
 * absolute positioning + outside-click dismiss + Esc dismiss)
 * without an actual code reuse — `<annot-tool-flyout>` is shaped
 * around the editor toolbar variant chips, and the surfaces are
 * different enough that a shared base would obscure both.
 *
 * Light DOM (Hybrid CSS) following the host-ui convention.
 */

import { html, LitElement, type TemplateResult } from "./lit.js";

export type BlockMenuKind =
  | "heading"
  | "paragraph"
  | "list"
  | "code"
  | "quote"
  | "callout"
  | "divider"
  | "image";

export interface BlockMenuItem {
  /** Stable id used for keyboard / test selection. */
  readonly id: string;
  /** User-visible label in the dropdown. */
  readonly label: string;
  /** Optional one-line description shown to the right of label. */
  readonly description?: string;
  /** Discriminator for the chosen block kind. */
  readonly kind: BlockMenuKind;
  /** Heading level (1 / 2 / 3) — only relevant for `heading`. */
  readonly level?: 1 | 2 | 3;
  /** Whether the list is ordered — only relevant for `list`. */
  readonly listOrdered?: boolean;
  /** Callout tone — only relevant for `callout`. */
  readonly tone?: "info" | "warn" | "note";
}

export interface BlockMenuSelectDetail {
  item: BlockMenuItem;
}

/** Default v1 catalog — covers every block kind reachable from
 *  the slash menu. Image blocks intentionally omitted — Phase 5
 *  introduces them via a different (capture-driven) flow. */
export const DEFAULT_BLOCK_MENU_ITEMS: readonly BlockMenuItem[] = [
  { id: "h1", label: "Heading 1", kind: "heading", level: 1 },
  { id: "h2", label: "Heading 2", kind: "heading", level: 2 },
  { id: "h3", label: "Heading 3", kind: "heading", level: 3 },
  { id: "paragraph", label: "Paragraph", kind: "paragraph" },
  { id: "ul", label: "Bulleted list", kind: "list", listOrdered: false },
  { id: "ol", label: "Numbered list", kind: "list", listOrdered: true },
  { id: "code", label: "Code block", kind: "code" },
  { id: "quote", label: "Quote", kind: "quote" },
  {
    id: "callout-info",
    label: "Callout",
    description: "Info",
    kind: "callout",
    tone: "info",
  },
  {
    id: "callout-warn",
    label: "Callout",
    description: "Warning",
    kind: "callout",
    tone: "warn",
  },
  {
    id: "callout-note",
    label: "Callout",
    description: "Note",
    kind: "callout",
    tone: "note",
  },
  { id: "divider", label: "Divider", kind: "divider" },
  {
    id: "image",
    label: "Image",
    description: "From file",
    kind: "image",
  },
];

let activeMenu: AnnotDocBlockMenuElement | null = null;

export class AnnotDocBlockMenuElement extends LitElement {
  static override properties = {
    items: { attribute: false },
    anchor: { attribute: false },
    activeIndex: { state: true },
  };

  declare items: readonly BlockMenuItem[];
  declare anchor: HTMLElement | null;
  declare activeIndex: number;

  #onDocClick: ((e: MouseEvent) => void) | null = null;
  #onDocKeydown: ((e: KeyboardEvent) => void) | null = null;
  #onReposition: (() => void) | null = null;

  constructor() {
    super();
    this.items = DEFAULT_BLOCK_MENU_ITEMS;
    this.anchor = null;
    this.activeIndex = 0;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Open the menu anchored to `anchor`. Replaces any previously-
   *  open instance (slash-menu is single-instance; the rare double-
   *  open is treated as "user changed their mind, anchor here"). */
  static openFor(
    anchor: HTMLElement,
    opts: { items?: readonly BlockMenuItem[] } = {},
  ): AnnotDocBlockMenuElement {
    activeMenu?.close();
    const el = document.createElement("annot-doc-block-menu") as AnnotDocBlockMenuElement;
    if (opts.items) el.items = opts.items;
    el.anchor = anchor;
    document.body.appendChild(el);
    activeMenu = el;
    // Position once we're attached + have measurable bounds.
    queueMicrotask(() => el.#reposition());
    return el;
  }

  static closeActive(): void {
    activeMenu?.close();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#onDocClick = (e) => {
      // A click that originates inside the menu shouldn't dismiss
      // it; capture-phase dismissal handles all other clicks.
      if (this.contains(e.target as Node)) return;
      this.close();
    };
    this.#onDocKeydown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.activeIndex = (this.activeIndex + 1) % this.items.length;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.activeIndex = (this.activeIndex - 1 + this.items.length) % this.items.length;
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = this.items[this.activeIndex];
        if (it) this.#select(it);
      }
    };
    this.#onReposition = () => this.#reposition();
    // `capture: true` so we see the click before any descendant
    // handler can stopPropagation.
    document.addEventListener("mousedown", this.#onDocClick, { capture: true });
    document.addEventListener("keydown", this.#onDocKeydown, { capture: true });
    window.addEventListener("resize", this.#onReposition);
    window.addEventListener("scroll", this.#onReposition, { capture: true });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#onDocClick) {
      document.removeEventListener("mousedown", this.#onDocClick, { capture: true });
      this.#onDocClick = null;
    }
    if (this.#onDocKeydown) {
      document.removeEventListener("keydown", this.#onDocKeydown, { capture: true });
      this.#onDocKeydown = null;
    }
    if (this.#onReposition) {
      window.removeEventListener("resize", this.#onReposition);
      window.removeEventListener("scroll", this.#onReposition, { capture: true });
      this.#onReposition = null;
    }
    if (activeMenu === this) activeMenu = null;
  }

  override render(): TemplateResult {
    return html`
      <div class="annot-doc-block-menu" role="listbox" aria-label="Choose block kind">
        ${this.items.map((item, idx) => {
          const active = idx === this.activeIndex;
          return html`
            <button
              type="button"
              role="option"
              aria-selected=${active ? "true" : "false"}
              class="annot-doc-block-menu-item ${active ? "active" : ""}"
              data-block-menu-id=${item.id}
              @mouseenter=${() => {
                this.activeIndex = idx;
              }}
              @click=${() => this.#select(item)}
            >
              <span class="annot-doc-block-menu-label">${item.label}</span>
              ${
                item.description
                  ? html`<span class="annot-doc-block-menu-desc">${item.description}</span>`
                  : ""
              }
            </button>
          `;
        })}
      </div>
    `;
  }

  close(): void {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  #select(item: BlockMenuItem): void {
    this.dispatchEvent(
      new CustomEvent<BlockMenuSelectDetail>("block-menu-select", {
        bubbles: true,
        composed: true,
        detail: { item },
      }),
    );
    this.close();
  }

  #reposition(): void {
    if (!this.anchor) return;
    const anchorRect = this.anchor.getBoundingClientRect();
    this.style.position = "fixed";
    this.style.zIndex = "1000";
    // Measure once placed in DOM so the height / width is real.
    // The element is `display: block` with a max-height of
    // 360px; on first call its size is whatever it laid out
    // to. We try below the anchor first; if the bottom edge
    // would clip the viewport AND there's more room above,
    // flip upwards. Mirrors the standard `Popper` "auto"
    // placement heuristic.
    const menuRect = this.getBoundingClientRect();
    const margin = 4;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const menuH = menuRect.height || 360; // fallback to max-height
    const menuW = menuRect.width || 240; // fallback to declared width

    const spaceBelow = viewportH - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    let top: number;
    if (spaceBelow >= menuH + margin || spaceBelow >= spaceAbove) {
      // Fits below or below has more room — anchor below.
      top = anchorRect.bottom + margin;
      // If even below isn't enough, clamp to the viewport so
      // some of the menu remains visible + the user can scroll
      // it.
      if (top + menuH > viewportH - margin) {
        top = Math.max(margin, viewportH - menuH - margin);
      }
    } else {
      // More room above — anchor above the trigger.
      top = anchorRect.top - menuH - margin;
      if (top < margin) top = margin;
    }

    // Horizontal: keep within the viewport, prefer the
    // anchor's left edge.
    let left = anchorRect.left;
    if (left + menuW > viewportW - margin) {
      left = Math.max(margin, viewportW - menuW - margin);
    }
    if (left < margin) left = margin;

    this.style.top = `${top}px`;
    this.style.left = `${left}px`;
  }
}

customElements.define("annot-doc-block-menu", AnnotDocBlockMenuElement);

declare global {
  interface HTMLElementTagNameMap {
    "annot-doc-block-menu": AnnotDocBlockMenuElement;
  }
}
