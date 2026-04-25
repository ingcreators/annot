/**
 * transform-utils — composite transform management for annotation
 * elements (rotation + flip + translate).
 *
 * State is persisted as `data-*` attributes on the element so the SVG
 * is the single source of truth (no parallel JS map). The visual
 * `transform` attribute is recomputed from those attrs whenever any
 * piece of state changes.
 *
 * Stored state:
 *   data-rot     ← rotation in degrees (CW positive). Default 0.
 *   data-flip-h  ← "1" if horizontally flipped. Default unset/0.
 *   data-flip-v  ← "1" if vertically flipped. Default unset/0.
 *   data-tx      ← translate x (only used for path/g — for rect/
 *                  ellipse/etc. position lives in their own attrs).
 *   data-ty      ← translate y (path/g only).
 *
 * Rotation/flip pivot is the element's LOCAL bbox center (computed via
 * getBBox() which ignores the element's own transform). Re-computed on
 * every update so the pivot follows resizes naturally.
 *
 * Composite math (right-to-left in SVG):
 *   M = T(tx, ty) * T(cx, cy) * R(rot) * S(sx, sy) * T(-cx, -cy)
 *
 * For elements with no rotation and no flip, the function emits a
 * plain `translate(tx, ty)` (or no transform at all when tx=ty=0) so
 * existing serialization stays byte-identical for unrotated content.
 */

import {
  readArrowControl,
  readArrowEndpoints,
  refreshArrowPath,
  writeArrowControl,
  writeArrowEndpoints,
} from "./arrow-markers.js";
// `rotateAround` lives in `./selection-geometry.ts` so the math has a
// single source of truth shared between transform-utils (Tier B) and
// the live SelectionManager (Tier C).
import { rotateAround } from "./selection-geometry.js";
import { rebuildCalloutTail } from "./text-utils.js";

// ---- Line/arrow specialization ----------------------------------
//
// `<line>` and `<g data-type="arrow">` are fully defined by their two
// endpoints, which makes transform-based rotation redundant: a rotated
// line is just a line with different endpoints. Worse, mixing an
// endpoint-space geometry with a transform-attribute rotation creates
// coordinate-frame ambiguities (dragging in world space while endpoints
// live in local space → the pivot-recentering on drag undoes the
// translation, etc.).
//
// So for these elements we BAKE rotation/flip/translate into endpoint
// coordinates and keep the transform attribute off entirely. The
// helpers below express each operation (rotation, flip, full-state
// bake) directly on endpoints. `setRotation` and `toggleFlip` auto-
// dispatch to them so callers don't need to know the difference.

/** True if `el` is a 2-point line-like element (`<line>` or an arrow
 *  `<g data-type="arrow">`). */
function isArrowGroup(el: Element): boolean {
  return el.tagName === "g" && el.getAttribute("data-type") === "arrow";
}
function isLineLike(el: Element): boolean {
  return el.tagName === "line" || isArrowGroup(el);
}

/** Read a line/arrow's endpoint coords (in its current coord frame —
 *  for a baked element, that's svg-root coords). */
function lineEndpointsOf(el: SVGElement): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  if (isArrowGroup(el)) return readArrowEndpoints(el);
  return {
    x1: Number.parseFloat(el.getAttribute("x1") || "0"),
    y1: Number.parseFloat(el.getAttribute("y1") || "0"),
    x2: Number.parseFloat(el.getAttribute("x2") || "0"),
    y2: Number.parseFloat(el.getAttribute("y2") || "0"),
  };
}

/** Write endpoint coords back to a line or arrow (rebuilds the arrow's
 *  stem + head paths automatically). */
function setLineEndpoints(el: SVGElement, x1: number, y1: number, x2: number, y2: number): void {
  if (isArrowGroup(el)) {
    writeArrowEndpoints(el, x1, y1, x2, y2);
    refreshArrowPath(el);
    return;
  }
  el.setAttribute("x1", String(x1));
  el.setAttribute("y1", String(y1));
  el.setAttribute("x2", String(x2));
  el.setAttribute("y2", String(y2));
}


/** Compose the element's current transform state into a DOMMatrix.
 *  Shared by the endpoint+control-point transformation helpers so the
 *  math is identical everywhere. */
function composeLineMatrix(state: TransformState, midX: number, midY: number): DOMMatrix {
  const sx = state.flipH ? -1 : 1;
  const sy = state.flipV ? -1 : 1;
  const m = new DOMMatrix();
  m.translateSelf(state.tx, state.ty);
  m.translateSelf(midX, midY);
  m.rotateSelf(state.rotation);
  m.scaleSelf(sx, sy);
  m.translateSelf(-midX, -midY);
  return m;
}

