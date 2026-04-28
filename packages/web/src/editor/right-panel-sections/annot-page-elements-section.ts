/**
 * Built-in `right-panel.page-elements` section — DOM-element list
 * sourced from the browser-extension's `pageMetadata` capture.
 * Lists interactive elements (buttons / links / inputs / …) that
 * fall within the screenshot's `captureRect`; hover highlights
 * them on the canvas via a translucent overlay; click inserts a
 * red annotation rectangle around the element's bbox.
 *
 * Lit Phase 2 — replaces the imperative render closure with a
 * `<annot-right-panel-page-elements-section>` element that owns
 * the search state, the filtered list render, and the hover /
 * click canvas manipulation.
 *
 * `visible(ctx)` gates on `pageMetadata` being non-null with at
 * least one element, so non-extension captures (paste / desktop /
 * legacy) skip the section's heading entirely.
 */

import type { CanvasManager } from "@ingcreators/annot-editor";
import type { History } from "@ingcreators/annot-editor";
import type { SelectionManager } from "@ingcreators/annot-editor";
import { builtinIcon } from "@ingcreators/annot-core";
import type { PageElement } from "@ingcreators/annot-core/storage";
import type { UISection } from "../../app/plugin-host.js";
import { html, LitElement } from "../../lit.js";
import "../../ui/annot-icon.js";
import {
  fullDescriptionFor,
  iconForElement,
  primaryLabelFor,
  SVG_NS,
  subLabelFor,
} from "./element-helpers.js";
import type { PageMetadataLike } from "./types.js";

export class AnnotRightPanelPageElementsSectionElement extends LitElement {
  static override properties = {
    pageMetadata: { attribute: false },
    canvas: { attribute: false },
    history: { attribute: false },
    selection: { attribute: false },
    searchQuery: { state: true },
  };

  declare pageMetadata: PageMetadataLike | null;
  declare canvas: CanvasManager | null;
  declare history: History | null;
  declare selection: SelectionManager | null;
  declare searchQuery: string;

  /** Reused across hovers — cheap to keep one rect attached. */
  #hoverHighlight: SVGRectElement | null = null;

  constructor() {
    super();
    this.pageMetadata = null;
    this.canvas = null;
    this.history = null;
    this.selection = null;
    this.searchQuery = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    const filtered = this.#filteredElements();
    return html`
      <div class="editor-right-panel-elements">
        <p class="editor-right-panel-elements-hint">Click to draw a box around it.</p>
        <input
          type="search"
          class="editor-right-panel-elements-search"
          placeholder="Search by text\u2026"
          .value=${this.searchQuery}
          @input=${this.#onSearchInput}
        />
        <div class="editor-right-panel-elements-list">
          ${filtered.length === 0
            ? html`<div class="editor-right-panel-elements-empty">
                ${this.searchQuery ? "No matches." : "No interactive elements detected."}
              </div>`
            : filtered.map(
                (el) => html`
                  <button
                    type="button"
                    class="editor-right-panel-element-row"
                    data-tooltip=${fullDescriptionFor(el)}
                    aria-label=${fullDescriptionFor(el)}
                    @mouseenter=${() => this.#showHoverHighlight(el)}
                    @mouseleave=${() => this.#clearHoverHighlight()}
                    @click=${() => this.#annotateElement(el)}
                  >
                    <annot-icon
                      class="editor-right-panel-element-icon"
                      .spec=${builtinIcon(iconForElement(el))}
                    ></annot-icon>
                    <span class="editor-right-panel-element-label"
                      >${primaryLabelFor(el)}</span
                    >
                    <span class="editor-right-panel-element-sub"
                      >${subLabelFor(el)}</span
                    >
                  </button>
                `,
              )}
        </div>
      </div>
    `;
  }

  /** Metadata changed — clear the search query so the new image's
   *  list renders without a stale filter, and drop the canvas
   *  hover highlight before it points at the old image. */
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("pageMetadata")) {
      this.searchQuery = "";
      this.#clearHoverHighlight();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#hoverHighlight?.remove();
    this.#hoverHighlight = null;
  }

  #onSearchInput = (e: Event): void => {
    this.searchQuery = (e.currentTarget as HTMLInputElement).value;
  };

  #filteredElements(): PageElement[] {
    const meta = this.pageMetadata;
    if (!meta) return [];
    // Filter against the metadata's `captureRect` (the doc-coord
    // rectangle the screenshot covers). For area captures this is
    // a small sub-region — without this filter we'd surface every
    // element on the page with screenshot-coord garbage. Element
    // is "in bounds" if its bbox INTERSECTS captureRect at all.
    // Defensive: older metadata records may not have captureRect;
    // fall back to scrollOffset + viewport.
    const cr = meta.captureRect ?? {
      x: meta.scrollOffset.x,
      y: meta.scrollOffset.y,
      width: meta.viewport.width,
      height: meta.viewport.height,
    };
    const inBounds = (el: PageElement): boolean => {
      const [x, y, w, h] = el.bbox;
      return x + w > cr.x && y + h > cr.y && x < cr.x + cr.width && y < cr.y + cr.height;
    };
    const q = this.searchQuery.toLowerCase();
    const matchesQuery = (el: PageElement): boolean => {
      if (!q) return true;
      return [el.text, el.ariaLabel, el.role, el.placeholder, el.tag, el.href].some((s) =>
        s?.toLowerCase().includes(q),
      );
    };
    return meta.elements.filter((e) => inBounds(e) && matchesQuery(e));
  }

