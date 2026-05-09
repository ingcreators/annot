/**
 * @vitest-environment happy-dom
 *
 * Bake-translate helpers. Validates that each per-shape baker
 * shifts every positional attribute on its children by exactly
 * (dx, dy) in world space — which is the correctness contract
 * the move dispatcher (phase 3) will rely on.
 */

import { describe, expect, it } from "vitest";
import {
  bakeAnnotationsTranslate,
  bakeGroupTranslate,
  bakeMarkerTranslate,
  bakePathTranslate,
  bakeTranslate,
} from "./bake-translate.js";
import { createTextShape } from "./text-utils.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgWithRoot(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  document.body.appendChild(svg);
  return svg;
}

function makeMarker({
  shape = "circle",
  cx = 100,
  cy = 100,
  r = 16,
  label = "1",
}: {
  shape?: "circle" | "rect" | "rounded";
  cx?: number;
  cy?: number;
  r?: number;
  label?: string;
} = {}): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.setAttribute("data-marker", label);
  g.setAttribute("data-shape", shape);
  if (shape === "circle") {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(r));
    g.appendChild(circle);
  } else {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(cx - r));
    rect.setAttribute("y", String(cy - r));
    rect.setAttribute("width", String(r * 2));
    rect.setAttribute("height", String(r * 2));
    g.appendChild(rect);
  }
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(cx));
  text.setAttribute("y", String(cy));
  text.textContent = label;
  g.appendChild(text);
  return g;
}

describe("bakeMarkerTranslate", () => {
  it("shifts a circle-bg marker's bg + text", () => {
    const g = makeMarker({ shape: "circle", cx: 100, cy: 100 });
    bakeMarkerTranslate(g, 50, 75);
    const circle = g.querySelector("circle")!;
    const text = g.querySelector("text")!;
    expect(circle.getAttribute("cx")).toBe("150");
    expect(circle.getAttribute("cy")).toBe("175");
    expect(text.getAttribute("x")).toBe("150");
    expect(text.getAttribute("y")).toBe("175");
  });

  it("shifts a rect-bg marker's bg + text", () => {
    const g = makeMarker({ shape: "rect", cx: 100, cy: 100, r: 16 });
    bakeMarkerTranslate(g, 50, 75);
    const rect = g.querySelector("rect")!;
    expect(rect.getAttribute("x")).toBe("134");
    expect(rect.getAttribute("y")).toBe("159");
  });

  it("is no-op for dx=dy=0", () => {
    const g = makeMarker({ shape: "circle", cx: 100, cy: 100 });
    bakeMarkerTranslate(g, 0, 0);
    expect(g.querySelector("circle")!.getAttribute("cx")).toBe("100");
  });

  it("is no-op when input is not a marker `<g>`", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    g.setAttribute("data-type", "shape");
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "10");
    rect.setAttribute("y", "20");
    g.appendChild(rect);
    bakeMarkerTranslate(g, 100, 200);
    expect(rect.getAttribute("x")).toBe("10");
  });
});

describe("bakePathTranslate", () => {
  it("shifts a freehand-style path's d attribute", () => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", "M 10 20 Q 30 10 50 20 L 60 30 Z");
    bakePathTranslate(p, 5, 7);
    expect(p.getAttribute("d")).toBe("M15 27 Q35 17 55 27 L65 37 Z");
  });

  it("is no-op when path has no d attribute", () => {
    const p = document.createElementNS(SVG_NS, "path");
    bakePathTranslate(p, 5, 7);
    expect(p.getAttribute("d")).toBeNull();
  });

  it("is no-op for dx=dy=0", () => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", "M 10 20 L 30 40");
    bakePathTranslate(p, 0, 0);
    expect(p.getAttribute("d")).toBe("M 10 20 L 30 40");
  });
});

