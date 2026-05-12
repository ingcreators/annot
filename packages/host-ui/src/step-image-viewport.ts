/**
 * `attachStepImageViewport(svg, options)` — Phase 7d of
 * `docs/plans/card-procedure-template.md`. Wires interactive
 * pan / zoom onto a step block's screenshot.
 *
 * The controller:
 *
 * - Sets the SVG's `viewBox` to the supplied initial rect (or
 *   the SVG's intrinsic viewBox if none is provided).
 * - Listens for `wheel` events to zoom in / out around the
 *   pointer. Wheel delta is treated as 1.1× per notch by
 *   default.
 * - Listens for pointer drag (left button) to pan the viewBox.
 *   Pan is clamped so the viewport stays inside the bitmap —
 *   the user can never pan the image entirely off-screen
 *   (Phase 7d-polish).
 * - Distinguishes drag from click: any pointer movement beyond
 *   a 4-pixel threshold during a pointerdown→pointerup cycle
 *   suppresses the synthetic `click` event that follows on
 *   pointerup. This prevents the doc shell's "click to open
 *   image modal" handler from firing every time the user pans
 *   (Phase 7d-polish).
 * - Exposes `current()` returning the live viewBox snapshot,
 *   `intrinsic()` returning the SVG's at-attach viewBox (the
 *   full image rect), `reset(rect?)` snapping back to the
 *   supplied or initial rect, `zoomBy(factor)` for UI button
 *   driven zoom (centred on the viewBox), and `dispose()` for
 *   teardown.
 *
 * The controller is read-only with respect to the model — it
 * never writes back to the host. Persistence is the caller's
 * job (the doc shell wires `current()` into the "Save view"
 * button handler).
 *
 * Lifecycle: caller invokes `attachStepImageViewport(...)` once
 * per materialised image slot. The returned `dispose()` is
 * called when the slot unmounts (block deleted / shell
 * destroyed).
 */

export interface StepImageViewportRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface StepImageViewportController {
  /** Current viewBox state (after any pan / zoom). */
  readonly current: () => StepImageViewportRect;
  /** The SVG's intrinsic viewBox at attach time — the "full
   *  image" rect, distinct from the supplied initial. The Reset
   *  button uses this to snap back to "show the entire image"
   *  even when the saved initial was a cropped sub-rect. */
  readonly intrinsic: () => StepImageViewportRect;
  /** The "no-viewport saved" default rect — the largest rect
   *  matching `targetAspect` that fits inside the intrinsic
   *  bitmap, anchored at the top-left. Falls back to the
   *  intrinsic when no target aspect is set. Used by the
   *  shell's Clear button so the user sees the same default
   *  view that a freshly-attached controller would show. */
  readonly defaultRect: () => StepImageViewportRect;
  /** Reset to a supplied rect (or to the controller's initial
   *  when no argument is passed). When `targetAspect` is set
   *  the supplied rect is snapped to that aspect before
   *  applying. */
  readonly reset: (rect?: StepImageViewportRect) => void;
  /** Zoom by a multiplicative factor (`factor < 1` zooms in,
   *  `> 1` zooms out), centred on the current viewBox centre.
   *  Used by the UI zoom buttons in the toolbar. */
  readonly zoomBy: (factor: number) => void;
  /** Phase 7d-polish: true between a drag-end pointerup and the
   *  next user interaction. The doc shell consults this in its
   *  click handler — if a drag just ended, the click that
   *  follows is treated as the drag's tail, not a "click to
   *  open editor". The flag clears on the NEXT pointerdown,
   *  so a fresh click without a preceding drag isn't gated. */
  readonly wasDragging: () => boolean;
  /** Tear down listeners. Idempotent. */
  readonly dispose: () => void;
}

export interface StepImageViewportOptions {
  /** Initial display rect in SVG coords. Defaults to the SVG's
   *  intrinsic `viewBox` (parsed from its element attribute). */
  readonly initial?: StepImageViewportRect;
  /** Minimum zoom in (smallest viewBox w/h, in SVG units).
   *  Defaults to 32. Prevents zooming into a single pixel. */
  readonly minSize?: number;
  /** Maximum viewBox size — defaults to the SVG's intrinsic
   *  dimensions, so the user can't zoom out beyond the full
   *  image. Pass `Infinity` to lift the cap. */
  readonly maxSize?: number;
  /** Wheel zoom factor per notch. Default 1.1. */
  readonly wheelStep?: number;
  /** Phase 7d-polish: pointer-movement threshold (in CSS
   *  pixels) past which the controller switches from "this is
   *  a click" to "this is a drag". Drags suppress the
   *  synthetic `click` event so the doc shell's modal opener
   *  doesn't fire. Default 4. */
  readonly dragThresholdPx?: number;
  /** Phase 7d-polish 2: lock the viewBox's aspect ratio to a
   *  target (e.g. `16 / 9` to match the card slot's fixed-
   *  aspect frame). When set, the initial rect is snapped to
   *  this aspect, and every subsequent zoom keeps it.
   *  Without this lock, pan/zoom on a non-16:9 saved viewport
   *  would letterbox INSIDE the slot — different per card,
   *  giving inconsistent image-starting positions across
   *  step blocks that share the same source bitmap. */
  readonly targetAspect?: number;
}

