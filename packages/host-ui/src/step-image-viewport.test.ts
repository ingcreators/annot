// @vitest-environment happy-dom
//
// Targeted coverage for the pan/zoom controller landed in
// Phase 7d of `docs/plans/card-procedure-template.md`. happy-dom
// doesn't fully ship pointer-capture / wheel-event geometry, so
// the tests focus on the controller's state-tracking surface:
// initial viewport application, `current()` snapshot, `reset()`
// behaviour, and disposal idempotency. Live drag / wheel
// interaction is covered by the Storybook visual + the shell's
// integration tests.

import { describe, expect, it } from "vitest";
import { attachStepImageViewport } from "./step-image-viewport.js";

function makeSvg(width = 1000, height = 800): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  document.body.appendChild(svg);
  return svg;
}

describe("attachStepImageViewport: initial state", () => {
  it("applies the supplied initial rect to the SVG viewBox", () => {
    const svg = makeSvg(800, 600);
    attachStepImageViewport(svg, { initial: { x: 100, y: 75, w: 400, h: 300 } });
    expect(svg.getAttribute("viewBox")).toBe("100 75 400 300");
  });

  it("falls back to the SVG's intrinsic viewBox when no initial is supplied", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg);
    expect(svg.getAttribute("viewBox")).toBe("0 0 800 600");
    expect(ctrl.current()).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it("reads width/height attrs when viewBox is missing", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("width", "400");
    svg.setAttribute("height", "200");
    document.body.appendChild(svg);
    const ctrl = attachStepImageViewport(svg);
    expect(ctrl.current()).toEqual({ x: 0, y: 0, w: 400, h: 200 });
  });
});

