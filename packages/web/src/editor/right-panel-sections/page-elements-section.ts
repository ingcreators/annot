/**
 * Built-in `right-panel.page-elements` section — DOM-element list
 * sourced from the browser-extension's `pageMetadata` capture.
 * Lists interactive elements (buttons / links / inputs / …) that
 * fall within the screenshot's `captureRect`; hover highlights
 * them on the canvas via a translucent overlay; click inserts a
 * red annotation rectangle around the element's bbox.
 *
 * Migrated from the previous monolithic right-panel as part of
 * Phase 3 of `docs/plans/plugin-ui-slots.md`. `visible(ctx)` gates
 * on `pageMetadata` being non-null with at least one element, so
 * non-extension captures (paste / desktop / legacy) skip the
 * section's heading entirely.
 */

import type { CanvasManager, History, PageElement, SelectionManager } from "@ingcreators/annot-core";
import { setTooltip } from "@ingcreators/annot-core/utils";
import type { UISection } from "../../app/plugin-host.js";
import {
  fullDescriptionFor,
  iconForElement,
  primaryLabelFor,
  SVG_NS,
  subLabelFor,
} from "./element-helpers.js";
import type { PageMetadataLike } from "./types.js";

export interface PageElementsSectionDeps {
  getPageMetadata(): PageMetadataLike | null;
  getCanvas(): CanvasManager;
  getHistory(): History;
  getSelection(): SelectionManager;
}

export function createPageElementsSection(deps: PageElementsSectionDeps): UISection {
  let elementsBody: HTMLElement | null = null;
  let hoverHighlight: SVGRectElement | null = null;

  const refreshList = (query: string) => {
    if (!elementsBody) return;
    const meta = deps.getPageMetadata();
    if (!meta) return;

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
    const matchesQuery = (el: PageElement): boolean => {
      if (!query) return true;
      const q = query.toLowerCase();
      return [el.text, el.ariaLabel, el.role, el.placeholder, el.tag, el.href].some((s) =>
        s?.toLowerCase().includes(q),
      );
    };

    const filtered = meta.elements.filter((e) => inBounds(e) && matchesQuery(e));
    console.log(
      "[annot/editor] filtered elements:",
      filtered.length,
      "/",
      meta.elements.length,
      "captureRect:",
      cr,
    );
    elementsBody.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "editor-right-panel-elements-empty";
      empty.textContent = query ? "No matches." : "No interactive elements detected.";
      elementsBody.appendChild(empty);
      return;
    }
    for (const el of filtered) {
      elementsBody.appendChild(buildElementRow(el));
    }
  };

  /** Convert an element's document-coords bbox (from metadata) to
   *  the canvas SVG's viewBox coords (which equal the screenshot's
   *  device-pixel dimensions). Origin is `captureRect`. CSS px →
   *  device px via DPR. */
  const bboxOnScreenshot = (el: PageElement): [number, number, number, number] => {
    const meta = deps.getPageMetadata();
    if (!meta) return [0, 0, 0, 0];
    const dpr = meta.devicePixelRatio || 1;
    const ox = meta.captureRect.x;
    const oy = meta.captureRect.y;
    const [x, y, w, h] = el.bbox;
    return [(x - ox) * dpr, (y - oy) * dpr, w * dpr, h * dpr];
  };

  /** Draw a translucent outline rect on the canvas SVG at the given
   *  element's bbox. Reuses one rect across hovers (cheap). Cleared
   *  by `clearHoverHighlight` when the row's hover ends. */
  const showHoverHighlight = (el: PageElement) => {
    const [x, y, w, h] = bboxOnScreenshot(el);
    if (!hoverHighlight) {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", "#ff00a8");
      rect.setAttribute("stroke-width", "2");
      rect.setAttribute("vector-effect", "non-scaling-stroke");
      rect.setAttribute("pointer-events", "none");
      rect.setAttribute("data-role", "elements-hover");
      deps.getCanvas().svg.appendChild(rect);
      hoverHighlight = rect;
    }
    hoverHighlight.setAttribute("x", String(x));
    hoverHighlight.setAttribute("y", String(y));
    hoverHighlight.setAttribute("width", String(w));
    hoverHighlight.setAttribute("height", String(h));
    hoverHighlight.setAttribute("opacity", "1");
  };

  const clearHoverHighlight = () => {
    if (hoverHighlight) hoverHighlight.setAttribute("opacity", "0");
  };

  /** Insert a red rectangle annotation around the element's bbox.
   *  The new rect lands in `#annotations` (so it exports / saves
   *  like any user-drawn rect) and becomes the selection so the
   *  user can immediately tweak it via the Property panel. */
  const annotateElement = (el: PageElement) => {
    const [x, y, w, h] = bboxOnScreenshot(el);
    if (w < 1 || h < 1) return;
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "#ff0000");
    rect.setAttribute("stroke-width", "3");
    deps.getCanvas().annotations.appendChild(rect);
    deps.getHistory().save();
    deps.getSelection().select(rect);
  };

  /** One row in the elements list — icon + label + (optional) sub-text. */
  const buildElementRow = (el: PageElement): HTMLElement => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "editor-right-panel-element-row";

    const icon = document.createElement("span");
    icon.className = "editor-right-panel-element-icon material-symbols-outlined";
    icon.textContent = iconForElement(el);
    row.appendChild(icon);

    const text = document.createElement("span");
    text.className = "editor-right-panel-element-label";
    text.textContent = primaryLabelFor(el);
    row.appendChild(text);

    const sub = document.createElement("span");
    sub.className = "editor-right-panel-element-sub";
    sub.textContent = subLabelFor(el);
    row.appendChild(sub);

    setTooltip(row, fullDescriptionFor(el));

    row.addEventListener("mouseenter", () => showHoverHighlight(el));
    row.addEventListener("mouseleave", () => clearHoverHighlight());
    row.addEventListener("click", () => {
      clearHoverHighlight();
      annotateElement(el);
    });
    return row;
  };

  const renderInto = (container: HTMLElement) => {
    container.innerHTML = "";
    container.classList.add("editor-right-panel-elements");

    const hint = document.createElement("p");
    hint.className = "editor-right-panel-elements-hint";
    hint.textContent = "Click to draw a box around it.";
    container.appendChild(hint);

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search by text…";
    search.className = "editor-right-panel-elements-search";
    search.addEventListener("input", () => refreshList(search.value));
    container.appendChild(search);

    const body = document.createElement("div");
    body.className = "editor-right-panel-elements-list";
    container.appendChild(body);
    elementsBody = body;

    refreshList("");
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
      renderInto(container);
      return {
        update() {
          if (elementsBody) {
            // Clear search query on metadata change — the new image
            // has different elements; keeping a stale query would
            // surface confusing "No matches." for queries the user
            // typed against the previous image.
            renderInto(container);
          }
        },
        unmount() {
          hoverHighlight?.remove();
          hoverHighlight = null;
          elementsBody = null;
        },
      };
    },
  };
}