describe("bakeTextShapeTranslate (via bakeTranslate dispatch)", () => {
  it("shifts a sticky's bg + clipPath + tspans", () => {
    // Use the production createTextShape so the structure mirrors
    // real edits exactly — bg <rect>, clipPath <rect>, <text> with
    // <tspan> children.
    const svg = svgWithRoot();
    const g = createTextShape({
      x: 100,
      y: 100,
      w: 200,
      h: 80,
      variant: "sticky",
      runs: [{ text: "Hello", line_break_after: false }],
      fontSize: 14,
      fontFamily: "sans-serif",
      color: "#000",
    });
    svg.appendChild(g);

    bakeTranslate(g, 50, 75);

    const bg = g.querySelector("rect");
    expect(bg!.getAttribute("x")).toBe("150");
    expect(bg!.getAttribute("y")).toBe("175");
    const clipRect = g.querySelector("clipPath > rect");
    expect(clipRect!.getAttribute("x")).toBe("150");
    expect(clipRect!.getAttribute("y")).toBe("175");
    // Each first-segment <tspan> carries x and y; both must shift.
    const tspans = Array.from(g.querySelectorAll("tspan"));
    expect(tspans.length).toBeGreaterThan(0);
    for (const t of tspans) {
      const tx = t.getAttribute("x");
      const ty = t.getAttribute("y");
      // Some continuation tspans may have no x/y; only verify the
      // ones that do — they should be shifted.
      if (tx != null) expect(Number.parseFloat(tx)).toBeGreaterThanOrEqual(150);
      if (ty != null) expect(Number.parseFloat(ty)).toBeGreaterThanOrEqual(175);
    }
  });

  it("shifts a callout's bg + tail anchor + clipPath", () => {
    const svg = svgWithRoot();
    const g = createTextShape({
      x: 100,
      y: 100,
      w: 200,
      h: 80,
      variant: "callout",
      runs: [{ text: "C", line_break_after: false }],
      fontSize: 14,
      fontFamily: "sans-serif",
      color: "#000",
      tailX: 50,
      tailY: 220,
    });
    svg.appendChild(g);

    bakeTranslate(g, 30, 40);

    const bg = g.querySelector("rect");
    expect(bg!.getAttribute("x")).toBe("130");
    expect(bg!.getAttribute("y")).toBe("140");
    expect(g.getAttribute("data-tail-x")).toBe("80");
    expect(g.getAttribute("data-tail-y")).toBe("260");
    // After bake, the tail path should be rebuilt — `d` non-empty.
    const tail = g.querySelector("path");
    expect(tail!.getAttribute("d")?.length).toBeGreaterThan(0);
  });

  it("shifts a plain text shape's tspans (transparent bg still gets x/y bumped)", () => {
    const svg = svgWithRoot();
    const g = createTextShape({
      x: 100,
      y: 100,
      w: 200,
      h: 80,
      variant: "plain",
      runs: [{ text: "P", line_break_after: false }],
      fontSize: 14,
      fontFamily: "sans-serif",
      color: "#000",
    });
    svg.appendChild(g);

    bakeTranslate(g, 10, 20);

    const bg = g.querySelector("rect");
    // Even though plain bg is fill="none", x/y shift consistently
    // so a future variant-change still finds the bg in the right spot.
    expect(bg!.getAttribute("x")).toBe("110");
    expect(bg!.getAttribute("y")).toBe("120");
  });

  it("is no-op for dx=dy=0", () => {
    const svg = svgWithRoot();
    const g = createTextShape({
      x: 100,
      y: 100,
      w: 200,
      h: 80,
      variant: "sticky",
      runs: [{ text: "X", line_break_after: false }],
      fontSize: 14,
      fontFamily: "sans-serif",
      color: "#000",
    });
    svg.appendChild(g);
    bakeTranslate(g, 0, 0);
    expect(g.querySelector("rect")!.getAttribute("x")).toBe("100");
  });
});

describe("bakeGroupTranslate", () => {
  it("recurses into a group's children, dispatching by kind", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    g.setAttribute("data-type", "group");
    // Mix a rect, an ellipse, and a path inside the group.
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "10");
    rect.setAttribute("y", "20");
    rect.setAttribute("width", "30");
    rect.setAttribute("height", "40");
    g.appendChild(rect);
    const ell = document.createElementNS(SVG_NS, "ellipse");
    ell.setAttribute("cx", "100");
    ell.setAttribute("cy", "200");
    ell.setAttribute("rx", "20");
    ell.setAttribute("ry", "10");
    g.appendChild(ell);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M 5 5 L 50 50");
    g.appendChild(path);

    bakeGroupTranslate(g, 7, 9);

    expect(rect.getAttribute("x")).toBe("17");
    expect(rect.getAttribute("y")).toBe("29");
    expect(ell.getAttribute("cx")).toBe("107");
    expect(ell.getAttribute("cy")).toBe("209");
    expect(path.getAttribute("d")).toBe("M12 14 L57 59");
  });

  it("recurses into nested groups", () => {
    const outer = document.createElementNS(SVG_NS, "g") as SVGGElement;
    outer.setAttribute("data-type", "group");
    const inner = document.createElementNS(SVG_NS, "g") as SVGGElement;
    inner.setAttribute("data-type", "group");
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "10");
    rect.setAttribute("y", "20");
    inner.appendChild(rect);
    outer.appendChild(inner);

    bakeGroupTranslate(outer, 5, 5);

    expect(rect.getAttribute("x")).toBe("15");
    expect(rect.getAttribute("y")).toBe("25");
  });
});

