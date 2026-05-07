/**
 * `<annot-context-menu>` — singleton popover menu used by the
 * gallery (3-dot button, right-click on cards) and other call
 * sites.
 *
 * Lit completion Phase 5 — replaces the imperative
 * `context-menu.ts` module. The public surface is preserved as
 * the `openContextMenu({ x, y, items })` /
 * `closeContextMenu()` function pair so callers don't need to
 * change. Internally:
 *
 *   - `openContextMenu` closes any active singleton, creates a
 *     fresh `<annot-context-menu>`, sets `.x` / `.y` /
 *     `.items`, and appends it to `document.body`. The element
 *     positions itself inside the viewport on `firstUpdated`,
 *     focuses the first item, and registers
 *     outside-click / Esc / scroll / arrow-key listeners on
 *     `document` while connected.
 *   - The element removes itself when an item action runs, the
 *     user clicks outside, presses Escape, or scrolls. The
 *     listener cleanup is in `disconnectedCallback`.
 *
 * Light DOM (Hybrid CSS) so the existing `.context-menu` /
 * `.context-menu-item` rules in `file-manager.css` apply
 * unchanged.
 */

import { builtinIcon } from "@ingcreators/annot-core";
import { html, LitElement } from "../lit.js";
import "../annot-icon.js";

export interface MenuItem {
  /** Material Symbols icon name. */
  icon: string;
  label: string;
  action: () => void | Promise<void>;
  /** If true, styled as a destructive (red) action. */
  danger?: boolean;
}

export interface OpenContextMenuOptions {
  /** Viewport X (clientX). */
  x: number;
  /** Viewport Y (clientY). */
  y: number;
  items: MenuItem[];
}

let activeMenu: AnnotContextMenuElement | null = null;

export class AnnotContextMenuElement extends LitElement {
  static override properties = {
    x: { attribute: false },
    y: { attribute: false },
    items: { attribute: false },
  };

  declare x: number;
  declare y: number;
  declare items: MenuItem[];

  #onDocClick: ((e: MouseEvent) => void) | null = null;
  #onKey: ((e: KeyboardEvent) => void) | null = null;
  #onScroll: (() => void) | null = null;

  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.items = [];
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("context-menu");
    this.setAttribute("role", "menu");
    // Position off-screen until firstUpdated has measured the
    // rendered size — matches the pre-Lit two-pass positioning.
    this.style.left = "-9999px";
    this.style.top = "-9999px";
  }

  override disconnectedCallback(): void {
    this.#detachDocumentListeners();
    if (activeMenu === this) activeMenu = null;
    super.disconnectedCallback();
  }

  override render() {
    return html`
      ${this.items.map(
        (item) => html`
          <button
            type="button"
            role="menuitem"
            class=${`context-menu-item${item.danger ? " context-menu-item-danger" : ""}`}
            @click=${(e: MouseEvent) => this.#onItemClick(e, item)}
          >
            <annot-icon
              class="context-menu-icon"
              .spec=${builtinIcon(item.icon)}
            ></annot-icon>
            <span>${item.label}</span>
          </button>
        `,
      )}
    `;
  }

  protected override firstUpdated(): void {
    // Position inside viewport
    const { width, height } = this.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(this.x, vw - width - 8);
    const top = Math.min(this.y, vh - height - 8);
    this.style.left = `${Math.max(8, left)}px`;
    this.style.top = `${Math.max(8, top)}px`;

    // Focus first item for keyboard access
    (this.firstElementChild as HTMLElement | null)?.focus();

    // Defer document-listener attach so the originating click
    // doesn't immediately close the menu it just opened.
    this.#onDocClick = (e: MouseEvent) => {
      if (!this.contains(e.target as Node)) this.close();
    };
    this.#onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.close();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = Array.from(this.querySelectorAll<HTMLElement>(".context-menu-item"));
        const idx = items.findIndex((el) => el === document.activeElement);
        const nextIdx =
          e.key === "ArrowDown"
            ? (idx + 1) % items.length
            : (idx - 1 + items.length) % items.length;
        items[nextIdx]?.focus();
      }
    };
    this.#onScroll = () => this.close();

    requestAnimationFrame(() => {
      // The menu may already have been closed by the time the
      // RAF fires (action ran synchronously). Skip in that case.
      if (!this.isConnected) return;
      document.addEventListener("mousedown", this.#onDocClick!);
      document.addEventListener("keydown", this.#onKey!);
      window.addEventListener("scroll", this.#onScroll!, true);
    });
  }

  /** Close + remove from the DOM. Idempotent. */
  close(): void {
    if (!this.isConnected) return;
    this.remove();
  }

  #onItemClick = async (e: MouseEvent, item: MenuItem): Promise<void> => {
    e.stopPropagation();
    this.close();
    try {
      await item.action();
    } catch (err) {
      console.error("[context-menu]", err);
    }
  };

  #detachDocumentListeners(): void {
    if (this.#onDocClick) document.removeEventListener("mousedown", this.#onDocClick);
    if (this.#onKey) document.removeEventListener("keydown", this.#onKey);
    if (this.#onScroll) window.removeEventListener("scroll", this.#onScroll, true);
    this.#onDocClick = null;
    this.#onKey = null;
    this.#onScroll = null;
  }
}

if (!customElements.get("annot-context-menu")) {
  customElements.define("annot-context-menu", AnnotContextMenuElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-context-menu": AnnotContextMenuElement;
  }
}

/** Show a floating menu at (x, y). Closes any previously-open
 *  menu. Pre-Lit API parity — call sites (gallery card 3-dot
 *  button, gallery card right-click, …) don't change. */
export function openContextMenu(opts: OpenContextMenuOptions): void {
  closeContextMenu();
  const el = document.createElement("annot-context-menu");
  el.x = opts.x;
  el.y = opts.y;
  el.items = opts.items;
  document.body.appendChild(el);
  activeMenu = el;
}

/** Close any open context menu — useful on navigation or
 *  storage switch. */
export function closeContextMenu(): void {
  if (activeMenu) {
    activeMenu.close();
    activeMenu = null;
  }
}
