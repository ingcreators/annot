/**
 * `attachStepImageViewport(container, options)` — Phase 7d of
 * `docs/plans/card-procedure-template.md`. Wires interactive
 * pan / zoom onto a step block's screenshot.
 *
 * The container is the `.annot-doc-image-svg-slot` div (or its
 * descendant SVG element). The controller:
 *
 * - Sets the SVG's `viewBox` to the supplied initial rect (or
 *   the SVG's intrinsic viewBox if none is provided).
 * - Listens for `wheel` events to zoom in / out around the
 *   pointer. Wheel delta is treated as 1.1× per notch.
 * - Listens for pointer drag (left button) to pan the viewBox.
 * - Exposes a `commit()` method that returns the current
 *   viewBox state — used by the "Save as initial view" button
 *   to capture the user's current pan / zoom into the model.
 * - Exposes a `reset(rect)` method to snap back to the initial
 *   viewport (or a fresh one passed in by the host).
 *
 * The controller is read-only with respect to the model — it
 * never writes back to the host. Persistence is the caller's
 * job (the doc shell wires `commit()` into the `<button data-
 * step-viewport-save>` handler).
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
  /** Reset to a supplied rect (or to the controller's initial
   *  when no argument is passed). */
  readonly reset: (rect?: StepImageViewportRect) => void;
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
  const initial = options.initial ?? intrinsicVb;
  const minSize = options.minSize ?? 32;
  // Default cap: the larger of the two intrinsic dimensions —
  // generous enough that the user can always zoom out to the
  // full image but not infinitely further.
  const maxSize =
    options.maxSize ?? (Math.max(intrinsic.w, intrinsic.h) || Number.POSITIVE_INFINITY);
  const wheelStep = options.wheelStep ?? 1.1;

  let state: StepImageViewportRect = { ...initial };
  apply(state);

  function apply(rect: StepImageViewportRect): void {
    svg.setAttribute("viewBox", `${rect.x} ${rect.y} ${rect.w} ${rect.h}`);
  }

  function clamp(rect: StepImageViewportRect): StepImageViewportRect {
    // Clamp viewBox size to [minSize, maxSize] on both axes,
    // preserving aspect ratio of the current rect.
    const aspect = rect.w / rect.h;
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

  // ---- Wheel zoom -------------------------------------------------------

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY > 0 ? wheelStep : 1 / wheelStep;
    zoomBy(factor, e);
  }

  /** Zoom around the pointer position in `e`. The point under
   *  the cursor stays anchored to the cursor after the zoom. */
  function zoomBy(factor: number, e: PointerEvent | WheelEvent): void {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Pointer position in screen coords relative to the SVG.
    const sx = (e.clientX - rect.left) / rect.width;
    const sy = (e.clientY - rect.top) / rect.height;
    // Map to SVG-coord cursor position using the current viewBox.
    const cx = state.x + sx * state.w;
    const cy = state.y + sy * state.h;
    const next = clamp({
      x: cx - sx * (state.w * factor),
      y: cy - sy * (state.h * factor),
      w: state.w * factor,
      h: state.h * factor,
    });
    state = next;
    apply(state);
  }

  // ---- Pan -------------------------------------------------------------

  let panActive = false;
  let panLastX = 0;
  let panLastY = 0;
  let panPointerId: number | null = null;

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("[data-step-viewport-controls]")) {
      return;
    }
    panActive = true;
    panLastX = e.clientX;
    panLastY = e.clientY;
    panPointerId = e.pointerId;
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = "grabbing";
  }

  function onPointerMove(e: PointerEvent): void {
    if (!panActive || e.pointerId !== panPointerId) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dxScreen = e.clientX - panLastX;
    const dyScreen = e.clientY - panLastY;
    panLastX = e.clientX;
    panLastY = e.clientY;
    // Convert screen-pixel deltas to SVG-coord deltas.
    const dxSvg = -(dxScreen / rect.width) * state.w;
    const dySvg = -(dyScreen / rect.height) * state.h;
    state = { x: state.x + dxSvg, y: state.y + dySvg, w: state.w, h: state.h };
    apply(state);
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== panPointerId) return;
    panActive = false;
    panPointerId = null;
    svg.releasePointerCapture(e.pointerId);
    svg.style.cursor = "";
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
    reset: (rect) => {
      state = { ...(rect ?? initial) };
      apply(state);
    },
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
