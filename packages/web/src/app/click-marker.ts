/**
 * Click-marker rendering — draws click indicators from the `click.*` tags
 * recorded at capture time.
 *
 * Extracted from `app.ts` as part of the Phase 0 decomposition
 * (see `docs/plans/_done/app-decomposition.md`). Touches DOM (createElementNS),
 * but takes its inputs explicitly — no app-state reach-ins.
 */

import type { CanvasManager } from "@ingcreators/annot-core/editor";

/**
 * Draw click indicators using tags recorded at capture time:
 *   - `click.rect.*` → rectangle outlining the clicked element
 *   - `click.x` / `click.y` → precise click point (dot + ring)
 * Coordinates are already in image-pixel space (dpr-multiplied).
 */
export function addClickMarker(canvas: CanvasManager, tags: Record<string, string>): void {
  const ns = "http://www.w3.org/2000/svg";
  const color = "#ff3b3b";

  // Missing tag → `parseFloat("")` returns NaN, which the `isFinite`
  // guard below correctly rejects. Default to "" so TS is happy.
  const rx = Number.parseFloat(tags["click.rect.x"] ?? "");
  const ry = Number.parseFloat(tags["click.rect.y"] ?? "");
  const rw = Number.parseFloat(tags["click.rect.w"] ?? "");
  const rh = Number.parseFloat(tags["click.rect.h"] ?? "");
  const hasRect =
    Number.isFinite(rx) &&
    Number.isFinite(ry) &&
    Number.isFinite(rw) &&
    Number.isFinite(rh) &&
    rw > 0 &&
    rh > 0;

  if (hasRect) {
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", String(rx));
    rect.setAttribute("y", String(ry));
    rect.setAttribute("width", String(rw));
    rect.setAttribute("height", String(rh));
    rect.setAttribute("fill", color);
    rect.setAttribute("fill-opacity", "0.12");
    rect.setAttribute("stroke", color);
    rect.setAttribute("stroke-width", "3");
    rect.setAttribute("rx", "4");
    rect.setAttribute("ry", "4");
    canvas.annotations.appendChild(rect);
  }

  const x = Number.parseFloat(tags["click.x"] ?? "");
  const y = Number.parseFloat(tags["click.y"] ?? "");
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  // Outer ring (smaller when we also have a rect, since the rect gives context)
  const ring = document.createElementNS(ns, "circle");
  ring.setAttribute("cx", String(x));
  ring.setAttribute("cy", String(y));
  ring.setAttribute("r", hasRect ? "14" : "28");
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", color);
  ring.setAttribute("stroke-width", hasRect ? "3" : "4");
  ring.setAttribute("opacity", "0.9");
  canvas.annotations.appendChild(ring);

  // Inner dot
  const dot = document.createElementNS(ns, "circle");
  dot.setAttribute("cx", String(x));
  dot.setAttribute("cy", String(y));
  dot.setAttribute("r", hasRect ? "5" : "7");
  dot.setAttribute("fill", color);
  dot.setAttribute("stroke", "#fff");
  dot.setAttribute("stroke-width", "2");
  canvas.annotations.appendChild(dot);
}