describe("bakeTranslate dispatcher (geometry-positioned leaves)", () => {
  it("rect: shifts x/y", () => {
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", "10");
    r.setAttribute("y", "20");
    bakeTranslate(r, 5, 7);
    expect(r.getAttribute("x")).toBe("15");
    expect(r.getAttribute("y")).toBe("27");
  });

  it("ellipse: shifts cx/cy", () => {
    const e = document.createElementNS(SVG_NS, "ellipse");
    e.setAttribute("cx", "100");
    e.setAttribute("cy", "200");
    bakeTranslate(e, 5, 7);
    expect(e.getAttribute("cx")).toBe("105");
    expect(e.getAttribute("cy")).toBe("207");
  });

  it("circle: shifts cx/cy", () => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", "10");
    c.setAttribute("cy", "20");
    bakeTranslate(c, 5, 7);
    expect(c.getAttribute("cx")).toBe("15");
    expect(c.getAttribute("cy")).toBe("27");
  });

  it("text: shifts x/y", () => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", "10");
    t.setAttribute("y", "20");
    bakeTranslate(t, 5, 7);
    expect(t.getAttribute("x")).toBe("15");
    expect(t.getAttribute("y")).toBe("27");
  });

  it("foreignObject: shifts x/y", () => {
    const f = document.createElementNS(SVG_NS, "foreignObject");
    f.setAttribute("x", "10");
    f.setAttribute("y", "20");
    bakeTranslate(f, 5, 7);
    expect(f.getAttribute("x")).toBe("15");
    expect(f.getAttribute("y")).toBe("27");
  });

  it("image: shifts x/y", () => {
    const i = document.createElementNS(SVG_NS, "image");
    i.setAttribute("x", "10");
    i.setAttribute("y", "20");
    bakeTranslate(i, 5, 7);
    expect(i.getAttribute("x")).toBe("15");
    expect(i.getAttribute("y")).toBe("27");
  });

  it("line: not handled (caller routes through bakeLineTransform)", () => {
    // Lines move via endpoint rewrite in `transform-utils.ts`'s
    // `bakeLineTransform` + setLineEndpoints. The bake dispatcher
    // intentionally leaves them alone.
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", "10");
    l.setAttribute("y1", "20");
    l.setAttribute("x2", "30");
    l.setAttribute("y2", "40");
    bakeTranslate(l, 5, 7);
    expect(l.getAttribute("x1")).toBe("10");
    expect(l.getAttribute("y1")).toBe("20");
  });

  it("path: routes to bakePathTranslate", () => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", "M 10 20 L 30 40");
    bakeTranslate(p, 5, 7);
    expect(p.getAttribute("d")).toBe("M15 27 L35 47");
  });

  it("marker `<g>`: routes to bakeMarkerTranslate", () => {
    const g = makeMarker({ shape: "circle", cx: 50, cy: 50 });
    bakeTranslate(g, 25, 25);
    expect(g.querySelector("circle")!.getAttribute("cx")).toBe("75");
    expect(g.querySelector("circle")!.getAttribute("cy")).toBe("75");
  });
});

