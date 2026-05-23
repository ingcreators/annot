/**
 * @vitest-environment happy-dom
 *
 * `<annot-snapshot-overlay>` tests — Phase 4c of
 * `docs/plans/living-spec-authoring-roadmap.md`.
 *
 * Covers:
 *   1. `collectSnapshotRegions` — flattens an ElementTree's bbox-bearing
 *      nodes; skips zero-area bboxes; preserves document order.
 *   2. Element renders one `<rect>` per region, sized from the bbox.
 *   3. `viewBox` matches the tree's `viewport`.
 *   4. Click on a region dispatches `overlay-region-pick` with the
 *      picked node's `ref` / `role` / `name?` / `bbox`.
 *   5. `highlightedRef` sets `data-highlighted="true"` on the matching
 *      rect (programmatic hover for external sync).
 */

import type { ElementTree } from "@ingcreators/annot-core/element-tree";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./snapshot-overlay.js";
import type { AnnotSnapshotOverlayElement, OverlayRegionPickDetail } from "./snapshot-overlay.js";
import { collectSnapshotRegions } from "./snapshot-overlay.js";

const SAMPLE_TREE: ElementTree = {
  version: 1,
  source: {
    kind: "playwright",
    capturedAt: "2026-05-23T10:00:00Z",
  },
  viewport: { width: 800, height: 600, scale: 2 },
  root: {
    ref: "e1",
    role: "main",
    bbox: { x: 0, y: 0, width: 800, height: 600 },
    children: [
      {
        ref: "e2",
        role: "textbox",
        name: "Email",
        bbox: { x: 100, y: 200, width: 300, height: 40 },
      },
      {
        ref: "e3",
        role: "textbox",
        name: "Password",
        bbox: { x: 100, y: 260, width: 300, height: 40 },
      },
      {
        // Decorative node with no bbox — should be skipped.
        ref: "e4",
        role: "presentation",
      },
      {
        // Zero-area bbox — should be skipped.
        ref: "e5",
        role: "generic",
        bbox: { x: 0, y: 0, width: 0, height: 0 },
      },
      {
        ref: "e6",
        role: "button",
        name: "Sign in",
        bbox: { x: 100, y: 340, width: 100, height: 36 },
      },
    ],
  },
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("collectSnapshotRegions", () => {
  it("returns [] when tree is undefined", () => {
    expect(collectSnapshotRegions(undefined)).toEqual([]);
  });

  it("flattens bbox-bearing nodes in document order", () => {
    const regions = collectSnapshotRegions(SAMPLE_TREE);
    expect(regions.map((r) => r.ref)).toEqual(["e1", "e2", "e3", "e6"]);
  });

  it("skips nodes with no bbox", () => {
    const regions = collectSnapshotRegions(SAMPLE_TREE);
    expect(regions.find((r) => r.ref === "e4")).toBeUndefined();
  });

  it("skips nodes with zero-area bbox", () => {
    const regions = collectSnapshotRegions(SAMPLE_TREE);
    expect(regions.find((r) => r.ref === "e5")).toBeUndefined();
  });

  it("includes role + name + bbox coords", () => {
    const regions = collectSnapshotRegions(SAMPLE_TREE);
    const email = regions.find((r) => r.ref === "e2");
    expect(email).toEqual({
      ref: "e2",
      role: "textbox",
      name: "Email",
      x: 100,
      y: 200,
      width: 300,
      height: 40,
    });
  });
});

describe("<annot-snapshot-overlay>", () => {
  function mount(): AnnotSnapshotOverlayElement {
    const el = document.createElement("annot-snapshot-overlay");
    document.body.appendChild(el);
    return el;
  }

  it("renders no rects when elementTree is undefined", async () => {
    const el = mount();
    await el.updateComplete;
    const rects = el.shadowRoot?.querySelectorAll("rect");
    expect(rects?.length ?? 0).toBe(0);
  });

  it("renders one <rect> per bbox-bearing node", async () => {
    const el = mount();
    el.elementTree = SAMPLE_TREE;
    await el.updateComplete;
    const rects = el.shadowRoot?.querySelectorAll("rect");
    expect(rects?.length).toBe(4);
  });

  it("sizes the SVG viewBox from the tree viewport", async () => {
    const el = mount();
    el.elementTree = SAMPLE_TREE;
    await el.updateComplete;
    const svg = el.shadowRoot?.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 800 600");
  });

  it("dispatches overlay-region-pick on click with the picked node's data", async () => {
    const el = mount();
    el.elementTree = SAMPLE_TREE;
    await el.updateComplete;
    const handler = vi.fn();
    el.addEventListener("overlay-region-pick", handler as EventListener);
    const emailRect = el.shadowRoot?.querySelector<SVGRectElement>('rect[data-ref="e2"]');
    expect(emailRect).toBeTruthy();
    emailRect?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]?.[0] as CustomEvent<OverlayRegionPickDetail>;
    expect(event.detail).toEqual({
      ref: "e2",
      role: "textbox",
      name: "Email",
      bbox: { x: 100, y: 200, width: 300, height: 40 },
    });
  });

  it("omits name from the detail when the picked node has no accessible name", async () => {
    const treeWithoutName: ElementTree = {
      ...SAMPLE_TREE,
      root: {
        ref: "e1",
        role: "main",
        bbox: { x: 0, y: 0, width: 800, height: 600 },
        children: [
          {
            ref: "e2",
            role: "generic",
            bbox: { x: 10, y: 10, width: 50, height: 50 },
          },
        ],
      },
    };
    const el = mount();
    el.elementTree = treeWithoutName;
    await el.updateComplete;
    const handler = vi.fn();
    el.addEventListener("overlay-region-pick", handler as EventListener);
    const genericRect = el.shadowRoot?.querySelector<SVGRectElement>('rect[data-ref="e2"]');
    genericRect?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const event = handler.mock.calls[0]?.[0] as CustomEvent<OverlayRegionPickDetail>;
    expect(event.detail.name).toBeUndefined();
  });

  it("sets data-highlighted='true' on the rect matching highlightedRef", async () => {
    const el = mount();
    el.elementTree = SAMPLE_TREE;
    el.highlightedRef = "e3";
    await el.updateComplete;
    const passwordRect = el.shadowRoot?.querySelector<SVGRectElement>('rect[data-ref="e3"]');
    const emailRect = el.shadowRoot?.querySelector<SVGRectElement>('rect[data-ref="e2"]');
    expect(passwordRect?.getAttribute("data-highlighted")).toBe("true");
    expect(emailRect?.getAttribute("data-highlighted")).toBe("false");
  });
});
