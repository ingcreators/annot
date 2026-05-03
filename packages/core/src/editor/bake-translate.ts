/**
 * Move-bake helpers — phase 2 of `docs/plans/move-bakes-coordinates.md`.
 *
 * Public entry point: `bakeTranslate(el, dx, dy)`. Dispatches by
 * `tagName` + `data-type` / `data-shape-kind` to a per-shape baker
 * that translates the element's children's geometry attrs (or the
 * `<path>` `d` for path shapes) by (dx, dy) in world space — so
 * `getBBox()` after the bake returns the post-move bounds without
 * any `transform="translate(...)"` on the wrapper.
 *
 * Tier B — pure Element manipulation, jsdom-friendly. No live-
 * browser dependencies (no canvas, no MutationObserver, no
 * pointer events). Lives next to `transform-utils.ts` since the
 * dispatcher pairs with `nudgeTranslate`'s rotation/flip path.
 *
 * Phase 2 is dead code until phase 3 wires this into the move
 * dispatcher in `selection.ts`. Tests cover the bake helpers in
 * isolation.
 */

import { translatePathD } from "./path-utils.js";
import { bakeTextShapeTranslate } from "./text-utils.js";

/**
 * Translate a Counter (marker) `<g>` and its children by (dx, dy).
 *
 * Marker structure (see `packages/editor/src/tools/marker-tool.ts`):
 *
 *   <g data-marker="N" data-shape="circle|rect|rounded">
 *     <circle cx cy r ...> | <rect x y w h ...>     ← background
 *     <text x y ...>N</text>                         ← numeral
 *   </g>
 *
 * Either bg shape carries position; the inner `<text>` carries x/y
 * and a single textContent (no `<tspan>` children). Shift all
 * positional attrs in place.
 *
 * No-op for non-marker `<g>` inputs. Caller is expected to confirm
 * the marker discriminator (`data-marker` attribute) before
 * dispatching.
 */
export function bakeMarkerTranslate(g: SVGElement, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  if (!g.hasAttribute("data-marker")) return;
  const rect = g.querySelector(":scope > rect");
  if (rect) {
    rect.setAttribute("x", String(Number.parseFloat(rect.getAttribute("x") || "0") + dx));
    rect.setAttribute("y", String(Number.parseFloat(rect.getAttribute("y") || "0") + dy));
  }
  const circle = g.querySelector(":scope > circle");
  if (circle) {
    circle.setAttribute(
      "cx",
      String(Number.parseFloat(circle.getAttribute("cx") || "0") + dx),
    );
    circle.setAttribute(
      "cy",
      String(Number.parseFloat(circle.getAttribute("cy") || "0") + dy),
    );
  }
  const text = g.querySelector(":scope > text");
  if (text) {
    text.setAttribute("x", String(Number.parseFloat(text.getAttribute("x") || "0") + dx));
    text.setAttribute("y", String(Number.parseFloat(text.getAttribute("y") || "0") + dy));
  }
}

/**
 * Translate a `<path>` element's `d` attribute by (dx, dy). Thin
 * wrapper around the Tier A `translatePathD` helper that also
 * handles the missing-attribute case.
 */
export function bakePathTranslate(p: SVGElement, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const d = p.getAttribute("d");
  if (d == null) return;
  p.setAttribute("d", translatePathD(d, dx, dy));
}

/**
 * Translate a `<g data-type="group">` and all its descendants by
 * (dx, dy), recursing into children via the public `bakeTranslate`
 * dispatcher. Each level decides per-child whether the legacy
 * transform-based move is needed (rotated / flipped child) or the
 * bake path applies.
 *
 * Children that already use a non-identity rotation/flip transform
 * have their TRANSLATE component baked into the local geometry
 * (matching the parent's bake), and their rotation/flip transform
 * gets re-emitted via `applyTransformState` so the matrix's pivot
 * tracks the new bbox center. The visual result is identical
 * because `parent_translate * child_rotate(cx, cy) ===
 * child_rotate(cx + dx, cy + dy)` after baking.
 */
export function bakeGroupTranslate(g: SVGElement, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const child of Array.from(g.children)) {
    bakeTranslate(child as SVGElement, dx, dy);
  }
}