describe("bakeAnnotationsTranslate (crop-bake walker)", () => {
  it("walks every direct child and shifts geometry by (dx, dy)", () => {
    const svg = svgWithRoot();
    const group = document.createElementNS(SVG_NS, "g") as SVGGElement;
    svg.appendChild(group);

    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "10");
    rect.setAttribute("y", "20");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "50");
    group.appendChild(rect);

    const circle = document.createElementNS(SVG_NS, "circle") as SVGCircleElement;
    circle.setAttribute("cx", "200");
    circle.setAttribute("cy", "150");
    circle.setAttribute("r", "30");
    group.appendChild(circle);

    const path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
    path.setAttribute("d", "M 10 20 L 30 40");
    group.appendChild(path);

    bakeAnnotationsTranslate(group, -5, -10);

    expect(rect.getAttribute("x")).toBe("5");
    expect(rect.getAttribute("y")).toBe("10");
    expect(circle.getAttribute("cx")).toBe("195");
    expect(circle.getAttribute("cy")).toBe("140");
    expect(path.getAttribute("d")).toBe("M5 10 L25 30");
  });

  it("translates `<line>` endpoints (the bakeTranslate dispatcher skips lines)", () => {
    const svg = svgWithRoot();
    const group = document.createElementNS(SVG_NS, "g") as SVGGElement;
    svg.appendChild(group);

    const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
    line.setAttribute("x1", "10");
    line.setAttribute("y1", "20");
    line.setAttribute("x2", "100");
    line.setAttribute("y2", "200");
    group.appendChild(line);

    bakeAnnotationsTranslate(group, -5, -10);

    expect(line.getAttribute("x1")).toBe("5");
    expect(line.getAttribute("y1")).toBe("10");
    expect(line.getAttribute("x2")).toBe("95");
    expect(line.getAttribute("y2")).toBe("190");
  });

  it('translates a curved `<g data-type="arrow">` — endpoints AND the bezier control point', () => {
    // Arrows store their endpoints + (optional) control point as data
    // attrs (`data-x1` / `data-y1` / `data-x2` / `data-y2` / `data-cx`
    // / `data-cy`). The composed stem / head `<path>` children are
    // rebuilt by `refreshArrowPath` from those values; bakeAnnotations
    // Translate routes arrows through `bakeLineTranslate` which shifts
    // endpoints AND control then re-runs the path refresh.
    const svg = svgWithRoot();
    const group = document.createElementNS(SVG_NS, "g") as SVGGElement;
    svg.appendChild(group);

    const arrow = document.createElementNS(SVG_NS, "g") as SVGGElement;
    arrow.setAttribute("data-type", "arrow");
    arrow.setAttribute("data-x1", "100");
    arrow.setAttribute("data-y1", "200");
    arrow.setAttribute("data-x2", "300");
    arrow.setAttribute("data-y2", "150");
    arrow.setAttribute("data-cx", "200");
    arrow.setAttribute("data-cy", "175");
    arrow.setAttribute("stroke", "#000");
    arrow.setAttribute("stroke-width", "3");
    group.appendChild(arrow);

    bakeAnnotationsTranslate(group, -50, -25);

    expect(arrow.getAttribute("data-x1")).toBe("50");
    expect(arrow.getAttribute("data-y1")).toBe("175");
    expect(arrow.getAttribute("data-x2")).toBe("250");
    expect(arrow.getAttribute("data-y2")).toBe("125");
    expect(arrow.getAttribute("data-cx")).toBe("150");
    expect(arrow.getAttribute("data-cy")).toBe("150");
  });

  it('translates a straight `<g data-type="arrow">` — no control point, no NaN leakage', () => {
    // Straight arrows have no `data-cx` / `data-cy` (the writer
    // omits them). The bake must NOT introduce a control point that
    // wasn't there originally — `readArrowControl` returns null when
    // the attrs are missing, so the writeArrowControl call is
    // skipped.
    const svg = svgWithRoot();
    const group = document.createElementNS(SVG_NS, "g") as SVGGElement;
    svg.appendChild(group);

    const arrow = document.createElementNS(SVG_NS, "g") as SVGGElement;
    arrow.setAttribute("data-type", "arrow");
    arrow.setAttribute("data-x1", "100");
    arrow.setAttribute("data-y1", "200");
    arrow.setAttribute("data-x2", "300");
    arrow.setAttribute("data-y2", "150");
    arrow.setAttribute("stroke", "#000");
    arrow.setAttribute("stroke-width", "3");
    group.appendChild(arrow);

    bakeAnnotationsTranslate(group, -50, -25);

    expect(arrow.getAttribute("data-x1")).toBe("50");
    expect(arrow.getAttribute("data-y1")).toBe("175");
    expect(arrow.getAttribute("data-x2")).toBe("250");
    expect(arrow.getAttribute("data-y2")).toBe("125");
    // No control attrs introduced.
    expect(arrow.hasAttribute("data-cx")).toBe(false);
    expect(arrow.hasAttribute("data-cy")).toBe(false);
  });

  it("(0, 0) is a no-op — no children are touched", () => {
    const svg = svgWithRoot();
    const group = document.createElementNS(SVG_NS, "g") as SVGGElement;
    svg.appendChild(group);
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "10");
    rect.setAttribute("y", "20");
    group.appendChild(rect);

    bakeAnnotationsTranslate(group, 0, 0);

    expect(rect.getAttribute("x")).toBe("10");
    expect(rect.getAttribute("y")).toBe("20");
  });

  it("handles a mixed annotation tree (line + rect + path) in one pass", () => {
    const svg = svgWithRoot();
    const group = document.createElementNS(SVG_NS, "g") as SVGGElement;
    svg.appendChild(group);

    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "100");
    rect.setAttribute("y", "100");
    rect.setAttribute("width", "50");
    rect.setAttribute("height", "30");
    group.appendChild(rect);

    const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
    line.setAttribute("x1", "100");
    line.setAttribute("y1", "100");
    line.setAttribute("x2", "200");
    line.setAttribute("y2", "150");
    group.appendChild(line);

    const path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
    path.setAttribute("d", "M 100 100 L 200 150");
    group.appendChild(path);

    bakeAnnotationsTranslate(group, -100, -100);

    expect(rect.getAttribute("x")).toBe("0");
    expect(rect.getAttribute("y")).toBe("0");
    expect(line.getAttribute("x1")).toBe("0");
    expect(line.getAttribute("y1")).toBe("0");
    expect(line.getAttribute("x2")).toBe("100");
    expect(line.getAttribute("y2")).toBe("50");
    expect(path.getAttribute("d")).toBe("M0 0 L100 50");
  });
});
