/**
 * `<annot-save-menu>` — dropdown menu opened by the save split-
 * button's caret. Lists the export-format options ("Download
 * SVG", "Download PNG (re-editable)", "Download PPTX", etc.).
 *
 * Lit completion Phase 6b — the element's pre-existing
 * presentational shell now also owns the orchestration that used
 * to live in `toolbar-save-menu.ts`: building the items + actions
 * map for the current host (browser vs Tauri), positioning
 * relative to its anchor, and binding the outside-click /
 * resize / scroll cleanup. The pre-existing `openToolbarSaveMenu`
 * helper became `AnnotSaveMenuElement.openFor(anchor, ctx)`.
 *
 * The orchestrator (`Toolbar.#showSaveMenu`) is now a one-line
 * call to that static method; `toolbar-save-menu.ts` is gone.
 *
 * Light DOM (Hybrid CSS) so the existing
 * `.save-dropdown-menu` / `.copy-dropdown-item` rules in
 * `editor.css` apply unchanged.
 */

import {
  type CanvasManager,
  downloadAsImage,
  exportPptx,
  saveAsEditableImage,
  saveToFile,
} from "@ingcreators/annot-editor";
import { isTauri } from "@ingcreators/annot-core/tauri-bridge";
import { html, LitElement } from "../lit.js";

export interface SaveMenuItem {
  /** Identifier passed back in the `menu-select` event detail
   *  (e.g. "svg", "jpg-editable", "png-editable", "pptx"). */
  id: string;
  /** Visible row label ("Download SVG"). */
  label: string;
  /** Tooltip / sub-description ("Editable vector format"). */
  description: string;
}

export interface SaveMenuSelectDetail {
  id: string;
}

export interface SaveMenuContext {
  canvas: CanvasManager;
  /** Returns the current filename for the active document. May
   *  be `undefined` for ephemeral / new documents — the export
   *  helpers fall back to an auto-generated name in that case. */
  getCurrentFilename?: () => string | undefined;
}

let activeMenu: AnnotSaveMenuElement | null = null;

export class AnnotSaveMenuElement extends LitElement {
  static override properties = {
    items: { attribute: false },
    anchor: { attribute: false },
    actions: { attribute: false },
  };

  declare items: SaveMenuItem[];
  declare anchor: HTMLElement | null;
  declare actions: Record<string, () => void>;

  #onReposition: (() => void) | null = null;
  #onDocClick: ((e: MouseEvent) => void) | null = null;