/** Return a line/arrow's endpoint + optional control-point coords in
 *  world space, applying any lingering `data-rot` / `data-flip-*` /
 *  `data-tx,ty` WITHOUT mutating the element. Used by read-only
 *  consumers (e.g. PPTX export) and by the mutating `bakeLineTransform`
 *  below. The control point is included so curved arrows survive the
 *  transform intact. */
export function getEffectiveLineEndpoints(el: SVGElement): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number | null;
  cy: number | null;
} {
  const ep = lineEndpointsOf(el);
  const control = isArrowGroup(el) ? readArrowControl(el) : null;
  if (!isLineLike(el)) {
    return { ...ep, cx: control?.x ?? null, cy: control?.y ?? null };
  }
  const s = readTransformState(el);
  const identity = s.tx === 0 && s.ty === 0 && s.rotation === 0 && !s.flipH && !s.flipV;
  if (identity) {
    return { ...ep, cx: control?.x ?? null, cy: control?.y ?? null };
  }
  const midX = (ep.x1 + ep.x2) / 2;
  const midY = (ep.y1 + ep.y2) / 2;
  const m = composeLineMatrix(s, midX, midY);
  const p1 = new DOMPoint(ep.x1, ep.y1).matrixTransform(m);
  const p2 = new DOMPoint(ep.x2, ep.y2).matrixTransform(m);
  let cx: number | null = null;
  let cy: number | null = null;
  if (control) {
    const pc = new DOMPoint(control.x, control.y).matrixTransform(m);
    cx = pc.x;
    cy = pc.y;
  }
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, cx, cy };
}

/** Collapse any rotation/flip/translate state on a line/arrow into
 *  its endpoints (and control point, for curved arrows), clearing the
 *  `transform` attribute + data-* state. Idempotent. Call before any
 *  gesture on a line/arrow to normalize legacy saved content that
 *  still carries a transform attribute. */
export function bakeLineTransform(el: SVGElement): void {
  if (!isLineLike(el)) return;
  const s = readTransformState(el);
  const identity = s.tx === 0 && s.ty === 0 && s.rotation === 0 && !s.flipH && !s.flipV;
  if (identity) return;
  const { x1, y1, x2, y2, cx, cy } = getEffectiveLineEndpoints(el);
  setLineEndpoints(el, x1, y1, x2, y2);
  if (isArrowGroup(el) && cx != null && cy != null) {
    writeArrowControl(el, { x: cx, y: cy });
    refreshArrowPath(el);
  }
  el.removeAttribute("transform");
  el.removeAttribute("data-rot");
  el.removeAttribute("data-flip-h");
  el.removeAttribute("data-flip-v");
  el.removeAttribute("data-tx");
  el.removeAttribute("data-ty");
}

/** Rotate a line's endpoints (and control point, if curved) by `deg`
 *  around the midpoint of the two endpoints. */
export function rotateLineEndpointsBy(el: SVGElement, deg: number): void {
  bakeLineTransform(el);
  const ep = lineEndpointsOf(el);
  const midX = (ep.x1 + ep.x2) / 2;
  const midY = (ep.y1 + ep.y2) / 2;
  const rad = (deg * Math.PI) / 180;
  const p1 = rotateAround(ep.x1, ep.y1, midX, midY, rad);
  const p2 = rotateAround(ep.x2, ep.y2, midX, midY, rad);
  setLineEndpoints(el, p1.x, p1.y, p2.x, p2.y);
  if (isArrowGroup(el)) {
    const control = readArrowControl(el);
    if (control) {
      const pc = rotateAround(control.x, control.y, midX, midY, rad);
      writeArrowControl(el, pc);
      refreshArrowPath(el);
    }
  }
}

/** Mirror a line's endpoints (and control point) across its midpoint
 *  on the given axis. */
export function flipLineEndpoints(el: SVGElement, axis: "h" | "v"): void {
  bakeLineTransform(el);
  const ep = lineEndpointsOf(el);
  const midX = (ep.x1 + ep.x2) / 2;
  const midY = (ep.y1 + ep.y2) / 2;
  if (axis === "h") {
    setLineEndpoints(el, 2 * midX - ep.x1, ep.y1, 2 * midX - ep.x2, ep.y2);
  } else {
    setLineEndpoints(el, ep.x1, 2 * midY - ep.y1, ep.x2, 2 * midY - ep.y2);
  }
  if (isArrowGroup(el)) {
    const control = readArrowControl(el);
    if (control) {
      const fc =
        axis === "h"
          ? { x: 2 * midX - control.x, y: control.y }
          : { x: control.x, y: 2 * midY - control.y };
      writeArrowControl(el, fc);
      refreshArrowPath(el);
    }
  }
}

