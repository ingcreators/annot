// Coordinate rebasing for sub-region (locator) screenshots.
//
// Phase 2 of `docs/plans/playwright-screenshot-annot-fixture.md`.
//
// `locator.screenshot()` returns a PNG cropped to the locator's
// bounding box. Annotation coordinates (whether MDX-derived from the
// snapshot or caller-supplied via `annot.overlays`) live in PAGE
// space. To overlay correctly on the cropped image, every coordinate
// needs to be rebased by `(clip.x, clip.y)`, and overlays whose
// bbox falls fully outside the clip must be dropped (warning + skip
// per Open Question 4; no fail-fast in v1).
//
// All functions are pure — `clip` in, annotations in, rebased
// annotations + dropped diagnostic out. The fixture's
// `runAnnotMode` calls this once per locator screenshot.

import type {
  BBox,
  BboxAnnotation,
  BboxArrowAnnotation,
  BboxCalloutAnnotation,
  BboxCircleAnnotation,
  BboxNumberedBadgeAnnotation,
  BboxRectAnnotation,
  BboxTextAnnotation,
  Point,
  RawAnnotation,
} from "@ingcreators/annot-annotator";

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RebaseResult {
  /** Annotations whose coordinates were rebased into clip-space. */
  kept: BboxAnnotation[];
  /** Annotations that fell outside `clip` and were dropped. The
   *  caller surfaces these as `RenderResult.droppedOverlays` /
   *  `test.info().annotations` warnings. */
  dropped: BboxAnnotation[];
}

/**
 * Rebase + filter a `BboxAnnotation[]` against a clip rectangle.
 *
 * - `kept` = annotations whose visible coords were translated by
 *   `(-clip.x, -clip.y)`. The new coords are in the clipped image's
 *   coordinate space (0,0 at the top-left of the screenshot).
 * - `dropped` = annotations whose bbox / endpoints fell outside the
 *   clip. Returned verbatim (un-rebased) so the caller can log
 *   which originals were skipped.
 *
 * `numberedBadge`'s `imageWidth` / `imageHeight` are also rebased
 * to match the clip dimensions, so `placement: "auto"` picks the
 * corner against the cropped image edge rather than the page edge.
 */
export function rebaseAnnotations(annotations: BboxAnnotation[], clip: Clip): RebaseResult {
  const kept: BboxAnnotation[] = [];
  const dropped: BboxAnnotation[] = [];
  for (const ann of annotations) {
    const rebased = rebaseOne(ann, clip);
    if (rebased) kept.push(rebased);
    else dropped.push(ann);
  }
  return { kept, dropped };
}

function rebaseOne(ann: BboxAnnotation, clip: Clip): BboxAnnotation | null {
  switch (ann.type) {
    case "rect":
      return rebaseRect(ann, clip);
    case "numberedBadge":
      return rebaseBadge(ann, clip);
    case "callout":
      return rebaseCallout(ann, clip);
    case "circle":
      return rebaseCircle(ann, clip);
    case "arrow":
      return rebaseArrow(ann, clip);
    case "text":
      return rebaseText(ann, clip);
    case "raw":
      // Raw SVG fragment — we can't safely walk arbitrary user
      // SVG and translate every coord. Keep verbatim; caller is
      // responsible for emitting clip-space coords if they want
      // visual correctness on locator screenshots.
      return rebaseRaw(ann);
  }
}

function rebaseRect(ann: BboxRectAnnotation, clip: Clip): BboxRectAnnotation | null {
  if (!bboxFitsInClip(ann.bbox, clip)) return null;
  return { ...ann, bbox: translateBBox(ann.bbox, clip) };
}

function rebaseBadge(
  ann: BboxNumberedBadgeAnnotation,
  clip: Clip,
): BboxNumberedBadgeAnnotation | null {
  if (!bboxFitsInClip(ann.bbox, clip)) return null;
  return {
    ...ann,
    bbox: translateBBox(ann.bbox, clip),
    // imageWidth / imageHeight describe the canvas the badge is
    // placed on. After clipping that's the clip's own dims —
    // `placement: "auto"` then picks the corner against the
    // cropped edge.
    imageWidth: clip.width,
    imageHeight: clip.height,
  };
}