  constructor() {
    super();
    this.items = [];
    this.anchor = null;
    this.actions = {};
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * Open (or toggle-close) the save dropdown anchored below
   * `anchor`. A second call with the same orchestrator context
   * closes the menu instead of stacking another instance —
   * matches the pre-Lit toolbar behaviour.
   */
  static openFor(anchor: HTMLElement, ctx: SaveMenuContext): void {
    if (activeMenu) {
      activeMenu.close();
      return;
    }
    const items: SaveMenuItem[] = [
      { id: "svg", label: "Download SVG", description: "Editable vector format" },
    ];
    const actions: Record<string, () => void> = {
      svg: () => saveToFile(ctx.canvas, ctx.getCurrentFilename?.()),
      pptx: () => exportPptx(ctx.canvas),
    };
    if (isTauri) {
      actions["jpg-editable"] = () =>
        saveAsEditableImage(ctx.canvas, "jpg", ctx.getCurrentFilename?.());
      actions["png-editable"] = () =>
        saveAsEditableImage(ctx.canvas, "png", ctx.getCurrentFilename?.());
      items.push(
        {
          id: "jpg-editable",
          label: "Save as JPG (re-editable)",
          description: "JPEG with embedded annotations",
        },
        {
          id: "png-editable",
          label: "Save as PNG (re-editable)",
          description: "PNG with embedded annotations",
        },
      );
    } else {
      actions["jpg-editable"] = () =>
        downloadAsImage(ctx.canvas, "jpg", ctx.getCurrentFilename?.());
      actions["png-editable"] = () =>
        downloadAsImage(ctx.canvas, "png", ctx.getCurrentFilename?.());
      items.push(
        {
          id: "jpg-editable",
          label: "Download JPG (re-editable)",
          description: "JPEG with embedded annotations",
        },
        {
          id: "png-editable",
          label: "Download PNG (re-editable)",
          description: "PNG with embedded annotations",
        },
      );
    }
    items.push({
      id: "pptx",
      label: "Download PPTX (PowerPoint)",
      description: "Editable PowerPoint slide with native shapes",
    });

    const el = document.createElement("annot-save-menu");
    el.items = items;
    el.actions = actions;
    el.anchor = anchor;
    document.body.appendChild(el);
    activeMenu = el;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Apply the menu chrome classes the existing CSS targets.
    this.classList.add("save-dropdown-menu", "copy-dropdown-menu");
    this.style.display = "flex";
    // Render into document.body with fixed positioning so the
    // menu escapes any ancestor `overflow: hidden` (the editor-
    // header has exactly that, which would otherwise clip the
    // dropdown the moment it appears below its anchor).
    this.style.position = "fixed";
    this.style.zIndex = "1000";
  }

  override disconnectedCallback(): void {
    this.#detachDocumentListeners();
    if (activeMenu === this) activeMenu = null;
    super.disconnectedCallback();
  }

  protected override firstUpdated(): void {
    if (!this.anchor) return;
    this.#reposition();
    this.#onReposition = () => this.#reposition();
    window.addEventListener("resize", this.#onReposition);
    window.addEventListener("scroll", this.#onReposition, true);

    // Defer the click-outside listener so the click that opened
    // the menu doesn't immediately close it.
    this.#onDocClick = (e: MouseEvent) => {
      if (this.contains(e.target as Node)) return;
      if (this.anchor?.contains(e.target as Node)) return;
      this.close();
    };
    setTimeout(() => {
      if (this.isConnected && this.#onDocClick) {
        document.addEventListener("click", this.#onDocClick);
      }
    }, 0);
  }

  override render() {
    return html`
      ${this.items.map(
        (item) => html`
          <button
            type="button"
            class="copy-dropdown-item"
            data-tooltip=${item.description}
            aria-label=${item.description}
            @click=${() => this.#select(item.id)}
          >
            ${item.label}
          </button>
        `,
      )}
    `;
  }

  /** Close + remove from the DOM. Idempotent. */
  close(): void {
    if (!this.isConnected) return;
    this.remove();
  }

  #reposition(): void {
    if (!this.anchor) return;
    const r = this.anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    // Show, measure, then compute the left edge so the menu
    // doesn't spill off the viewport on narrow windows.
    this.style.top = `${Math.round(r.bottom + 4)}px`;
    const mw = this.offsetWidth;
    let left = Math.round(r.right - mw);
    if (left < 8) left = 8;
    if (left + mw > vw - 8) left = vw - mw - 8;
    this.style.left = `${left}px`;
  }

  #select(id: string): void {
    this.dispatchEvent(
      new CustomEvent<SaveMenuSelectDetail>("menu-select", {
        detail: { id },
        bubbles: true,
      }),
    );
    this.actions[id]?.();
    this.close();
  }

  #detachDocumentListeners(): void {
    if (this.#onReposition) {
      window.removeEventListener("resize", this.#onReposition);
      window.removeEventListener("scroll", this.#onReposition, true);
      this.#onReposition = null;
    }
    if (this.#onDocClick) {
      document.removeEventListener("click", this.#onDocClick);
      this.#onDocClick = null;
    }
  }
}

if (!customElements.get("annot-save-menu")) {
  customElements.define("annot-save-menu", AnnotSaveMenuElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-save-menu": AnnotSaveMenuElement;
  }
}
