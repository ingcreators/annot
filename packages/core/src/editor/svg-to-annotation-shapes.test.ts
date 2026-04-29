/**
 * @vitest-environment happy-dom
 *
 * Unit test for the SVG → AnnotationShape extractor lifted from
 * the toolbar's `#copyForOffice` in
 * [`office-paste-shared-drawing-builder` phase 1](../../../../docs/plans/office-paste-shared-drawing-builder.md).
 *
 * Each `it` block builds a hand-crafted annotation tree and asserts
 * the extractor produces the same shape literals the toolbar's
 * inlined version produced before the lift. Pinning the per-tag
 * dispatch means later phases (the shared OOXML builder in
 * `annot-render`) can refactor the consumer side without dragging
 * the extractor along.
 */

import { describe, expect, it } from "vitest";
import { svgAnnotationsToShapes, svgElementToAnnotationShape } from "./svg-to-annotation-shapes.js";

// happy-dom ships `DOMPoint` but not `DOMPoint.prototype.matrixTransform`
// (used by `getEffectiveLineEndpoints` for the rotation / flip / non-zero
// translate path). Patch in a 2-D affine-transform implementation so the
// arrow-group tests below can exercise the matrix branch.
if (typeof DOMPoint !== "undefined" && !DOMPoint.prototype.matrixTransform) {
  DOMPoint.prototype.matrixTransform = function (this: DOMPoint, m: DOMMatrix) {
    const x = this.x;
    const y = this.y;
    return new DOMPoint(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

function group(...children: Element[]): SVGGElement {
  const g = svg("g");
  for (const c of children) g.appendChild(c);
  return g;
}

describe("svgElementToAnnotationShape", () => {
  it("plain rect emits type=rect with corner_radius=0", () => {
    const el = svg("rect", {
      x: "10",
      y: "20",
      width: "100",
      height: "80",
      stroke: "#ff0000",
      "stroke-width": "3",
      fill: "#ffeeaa",
      "fill-opacity": "0.5",
    });
    expect(svgElementToAnnotationShape(el)).toEqual({
      type: "rect",
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      stroke: "#ff0000",
      stroke_width: 3,
      stroke_dasharray: "",
      fill: "#ffeeaa",
      fill_opacity: 0.5,
      corner_radius: 0,
      redact_style: undefined,
    });
  });

  it("rect with rx>0 carries the corner_radius for the roundRect dispatch", () => {
    const el = svg("rect", {
      x: "0",
      y: "0",
      width: "50",
      height: "50",
      rx: "8",
      stroke: "none",
      "stroke-width": "0",
      fill: "none",
      "fill-opacity": "1",
    });
    const out = svgElementToAnnotationShape(el)!;
    expect(out.corner_radius).toBe(8);
  });

  it("rect with data-redact-style='solid' carries redact_style='solid'", () => {
    const el = svg("rect", {
      x: "0",
      y: "0",
      width: "100",
      height: "30",
      stroke: "#ff0000",
      "stroke-width": "3",
      fill: "#000000",
      "fill-opacity": "1",
      "data-redact-style": "solid",
    });
    const out = svgElementToAnnotationShape(el)!;
    expect(out.redact_style).toBe("solid");
  });

  it("ellipse maps geometry + stroke + fill", () => {
    const el = svg("ellipse", {
      cx: "300",
      cy: "60",
      rx: "50",
      ry: "40",
      stroke: "#00ff00",
      "stroke-width": "3",
      fill: "none",
      "fill-opacity": "1",
    });
    const out = svgElementToAnnotationShape(el)!;
    expect(out).toMatchObject({
      type: "ellipse",
      cx: 300,
      cy: 60,
      rx: 50,
      ry: 40,
      stroke: "#00ff00",
      fill: "none",
    });
  });

  it("g[data-type=arrow] picks type=arrow when an end shape is set", () => {
    const g = svg("g");
    g.setAttribute("data-type", "arrow");
    g.setAttribute("data-x1", "10");
    g.setAttribute("data-y1", "150");
    g.setAttribute("data-x2", "210");
    g.setAttribute("data-y2", "250");
    g.setAttribute("stroke", "#ff0000");
    g.setAttribute("stroke-width", "3");
    g.setAttribute("data-arrow-end-shape", "triangle");
    const out = svgElementToAnnotationShape(g)!;
    expect(out.type).toBe("arrow");
    expect(out).toMatchObject({
      x1: 10,
      y1: 150,
      x2: 210,
      y2: 250,
      has_arrow: true,
      arrow_head_end: true,
      arrow_shape_end: "triangle",
    });
  });

  it("g[data-type=arrow] degrades to type=line without any end shape", () => {
    const g = svg("g");
    g.setAttribute("data-type", "arrow");
    g.setAttribute("data-x1", "0");
    g.setAttribute("data-y1", "0");
    g.setAttribute("data-x2", "100");
    g.setAttribute("data-y2", "0");
    expect(svgElementToAnnotationShape(g)?.type).toBe("line");
  });

  it("path emits type=freehand with the d-string in `path_d`", () => {
    const el = svg("path", {
      d: "M 0 0 L 10 10 L 20 5",
      stroke: "#ff00ff",
      "stroke-width": "2",
      "stroke-opacity": "0.5",
    });
    const out = svgElementToAnnotationShape(el)!;
    expect(out.type).toBe("freehand");
    expect(out.path_d).toBe("M 0 0 L 10 10 L 20 5");
    // stroke-opacity < 0.99 → highlighter draw style.
    expect(out.draw_style).toBe("highlighter");
    // The transformOf helper folds the stroke opacity into the
    // canonical `stroke_opacity_value` field.
    expect(out.stroke_opacity_value).toBe(0.5);
  });

  it("plain <text> emits shape_kind='plain' with one run", () => {
    const el = svg("text", {
      x: "10",
      y: "400",
      "font-size": "24",
      fill: "#000000",
    });
    el.textContent = "Hello";
    const out = svgElementToAnnotationShape(el)!;
    expect(out).toMatchObject({
      type: "text",
      x: 10,
      y: 400,
      font_size: 24,
      fill: "#000000",
      shape_kind: "plain",
    });
    expect(out.runs).toEqual([{ text: "Hello" }]);
  });

  it("text-bearing shape <g> with sticky kind carries text_bg_color from the bg rect", () => {
    const g = svg("g");
    g.setAttribute("data-type", "shape");
    g.setAttribute("data-shape-kind", "sticky");
    const bgRect = svg("rect", {
      x: "10",
      y: "400",
      width: "200",
      height: "50",
      fill: "rgba(255,255,200,0.92)",
    });
    const t = svg("text", {
      "font-size": "24",
      fill: "#000000",
    });
    const ts = svg("tspan");
    ts.textContent = "Sticky";
    t.appendChild(ts);
    g.appendChild(bgRect);
    g.appendChild(t);
    const out = svgElementToAnnotationShape(g)!;
    expect(out).toMatchObject({
      type: "text",
      x: 10,
      y: 400,
      width: 200,
      height: 50,
      shape_kind: "sticky",
      text_bg_color: "rgba(255,255,200,0.92)",
    });
    expect(out.runs).toEqual([{ text: "Sticky" }]);
  });

  it("text-bearing shape callout populates tail_x / tail_y", () => {
    const g = svg("g");
    g.setAttribute("data-type", "shape");
    g.setAttribute("data-shape-kind", "callout");
    g.setAttribute("data-tail-x", "300");
    g.setAttribute("data-tail-y", "470");
    g.appendChild(svg("rect", { x: "100", y: "400", width: "150", height: "50", fill: "#ffffaa" }));
    const t = svg("text", { "font-size": "20" });
    const ts = svg("tspan");
    ts.textContent = "Callout!";
    t.appendChild(ts);
    g.appendChild(t);
    const out = svgElementToAnnotationShape(g)!;
    expect(out.shape_kind).toBe("callout");
    expect(out.tail_x).toBe(300);
    expect(out.tail_y).toBe(470);
    expect(out.runs).toEqual([{ text: "Callout!" }]);
  });

  it("text-bearing shape with multi-line tspans collapses runs to one-per-line with line_break_after", () => {
    const g = svg("g");
    g.setAttribute("data-type", "shape");
    g.setAttribute("data-shape-kind", "plain");
    g.appendChild(svg("rect", { x: "0", y: "0", width: "100", height: "60" }));
    const t = svg("text", { "font-size": "16", fill: "#000" });
    // Each line's first tspan carries x / y to mark a new paragraph;
    // continuation tspans within the same paragraph (Phase 2) would
    // omit them and inherit the parent's flow position.
    const a = svg("tspan", { x: "0", y: "16" });
    a.textContent = "Line A";
    const b = svg("tspan", { x: "0", y: "32" });
    b.textContent = "Line B";
    t.appendChild(a);
    t.appendChild(b);
    g.appendChild(t);
    const out = svgElementToAnnotationShape(g)!;
    expect(out.runs).toEqual([{ text: "Line A", line_break_after: true }, { text: "Line B" }]);
  });

  it("marker <g> with data-shape='rect' picks the rect counter form", () => {
    const g = svg("g");
    g.setAttribute("data-shape", "rect");
    g.appendChild(svg("rect", { x: "390", y: "290", width: "20", height: "20", fill: "#ff0000" }));
    const t = svg("text", { "font-size": "13" });
    t.textContent = "1";
    g.appendChild(t);
    const out = svgElementToAnnotationShape(g)!;
    expect(out).toMatchObject({
      type: "marker",
      cx: 400,
      cy: 300,
      fill: "#ff0000",
      label: "1",
      font_size: 13,
      marker_shape: "rect",
    });
  });

  it("marker <g> with data-shape='rounded' picks the rounded counter form", () => {
    const g = svg("g");
    g.setAttribute("data-shape", "rounded");
    g.appendChild(svg("rect", { x: "490", y: "290", width: "20", height: "20", fill: "#0000ff" }));
    const t = svg("text", { "font-size": "13" });
    t.textContent = "2";
    g.appendChild(t);
    const out = svgElementToAnnotationShape(g)!;
    expect(out?.marker_shape).toBe("rounded");
  });

  it("image with data-redact-style picks the matching image shape type", () => {
    const el = svg("image", {
      x: "500",
      y: "400",
      width: "100",
      height: "80",
      href: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "data-redact-style": "blur",
    });
    expect(svgElementToAnnotationShape(el)).toMatchObject({
      type: "blur_image",
      redact_style: "blur",
      image_data_url: expect.stringContaining("data:image/png"),
    });
  });

  it("group translate via data-tx / data-ty bakes into resulting coords", () => {
    const g = svg("g");
    g.setAttribute("data-type", "arrow");
    g.setAttribute("data-x1", "0");
    g.setAttribute("data-y1", "0");
    g.setAttribute("data-x2", "100");
    g.setAttribute("data-y2", "0");
    g.setAttribute("data-tx", "50");
    g.setAttribute("data-ty", "20");
    const out = svgElementToAnnotationShape(g)!;
    expect(out.x1).toBe(50);
    expect(out.y1).toBe(20);
    expect(out.x2).toBe(150);
    expect(out.y2).toBe(20);
  });

  it("data-rot / data-flip-h / data-flip-v populate the xform partial", () => {
    const el = svg("rect", {
      x: "0",
      y: "0",
      width: "10",
      height: "10",
      "data-rot": "45",
      "data-flip-h": "1",
      "data-flip-v": "1",
    });
    const out = svgElementToAnnotationShape(el)!;
    expect(out.rotation_deg).toBe(45);
    expect(out.flip_h).toBe(true);
    expect(out.flip_v).toBe(true);
  });

  it("returns null for an unrecognised <g> wrapper", () => {
    const g = svg("g");
    g.setAttribute("data-type", "freehand"); // freehand session group — toolbar today doesn't emit this in #copyForOffice
    expect(svgElementToAnnotationShape(g)).toBeNull();
  });
});

describe("svgAnnotationsToShapes", () => {
  it("walks the parent's child elements and emits one shape per recognised tag", () => {
    const parent = group(
      svg("rect", {
        x: "0",
        y: "0",
        width: "10",
        height: "10",
        stroke: "none",
        "stroke-width": "0",
        fill: "#ff0000",
        "fill-opacity": "1",
      }),
      svg("ellipse", {
        cx: "100",
        cy: "100",
        rx: "10",
        ry: "10",
        stroke: "#00ff00",
        "stroke-width": "3",
        fill: "none",
        "fill-opacity": "1",
      }),
    );
    const shapes = svgAnnotationsToShapes(parent);
    expect(shapes).toHaveLength(2);
    expect(shapes[0]?.type).toBe("rect");
    expect(shapes[1]?.type).toBe("ellipse");
  });

  it("skips child nodes the per-tag dispatch doesn't recognise", () => {
    const parent = svg("g");
    // Add a text node (a stray whitespace string between elements
    // is the common case in real annotation trees).
    parent.appendChild(document.createTextNode("\n  "));
    parent.appendChild(svg("rect", { x: "0", y: "0", width: "1", height: "1", fill: "#000" }));
    parent.appendChild(document.createTextNode("\n"));
    const shapes = svgAnnotationsToShapes(parent);
    expect(shapes).toHaveLength(1);
  });
});