describe("attachStepImageViewport: current() snapshot", () => {
  it("returns a copy that doesn't share identity with internal state", () => {
    const svg = makeSvg();
    const ctrl = attachStepImageViewport(svg, { initial: { x: 0, y: 0, w: 100, h: 100 } });
    const a = ctrl.current();
    const b = ctrl.current();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("attachStepImageViewport: intrinsic()", () => {
  it("returns the SVG's viewBox at attach time, regardless of supplied initial", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg, { initial: { x: 100, y: 75, w: 400, h: 300 } });
    expect(ctrl.intrinsic()).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it("returns a fresh copy on each call", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg);
    const a = ctrl.intrinsic();
    const b = ctrl.intrinsic();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("attachStepImageViewport: reset()", () => {
  it("resets to the original initial when called with no argument", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg, { initial: { x: 100, y: 75, w: 400, h: 300 } });
    // Pretend the user panned to a new state via direct viewBox
    // mutation (the controller doesn't have a public setter
    // because pan/zoom comes through DOM events).
    svg.setAttribute("viewBox", "0 0 1 1");
    ctrl.reset();
    expect(svg.getAttribute("viewBox")).toBe("100 75 400 300");
    expect(ctrl.current()).toEqual({ x: 100, y: 75, w: 400, h: 300 });
  });

  it("resets to a supplied rect when one is passed", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg);
    ctrl.reset({ x: 50, y: 25, w: 200, h: 150 });
    expect(svg.getAttribute("viewBox")).toBe("50 25 200 150");
    expect(ctrl.current()).toEqual({ x: 50, y: 25, w: 200, h: 150 });
  });
});

describe("attachStepImageViewport: dispose()", () => {
  it("removes event listeners and is idempotent", () => {
    const svg = makeSvg();
    const ctrl = attachStepImageViewport(svg);
    ctrl.dispose();
    ctrl.dispose(); // second call is a no-op
    // After dispose, the SVG's cursor / touch-action overrides
    // are reverted.
    expect(svg.style.cursor).toBe("");
    expect(svg.style.touchAction).toBe("");
  });
});

// Phase 7d-polish — pan clamping. The viewport can't pan
// outside the intrinsic bitmap; when zoomed in, the rect's
// origin is bounded to `[0, intrinsic - rect.size]`. When
// zoomed out past the bitmap, the rect centres the bitmap.
describe("attachStepImageViewport: pan clamping (Phase 7d-polish)", () => {
  it("clamps the initial rect's origin to inside the bitmap", () => {
    const svg = makeSvg(800, 600);
    // Negative initial origin — should clamp to (0, 0).
    const ctrl = attachStepImageViewport(svg, { initial: { x: -100, y: -50, w: 400, h: 300 } });
    expect(ctrl.current()).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it("clamps the initial rect's origin past the bitmap edge", () => {
    const svg = makeSvg(800, 600);
    // Past-right origin (x=600 + w=400 = 1000 > 800) — should clamp x to 400.
    const ctrl = attachStepImageViewport(svg, { initial: { x: 600, y: 400, w: 400, h: 300 } });
    expect(ctrl.current()).toEqual({ x: 400, y: 300, w: 400, h: 300 });
  });

  it("centres the bitmap when the viewport is larger than the bitmap", () => {
    // A 1000×800 viewport on a 800×600 bitmap. The viewport
    // can't slide INSIDE the bitmap; instead the bitmap centres
    // inside the viewport so the user always sees the image.
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg, {
      maxSize: 2000,
      initial: { x: 0, y: 0, w: 1000, h: 800 },
    });
    // Centred: x = (800 - 1000) / 2 = -100; y = (600 - 800) / 2 = -100.
    expect(ctrl.current()).toEqual({ x: -100, y: -100, w: 1000, h: 800 });
  });

  it("reset(rect) also clamps the supplied rect", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg);
    ctrl.reset({ x: 1000, y: 700, w: 200, h: 150 });
    // x=1000 clamps to 800-200=600; y=700 clamps to 600-150=450.
    expect(ctrl.current()).toEqual({ x: 600, y: 450, w: 200, h: 150 });
  });
});

// Phase 7d-polish 2 — `targetAspect` locks the viewBox aspect to
// match the slot's CSS aspect ratio (16:9) so multiple cards on
// the same source bitmap stay visually aligned. Initial state,
// reset, and zoom all preserve the target aspect.
describe("attachStepImageViewport: targetAspect (Phase 7d-polish 2)", () => {
  it("snaps initial state to target aspect by shrinking the wider dimension", () => {
    // Bitmap 800x600 (4:3). Initial supplied as the full
    // intrinsic. Target 16:9 → height shrinks to 800/(16/9) =
    // 450; rect centred on (400, 300) → x=0, y=(600-450)/2=75.
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg, {
      initial: { x: 0, y: 0, w: 800, h: 600 },
      targetAspect: 16 / 9,
    });
    const current = ctrl.current();
    expect(current.w).toBe(800);
    expect(current.h).toBe(450);
    expect(Math.abs(current.w / current.h - 16 / 9)).toBeLessThan(1e-6);
  });

  it("computes a top-left-anchored default rect when no initial is supplied", () => {
    // Tall bitmap 800x4000. Top-left 16:9 sub-rect = 800x450.
    const svg = makeSvg(800, 4000);
    const ctrl = attachStepImageViewport(svg, { targetAspect: 16 / 9 });
    const def = ctrl.defaultRect();
    expect(def).toEqual({ x: 0, y: 0, w: 800, h: 450 });
    // ALSO: the initial state itself matches the default.
    expect(ctrl.current()).toEqual({ x: 0, y: 0, w: 800, h: 450 });
  });

  it("handles a bitmap WIDER than target — uses full height, shrinks width", () => {
    // 3000x1080 panorama. target = 16/9 → max w = 1080 * 16/9 = 1920.
    // Top-left 16:9 sub-rect = 1920x1080.
    const svg = makeSvg(3000, 1080);
    const ctrl = attachStepImageViewport(svg, { targetAspect: 16 / 9 });
    expect(ctrl.defaultRect()).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("preserves target aspect through zoomBy", () => {
    const svg = makeSvg(1920, 1080);
    const ctrl = attachStepImageViewport(svg, { targetAspect: 16 / 9 });
    ctrl.zoomBy(0.5);
    const a = ctrl.current();
    expect(Math.abs(a.w / a.h - 16 / 9)).toBeLessThan(1e-6);
    ctrl.zoomBy(2);
    const b = ctrl.current();
    expect(Math.abs(b.w / b.h - 16 / 9)).toBeLessThan(1e-6);
  });

  it("reset(rect) snaps the supplied rect to target aspect", () => {
    const svg = makeSvg(1920, 1080);
    const ctrl = attachStepImageViewport(svg, { targetAspect: 16 / 9 });
    // Pass a 4:3 rect; reset should snap to 16:9.
    ctrl.reset({ x: 100, y: 100, w: 800, h: 600 });
    const after = ctrl.current();
    expect(Math.abs(after.w / after.h - 16 / 9)).toBeLessThan(1e-6);
  });

  it("reset() (no arg) returns to the snapped initial", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg, {
      initial: { x: 0, y: 0, w: 800, h: 600 },
      targetAspect: 16 / 9,
    });
    // After zoom...
    ctrl.zoomBy(0.5);
    expect(ctrl.current().w).not.toBe(800);
    // ...reset() goes back to the snapped initial (800x450).
    ctrl.reset();
    const current = ctrl.current();
    expect(current.w).toBe(800);
    expect(current.h).toBe(450);
  });

  it("defaultRect() returns the same rect as a no-initial controller would adopt", () => {
    // Verify consistency: defaultRect() ≡ current() when no
    // initial was supplied. The shell's Clear button relies on
    // this so the displayed view after Clear matches what a
    // freshly-attached controller would show.
    const svg1 = makeSvg(800, 4000);
    const ctrl1 = attachStepImageViewport(svg1, { targetAspect: 16 / 9 });
    expect(ctrl1.defaultRect()).toEqual(ctrl1.current());
  });

  it("falls back to intrinsic when no target aspect is set", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg);
    expect(ctrl.defaultRect()).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
});