export { isLineLike };

export interface TransformState {
  tx: number;
  ty: number;
  rotation: number; // degrees, CW positive
  flipH: boolean;
  flipV: boolean;
}

/** Elements whose position lives in their own geometry attrs (not in
 *  a translate transform). For these, `tx`/`ty` are always 0; movement
 *  shifts those geometry attrs directly and the transform only carries
 *  rotation/flip. */
export function usesGeometryPosition(el: Element): boolean {
  const tag = el.tagName;
  return (
    tag === "rect" ||
    tag === "ellipse" ||
    tag === "circle" ||
    tag === "image" ||
    tag === "text" ||
    tag === "line" ||
    tag === "foreignObject"
  );
}

/** Read the current transform state. Migrates legacy `translate(tx,ty)`
 *  values found on `<g>` / `<path>` into data-tx/data-ty so subsequent
 *  reads/writes use the unified path.  */
export function readTransformState(el: SVGElement): TransformState {
  const rotation = Number.parseFloat(el.getAttribute("data-rot") || "0") || 0;
  const flipH = el.getAttribute("data-flip-h") === "1";
  const flipV = el.getAttribute("data-flip-v") === "1";

  let tx = 0;
  let ty = 0;
  if (!usesGeometryPosition(el)) {
    const dtx = el.getAttribute("data-tx");
    const dty = el.getAttribute("data-ty");
    if (dtx != null && dty != null) {
      tx = Number.parseFloat(dtx) || 0;
      ty = Number.parseFloat(dty) || 0;
    } else {
      // Legacy: parse the existing transform's translate component.
      const t = el.getAttribute("transform") || "";
      const m = t.match(/translate\(\s*([\d.-]+)\s*,?\s*([\d.-]+)\s*\)/);
      if (m) {
        // Both capture groups are present on a successful match.
        tx = Number.parseFloat(m[1]!);
        ty = Number.parseFloat(m[2]!);
      }
      // Persist the migrated values so the next read is fast.
      el.setAttribute("data-tx", String(tx));
      el.setAttribute("data-ty", String(ty));
    }
  }
  return { tx, ty, rotation, flipH, flipV };
}

/** Compute the local bbox center (in pre-transform coords). For
 *  geometry-positioned elements this is the bbox center in the parent
 *  coord system; for translate-positioned elements it's the center in
 *  the element's local frame. */
function localCenter(el: SVGElement): { cx: number; cy: number } | null {
  const g = el as SVGGraphicsElement;
  if (!g.getBBox) return null;
  let bb: DOMRect;
  try {
    bb = g.getBBox();
  } catch {
    return null;
  }
  return { cx: bb.x + bb.width / 2, cy: bb.y + bb.height / 2 };
}

/** Recompute the element's `transform` attribute from its current
 *  data-* state and local geometry. Idempotent — call after any state
 *  change. */
export function applyTransformState(el: SVGElement, state?: TransformState): void {
  const s = state ?? readTransformState(el);
  const isIdentity = s.tx === 0 && s.ty === 0 && s.rotation === 0 && !s.flipH && !s.flipV;

  if (isIdentity) {
    el.removeAttribute("transform");
    return;
  }

  // No rotation, no flip → keep the legacy "translate(tx, ty)" shape so
  // diffs against pre-rotation files stay minimal.
  if (s.rotation === 0 && !s.flipH && !s.flipV) {
    el.setAttribute("transform", `translate(${s.tx}, ${s.ty})`);
    return;
  }

  const center = localCenter(el);
  // Pivot fallback: for elements where getBBox is unavailable (very
  // rare), pivot at origin. Visually unsatisfying but never throws.
  const cx = center?.cx ?? 0;
  const cy = center?.cy ?? 0;
  const sx = s.flipH ? -1 : 1;
  const sy = s.flipV ? -1 : 1;

  const m = new DOMMatrix();
  m.translateSelf(s.tx, s.ty);
  m.translateSelf(cx, cy);
  m.rotateSelf(s.rotation);
  m.scaleSelf(sx, sy);
  m.translateSelf(-cx, -cy);

  el.setAttribute(
    "transform",
    `matrix(${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ${fmt(m.e)} ${fmt(m.f)})`,
  );
}

function fmt(n: number): string {
  // Trim trailing zeros — SVG matrix attrs accept short forms.
  return Math.abs(n) < 1e-9 ? "0" : Number(n.toFixed(6)).toString();
}

