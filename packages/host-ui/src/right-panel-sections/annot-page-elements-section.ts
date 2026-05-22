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

import type { ElementNode, ElementTree } from "@ingcreators/annot-core";
import { builtinIcon } from "@ingcreators/annot-core";
import type { PageElement } from "@ingcreators/annot-core/storage";
import type { CanvasManager, History, SelectionManager } from "@ingcreators/annot-editor";
import { html, LitElement } from "../lit.js";
import type { UISection } from "../ui-section.js";
import "../annot-icon.js";
import {
  fullDescriptionFor,
  iconForElement,
  primaryLabelFor,
  SVG_NS,
  subLabelFor,
} from "./element-helpers.js";
import {
  type FlatTreeRow,
  flattenForTreeRender,
  fullDescriptionForNode,
  iconForElementNode,
  primaryLabelForNode,
  subLabelForNode,
} from "./element-node-helpers.js";
import type { PageMetadataLike } from "./types.js";

export class AnnotRightPanelPageElementsSectionElement extends LitElement {
  static override properties = {
    pageMetadata: { attribute: false },
    elementTree: { attribute: false },
    canvas: { attribute: false },
    history: { attribute: false },
    selection: { attribute: false },
    searchQuery: { state: true },
  };

  declare pageMetadata: PageMetadataLike | null;
  /** Canonical screen-capture tree — Phase 1f of
   *  `docs/plans/living-spec-authoring-roadmap.md`. When non-null,
   *  the section renders a hierarchical tree view of the
   *  `ElementTree` instead of the legacy flat list derived from
   *  `pageMetadata`. The two inputs are independent during the
   *  multi-PR migration; Phase 1i removes `pageMetadata` entirely. */
  declare elementTree: ElementTree | null;
  declare canvas: CanvasManager | null;
  declare history: History | null;
  declare selection: SelectionManager | null;
  declare searchQuery: string;

  /** Reused across hovers — cheap to keep one rect attached. */
  #hoverHighlight: SVGRectElement | null = null;

  constructor() {
    super();
    this.pageMetadata = null;
    this.elementTree = null;
    this.canvas = null;
    this.history = null;
    this.selection = null;
    this.searchQuery = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
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
          ${this.elementTree ? this.#renderTree() : this.#renderFlatList()}
        </div>
      </div>
    `;
  }

  /** Legacy flat-list rendering (PageMetadata path). Phase 1i
   *  removes this when PageMetadata itself is deleted. */
  #renderFlatList() {
    const filtered = this.#filteredElements();
    if (filtered.length === 0) {
      return html`<div class="editor-right-panel-elements-empty">
        ${this.searchQuery ? "No matches." : "No interactive elements detected."}
      </div>`;
    }
    return filtered.map(
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
          <span class="editor-right-panel-element-label">${primaryLabelFor(el)}</span>
          <span class="editor-right-panel-element-sub">${subLabelFor(el)}</span>
        </button>
      `,
    );
  }

