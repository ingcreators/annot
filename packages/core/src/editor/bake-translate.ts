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
import { bakeLineTranslate } from "./transform-utils.js";

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
    circle.setAttribute("cx", String(Number.parseFloat(circle.getAttribute("cx") || "0") + dx));
    circle.setAttribute("cy", String(Number.parseFloat(circle.getAttribute("cy") || "0") + dy));
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

/**
 * Translate every direct child of an annotations group by (dx, dy).
 *
 * Like {@link bakeTranslate} but also handles `<line>` and
 * `<g data-type="arrow">` children — the destructive-crop path
 * (`EditorShell.applyCrop`) calls this to shift the annotation
 * tree into the cropped image's new origin, so it has to cover
 * EVERY annotation type the editor produces (the `bakeTranslate`
 * dispatcher itself omits lines/arrows because their move flow goes
 * through `transform-utils.ts:bakeLineTranslate` directly).
 *
 * Tier B — pure DOM mutation, jsdom-friendly. The line/arrow path
 * uses `DOMMatrix` via `bakeLineTransform`, which jsdom polyfills
 * via `applyInverseAffine`-style numeric helpers; happy-dom ships a
 * working `DOMMatrix` for the same routine. No-op for (0, 0).
 */
export function bakeAnnotationsTranslate(group: SVGElement, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const child of Array.from(group.children)) {
    const el = child as SVGElement;
    const tag = el.tagName;
    if (tag === "line" || (tag === "g" && el.getAttribute("data-type") === "arrow")) {
      bakeLineTranslate(el, dx, dy);
      continue;
    }
    bakeTranslate(el, dx, dy);
  }
}

// ─── annotation bbox + prune-outside-rect helpers ──────────────────────────────
//
// Used by EditorShell.applyCrop to drop annotations whose entire
// bounding box falls outside the crop rect, so the destructive-crop
// path doesn't carry hidden-but-persisted off-canvas content into the
// saved file (privacy + file-size win). Annotations that PARTIALLY
// overlap the crop rect are kept as-is — clipping per-shape geometry
// (truncating arrow shafts, snipping freehand path segments,
// shrinking text bg rects) is intentionally out of scope for v1.
// Forward-looking notes captured in
// `docs/plans/_done/destructive-crop-bake.md`.
//
// Tier B — jsdom-friendly. We compute bbox from the same geometry
// attrs the corresponding bakers read, NOT from `getBBox()` (which
// happy-dom / jsdom return zeros for, breaking the prune in tests).

