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
