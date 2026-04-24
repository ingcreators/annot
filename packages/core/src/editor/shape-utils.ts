/**
 * Shape family utilities — identify and convert between the three
 * Shape variants (rectangle, rounded rectangle, ellipse).
 *
 * All three share the "region marker" purpose: a bounding box with
 * stroke + optional fill. The only differences are corner handling
 * and outline geometry (<rect> vs <ellipse>). Unifying them under a
 * single ShapeTool + a property-driven subtype keeps the toolbar
 * uncluttered and lets the user convert an existing shape to a
 * different variant without re-drawing.
 */

import type { ShapeType } from "./tools/tool-base.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Classify an existing SVG element as one of the three Shape variants,
 * or null if it isn't a shape.
 */
export function detectShapeType(el: SVGElement): ShapeType | null {
  if (el.tagName === "ellipse") return "ellipse";
  if (el.tagName === "rect") {
    return el.hasAttribute("data-rounded") ? "rounded" : "rect";
  }
  return null;
}

/**
 * Return the element's canvas-space bounding box as (x, y, w, h).
 * Works for both <rect> (x/y/w/h attrs) and <ellipse> (cx/cy/rx/ry).
 */
export function shapeBBox(el: SVGElement): { x: number; y: number; w: number; h: number } {
  if (el.tagName === "ellipse") {
    const cx = Number.parseFloat(el.getAttribute("cx") || "0");
    const cy = Number.parseFloat(el.getAttribute("cy") || "0");
    const rx = Number.parseFloat(el.getAttribute("rx") || "0");
    const ry = Number.parseFloat(el.getAttribute("ry") || "0");
    return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
  }
  return {
    x: Number.parseFloat(el.getAttribute("x") || "0"),
    y: Number.parseFloat(el.getAttribute("y") || "0"),
    w: Number.parseFloat(el.getAttribute("width") || "0"),
    h: Number.parseFloat(el.getAttribute("height") || "0"),
  };
}

/** List of common style attributes preserved when converting between
 *  shape types. */
const PRESERVED_ATTRS = [
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "data-dash-key",
  "fill",
  "fill-opacity",
];

/**
 * Convert a Shape element to a different variant in place. Preserves
 * the bounding box (same x/y/w/h visual footprint) and common style
 * attributes (stroke, fill, dash, etc.).
 *
 * Returns the NEW element, which has been inserted into the DOM in
 * the same position as the old one. The old element is removed.
 * Callers must update any references they hold (SelectionManager,
 * PropertyPanel targets, etc.) to point at the returned element.
 */
export function convertShape(oldEl: SVGElement, newType: ShapeType): SVGElement {
  const { x, y, w, h } = shapeBBox(oldEl);
  const parent = oldEl.parentNode;
  if (!parent) throw new Error("convertShape: element is detached from DOM");

  let newEl: SVGElement;
  if (newType === "ellipse") {
    newEl = document.createElementNS(SVG_NS, "ellipse");
    newEl.setAttribute("cx", String(x + w / 2));
    newEl.setAttribute("cy", String(y + h / 2));
    newEl.setAttribute("rx", String(w / 2));
    newEl.setAttribute("ry", String(h / 2));
  } else {
    // rect (both "rect" and "rounded" share the <rect> tag)
    newEl = document.createElementNS(SVG_NS, "rect");
    newEl.setAttribute("x", String(x));
    newEl.setAttribute("y", String(y));
    newEl.setAttribute("width", String(w));
    newEl.setAttribute("height", String(h));
    if (newType === "rounded") {
      const rx = Math.max(2, Math.round(Math.min(w, h) / 6));
      newEl.setAttribute("rx", String(rx));
      newEl.setAttribute("data-rounded", "true");
    } else {
      newEl.setAttribute("rx", "0");
    }
  }

  // Carry over style attributes so stroke / fill / dash pattern don't
  // reset during a type change.
  for (const attr of PRESERVED_ATTRS) {
    const v = oldEl.getAttribute(attr);
    if (v != null) newEl.setAttribute(attr, v);
  }

  parent.replaceChild(newEl, oldEl);
  return newEl;
}
