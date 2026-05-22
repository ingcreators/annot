/**
 * Built-in `right-panel.page-elements` section — DOM-element list
 * sourced from the `ElementTree` snapshot captured alongside the
 * screenshot (browser extension's MAIN-world walker, Playwright's
 * adapter, or any other capture source). Renders the tree as a
 * hierarchical list; hover highlights each element on the canvas
 * via a translucent overlay; click inserts a red annotation
 * rectangle around the element's bbox.
 *
 * `visible(ctx)` gates on the tree having at least one named
 * child, so non-DOM captures (paste / desktop / legacy) skip the
 * section's heading entirely.
 */

import type { ElementNode, ElementTree } from "@ingcreators/annot-core";
import { builtinIcon } from "@ingcreators/annot-core";
import type { CanvasManager, History, SelectionManager } from "@ingcreators/annot-editor";
import { html, LitElement } from "../lit.js";
import type { UISection } from "../ui-section.js";
import "../annot-icon.js";
import {
  type FlatTreeRow,
  flattenForTreeRender,
  fullDescriptionForNode,
  iconForElementNode,
  primaryLabelForNode,
  SVG_NS,
  subLabelForNode,
} from "./element-node-helpers.js";

export class AnnotRightPanelPageElementsSectionElement extends LitElement {
  static override properties = {
    elementTree: { attribute: false },
    canvas: { attribute: false },
    history: { attribute: false },
    selection: { attribute: false },
    searchQuery: { state: true },
  };

  /** Canonical screen-capture tree. The section renders a
   *  hierarchical view of this tree and hides itself when null
   *  (paste / desktop / legacy captures). */
  declare elementTree: ElementTree | null;
  declare canvas: CanvasManager | null;
  declare history: History | null;
  declare selection: SelectionManager | null;
  declare searchQuery: string;

  /** Reused across hovers — cheap to keep one rect attached. */
  #hoverHighlight: SVGRectElement | null = null;

  constructor() {
    super();
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
          placeholder="Search by text…"
          .value=${this.searchQuery}
          @input=${this.#onSearchInput}
        />
        <div class="editor-right-panel-elements-list">${this.#renderTree()}</div>
      </div>
    `;
  }

  /** Tree-view rendering. Each row is a flat-rendered button with
   *  `padding-inline-start` derived from depth — keeps the layout
   *  simple while still conveying the DOM hierarchy. */
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

  /** Tree changed — clear the search query so the new image's
   *  list renders without a stale filter, and drop the canvas
   *  hover highlight before it points at the old image. */
  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("elementTree")) {
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
   *  the canvas SVG's viewBox coords (which equal the screenshot's
   *  device-pixel dimensions). Origin is the tree's root bbox; CSS
   *  px → device px via `viewport.scale`. */
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

  /** Draw a translucent outline rect on the canvas SVG at the
   *  given node's bbox. Reuses one rect across hovers (cheap). */
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

  #clearHoverHighlight(): void {
    if (this.#hoverHighlight) this.#hoverHighlight.setAttribute("opacity", "0");
  }

  /** Insert a red rectangle annotation around the node's bbox.
   *  The new rect lands in `#annotations` (so it exports / saves
   *  like any user-drawn rect) and becomes the selection so the
   *  user can immediately tweak it via the Property panel. */
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
  /** Canonical screen-capture tree. Returns null when the host
   *  has no tree for the current image (paste / desktop / legacy
   *  capture) — the section then hides itself. */
  getElementTree(): ElementTree | null;
  getCanvas(): CanvasManager;
  getHistory(): History;
  getSelection(): SelectionManager;
}

export function createPageElementsSection(deps: PageElementsSectionDeps): UISection {
  let el: AnnotRightPanelPageElementsSectionElement | null = null;
  const sync = () => {
    if (!el) return;
    el.elementTree = deps.getElementTree();
    el.canvas = deps.getCanvas();
    el.history = deps.getHistory();
    el.selection = deps.getSelection();
  };

  return {
    id: "right-panel.page-elements",
    title: "Elements",
    priority: 30,
    visible() {
      const tree = deps.getElementTree();
      return Boolean(tree && (tree.root.children?.length ?? 0) > 0);
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