  /** Convert an element's document-coords bbox (from metadata) to
   *  the canvas SVG's viewBox coords (which equal the screenshot's
   *  device-pixel dimensions). Origin is `captureRect`. CSS px →
   *  device px via DPR. */
  #bboxOnScreenshot(el: PageElement): [number, number, number, number] {
    const meta = this.pageMetadata;
    if (!meta) return [0, 0, 0, 0];
    const dpr = meta.devicePixelRatio || 1;
    const ox = meta.captureRect.x;
    const oy = meta.captureRect.y;
    const [x, y, w, h] = el.bbox;
    return [(x - ox) * dpr, (y - oy) * dpr, w * dpr, h * dpr];
  }

  /** Draw a translucent outline rect on the canvas SVG at the
   *  given element's bbox. Reuses one rect across hovers (cheap). */
  #showHoverHighlight(el: PageElement): void {
    if (!this.canvas) return;
    const [x, y, w, h] = this.#bboxOnScreenshot(el);
    if (!this.#hoverHighlight) {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", "#ff00a8");
      rect.setAttribute("stroke-width", "2");
      rect.setAttribute("vector-effect", "non-scaling-stroke");
      rect.setAttribute("pointer-events", "none");
      rect.setAttribute("data-role", "elements-hover");
      this.canvas.svg.appendChild(rect);
      this.#hoverHighlight = rect;
    }
    this.#hoverHighlight.setAttribute("x", String(x));
    this.#hoverHighlight.setAttribute("y", String(y));
    this.#hoverHighlight.setAttribute("width", String(w));
    this.#hoverHighlight.setAttribute("height", String(h));
    this.#hoverHighlight.setAttribute("opacity", "1");
  }

  #clearHoverHighlight(): void {
    if (this.#hoverHighlight) this.#hoverHighlight.setAttribute("opacity", "0");
  }

  /** Insert a red rectangle annotation around the element's bbox.
   *  The new rect lands in `#annotations` (so it exports / saves
   *  like any user-drawn rect) and becomes the selection so the
   *  user can immediately tweak it via the Property panel. */
  #annotateElement(el: PageElement): void {
    if (!this.canvas || !this.history || !this.selection) return;
    const [x, y, w, h] = this.#bboxOnScreenshot(el);
    if (w < 1 || h < 1) return;
    this.#clearHoverHighlight();
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "#ff0000");
    rect.setAttribute("stroke-width", "3");
    this.canvas.annotations.appendChild(rect);
    this.history.save();
    this.selection.select(rect);
  }
}

if (!customElements.get("annot-right-panel-page-elements-section")) {
  customElements.define(
    "annot-right-panel-page-elements-section",
    AnnotRightPanelPageElementsSectionElement,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-right-panel-page-elements-section": AnnotRightPanelPageElementsSectionElement;
  }
}

export interface PageElementsSectionDeps {
  getPageMetadata(): PageMetadataLike | null;
  getCanvas(): CanvasManager;
  getHistory(): History;
  getSelection(): SelectionManager;
}

export function createPageElementsSection(deps: PageElementsSectionDeps): UISection {
  let el: AnnotRightPanelPageElementsSectionElement | null = null;
  const sync = () => {
    if (!el) return;
    el.pageMetadata = deps.getPageMetadata();
    el.canvas = deps.getCanvas();
    el.history = deps.getHistory();
    el.selection = deps.getSelection();
  };

  return {
    id: "right-panel.page-elements",
    title: "Elements",
    priority: 30,
    visible() {
      const meta = deps.getPageMetadata();
      return Boolean(meta && meta.elements.length > 0);
    },
    mount(container) {
      el = document.createElement("annot-right-panel-page-elements-section");
      container.appendChild(el);
      sync();
      return {
        update() {
          sync();
        },
        unmount() {
          el?.remove();
          el = null;
        },
      };
    },
  };
}
