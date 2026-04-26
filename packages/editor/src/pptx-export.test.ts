/**
 * @vitest-environment happy-dom
 *
 * Golden-snapshot regression net for the PPTX export's slide XML.
 * Mirrors what `clipboard_test.rs` does for the GVML clipboard
 * path: pin the current `<p:sp>` / `<p:cxnSp>` / `<p:pic>` output
 * byte-for-byte so the upcoming
 * [`office-paste-shared-drawing-builder` plan](../../../docs/plans/office-paste-shared-drawing-builder.md)
 * can swap the per-shape builders for a shared `annot-render`
 * implementation without silently regressing the PPTX surface.
 *
 * The test feeds a synthetic `PptxExportInput` whose `annotations`
 * is a hand-built SVG `<g>` containing one of every emitter the
 * canvas can produce: line, arrow, rect (sharp + rounded),
 * ellipse, text, freehand path, freehand session group, and a
 * marker (counter) `<g>`. All shape kinds also exercise the
 * `xfrmAttrs` rotation/flip plumbing where applicable.
 */

import { describe, expect, it } from "vitest";
import { buildPptxFiles, type PptxExportInput } from "./pptx-export.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Element[] = [],
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  for (const child of children) {
    el.appendChild(child);
  }
  return el;
}

function makeAnnotationGroup(...children: Element[]): SVGGElement {
  const g = svg("g");
  for (const c of children) g.appendChild(c);
  return g;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function buildInput(annotations: SVGElement, opts?: { hasImage?: boolean }): PptxExportInput {
  // 1x1 transparent JPEG-ish data URL — content irrelevant; only
  // `dataUrlToUint8Array` decode-success matters for whether the
  // slide emits the background `<p:pic>` element.
  const href = opts?.hasImage
    ? "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKp//9k="
    : "";
  const imageEl = {
    getAttribute(name: string): string | null {
      return name === "href" ? href : null;
    },
  };
  return {
    imageWidth: 800,
    imageHeight: 600,
    imageEl,
    annotations,
  };
}

describe("buildPptxFiles slide XML", () => {
  it("pins the current output for every emitter", () => {
    const annotations = makeAnnotationGroup(
      // Plain rect.
      svg("rect", {
        x: "10",
        y: "20",
        width: "100",
        height: "80",
        stroke: "#ff0000",
        "stroke-width": "3",
        fill: "#ffeeaa",
        "fill-opacity": "0.5",
      }),
      // Rounded rect (rx>0 triggers the avLst adj branch).
      svg("rect", {
        x: "120",
        y: "20",
        width: "100",
        height: "80",
        rx: "8",
        stroke: "#0000ff",
        "stroke-width": "2",
        fill: "none",
      }),
      // Ellipse.
      svg("ellipse", {
        cx: "300",
        cy: "60",
        rx: "50",
        ry: "40",
        stroke: "#00ff00",
        "stroke-width": "3",
        fill: "none",
      }),
      // Arrow group — ArrowTool's `<g data-type="arrow">` form.
      // (Plain `<line>` SVG elements were a legacy back-compat
      // path for old saved files; ArrowTool no longer emits them
      // and the dispatch was dropped in
      // pptx-export-shared-builder-finish phase 1.)
      makeArrowGroup({
        x1: 10,
        y1: 250,
        x2: 210,
        y2: 250,
        endShape: "triangle",
      }),
      // Plain `<text>` (single-string editor text, no group).
      svg("text", {
        x: "10",
        y: "350",
        "font-size": "24",
        fill: "#000000",
      }),
      // Freehand standalone <path>.
      svg("path", {
        d: "M 0 400 L 100 410 L 200 405",
        stroke: "#ff00ff",
        "stroke-width": "2",
        fill: "none",
      }),
      // Freehand session group with two child paths.
      makeFreehandGroup(),
      // Marker (counter): outer <g> with `data-shape="rect"`,
      // bg <rect>, label <text>. Tests the rect/rounded
      // dispatch in `buildMarker`.
      makeMarkerGroup({ shape: "rect", cx: 400, cy: 500, label: "1" }),
    );

    const files = buildPptxFiles(buildInput(annotations));
    const slide = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide).toMatchSnapshot();
  });

  it("emits <p:pic> background when the canvas has an image", () => {
    const annotations = makeAnnotationGroup(
      svg("rect", {
        x: "10",
        y: "20",
        width: "100",
        height: "80",
        stroke: "#ff0000",
        "stroke-width": "3",
        fill: "#ffeeaa",
      }),
    );
    const files = buildPptxFiles(buildInput(annotations, { hasImage: true }));
    const slide = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide).toMatchSnapshot();
  });

  it("rounded marker dispatches via data-shape='rounded'", () => {
    // Counter with rounded variant — emits roundRect with the
    // larger `adj` value vs the sharp-corner `rect` form.
    const annotations = makeAnnotationGroup(
      makeMarkerGroup({ shape: "rounded", cx: 500, cy: 300, label: "2" }),
    );
    const files = buildPptxFiles(buildInput(annotations));
    const slide = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide).toMatchSnapshot();
  });

  it("every PPTX non-visual props container carries <p:nvPr/>", () => {
    // PPTX's `CT_ShapeNonVisual` / `CT_ConnectorNonVisual` /
    // `CT_PictureNonVisual` schemas REQUIRE `<p:nvPr/>` as the
    // third child (after `cNvPr` and `cNv{type}Pr`). PowerPoint
    // refuses to open files where it's missing — a regression
    // we hit on 2026-04-27 with anno-1777242607432.pptx.
    //
    // Structural guard: the every-emitter slide must contain a
    // `<p:nvPr/>` immediately after each `<p:cNvSpPr*/>` /
    // `<p:cNvCxnSpPr/>` / `</p:cNvPicPr>`. If a future namespace
    // refactor drops the suffix on one of the emitters, this
    // test fails before the snapshot one does — making the
    // failure mode obvious instead of silently producing a
    // PowerPoint-rejected file.
    const annotations = makeAnnotationGroup(
      svg("rect", {
        x: "10",
        y: "20",
        width: "100",
        height: "80",
        stroke: "#ff0000",
        "stroke-width": "3",
        fill: "#ffeeaa",
      }),
      svg("ellipse", {
        cx: "300",
        cy: "60",
        rx: "50",
        ry: "40",
        stroke: "#00ff00",
        "stroke-width": "3",
        fill: "none",
      }),
      makeArrowGroup({
        x1: 10,
        y1: 250,
        x2: 210,
        y2: 250,
        endShape: "triangle",
      }),
      makeMarkerGroup({ shape: "rect", cx: 400, cy: 500, label: "1" }),
    );
    const files = buildPptxFiles(buildInput(annotations, { hasImage: true }));
    const slide = decode(files["ppt/slides/slide1.xml"]!);

    // Strip whitespace so we can match the patterns regardless
    // of how the slide envelope chooses to format itself.
    const compact = slide.replace(/\s+/g, "");

    // Every `<p:cNvSpPr.../>` must be followed by `<p:nvPr/>`
    // before the closing `</p:nvSpPr>`.
    const cnvSpRegex = /<p:cNvSpPr[^/]*\/>([^<]*<[^>]*>)*?<\/p:nvSpPr>/g;
    for (const match of compact.matchAll(cnvSpRegex)) {
      expect(match[0]).toContain("<p:nvPr/>");
    }
    // Every `<p:cNvCxnSpPr/>` must be followed by `<p:nvPr/>`.
    const cnvCxnRegex = /<p:cNvCxnSpPr\/>([^<]*<[^>]*>)*?<\/p:nvCxnSpPr>/g;
    for (const match of compact.matchAll(cnvCxnRegex)) {
      expect(match[0]).toContain("<p:nvPr/>");
    }
    // Every `</p:cNvPicPr>` must be followed by `<p:nvPr/>`.
    const cnvPicRegex = /<\/p:cNvPicPr>([^<]*<[^>]*>)*?<\/p:nvPicPr>/g;
    for (const match of compact.matchAll(cnvPicRegex)) {
      expect(match[0]).toContain("<p:nvPr/>");
    }
  });

  it("curved arrow emits <a:custGeom> with quadratic Bezier", () => {
    // ArrowTool emits a `<g data-type="arrow">` with `data-cx` /
    // `data-cy` for the quadratic-Bezier control point when the
    // user drags a curved arrow. PPTX export's `buildLine`
    // detects the curve via `getEffectiveLineEndpoints` (which
    // routes through `readArrowControl`) and swaps the
    // `<a:prstGeom prst="line">` for `<a:custGeom>` with a
    // `<a:moveTo>` + `<a:quadBezTo>` path so the curve survives
    // the paste. Pin the current XML so phase 3's migration to
    // the shared builder produces the same output.
    const annotations = makeAnnotationGroup(
      makeArrowGroup({
        x1: 50,
        y1: 100,
        x2: 250,
        y2: 100,
        endShape: "triangle",
        controlX: 150,
        controlY: 30,
      }),
    );
    const files = buildPptxFiles(buildInput(annotations));
    const slide = decode(files["ppt/slides/slide1.xml"]!);
    expect(slide).toMatchSnapshot();
  });
});