/** Parse `viewBox="x y w h"` into a rect. Returns `null` when
 *  the attribute is missing or malformed (caller falls back to
 *  width / height attrs). */
function parseViewBox(svg: SVGSVGElement): StepImageViewportRect | null {
  const raw = svg.getAttribute("viewBox");
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 4) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/** Read the SVG's intrinsic dimensions for the `maxSize` cap. */
function readIntrinsicSize(svg: SVGSVGElement): { w: number; h: number } {
  const vb = parseViewBox(svg);
  if (vb) return { w: vb.w, h: vb.h };
  const w = Number.parseFloat(svg.getAttribute("width") ?? "");
  const h = Number.parseFloat(svg.getAttribute("height") ?? "");
  return { w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0 };
}

export function attachStepImageViewport(
  svg: SVGSVGElement,
  options: StepImageViewportOptions = {},
): StepImageViewportController {
  const intrinsic = readIntrinsicSize(svg);
  const intrinsicVb = parseViewBox(svg) ?? { x: 0, y: 0, w: intrinsic.w, h: intrinsic.h };
  const minSize = options.minSize ?? 32;
  const targetAspect = options.targetAspect ?? null;
  // Default cap: when a `targetAspect` is set, the user-visible
  // "fit everything" viewport is the smallest rect of that
  // aspect that CONTAINS the bitmap (see
  // `defaultRectForAspect`). For a portrait 720×1280 bitmap at
  // 16:9, that's 2275×1280 — wider than either intrinsic
  // dimension. Cap `maxSize` at the larger axis of that
  // contain rect so the user can always zoom out to the full
  // image, regardless of aspect mismatch.
  const containSize =
    targetAspect !== null
      ? Math.max(intrinsic.w, intrinsic.h, intrinsic.h * targetAspect, intrinsic.w / targetAspect)
      : Math.max(intrinsic.w, intrinsic.h);
  const maxSize = options.maxSize ?? (containSize || Number.POSITIVE_INFINITY);
  const wheelStep = options.wheelStep ?? 1.1;
  const dragThreshold = options.dragThresholdPx ?? 4;

  // Phase 7d-polish 2: when a `targetAspect` is set, the initial
  // rect is snapped to it. If no initial was supplied, derive
  // the smallest target-aspect rect that CONTAINS the intrinsic
  // bitmap, centred over the bitmap (so every step sharing the
  // same source image gets an identical default view that shows
  // the entire image — letterboxed for non-target-aspect
  // sources).
  const rawInitial =
    options.initial ??
    (targetAspect !== null ? defaultRectForAspect(intrinsicVb, targetAspect) : intrinsicVb);
  const initial = targetAspect !== null ? snapToAspect(rawInitial, targetAspect) : rawInitial;

  let state: StepImageViewportRect = clampPan(clampSize({ ...initial }));
  apply(state);

  /** Phase 7d-polish 2 — compute the smallest rect of the given
   *  aspect that CONTAINS the supplied bitmap, centred over the
   *  bitmap. This is the "fit everything into the frame"
   *  default: for a portrait source on a 16:9 frame, the
   *  returned rect extends horizontally beyond the bitmap (the
   *  out-of-bitmap area renders as the SVG background, which
   *  the slot's `overflow: hidden` clips to the card chrome).
   *
   *  Earlier revisions used "cover" semantics (largest rect
   *  fitting INSIDE the bitmap, anchored at the top-left) so
   *  every step showed an identical top-left crop of a near-
   *  16:9 screenshot. That left portrait sources permanently
   *  cropped to their top band with no way to zoom out far
   *  enough to see the whole image — `maxSize` was capped at
   *  the larger intrinsic dimension. "Contain" semantics restore
   *  full-image visibility by default while still pinning a
   *  consistent starting view across cards. */
  function defaultRectForAspect(
    bitmap: StepImageViewportRect,
    aspect: number,
  ): StepImageViewportRect {
    // Pick the binding axis: if the bitmap is already wider than
    // the target aspect demands for its height, wrap by width and
    // expand height; otherwise wrap by height and expand width.
    let w: number;
    let h: number;
    if (bitmap.w >= bitmap.h * aspect) {
      // Bitmap is wider-than-target — expand height to wrap.
      w = bitmap.w;
      h = bitmap.w / aspect;
    } else {
      // Bitmap is taller-than-target — expand width to wrap.
      h = bitmap.h;
      w = bitmap.h * aspect;
    }
    // Centre the contain rect on the bitmap so letterbox is
    // symmetric on whichever axis got expanded.
    return {
      x: bitmap.x + (bitmap.w - w) / 2,
      y: bitmap.y + (bitmap.h - h) / 2,
      w,
      h,
    };
  }

  /** Phase 7d-polish 2 — adjust the rect to match a target
   *  aspect ratio by SHRINKING the wider dimension. Centred
   *  on the input rect's centre so the shift is symmetric. */
  function snapToAspect(rect: StepImageViewportRect, aspect: number): StepImageViewportRect {
    if (rect.w <= 0 || rect.h <= 0) return rect;
    const currentAspect = rect.w / rect.h;
    if (Math.abs(currentAspect - aspect) < 1e-6) return rect;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    let w = rect.w;
    let h = rect.h;
    if (currentAspect > aspect) {
      // Too wide — shrink width.
      w = h * aspect;
    } else {
      // Too tall — shrink height.
      h = w / aspect;
    }
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function apply(rect: StepImageViewportRect): void {
    svg.setAttribute("viewBox", `${rect.x} ${rect.y} ${rect.w} ${rect.h}`);
  }

  function clampSize(rect: StepImageViewportRect): StepImageViewportRect {
    // Clamp viewBox size to [minSize, maxSize] on both axes,
    // preserving aspect ratio of the current rect. Aspect is
    // resolved from rect.w / rect.h; degenerate cases (w or h
    // ≤ 0) get an aspect of 1 to avoid division-by-zero.
    const aspect = rect.h > 0 ? rect.w / rect.h : 1;
    let w = rect.w;
    let h = rect.h;
    if (w < minSize) {
      w = minSize;
      h = w / aspect;
    } else if (w > maxSize) {
      w = maxSize;
      h = w / aspect;
    }
    if (h < minSize) {
      h = minSize;
      w = h * aspect;
    } else if (h > maxSize) {
      h = maxSize;
      w = h * aspect;
    }
    return { x: rect.x, y: rect.y, w, h };
  }

  /** Phase 7d-polish: clamp the viewBox origin so the viewport
   *  rect stays inside the bitmap. When the viewport is
   *  smaller than the bitmap, the origin is bounded to
   *  `[intrinsic.x, intrinsic.x + intrinsic.w - rect.w]`.
   *  When the viewport is LARGER than the bitmap (zoomed out
   *  past it), centre the bitmap inside the viewport so the
   *  user always sees the image, no matter how far they pan. */
  function clampPan(rect: StepImageViewportRect): StepImageViewportRect {
    const xMin = intrinsicVb.x;
    const xMax = intrinsicVb.x + intrinsicVb.w - rect.w;
    const yMin = intrinsicVb.y;
    const yMax = intrinsicVb.y + intrinsicVb.h - rect.h;
    let x = rect.x;
    let y = rect.y;
    if (xMax < xMin) {
      // Viewport wider than bitmap — centre the bitmap.
      x = intrinsicVb.x + (intrinsicVb.w - rect.w) / 2;
    } else {
      if (x < xMin) x = xMin;
      else if (x > xMax) x = xMax;
    }
    if (yMax < yMin) {
      y = intrinsicVb.y + (intrinsicVb.h - rect.h) / 2;
    } else {
      if (y < yMin) y = yMin;
      else if (y > yMax) y = yMax;
    }
    return { x, y, w: rect.w, h: rect.h };
  }

  // ---- Wheel zoom -------------------------------------------------------

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY > 0 ? wheelStep : 1 / wheelStep;
    zoomAroundClient(factor, e.clientX, e.clientY);
  }

  /** Zoom around the supplied client coordinate (cursor anchor
   *  for the wheel handler; viewBox-centre anchor for the
   *  zoom buttons). The point under the anchor stays anchored
   *  to the same screen pixel after the zoom. */
  function zoomAroundClient(factor: number, clientX: number, clientY: number): void {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const sx = (clientX - rect.left) / rect.width;
    const sy = (clientY - rect.top) / rect.height;
    const cx = state.x + sx * state.w;
    const cy = state.y + sy * state.h;
    const next = clampPan(
      clampSize({
        x: cx - sx * (state.w * factor),
        y: cy - sy * (state.h * factor),
        w: state.w * factor,
        h: state.h * factor,
      }),
    );
    state = next;
    apply(state);
  }

  /** UI-button zoom: centred on the current viewBox. */
  function zoomByCenter(factor: number): void {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // No bounding rect (detached / unrendered) — zoom by
      // mutating state directly around the viewBox centre.
      const cx = state.x + state.w / 2;
      const cy = state.y + state.h / 2;
      const next = clampPan(
        clampSize({
          x: cx - (state.w * factor) / 2,
          y: cy - (state.h * factor) / 2,
          w: state.w * factor,
          h: state.h * factor,
        }),
      );
      state = next;
      apply(state);
      return;
    }
    const centerClientX = rect.left + rect.width / 2;
    const centerClientY = rect.top + rect.height / 2;
    zoomAroundClient(factor, centerClientX, centerClientY);
  }

  // ---- Pan + drag-vs-click disambiguation ------------------------------

  let panActive = false;
  let panLastX = 0;
  let panLastY = 0;
  let panStartX = 0;
  let panStartY = 0;
  let dragExceededThreshold = false;
  let dragJustEnded = false;
  let panPointerId: number | null = null;

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("[data-step-viewport-controls]")) {
      return;
    }
    panActive = true;
    panLastX = e.clientX;
    panLastY = e.clientY;
    panStartX = e.clientX;
    panStartY = e.clientY;
    dragExceededThreshold = false;
    // Phase 7d-polish: clear the "just dragged" flag on a fresh
    // interaction so a non-drag pointerdown→pointerup→click
    // chain still opens the editor modal.
    dragJustEnded = false;
    panPointerId = e.pointerId;
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = "grabbing";
  }

  function onPointerMove(e: PointerEvent): void {
    if (!panActive || e.pointerId !== panPointerId) return;
    if (!dragExceededThreshold) {
      const totalDx = e.clientX - panStartX;
      const totalDy = e.clientY - panStartY;
      if (Math.hypot(totalDx, totalDy) >= dragThreshold) {
        dragExceededThreshold = true;
      } else {
        // Still within the click slop — don't update viewBox
        // yet so a quick tap doesn't visibly jitter.
        return;
      }
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dxScreen = e.clientX - panLastX;
    const dyScreen = e.clientY - panLastY;
    panLastX = e.clientX;
    panLastY = e.clientY;
    // Convert screen-pixel deltas to SVG-coord deltas.
    const dxSvg = -(dxScreen / rect.width) * state.w;
    const dySvg = -(dyScreen / rect.height) * state.h;
    state = clampPan({ x: state.x + dxSvg, y: state.y + dySvg, w: state.w, h: state.h });
    apply(state);
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== panPointerId) return;
    const wasDrag = dragExceededThreshold;
    panActive = false;
    panPointerId = null;
    dragExceededThreshold = false;
    svg.releasePointerCapture(e.pointerId);
    svg.style.cursor = "grab";
    // Phase 7d-polish: surface a "just dragged" flag so the
    // doc shell's click handler can bail out of "open the
    // image editor modal" when the click came from a drag's
    // tail. The flag stays true until the next pointerdown
    // (which clears it), giving the shell's synchronous click
    // delegation a chance to read it.
    dragJustEnded = wasDrag;
  }

  // ---- Wire listeners --------------------------------------------------

  svg.style.cursor = "grab";
  svg.style.touchAction = "none";
  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerUp);

  let disposed = false;

  return {
    current: () => ({ ...state }),
    intrinsic: () => ({ ...intrinsicVb }),
    defaultRect: () =>
      targetAspect !== null ? defaultRectForAspect(intrinsicVb, targetAspect) : { ...intrinsicVb },
    reset: (rect) => {
      let next = rect ?? initial;
      if (targetAspect !== null) next = snapToAspect(next, targetAspect);
      state = clampPan(clampSize({ ...next }));
      apply(state);
    },
    zoomBy: (factor) => zoomByCenter(factor),
    wasDragging: () => dragJustEnded,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onPointerMove);
      svg.removeEventListener("pointerup", onPointerUp);
      svg.removeEventListener("pointercancel", onPointerUp);
      svg.style.cursor = "";
      svg.style.touchAction = "";
    },
  };
}