/** Persist a (possibly partial) state update and re-apply the
 *  composite transform. Callout tails get rebuilt automatically since
 *  rotation/flip pivots can change as the bbox changes. */
export function writeTransformState(el: SVGElement, patch: Partial<TransformState>): void {
  const cur = readTransformState(el);
  const next: TransformState = { ...cur, ...patch };
  if (next.rotation !== 0) el.setAttribute("data-rot", String(next.rotation));
  else el.removeAttribute("data-rot");
  if (next.flipH) el.setAttribute("data-flip-h", "1");
  else el.removeAttribute("data-flip-h");
  if (next.flipV) el.setAttribute("data-flip-v", "1");
  else el.removeAttribute("data-flip-v");
  if (!usesGeometryPosition(el)) {
    el.setAttribute("data-tx", String(next.tx));
    el.setAttribute("data-ty", String(next.ty));
  }
  applyTransformState(el, next);
  // Tail base anchors at a closest-edge midpoint, which depends on the
  // unrotated bg rect. Recompute defensively so visual stays consistent.
  if (
    el.tagName === "g" &&
    el.getAttribute("data-type") === "textbox" &&
    el.getAttribute("data-text-variant") === "callout"
  ) {
    rebuildCalloutTail(el);
  }
}

/** Apply a translation delta. For geometry-positioned elements, the
 *  caller updates x/y/cx/cy/etc. directly and then calls this with
 *  dx=dy=0 — the helper still recomputes the transform so the rotation
 *  pivot tracks the new bbox center. */
export function nudgeTranslate(el: SVGElement, dx: number, dy: number): void {
  if (usesGeometryPosition(el)) {
    applyTransformState(el);
    return;
  }
  const cur = readTransformState(el);
  writeTransformState(el, { tx: cur.tx + dx, ty: cur.ty + dy });
}

/** Toggle a flip axis. For line/arrow elements the flip is baked
 *  into endpoint coordinates (no transform attribute); for everything
 *  else the flip is persisted as a data-flip-h/v attribute.
 *
 *  The flip acts in SCREEN space: a Flip V on a rect that's currently
 *  rotated 30° mirrors the visibly-rotated shape across a horizontal
 *  screen axis through its visible center — it does NOT mirror the
 *  rect in its pre-rotation local frame (which would visually look
 *  like the shape just jumped to a new rotation, not like a flip).
 *
 *  Composing a screen-space reflection S_screen after the existing
 *  transform T * R * S * T⁻¹ reduces via the identity S * R(θ) =
 *  R(−θ) * S to the same transform shape with: rotation negated AND
 *  the target flip-axis toggled. So the fix is one sign flip on
 *  rotation + one boolean toggle. */
export function toggleFlip(el: SVGElement, axis: "h" | "v"): void {
  if (isLineLike(el)) {
    flipLineEndpoints(el, axis);
    return;
  }
  const cur = readTransformState(el);
  // rotation === 0 stays 0 (no sign to flip); also keeps the emit-no-
  // transform fast path in applyTransformState unchanged for the common
  // unrotated case.
  const nextRotation = cur.rotation === 0 ? 0 : -cur.rotation;
  if (axis === "h") {
    writeTransformState(el, { flipH: !cur.flipH, rotation: nextRotation });
  } else {
    writeTransformState(el, { flipV: !cur.flipV, rotation: nextRotation });
  }
}

/** Set rotation (degrees, CW positive). Normalized to [-180, 180).
 *  For line/arrow elements rotation is baked into endpoints: the
 *  argument is interpreted as the target absolute rotation relative
 *  to the element's current orientation (i.e. the caller sees a
 *  stateless rotation — always rotates FROM the current endpoints).
 *  Because baked lines always report rotation=0 via readTransformState,
 *  the typical caller pattern `setRotation(el, readRotation() + delta)`
 *  still works and applies `delta` degrees. */
export function setRotation(el: SVGElement, deg: number): void {
  let d = deg % 360;
  if (d >= 180) d -= 360;
  else if (d < -180) d += 360;
  // Snap to 0 within a tiny epsilon so the transform attr drops out
  // entirely when the user spins back to upright.
  if (Math.abs(d) < 0.05) d = 0;
  if (isLineLike(el)) {
    // Baked lines: treat `d` as a rotation amount (from the current
    // orientation) since their logical "rotation" is always 0 post-
    // bake. Rotating by d around the midpoint yields the same visual
    // as a transform-based rotation by d would.
    rotateLineEndpointsBy(el, d);
    return;
  }
  writeTransformState(el, { rotation: d });
}
