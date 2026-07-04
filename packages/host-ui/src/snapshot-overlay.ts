/**
 * `<annot-snapshot-overlay>` — a hover-pickable rendering of the
 * page's `ElementTree` regions, used by the Overlay tool (Phase 4d)
 * as the click target for adding numbered-badge overlays. Each
 * `ElementNode` with a `bbox` becomes a semi-transparent rect over
 * the underlying screenshot; hover highlights one region; click
 * fires an `overlay-region-pick` CustomEvent with the picked
 * node's `ref` / `role` / `name?` / `bbox`.
 *
 * Phase 4c of
 * [`docs/plans/living-spec-authoring-roadmap.md`](../../../docs/plans/living-spec-authoring-roadmap.md).
 *
 * The element hosts an inline `<svg>` sized to the captured
 * viewport (CSS px), with `viewBox="0 0 viewport.width viewport.height"`
 * so the host element's CSS size scales the rects naturally.
 * Mount the host absolutely over the canvas (`position: absolute;
 * inset: 0`) for a 1:1 overlay; the tool wires this up in Phase
 * 4d/4e.
 *
 * Decoupled from the OverlayTool — usable as a standalone
 * hover-pick surface for any future tool that needs to point at
 * snapshot elements (e.g. a card-document `<AnnotCardStep target>`
 * picker).
 *
 * Light DOM (Hybrid CSS): the element's own styles live below in
 * the `static styles` block so it stays self-contained without
 * relying on a host stylesheet.
 */

import type { OverlayRegionPickDetail } from "@ingcreators/annot-core/editor";
import type { ElementNode, ElementTree } from "@ingcreators/annot-core/element-tree";
import { findByRef } from "@ingcreators/annot-core/element-tree";
import { css, html, LitElement, svg } from "./lit.js";

export type { OverlayRegionPickDetail } from "@ingcreators/annot-core/editor";

/**
 * One ready-to-render region — derived from an `ElementNode` with a
 * bbox. Exposed for tests that want to assert the collected set
 * without rebuilding their own walker.
 */
export interface SnapshotOverlayRegion {
  ref: string;
  role: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Walk an `ElementTree` and collect every node with a bbox. Deep-first,
 * preserves document order, skips nodes whose bbox is degenerate
 * (zero area) — those aren't useful click targets.
 */
export function collectSnapshotRegions(tree: ElementTree | undefined): SnapshotOverlayRegion[] {
  if (!tree) return [];
  const out: SnapshotOverlayRegion[] = [];
  const visit = (node: ElementNode): void => {
    if (node.bbox && node.bbox.width > 0 && node.bbox.height > 0) {
      out.push({
        ref: node.ref,
        role: node.role,
        name: node.name,
        x: node.bbox.x,
        y: node.bbox.y,
        width: node.bbox.width,
        height: node.bbox.height,
      });
    }
    if (node.children) {
      for (const child of node.children) visit(child);
    }
  };
  visit(tree.root);
  return out;
}

export class AnnotSnapshotOverlayElement extends LitElement {
  static override properties = {
    elementTree: { attribute: false },
    highlightedRef: { attribute: false },
  };

  declare elementTree: ElementTree | undefined;
  /** When set, the matching region renders in the "hovered" style
   *  even without a real pointer hover. Useful for tools that want
   *  to drive the highlight from outside (e.g. keyboard navigation,
   *  "fly to next region" affordance). */
  declare highlightedRef: string | undefined;

  static override styles = css`
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
      display: block;
    }
    svg {
      width: 100%;
      height: 100%;
      display: block;
      pointer-events: none;
    }
    rect {
      fill: rgba(80, 144, 224, 0.08);
      stroke: rgba(80, 144, 224, 0.35);
      stroke-width: 1;
      pointer-events: auto;
      cursor: pointer;
      transition:
        fill 0.1s ease-out,
        stroke 0.1s ease-out,
        stroke-width 0.1s ease-out;
    }
    rect:hover,
    rect[data-highlighted="true"] {
      fill: rgba(80, 144, 224, 0.25);
      stroke: rgba(80, 144, 224, 0.85);
      stroke-width: 2;
    }
  `;

  constructor() {
    super();
    this.elementTree = undefined;
    this.highlightedRef = undefined;
  }

  protected override render() {
    if (!this.elementTree) {
      return html`<svg aria-hidden="true"></svg>`;
    }
    const { width, height } = this.elementTree.viewport;
    const regions = collectSnapshotRegions(this.elementTree);
    return html`
      <svg
        viewBox="0 0 ${width} ${height}"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        ${regions.map(
          (r) => svg`
            <rect
              x=${r.x}
              y=${r.y}
              width=${r.width}
              height=${r.height}
              data-ref=${r.ref}
              data-highlighted=${r.ref === this.highlightedRef ? "true" : "false"}
              @click=${this.#onRegionClick}
            ></rect>
          `,
        )}
      </svg>
    `;
  }

  #onRegionClick = (e: MouseEvent): void => {
    e.stopPropagation();
    const rect = e.currentTarget as SVGRectElement | null;
    const ref = rect?.dataset.ref;
    if (!ref || !this.elementTree) return;
    const node = findByRef(this.elementTree, ref);
    if (!node?.bbox) return;
    const detail: OverlayRegionPickDetail = {
      ref: node.ref,
      role: node.role,
      bbox: { ...node.bbox },
    };
    if (node.name) detail.name = node.name;
    this.dispatchEvent(
      new CustomEvent<OverlayRegionPickDetail>("overlay-region-pick", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  };
}

if (!customElements.get("annot-snapshot-overlay")) {
  customElements.define("annot-snapshot-overlay", AnnotSnapshotOverlayElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-snapshot-overlay": AnnotSnapshotOverlayElement;
  }
  interface HTMLElementEventMap {
    "overlay-region-pick": CustomEvent<OverlayRegionPickDetail>;
  }
}