// Phase 7d-polish — drag-just-ended flag used by the shell to
// suppress the image-editor modal after a pan.
describe("attachStepImageViewport: wasDragging() (Phase 7d-polish)", () => {
  it("starts false on a fresh controller", () => {
    const svg = makeSvg();
    const ctrl = attachStepImageViewport(svg);
    expect(ctrl.wasDragging()).toBe(false);
  });

  it("stays false after a pointerdown+pointerup with no movement (click)", () => {
    const svg = makeSvg();
    const ctrl = attachStepImageViewport(svg);
    svg.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    expect(ctrl.wasDragging()).toBe(false);
  });

  it("becomes true after a drag past the threshold", () => {
    const svg = makeSvg();
    const ctrl = attachStepImageViewport(svg);
    svg.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );
    expect(ctrl.wasDragging()).toBe(true);
  });

  it("clears on the NEXT pointerdown so a subsequent click works", () => {
    const svg = makeSvg();
    const ctrl = attachStepImageViewport(svg);
    // First: a drag.
    svg.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 1,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1,
        clientX: 50,
        clientY: 50,
        bubbles: true,
      }),
    );
    expect(ctrl.wasDragging()).toBe(true);
    // Next: a non-drag pointerdown should clear the flag.
    svg.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        pointerId: 2,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    expect(ctrl.wasDragging()).toBe(false);
  });
});

// Phase 7d-polish — programmatic zoom for the UI buttons.
describe("attachStepImageViewport: zoomBy() (Phase 7d-polish)", () => {
  it("zooms in (factor < 1) shrinking the viewBox", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg, { initial: { x: 100, y: 75, w: 400, h: 300 } });
    ctrl.zoomBy(0.5);
    const after = ctrl.current();
    expect(after.w).toBe(200);
    expect(after.h).toBe(150);
  });

  it("zooms out (factor > 1) growing the viewBox", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg, { initial: { x: 100, y: 75, w: 400, h: 300 } });
    ctrl.zoomBy(2);
    const after = ctrl.current();
    // Capped at intrinsic dimensions (max=800 on width, aspect-preserved).
    expect(after.w).toBeLessThanOrEqual(800);
    expect(after.w).toBeGreaterThan(400);
  });

  it("centres the zoom on the current viewBox centre", () => {
    const svg = makeSvg(1000, 1000);
    const ctrl = attachStepImageViewport(svg, { initial: { x: 200, y: 200, w: 400, h: 400 } });
    // Center of initial = (400, 400). Zoom in 2× → new w/h = 200,
    // new origin = center - 100 = (300, 300).
    ctrl.zoomBy(0.5);
    expect(ctrl.current()).toEqual({ x: 300, y: 300, w: 200, h: 200 });
  });

  it("respects the minSize cap when zooming in", () => {
    const svg = makeSvg(800, 600);
    const ctrl = attachStepImageViewport(svg, {
      minSize: 100,
      initial: { x: 0, y: 0, w: 200, h: 150 },
    });
    // Zoom in repeatedly — eventually hits minSize=100.
    ctrl.zoomBy(0.1);
    ctrl.zoomBy(0.1);
    ctrl.zoomBy(0.1);
    expect(ctrl.current().w).toBeGreaterThanOrEqual(100);
    expect(ctrl.current().h).toBeGreaterThanOrEqual(75); // aspect-preserved
  });
});
