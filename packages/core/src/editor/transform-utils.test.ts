/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for `transform-utils`. The previously-untested
 * surface area is the **write side** of the transform model:
 *
 *   - `applyTransformState` / `writeTransformState` — emit the
 *     `transform` attribute string, including the matrix path
 *     for non-identity rotation / flip.
 *   - `nudgeTranslate` — geometry-positioned vs translate-positioned
 *     branch.
 *   - `toggleFlip` — the `S * R(θ) = R(−θ) * S` invariant for
 *     rotated-flip composition.
 *   - `setRotation` — angle normalization to [-180, 180), epsilon
 *     snap to 0, and dispatch to the line-bake path for line-like
 *     elements.
 *   - `bakeLineTransform` / `rotateLineEndpointsBy` /
 *     `flipLineEndpoints` / `getEffectiveLineEndpoints` — the
 *     endpoint-baking specialization for `<line>` and arrow groups.
 *
 * happy-dom doesn't ship `DOMPoint.prototype.matrixTransform` (used
 * by `getEffectiveLineEndpoints`), so we polyfill the same 2-D affine
 * implementation `svg-to-annotation-shapes.test.ts` uses.
 */

import { describe, expect, it } from "vitest";
import {
  applyTransformState,
  bakeLineTransform,
  flipLineEndpoints,
  getEffectiveLineEndpoints,
  isLineLike,
  nudgeTranslate,
  readTransformState,
  rotateLineEndpointsBy,
  setRotation,
  toggleFlip,
  usesGeometryPosition,
  writeTransformState,
} from "./transform-utils.js";