  /** Tree-view rendering (ElementTree path). Each row is a
   *  flat-rendered button with `padding-inline-start` derived
   *  from depth \u2014 keeps the layout simple while still
   *  conveying the DOM hierarchy. */
  #renderTree() {
    const rows = this.#filteredTreeRows();
    if (rows.length === 0) {
      return html`<div class="editor-right-panel-elements-empty">
        ${this.searchQuery ? "No matches." : "No interactive elements detected."}
      </div>`;
    }
    return rows.map(
      (row: FlatTreeRow) => html`
        <button
          type="button"
          class="editor-right-panel-element-row"
          data-tooltip=${fullDescriptionForNode(row.node)}
          aria-label=${fullDescriptionForNode(row.node)}
          style="padding-inline-start: ${0.5 + row.depth * 0.875}rem;"
          @mouseenter=${() => this.#showHoverHighlightNode(row.node)}
          @mouseleave=${() => this.#clearHoverHighlight()}
          @click=${() => this.#annotateElementNode(row.node)}
        >
          <annot-icon
            class="editor-right-panel-element-icon"
            .spec=${builtinIcon(iconForElementNode(row.node))}
          ></annot-icon>
          <span class="editor-right-panel-element-label">${primaryLabelForNode(row.node)}</span>
          <span class="editor-right-panel-element-sub">${subLabelForNode(row.node)}</span>
        </button>
      `,
    );
  }

  /** Metadata changed — clear the search query so the new image's
   *  list renders without a stale filter, and drop the canvas
   *  hover highlight before it points at the old image. */
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("pageMetadata") || changed.has("elementTree")) {
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

  // ── ElementTree (tree-view) helpers — Phase 1f ─────────────────

  #filteredTreeRows(): FlatTreeRow[] {
    if (!this.elementTree) return [];
    const rows = flattenForTreeRender(this.elementTree.root);
    // Drop the synthetic root (`role: "document" | "generic"`) so the
    // visible tree starts at the page's first real child. The root
    // is informationally empty — it just holds the captureRect.
    const visible = rows.filter((r) => r.depth > 0);
    const q = this.searchQuery.toLowerCase();
    if (!q) return visible;
    return visible.filter((r) => this.#nodeMatchesQuery(r.node, q));
  }

  #nodeMatchesQuery(node: ElementNode, q: string): boolean {
    const haystack = [node.name, node.text, node.role, node.attributes?.placeholder].filter(
      (s): s is string => typeof s === "string",
    );
    return haystack.some((s) => s.toLowerCase().includes(q));
  }

  /** Convert an ElementNode's bbox (CSS px, document coords) to
   *  the canvas SVG's viewBox coords. Mirrors `#bboxOnScreenshot`
   *  but reads from `ElementTree.viewport.scale` instead of
   *  `pageMetadata.devicePixelRatio`. */
  #bboxOnScreenshotForNode(node: ElementNode): [number, number, number, number] | null {
    if (!this.elementTree || !node.bbox) return null;
    const dpr = this.elementTree.viewport.scale || 1;
    const root = this.elementTree.root;
    const origin = root.bbox ?? { x: 0, y: 0, width: 0, height: 0 };
    return [
      (node.bbox.x - origin.x) * dpr,
      (node.bbox.y - origin.y) * dpr,
      node.bbox.width * dpr,
      node.bbox.height * dpr,
    ];
  }

  #showHoverHighlightNode(node: ElementNode): void {
    if (!this.canvas) return;
    const bbox = this.#bboxOnScreenshotForNode(node);
    if (!bbox) return;
    const [x, y, w, h] = bbox;
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

  #annotateElementNode(node: ElementNode): void {
    if (!this.canvas || !this.history || !this.selection) return;
    const bbox = this.#bboxOnScreenshotForNode(node);
    if (!bbox) return;
    const [x, y, w, h] = bbox;
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
  /** Canonical screen-capture tree — Phase 1f. When the host
   *  populates this, the section renders a hierarchical tree view.
   *  Optional during the multi-PR migration; falls back to the
   *  legacy `getPageMetadata()` flat list when undefined / null. */
  getElementTree?(): ElementTree | null;
  getCanvas(): CanvasManager;
  getHistory(): History;
  getSelection(): SelectionManager;
}

export function createPageElementsSection(deps: PageElementsSectionDeps): UISection {
  let el: AnnotRightPanelPageElementsSectionElement | null = null;
  const sync = () => {
    if (!el) return;
    el.pageMetadata = deps.getPageMetadata();
    el.elementTree = deps.getElementTree?.() ?? null;
    el.canvas = deps.getCanvas();
    el.history = deps.getHistory();
    el.selection = deps.getSelection();
  };

  return {
    id: "right-panel.page-elements",
    title: "Elements",
    priority: 30,
    visible() {
      const tree = deps.getElementTree?.();
      if (tree && (tree.root.children?.length ?? 0) > 0) return true;
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