function rebaseCallout(ann: BboxCalloutAnnotation, clip: Clip): BboxCalloutAnnotation | null {
  if (!bboxFitsInClip(ann.targetBbox, clip)) return null;
  if (!pointFitsInClip(ann.at, clip)) return null;
  return {
    ...ann,
    at: translatePoint(ann.at, clip),
    targetBbox: translateBBox(ann.targetBbox, clip),
  };
}

function rebaseCircle(ann: BboxCircleAnnotation, clip: Clip): BboxCircleAnnotation | null {
  // Use the circle's bounding square as the containment test.
  const bbox: BBox = {
    x: ann.center.x - ann.radius,
    y: ann.center.y - ann.radius,
    width: ann.radius * 2,
    height: ann.radius * 2,
  };
  if (!bboxFitsInClip(bbox, clip)) return null;
  return { ...ann, center: translatePoint(ann.center, clip) };
}

function rebaseArrow(ann: BboxArrowAnnotation, clip: Clip): BboxArrowAnnotation | null {
  // Both endpoints must be inside the clip — partial clipping
  // would produce an arrow that points into nowhere. Out of scope
  // for v1 (would need to compute the clip-edge intersection).
  if (!pointFitsInClip(ann.from, clip) || !pointFitsInClip(ann.to, clip)) return null;
  return {
    ...ann,
    from: translatePoint(ann.from, clip),
    to: translatePoint(ann.to, clip),
  };
}

function rebaseText(ann: BboxTextAnnotation, clip: Clip): BboxTextAnnotation | null {
  if (!pointFitsInClip(ann.at, clip)) return null;
  return { ...ann, at: translatePoint(ann.at, clip) };
}

function rebaseRaw(ann: RawAnnotation): RawAnnotation {
  // No translation — see comment in dispatch above.
  return ann;
}

function translateBBox(b: BBox, clip: Clip): BBox {
  return { x: b.x - clip.x, y: b.y - clip.y, width: b.width, height: b.height };
}

function translatePoint(p: Point, clip: Clip): Point {
  return { x: p.x - clip.x, y: p.y - clip.y };
}

/**
 * Strict containment: every corner of `b` must lie inside `clip`.
 * Partial overlap drops the annotation — see Open Question 4 of the
 * plan (warning + skip, not fail-fast; future `annot.strictClip`
 * could opt into stricter containment if needed).
 */
function bboxFitsInClip(b: BBox, clip: Clip): boolean {
  return (
    b.x >= clip.x &&
    b.y >= clip.y &&
    b.x + b.width <= clip.x + clip.width &&
    b.y + b.height <= clip.y + clip.height
  );
}

function pointFitsInClip(p: Point, clip: Clip): boolean {
  return (
    p.x >= clip.x && p.y >= clip.y && p.x <= clip.x + clip.width && p.y <= clip.y + clip.height
  );
}

/**
 * Format a short identifier for an annotation so dropped diagnostics
 * stay readable. We don't have a stable id field on the DSL types —
 * use `type` + first bbox coords as a heuristic.
 */
export function describeAnnotation(ann: BboxAnnotation): string {
  switch (ann.type) {
    case "rect":
    case "numberedBadge":
      return `${ann.type}@(${ann.bbox.x},${ann.bbox.y},${ann.bbox.width},${ann.bbox.height})`;
    case "callout":
      return `callout@(${ann.targetBbox.x},${ann.targetBbox.y},${ann.targetBbox.width},${ann.targetBbox.height})`;
    case "circle":
      return `circle@(${ann.center.x},${ann.center.y},r=${ann.radius})`;
    case "arrow":
      return `arrow@(${ann.from.x},${ann.from.y})→(${ann.to.x},${ann.to.y})`;
    case "text":
      return `text@(${ann.at.x},${ann.at.y})`;
    case "raw":
      return "raw[<svg fragment>]";
  }
}