/** Geometry-positioned tags that store position in their own attrs.
 *  Mirrors `usesGeometryPosition` from `transform-utils.ts` but
 *  scoped to the bake decision (line/arrow are NOT here — they
 *  route to `bakeLineTranslate` instead).
 */
function isGeometryPositionedTag(tag: string): boolean {
  return (
    tag === "rect" ||
    tag === "ellipse" ||
    tag === "circle" ||
    tag === "image" ||
    tag === "text" ||
    tag === "foreignObject"
  );
}

/** Geometry-attr rewriter for non-grouped shapes (rect / ellipse /
 *  circle / image / text / foreignObject). Each tag stores its
 *  position in different attrs (x/y vs cx/cy) — handle each. */
function bakeGeometryPositioned(el: SVGElement, dx: number, dy: number): void {
  const tag = el.tagName;
  if (tag === "rect" || tag === "image" || tag === "text" || tag === "foreignObject") {
    el.setAttribute("x", String(Number.parseFloat(el.getAttribute("x") || "0") + dx));
    el.setAttribute("y", String(Number.parseFloat(el.getAttribute("y") || "0") + dy));
  } else if (tag === "ellipse" || tag === "circle") {
    el.setAttribute("cx", String(Number.parseFloat(el.getAttribute("cx") || "0") + dx));
    el.setAttribute("cy", String(Number.parseFloat(el.getAttribute("cy") || "0") + dy));
  }
}

/**
 * Public dispatcher. Translates the element's visual position by
 * (dx, dy) without using a `transform="translate(...)"` — the
 * children's geometry attrs absorb the move.
 *
 * Dispatch:
 *
 * | Element / discriminator | Routes to |
 * |---|---|
 * | `<g data-type="shape">` (sticky / callout / text-on-shape / textbox) | `bakeTextShapeTranslate` |
 * | `<g data-type="group">` | `bakeGroupTranslate` (recursive) |
 * | `<g data-marker>` (Counter) | `bakeMarkerTranslate` |
 * | `<path>` (Freehand / Redact-path / future Focus-mask) | `bakePathTranslate` |
 * | Other `<g>` (unrecognised) | recursive children (best-effort) |
 * | `<rect>` / `<ellipse>` / `<circle>` / `<image>` / `<text>` / `<foreignObject>` | direct geometry-attr rewrite |
 * | `<line>` and `<g data-type="arrow">` | NOT handled here — callers should use the existing `bakeLineTransform` + endpoint-rewrite path in `transform-utils.ts`, since lines already carry no `data-tx` / `data-ty` (their position is in their endpoints from the start). |
 *
 * No-op for unrecognised inputs.
 *
 * Tier B — jsdom-friendly. Caller (live editor in `annot-editor`)
 * is expected to call `applyTransformState(el)` afterwards if the
 * element has a non-identity rotation/flip whose pivot needs to
 * recompute against the post-bake bbox center.
 */
export function bakeTranslate(el: SVGElement, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const tag = el.tagName;

  // Group dispatch by tag, then by discriminator data-attribute.
  if (tag === "g") {
    const dataType = el.getAttribute("data-type");
    if (dataType === "shape") {
      bakeTextShapeTranslate(el, dx, dy);
      return;
    }
    if (dataType === "group") {
      bakeGroupTranslate(el, dx, dy);
      return;
    }
    if (el.hasAttribute("data-marker")) {
      bakeMarkerTranslate(el, dx, dy);
      return;
    }
    // Unknown / future `<g>` shape — fall back to recursion. This
    // is best-effort: a future shape that stores position in
    // wrapper-level attrs (data-* something) will need its own
    // baker plumbed in here. The recursion at least keeps the
    // children's known-shape geometry consistent.
    bakeGroupTranslate(el, dx, dy);
    return;
  }

  if (tag === "path") {
    bakePathTranslate(el, dx, dy);
    return;
  }

  if (isGeometryPositionedTag(tag)) {
    bakeGeometryPositioned(el, dx, dy);
    return;
  }

  // line / arrow / unknown leaf — caller's responsibility.
}