if (typeof DOMPoint !== "undefined" && !DOMPoint.prototype.matrixTransform) {
  DOMPoint.prototype.matrixTransform = function (this: DOMPoint, m: DOMMatrix) {
    const x = this.x;
    const y = this.y;
    return new DOMPoint(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgRoot(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  document.body.appendChild(svg);
  return svg;
}

function makeRect(): SVGRectElement {
  const svg = svgRoot();
  const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
  rect.setAttribute("x", "10");
  rect.setAttribute("y", "20");
  rect.setAttribute("width", "100");
  rect.setAttribute("height", "50");
  svg.appendChild(rect);
  return rect;
}

function makeLine(
  x1 = 10,
  y1 = 20,
  x2 = 110,
  y2 = 60,
): SVGLineElement {
  const svg = svgRoot();
  const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  svg.appendChild(line);
  return line;
}

function makeArrow(
  x1 = 10,
  y1 = 20,
  x2 = 110,
  y2 = 60,
  control?: { x: number; y: number },
): SVGGElement {
  const svg = svgRoot();
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.setAttribute("data-type", "arrow");
  g.setAttribute("data-x1", String(x1));
  g.setAttribute("data-y1", String(y1));
  g.setAttribute("data-x2", String(x2));
  g.setAttribute("data-y2", String(y2));
  if (control) {
    g.setAttribute("data-cx", String(control.x));
    g.setAttribute("data-cy", String(control.y));
  }
  svg.appendChild(g);
  return g;
}

function makePath(): SVGPathElement {
  const svg = svgRoot();
  const path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
  path.setAttribute("d", "M0 0 L10 10");
  svg.appendChild(path);
  return path;
}

describe("usesGeometryPosition + isLineLike helpers", () => {
  it("rect / ellipse / circle / image / text / line / foreignObject use geometry attrs", () => {
    for (const tag of ["rect", "ellipse", "circle", "image", "text", "line", "foreignObject"]) {
      const el = document.createElementNS(SVG_NS, tag);
      expect(usesGeometryPosition(el)).toBe(true);
    }
  });

  it("path / g do NOT use geometry attrs (translate via data-tx/ty)", () => {
    expect(usesGeometryPosition(document.createElementNS(SVG_NS, "path"))).toBe(false);
    expect(usesGeometryPosition(document.createElementNS(SVG_NS, "g"))).toBe(false);
  });

  it("isLineLike: <line> and <g data-type=\"arrow\"> are line-like; rect/path/g are not", () => {
    expect(isLineLike(document.createElementNS(SVG_NS, "line"))).toBe(true);
    const arrow = document.createElementNS(SVG_NS, "g");
    arrow.setAttribute("data-type", "arrow");
    expect(isLineLike(arrow)).toBe(true);
    expect(isLineLike(document.createElementNS(SVG_NS, "rect"))).toBe(false);
    expect(isLineLike(document.createElementNS(SVG_NS, "path"))).toBe(false);
    const plainG = document.createElementNS(SVG_NS, "g");
    expect(isLineLike(plainG)).toBe(false);
  });
});

describe("applyTransformState", () => {
  it("identity state removes the transform attribute", () => {
    const rect = makeRect();
    rect.setAttribute("transform", "translate(5, 5)");
    applyTransformState(rect, { tx: 0, ty: 0, rotation: 0, flipH: false, flipV: false });
    expect(rect.hasAttribute("transform")).toBe(false);
  });

  it("non-zero translate, no rotation/flip → emits plain translate(...)", () => {
    const path = makePath();
    applyTransformState(path, { tx: 12, ty: 34, rotation: 0, flipH: false, flipV: false });
    expect(path.getAttribute("transform")).toBe("translate(12, 34)");
  });

  it("non-identity rotation → emits matrix(...) — never translate(...)", () => {
    const rect = makeRect();
    applyTransformState(rect, { tx: 0, ty: 0, rotation: 90, flipH: false, flipV: false });
    expect(rect.getAttribute("transform")).toMatch(/^matrix\(/);
  });

  it("flipH → emits matrix with negative determinant component", () => {
    const rect = makeRect();
    applyTransformState(rect, { tx: 0, ty: 0, rotation: 0, flipH: true, flipV: false });
    const tr = rect.getAttribute("transform")!;
    expect(tr).toMatch(/^matrix\(/);
    // matrix(a b c d e f) — pull `a`, the x-scale: should be -1 for flipH=true.
    const m = tr.match(/^matrix\((-?\d+(?:\.\d+)?)\s/);
    expect(m).not.toBeNull();
    expect(Number.parseFloat(m![1]!)).toBe(-1);
  });

  it("flipV alone → matrix with `d` component = -1", () => {
    const rect = makeRect();
    applyTransformState(rect, { tx: 0, ty: 0, rotation: 0, flipH: false, flipV: true });
    const tr = rect.getAttribute("transform")!;
    // matrix(1 0 0 -1 e f) for pure flipV with no rotation.
    const m = tr.match(/^matrix\((-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
    expect(m).not.toBeNull();
    expect(Number.parseFloat(m![1]!)).toBe(1);
    expect(Number.parseFloat(m![4]!)).toBe(-1);
  });

  it("reads state from data-* attrs when no explicit state is passed", () => {
    const path = makePath();
    path.setAttribute("data-tx", "5");
    path.setAttribute("data-ty", "7");
    applyTransformState(path);
    expect(path.getAttribute("transform")).toBe("translate(5, 7)");
  });

  it("survives when getBBox is unavailable (uses 0,0 pivot)", () => {
    const rect = makeRect();
    // Force getBBox to throw to exercise the catch path → cx=cy=0.
    Object.defineProperty(rect, "getBBox", {
      value: () => {
        throw new Error("no layout");
      },
      configurable: true,
    });
    applyTransformState(rect, { tx: 0, ty: 0, rotation: 45, flipH: false, flipV: false });
    expect(rect.getAttribute("transform")).toMatch(/^matrix\(/);
  });
});

describe("writeTransformState", () => {
  it("merges patch onto current state and persists data-* attrs", () => {
    const path = makePath();
    writeTransformState(path, { tx: 10, ty: 20 });
    expect(path.getAttribute("data-tx")).toBe("10");
    expect(path.getAttribute("data-ty")).toBe("20");
    expect(path.hasAttribute("data-rot")).toBe(false);
    expect(path.hasAttribute("data-flip-h")).toBe(false);
    expect(path.hasAttribute("data-flip-v")).toBe(false);
  });

  it("removes data-rot when rotation goes back to 0", () => {
    const path = makePath();
    writeTransformState(path, { rotation: 30 });
    expect(path.getAttribute("data-rot")).toBe("30");
    writeTransformState(path, { rotation: 0 });
    expect(path.hasAttribute("data-rot")).toBe(false);
  });

  it("removes data-flip-h / data-flip-v when toggled off", () => {
    const path = makePath();
    writeTransformState(path, { flipH: true, flipV: true });
    expect(path.getAttribute("data-flip-h")).toBe("1");
    expect(path.getAttribute("data-flip-v")).toBe("1");
    writeTransformState(path, { flipH: false, flipV: false });
    expect(path.hasAttribute("data-flip-h")).toBe(false);
    expect(path.hasAttribute("data-flip-v")).toBe(false);
  });

  it("does NOT write data-tx/ty for geometry-positioned elements", () => {
    const rect = makeRect();
    writeTransformState(rect, { tx: 99, ty: 99, rotation: 30 });
    expect(rect.hasAttribute("data-tx")).toBe(false);
    expect(rect.hasAttribute("data-ty")).toBe(false);
    expect(rect.getAttribute("data-rot")).toBe("30");
  });
});

describe("nudgeTranslate", () => {
  it("geometry-positioned: caller already moved geometry — only re-applies transform", () => {
    const rect = makeRect();
    rect.setAttribute("data-rot", "45");
    nudgeTranslate(rect, 0, 0);
    // data-tx / data-ty stay absent (geometry-positioned)
    expect(rect.hasAttribute("data-tx")).toBe(false);
    expect(rect.hasAttribute("data-ty")).toBe(false);
    // transform attr is recomputed.
    expect(rect.getAttribute("transform")).toMatch(/^matrix\(/);
  });

  it("translate-positioned: dx/dy accumulates onto current data-tx/ty", () => {
    const path = makePath();
    writeTransformState(path, { tx: 5, ty: 5 });
    nudgeTranslate(path, 10, 20);
    expect(path.getAttribute("data-tx")).toBe("15");
    expect(path.getAttribute("data-ty")).toBe("25");
    expect(path.getAttribute("transform")).toBe("translate(15, 25)");
  });
});

describe("toggleFlip", () => {
  it("flips H on rect with rotation=0 → flipH true, rotation stays 0", () => {
    const rect = makeRect();
    toggleFlip(rect, "h");
    const s = readTransformState(rect);
    expect(s.flipH).toBe(true);
    expect(s.flipV).toBe(false);
    expect(s.rotation).toBe(0);
  });

  it("flips V → flipV true", () => {
    const rect = makeRect();
    toggleFlip(rect, "v");
    expect(readTransformState(rect).flipV).toBe(true);
  });

  it("S * R(θ) = R(−θ) * S — flipping a rotated shape negates rotation", () => {
    const rect = makeRect();
    writeTransformState(rect, { rotation: 30 });
    toggleFlip(rect, "h");
    const s = readTransformState(rect);
    expect(s.flipH).toBe(true);
    expect(s.rotation).toBe(-30);
  });

  it("toggling flip twice cancels (state returns to no flip, rotation back)", () => {
    const rect = makeRect();
    writeTransformState(rect, { rotation: 30 });
    toggleFlip(rect, "h");
    toggleFlip(rect, "h");
    const s = readTransformState(rect);
    expect(s.flipH).toBe(false);
    expect(s.rotation).toBe(30);
  });

  it("on a line element, flips by mirroring endpoints across midpoint", () => {
    const line = makeLine(0, 0, 100, 0);
    flipLineEndpoints(line, "h");
    expect(Number(line.getAttribute("x1"))).toBe(100);
    expect(Number(line.getAttribute("x2"))).toBe(0);
    // y unchanged for horizontal-axis flip
    expect(Number(line.getAttribute("y1"))).toBe(0);
    expect(Number(line.getAttribute("y2"))).toBe(0);
  });

  it("toggleFlip dispatches to flipLineEndpoints for line-likes (no data-flip-* persisted)", () => {
    const line = makeLine(0, 0, 100, 50);
    toggleFlip(line, "v");
    expect(line.hasAttribute("data-flip-v")).toBe(false);
    // y's mirrored across midY=25 → y1 50, y2 0
    expect(Number(line.getAttribute("y1"))).toBe(50);
    expect(Number(line.getAttribute("y2"))).toBe(0);
  });
});

describe("setRotation", () => {
  it("normalizes ≥180 into (-180, 0]", () => {
    const path = makePath();
    setRotation(path, 270);
    expect(readTransformState(path).rotation).toBe(-90);
  });

  it("normalizes <-180 into [0, 180)", () => {
    const path = makePath();
    setRotation(path, -270);
    expect(readTransformState(path).rotation).toBe(90);
  });

  it("snaps near-zero values to 0 (epsilon = 0.05) and drops the data attr", () => {
    const path = makePath();
    setRotation(path, 30);
    setRotation(path, 0.01);
    expect(readTransformState(path).rotation).toBe(0);
    expect(path.hasAttribute("data-rot")).toBe(false);
  });

  it("on a line, dispatches to rotateLineEndpointsBy (rotates around midpoint)", () => {
    // Horizontal line of length 100, midpoint (50, 0). 90° rotation
    // produces a vertical line through the midpoint.
    const line = makeLine(0, 0, 100, 0);
    setRotation(line, 90);
    expect(Number(line.getAttribute("x1"))).toBeCloseTo(50, 5);
    expect(Number(line.getAttribute("y1"))).toBeCloseTo(-50, 5);
    expect(Number(line.getAttribute("x2"))).toBeCloseTo(50, 5);
    expect(Number(line.getAttribute("y2"))).toBeCloseTo(50, 5);
    // No data-rot persisted on baked lines.
    expect(line.hasAttribute("data-rot")).toBe(false);
  });
});

describe("bakeLineTransform", () => {
  it("no-op on identity state", () => {
    const line = makeLine(0, 0, 100, 0);
    bakeLineTransform(line);
    expect(Number(line.getAttribute("x1"))).toBe(0);
    expect(Number(line.getAttribute("x2"))).toBe(100);
  });

  it("bakes data-rot into endpoint coords + clears the data + transform attrs", () => {
    const line = makeLine(0, 0, 100, 0);
    line.setAttribute("data-rot", "90");
    line.setAttribute("transform", "matrix(0 1 -1 0 0 0)");
    bakeLineTransform(line);
    // 90° rotation around midpoint (50, 0): same expectations as setRotation test.
    expect(Number(line.getAttribute("x1"))).toBeCloseTo(50, 5);
    expect(Number(line.getAttribute("y1"))).toBeCloseTo(-50, 5);
    expect(line.hasAttribute("data-rot")).toBe(false);
    expect(line.hasAttribute("transform")).toBe(false);
    expect(line.hasAttribute("data-tx")).toBe(false);
  });

  it("no-op on non-line-like elements", () => {
    const rect = makeRect();
    rect.setAttribute("data-rot", "45");
    rect.setAttribute("transform", "matrix(...)");
    bakeLineTransform(rect);
    // Untouched — bakeLineTransform short-circuits on non-line elements.
    expect(rect.getAttribute("data-rot")).toBe("45");
  });

  it("bakes an arrow group's control point through the rotation too", () => {
    const arrow = makeArrow(0, 0, 100, 0, { x: 50, y: 30 });
    arrow.setAttribute("data-rot", "90");
    bakeLineTransform(arrow);
    // After 90° around midpoint (50, 0): control (50, 30) → (20, 0)
    const cx = Number(arrow.getAttribute("data-cx"));
    const cy = Number(arrow.getAttribute("data-cy"));
    expect(cx).toBeCloseTo(20, 5);
    expect(cy).toBeCloseTo(0, 5);
  });
});

describe("rotateLineEndpointsBy", () => {
  it("rotates around midpoint by an arbitrary angle", () => {
    // 180° around midpoint (50, 0) swaps endpoints.
    const line = makeLine(0, 0, 100, 0);
    rotateLineEndpointsBy(line, 180);
    expect(Number(line.getAttribute("x1"))).toBeCloseTo(100, 5);
    expect(Number(line.getAttribute("x2"))).toBeCloseTo(0, 5);
  });

  it("rotates an arrow's control point alongside its endpoints", () => {
    const arrow = makeArrow(0, 0, 100, 0, { x: 50, y: 30 });
    rotateLineEndpointsBy(arrow, 180);
    expect(Number(arrow.getAttribute("data-cx"))).toBeCloseTo(50, 5);
    expect(Number(arrow.getAttribute("data-cy"))).toBeCloseTo(-30, 5);
  });
});

describe("flipLineEndpoints", () => {
  it("h-axis flip mirrors endpoints around midX", () => {
    const line = makeLine(20, 10, 80, 30);
    flipLineEndpoints(line, "h");
    // midX = 50, mirrored: 20 → 80, 80 → 20
    expect(Number(line.getAttribute("x1"))).toBe(80);
    expect(Number(line.getAttribute("x2"))).toBe(20);
    // y stays the same
    expect(Number(line.getAttribute("y1"))).toBe(10);
    expect(Number(line.getAttribute("y2"))).toBe(30);
  });

  it("v-axis flip mirrors arrow endpoints + control around midY", () => {
    const arrow = makeArrow(0, 10, 100, 30, { x: 50, y: 50 });
    flipLineEndpoints(arrow, "v");
    // midY = 20: 10 → 30, 30 → 10
    expect(Number(arrow.getAttribute("data-y1"))).toBe(30);
    expect(Number(arrow.getAttribute("data-y2"))).toBe(10);
    // control (50, 50) → (50, -10)
    expect(Number(arrow.getAttribute("data-cx"))).toBe(50);
    expect(Number(arrow.getAttribute("data-cy"))).toBe(-10);
  });
});

describe("getEffectiveLineEndpoints", () => {
  it("returns endpoints unchanged when the line has no transform state", () => {
    const line = makeLine(10, 20, 110, 60);
    const eff = getEffectiveLineEndpoints(line);
    expect(eff).toEqual({ x1: 10, y1: 20, x2: 110, y2: 60, cx: null, cy: null });
  });

  it("composes data-rot into the returned endpoints WITHOUT mutating the element", () => {
    const line = makeLine(0, 0, 100, 0);
    line.setAttribute("data-rot", "90");
    const eff = getEffectiveLineEndpoints(line);
    expect(eff.x1).toBeCloseTo(50, 5);
    expect(eff.y1).toBeCloseTo(-50, 5);
    expect(eff.x2).toBeCloseTo(50, 5);
    expect(eff.y2).toBeCloseTo(50, 5);
    // Element NOT mutated — read-only effective view.
    expect(line.getAttribute("x1")).toBe("0");
  });

  it("returns the control point in effective coords for curved arrows", () => {
    const arrow = makeArrow(0, 0, 100, 0, { x: 50, y: 30 });
    const eff = getEffectiveLineEndpoints(arrow);
    expect(eff.cx).toBe(50);
    expect(eff.cy).toBe(30);
  });

  it("returns endpoint coords as-is for non-line-like callers (defensive)", () => {
    const rect = makeRect();
    // rect has no x1/y1/x2/y2 — should yield NaN/0 for those, but not throw.
    const eff = getEffectiveLineEndpoints(rect);
    expect(eff.cx).toBeNull();
    expect(eff.cy).toBeNull();
  });
});