/** Axis-aligned bbox in world (svg-root) coordinates. */
export interface AnnotationBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Compute world-space bbox of an annotation element from its
 *  geometry attrs. Returns `null` when the element doesn't carry
 *  enough information for a confident bbox — callers SHOULD treat
 *  null as "keep" (defensive: never delete what we can't measure).
 *
 *  Tag dispatch mirrors `bakeTranslate`:
 *
 *   - `<rect>`, `<image>`, `<foreignObject>`: x, y, width, height
 *   - `<circle>`: (cx-r, cy-r, 2r, 2r)
 *   - `<ellipse>`: (cx-rx, cy-ry, 2rx, 2ry)
 *   - `<text>`: a single point at (x, y) — we treat it as 0×0; if
 *     the user's text overflows the point we err on the side of
 *     keeping (rare). The bg of a sticky/callout/textbox is the
 *     `<g data-type="shape">` wrapper case, not a plain `<text>`.
 *   - `<line>`: bbox of the two endpoints
 *   - `<g data-type="arrow">`: bbox of `data-x1/y1` … `data-x2/y2`
 *     plus `data-cx/cy` if curved
 *   - `<path>`: bbox of every absolute `M` / `L` / `Q` / `C` / `T`
 *     / `S` / `A` coordinate token in `d` (good enough for
 *     freehand and redact-path shapes — both write absolute coords
 *     today via `translatePathD`'s round-trip discipline)
 *   - `<g data-marker>`: recurse into the bg circle / rect
 *   - `<g data-type="shape">`: bbox of the bg `<rect>`
 *   - `<g data-type="group">`: union of every direct child's bbox
 *   - other `<g>`: union of every direct child's bbox (best-effort)
 *
 *  Pure attribute-reading; no DOM-API calls beyond `getAttribute`.
 */
export function annotationBBox(el: SVGElement): AnnotationBBox | null {
  const tag = el.tagName;
  if (tag === "rect" || tag === "image" || tag === "foreignObject") {
    const x = parseAttr(el, "x");
    const y = parseAttr(el, "y");
    const w = parseAttr(el, "width");
    const h = parseAttr(el, "height");
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    return { x, y, w, h };
  }
  if (tag === "text") {
    const x = parseAttr(el, "x");
    const y = parseAttr(el, "y");
    return { x, y, w: 0, h: 0 };
  }
  if (tag === "circle") {
    const cx = parseAttr(el, "cx");
    const cy = parseAttr(el, "cy");
    const r = parseAttr(el, "r");
    if (!Number.isFinite(r) || r <= 0) return null;
    return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
  }
  if (tag === "ellipse") {
    const cx = parseAttr(el, "cx");
    const cy = parseAttr(el, "cy");
    const rx = parseAttr(el, "rx");
    const ry = parseAttr(el, "ry");
    if (!Number.isFinite(rx) || rx <= 0 || !Number.isFinite(ry) || ry <= 0) return null;
    return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
  }
  if (tag === "line") {
    const x1 = parseAttr(el, "x1");
    const y1 = parseAttr(el, "y1");
    const x2 = parseAttr(el, "x2");
    const y2 = parseAttr(el, "y2");
    return bboxOfPoints([
      [x1, y1],
      [x2, y2],
    ]);
  }
  if (tag === "path") {
    return bboxOfPathD(el.getAttribute("d"));
  }
  if (tag === "g") {
    const dataType = el.getAttribute("data-type");
    if (dataType === "arrow") {
      const x1 = parseAttr(el, "data-x1");
      const y1 = parseAttr(el, "data-y1");
      const x2 = parseAttr(el, "data-x2");
      const y2 = parseAttr(el, "data-y2");
      const points: Array<[number, number]> = [
        [x1, y1],
        [x2, y2],
      ];
      const cxRaw = el.getAttribute("data-cx");
      const cyRaw = el.getAttribute("data-cy");
      if (cxRaw != null && cyRaw != null) {
        const cx = Number.parseFloat(cxRaw);
        const cy = Number.parseFloat(cyRaw);
        if (Number.isFinite(cx) && Number.isFinite(cy)) {
          points.push([cx, cy]);
        }
      }
      return bboxOfPoints(points);
    }
    if (dataType === "shape") {
      // Sticky / callout / textbox / text-on-shape — the bg `<rect>`
      // (the first direct rect child) carries the wrapper's bbox.
      // For callouts, the tail anchor point sits OUTSIDE the bg rect;
      // include it so a callout whose bg is inside the crop but tail
      // points to a target outside still gets kept (the tail line is
      // the meaningful part of a callout).
      const bg = el.querySelector(":scope > rect");
      if (!bg) return bboxOfChildren(el);
      let bbox: AnnotationBBox | null = annotationBBox(bg as SVGElement);
      const tailX = el.getAttribute("data-tail-x");
      const tailY = el.getAttribute("data-tail-y");
      if (bbox && tailX != null && tailY != null) {
        const tx = Number.parseFloat(tailX);
        const ty = Number.parseFloat(tailY);
        if (Number.isFinite(tx) && Number.isFinite(ty)) {
          bbox = unionBBox(bbox, { x: tx, y: ty, w: 0, h: 0 });
        }
      }
      return bbox;
    }
    if (el.hasAttribute("data-marker")) {
      // Counter — bg circle or rect carries the bbox.
      const circle = el.querySelector(":scope > circle");
      if (circle) return annotationBBox(circle as SVGElement);
      const rect = el.querySelector(":scope > rect");
      if (rect) return annotationBBox(rect as SVGElement);
      return bboxOfChildren(el);
    }
    // group / unknown <g> → union of children
    return bboxOfChildren(el);
  }
  return null;
}

/**
 * Remove direct children of `group` whose entire bbox falls outside
 * the supplied rect (in world coords). Returns the count of removed
 * children. Used by `EditorShell.applyCrop` to prune annotations
 * that the destructive crop would put off-screen.
 *
 * "Fully outside" means `bbox.right <= rect.x` or `bbox.bottom <=
 * rect.y` or `bbox.left >= rect.x + rect.w` or `bbox.top >= rect.y
 * + rect.h`. Annotations that PARTIALLY overlap the rect (straddle
 * the boundary) are kept — clipping per-shape geometry is out of
 * scope, so the visible portion stays visible after the crop and
 * the invisible portion remains in the data (acceptable v1 trade-
 * off; see `_done/destructive-crop-bake.md`).
 *
 * Children whose bbox cannot be determined (`annotationBBox`
 * returns null) are kept defensively — never delete what we can't
 * measure.
 */
export function pruneAnnotationsOutsideRect(group: SVGElement, rect: AnnotationBBox): number {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  let removed = 0;
  for (const child of Array.from(group.children)) {
    const bbox = annotationBBox(child as SVGElement);
    if (!bbox) continue;
    const bRight = bbox.x + bbox.w;
    const bBottom = bbox.y + bbox.h;
    const fullyOutside = bRight <= left || bBottom <= top || bbox.x >= right || bbox.y >= bottom;
    if (fullyOutside) {
      child.remove();
      removed++;
    }
  }
  return removed;
}

// ─── private helpers ───────────────────────────────────────────────

function parseAttr(el: SVGElement, name: string): number {
  const raw = el.getAttribute(name);
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function bboxOfPoints(points: Array<[number, number]>): AnnotationBBox | null {
  if (points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function bboxOfChildren(g: SVGElement): AnnotationBBox | null {
  let union: AnnotationBBox | null = null;
  for (const child of Array.from(g.children)) {
    const cb = annotationBBox(child as SVGElement);
    if (!cb) continue;
    union = union ? unionBBox(union, cb) : cb;
  }
  return union;
}

function unionBBox(a: AnnotationBBox, b: AnnotationBBox): AnnotationBBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const r = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: r - x, h: bottom - y };
}

/** Bbox of a `<path>` `d` attribute by scanning its absolute
 *  coordinate tokens. Relative tokens (`m` / `l` / `c` / etc.)
 *  contribute via accumulated current-point arithmetic — the
 *  resulting bbox is correct for every Annot-produced path
 *  (freehand, redact-path) since those write absolute coords
 *  today, plus is reasonable for legacy paths that mix absolute /
 *  relative.
 *
 *  Only `M` / `L` / `Q` / `C` / `T` / `S` / `A` are tracked (the
 *  command set Annot's path serializers produce); `H` / `V`
 *  contribute their single-axis component; `Z` closes without
 *  contributing. Returns null if `d` is empty / unparseable. */
function bboxOfPathD(d: string | null): AnnotationBBox | null {
  if (!d) return null;
  // Tokenize: command letters + signed numbers (with decimals,
  // exponents, commas, whitespace).
  const tokenRe = /[a-zA-Z]|-?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][-+]?\d+)?/g;
  const matches = d.match(tokenRe);
  if (!matches) return null;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let cmd = "";
  let i = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const update = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  // Each iteration consumes one logical "draw step" of the current
  // command. Commands with a number-grouping continue with implicit
  // commands of the same type (per SVG spec).
  while (i < matches.length) {
    const tok = matches[i]!;
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok;
      i++;
      // For implicit `M` continuation, subsequent pairs become `L`.
      // We handle this by treating the FIRST pair as `M` then
      // switching `cmd` to `L` (or `l` for relative).
      continue;
    }
    if (cmd === "") return null;
    const num = (offset: number): number => Number.parseFloat(matches[i + offset]!);
    const upper = cmd.toUpperCase();
    const isAbs = cmd === upper;
    // Per-command parameter consumption, mirroring the spec table.
    switch (upper) {
      case "M":
      case "L":
      case "T": {
        const x = num(0);
        const y = num(1);
        const ax = isAbs ? x : cx + x;
        const ay = isAbs ? y : cy + y;
        update(ax, ay);
        cx = ax;
        cy = ay;
        if (cmd === "M" || cmd === "m") {
          startX = cx;
          startY = cy;
          // After moveto, subsequent implicit pairs become lineto.
          cmd = isAbs ? "L" : "l";
        }
        i += 2;
        break;
      }
      case "H": {
        const x = num(0);
        const ax = isAbs ? x : cx + x;
        update(ax, cy);
        cx = ax;
        i += 1;
        break;
      }
      case "V": {
        const y = num(0);
        const ay = isAbs ? y : cy + y;
        update(cx, ay);
        cy = ay;
        i += 1;
        break;
      }
      case "Q":
      case "S": {
        const cpx = num(0);
        const cpy = num(1);
        const x = num(2);
        const y = num(3);
        const acpx = isAbs ? cpx : cx + cpx;
        const acpy = isAbs ? cpy : cy + cpy;
        const ax = isAbs ? x : cx + x;
        const ay = isAbs ? y : cy + y;
        update(acpx, acpy);
        update(ax, ay);
        cx = ax;
        cy = ay;
        i += 4;
        break;
      }
      case "C": {
        const cp1x = num(0);
        const cp1y = num(1);
        const cp2x = num(2);
        const cp2y = num(3);
        const x = num(4);
        const y = num(5);
        const acp1x = isAbs ? cp1x : cx + cp1x;
        const acp1y = isAbs ? cp1y : cy + cp1y;
        const acp2x = isAbs ? cp2x : cx + cp2x;
        const acp2y = isAbs ? cp2y : cy + cp2y;
        const ax = isAbs ? x : cx + x;
        const ay = isAbs ? y : cy + y;
        update(acp1x, acp1y);
        update(acp2x, acp2y);
        update(ax, ay);
        cx = ax;
        cy = ay;
        i += 6;
        break;
      }
      case "A": {
        // Arc: rx ry x-axis-rotation large-arc sweep x y
        const x = num(5);
        const y = num(6);
        const ax = isAbs ? x : cx + x;
        const ay = isAbs ? y : cy + y;
        update(ax, ay);
        cx = ax;
        cy = ay;
        i += 7;
        break;
      }
      case "Z": {
        cx = startX;
        cy = startY;
        // No params.
        break;
      }
      default:
        // Unknown command — bail.
        return null;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
