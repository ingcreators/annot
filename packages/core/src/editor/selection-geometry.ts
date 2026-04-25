// Tier A — pure geometry helpers used by the SelectionManager (live
// editor, Tier C) and the smart-guide overlay. None of these touch
// the DOM: callers feed in plain `{x, y, width, height}` rects and
// numeric angles / coordinates.
//
// History: previously split across
//   - `@ingcreators/annot-editor/smart-guides`     (`computeSnap`)
//   - `@ingcreators/annot-editor/selection-helpers` (`rotateAround`, `cursorForAngle`)
//   - `@ingcreators/annot-core/editor/transform-utils` (private `rotateAround`)
// Centralising them here removes one duplicate, exposes the snap and
// rotation math to pure-Node tests, and unblocks the future headless
// SelectionManager-equivalent.

/** Plain rectangle shape. Structurally compatible with `DOMRect`, so
 *  existing callers passing `DOMRect[]` continue to typecheck. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─────────────────────────────────────────────────────────────────────
// Rotation
// ─────────────────────────────────────────────────────────────────────

/**
 * Rotate the point `(px, py)` around the pivot `(cx, cy)` by `rad`
 * radians (positive = counter-clockwise in screen-space terms,
 * which matches Math.cos / Math.sin convention).
 */
export function rotateAround(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rad: number,
): { x: number; y: number } {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx + (px - cx) * cos - (py - cy) * sin,
    y: cy + (px - cx) * sin + (py - cy) * cos,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Resize-handle cursor lookup
// ─────────────────────────────────────────────────────────────────────

/** 8 axis-aligned resize cursor names, indexed by 45° sector starting
 *  from "due east" (right) and walking clockwise. Used to map a
 *  handle's screen-space angle (relative to its element's center)
 *  into an appropriate cursor — so a NW handle on a 45°-rotated rect
 *  ends up showing a north-pointing cursor instead of an NW one. */
const CURSOR_BY_SECTOR = [
  "ew-resize", // 0 → E (-22.5°..22.5°)
  "nwse-resize", // 1 → SE
  "ns-resize", // 2 → S
  "nesw-resize", // 3 → SW
  "ew-resize", // 4 → W
  "nwse-resize", // 5 → NW
  "ns-resize", // 6 → N
  "nesw-resize", // 7 → NE
] as const;

/** Pick the appropriate axis-aligned cursor for the angle at which a
 *  resize handle sits relative to its element's centre.
 *
 *  The angle is normalised into `[0, 2π)`, offset by π/8 so cursor
 *  "centres" align with E/SE/S/SW/W/NW/N/NE, then bucketed into 8
 *  equal 45° sectors. */
export function cursorForAngle(rad: number): string {
  const TAU = Math.PI * 2;
  let a = ((rad % TAU) + TAU) % TAU;
  a += Math.PI / 8;
  if (a >= TAU) a -= TAU;
  const idx = Math.floor(a / (Math.PI / 4));
  // `idx % 8` is in `[0, 7]` and `CURSOR_BY_SECTOR` has 8 entries.
  return CURSOR_BY_SECTOR[idx % 8]!;
}

// ─────────────────────────────────────────────────────────────────────
// Smart-guide snap
// ─────────────────────────────────────────────────────────────────────

export interface SnapGuide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SnapResult {
  /** Adjusted drag delta in world units — what the caller should
   *  apply instead of the raw pointer delta. */
  dx: number;
  dy: number;
  /** World-space line segments to render as dashed guides. Each
   *  guide is an axis-aligned line through the snap point. */
  guides: SnapGuide[];
}

export interface SnapInput {
  /** Bounding boxes of the dragged (selected) elements in world
   *  space, computed BEFORE applying the current delta. */
  draggedBoxes: readonly Rect[];
  /** Raw pointer delta the caller wants to apply. */
  dx: number;
  dy: number;
  /** Bounding boxes of NON-dragged elements to snap against. */
  otherBoxes: readonly Rect[];
  /** Snap activation radius in world units. Typically 4–6 px. */
  threshold: number;
}

/** Compute the union rect of a non-empty list of `Rect`. Caller is
 *  responsible for the non-empty precondition; the public `computeSnap`
 *  short-circuits when `draggedBoxes` is empty so this never gets a
 *  zero-length input. */
function unionRect(rects: readonly Rect[]): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Compute a snapped drag delta and the guide lines to render.
 *
 * Snap candidates per axis (for each dragged-bbox edge):
 *   left   ↔ other's left, center-x, right
 *   center ↔ same three
 *   right  ↔ same three
 * Same six comparisons on Y. That's 18 candidate offsets per
 * (dragged-union, other) pair; the smallest absolute delta per axis
 * wins, breaking ties by edge-similarity.
 *
 * Returns the raw `dx` / `dy` unmodified when no snap candidate is
 * within `threshold`.
 */
export function computeSnap(input: SnapInput): SnapResult {
  const { draggedBoxes, dx, dy, otherBoxes, threshold } = input;
  if (draggedBoxes.length === 0 || otherBoxes.length === 0) {
    return { dx, dy, guides: [] };
  }
  // Union bbox of the dragged group after the proposed move — we
  // snap the group's leading/center/trailing edges, not each
  // individual dragged element. This makes multi-select drag feel
  // like moving a single bigger object.
  const unionBefore = unionRect(draggedBoxes);
  const proposed = {
    left: unionBefore.x + dx,
    right: unionBefore.x + unionBefore.width + dx,
    centerX: unionBefore.x + unionBefore.width / 2 + dx,
    top: unionBefore.y + dy,
    bottom: unionBefore.y + unionBefore.height + dy,
    centerY: unionBefore.y + unionBefore.height / 2 + dy,
  };

  let bestX: { delta: number; guide: SnapGuide } | null = null;
  let bestY: { delta: number; guide: SnapGuide } | null = null;

  for (const other of otherBoxes) {
    const oEdges = {
      left: other.x,
      right: other.x + other.width,
      centerX: other.x + other.width / 2,
      top: other.y,
      bottom: other.y + other.height,
      centerY: other.y + other.height / 2,
    };
    // --- X axis ---
    for (const pv of [proposed.left, proposed.centerX, proposed.right]) {
      for (const ov of [oEdges.left, oEdges.centerX, oEdges.right]) {
        const diff = ov - pv;
        if (Math.abs(diff) <= threshold) {
          if (!bestX || Math.abs(diff) < Math.abs(bestX.delta)) {
            // Guide runs vertically through the aligned x, spanning
            // the union of both bboxes in y so it visually ties them.
            const x = ov;
            const y1 = Math.min(unionBefore.y + dy, other.y);
            const y2 = Math.max(unionBefore.y + dy + unionBefore.height, other.y + other.height);
            bestX = { delta: diff, guide: { x1: x, y1, x2: x, y2 } };
          }
        }
      }
    }
    // --- Y axis ---
    for (const pv of [proposed.top, proposed.centerY, proposed.bottom]) {
      for (const ov of [oEdges.top, oEdges.centerY, oEdges.bottom]) {
        const diff = ov - pv;
        if (Math.abs(diff) <= threshold) {
          if (!bestY || Math.abs(diff) < Math.abs(bestY.delta)) {
            const y = ov;
            const x1 = Math.min(unionBefore.x + dx, other.x);
            const x2 = Math.max(unionBefore.x + dx + unionBefore.width, other.x + other.width);
            bestY = { delta: diff, guide: { x1, y1: y, x2, y2: y } };
          }
        }
      }
    }
  }

  const guides: SnapGuide[] = [];
  let adjDx = dx;
  let adjDy = dy;
  if (bestX) {
    adjDx += bestX.delta;
    guides.push(bestX.guide);
  }
  if (bestY) {
    adjDy += bestY.delta;
    guides.push(bestY.guide);
  }
  return { dx: adjDx, dy: adjDy, guides };
}