function makeArrowGroup(opts: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  endShape: string;
  /** Optional quadratic-Bezier control point. Set together
   *  with `controlY`; when populated, the arrow renders as a
   *  curve via `<a:custGeom>` instead of `<a:prstGeom prst="line">`. */
  controlX?: number;
  controlY?: number;
}): SVGGElement {
  // Mirror of ArrowTool's `<g data-type="arrow">` skeleton. The
  // PPTX export's `buildLine` reads endpoints from `data-x1` /
  // `data-y1` / `data-x2` / `data-y2`, arrow spec from the
  // `data-arrow-*-shape` attrs, and (when curved) the control
  // point from `data-cx` / `data-cy` via `readArrowControl`.
  const g = svg("g");
  g.setAttribute("data-type", "arrow");
  g.setAttribute("data-x1", String(opts.x1));
  g.setAttribute("data-y1", String(opts.y1));
  g.setAttribute("data-x2", String(opts.x2));
  g.setAttribute("data-y2", String(opts.y2));
  g.setAttribute("stroke", "#ff0000");
  g.setAttribute("stroke-width", "3");
  g.setAttribute("data-arrow-end-shape", opts.endShape);
  g.setAttribute("data-arrow-end-width", "med");
  g.setAttribute("data-arrow-end-length", "med");
  if (opts.controlX != null && opts.controlY != null) {
    g.setAttribute("data-cx", String(opts.controlX));
    g.setAttribute("data-cy", String(opts.controlY));
  }
  return g;
}

function makeFreehandGroup(): SVGGElement {
  // `<g data-type="freehand">` skeleton with two child <path>s,
  // matching the freehand session group the toolbar emits.
  const g = svg("g");
  g.setAttribute("data-type", "freehand");
  g.appendChild(
    svg("path", {
      d: "M 50 600 L 100 605 L 150 600",
      stroke: "#ff8800",
      "stroke-width": "3",
      fill: "none",
    }),
  );
  g.appendChild(
    svg("path", {
      d: "M 60 620 L 110 625 L 160 620",
      stroke: "#ff8800",
      "stroke-width": "3",
      fill: "none",
    }),
  );
  return g;
}

function makeMarkerGroup(opts: {
  shape: "circle" | "rect" | "rounded";
  cx: number;
  cy: number;
  label: string;
}): SVGGElement {
  const g = svg("g");
  g.setAttribute("data-shape", opts.shape);
  if (opts.shape === "circle") {
    g.appendChild(
      svg("circle", {
        cx: String(opts.cx),
        cy: String(opts.cy),
        r: "10",
        fill: "#ff0000",
      }),
    );
  } else {
    g.appendChild(
      svg("rect", {
        x: String(opts.cx - 10),
        y: String(opts.cy - 10),
        width: "20",
        height: "20",
        fill: "#ff0000",
      }),
    );
  }
  const label = svg("text", {
    x: String(opts.cx),
    y: String(opts.cy + 4),
    "font-size": "13",
    "text-anchor": "middle",
    fill: "#ffffff",
  });
  label.textContent = opts.label;
  g.appendChild(label);
  return g;
}
