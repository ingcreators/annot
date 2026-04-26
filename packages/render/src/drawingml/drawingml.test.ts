/**
 * Cross-implementation validation: assert the TS-side
 * `buildDrawingXml` output is byte-equivalent to the existing
 * Rust GVML golden snapshots (pinned in
 * `packages/desktop/src-tauri/src/commands/snapshots/`).
 *
 * The Rust phase-0 snapshot from
 * [`_done/office-paste-abi-modernisation` phase 0](../../../../docs/plans/_done/office-paste-abi-modernisation.md)
 * is the ground-truth XML the Office clipboard currently emits.
 * Once these tests pass, [phase 3 of the shared-builder
 * plan](../../../../docs/plans/office-paste-shared-drawing-builder.md)
 * can swap the Rust per-shape emitters for the TS implementation
 * without changing the wire output.
 *
 * The fixtures here mirror the Rust test inputs in
 * `packages/desktop/src-tauri/src/commands/clipboard_test.rs`
 * one-for-one — same coordinates, same colors, same field
 * values — so the snapshots are directly comparable. The
 * expected strings are pasted from the Rust `.snap` files
 * verbatim (frontmatter stripped); when Rust output
 * intentionally changes, the cross-impl test fails first and
 * forces the TS side to update in lockstep.
 */

import type { AnnotationShape } from "@ingcreators/annot-core/tauri-bridge";
import { describe, expect, it } from "vitest";
import { buildDrawingXml } from "./drawing-envelope.js";

const TEST_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function rect(): AnnotationShape {
  return {
    type: "rect",
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    stroke: "#ff0000",
    stroke_width: 3,
    fill: "#ffeeaa",
    fill_opacity: 0.5,
  };
}

function roundedRect(): AnnotationShape {
  return {
    type: "rect",
    x: 120,
    y: 20,
    width: 100,
    height: 80,
    stroke: "#0000ff",
    stroke_width: 2,
    fill: "none",
    corner_radius: 8,
  };
}

function ellipse(): AnnotationShape {
  return {
    type: "ellipse",
    cx: 300,
    cy: 60,
    rx: 50,
    ry: 40,
    stroke: "#00ff00",
    stroke_width: 3,
    fill: "none",
  };
}

function arrow(): AnnotationShape {
  return {
    type: "arrow",
    x1: 10,
    y1: 150,
    x2: 210,
    y2: 250,
    stroke: "#ff0000",
    stroke_width: 3,
    has_arrow: true,
    arrow_shape_end: "triangle",
    // The TS interface lists `"sm" | "md" | "lg"` but the
    // OOXML wire form is `"sm" | "med" | "lg"` — `endXml`
    // maps "md" to "med" (default fallback) so both round-trip
    // to the same byte output.
    arrow_width_end: "md",
    arrow_length_end: "md",
  };
}

function curvedArrow(): AnnotationShape {
  // Quadratic Bezier with the control point at (150, 30) — outside
  // the straight-line bbox, so the bbox computation must include
  // the control point or the curve gets clipped on paste.
  return {
    type: "arrow",
    x1: 50,
    y1: 100,
    x2: 250,
    y2: 100,
    arrow_curve_cx: 150,
    arrow_curve_cy: 30,
    stroke: "#ff0000",
    stroke_width: 3,
    has_arrow: true,
    arrow_shape_end: "triangle",
    arrow_width_end: "md",
    arrow_length_end: "md",
  };
}

function marker(): AnnotationShape {
  return {
    type: "marker",
    cx: 400,
    cy: 300,
    font_size: 13,
    fill: "#ff0000",
    label: "1",
    marker_shape: "rect",
  };
}

function markerRounded(): AnnotationShape {
  return {
    type: "marker",
    cx: 500,
    cy: 300,
    font_size: 13,
    fill: "#0000ff",
    label: "2",
    marker_shape: "rounded",
  };
}

function text(): AnnotationShape {
  return {
    type: "text",
    x: 10,
    y: 400,
    width: 200,
    height: 50,
    font_size: 24,
    fill: "#000000",
    text: "Hello",
    text_bg_color: "rgba(255,255,200,0.92)",
  };
}

function callout(): AnnotationShape {
  return {
    type: "text",
    x: 100,
    y: 400,
    width: 150,
    height: 50,
    font_size: 20,
    fill: "#000000",
    text: "Callout!",
    text_bg_color: "rgba(255,255,200,0.92)",
    text_variant: "callout",
    tail_x: 300,
    tail_y: 470,
  };
}

function freehand(): AnnotationShape {
  return {
    type: "freehand",
    stroke: "#ff00ff",
    stroke_width: 2,
    text: "M 0 0 L 10 10 L 20 5",
  };
}

function mosaic(): AnnotationShape {
  return {
    type: "mosaic_image",
    x: 500,
    y: 400,
    width: 100,
    height: 80,
    image_data_url: TEST_PNG_DATA_URL,
  };
}

function redactSolid(): AnnotationShape {
  return {
    type: "rect",
    x: 50,
    y: 500,
    width: 120,
    height: 30,
    stroke: "#ff0000",
    stroke_width: 3,
    fill: "#000000",
    fill_opacity: 1,
    redact_style: "solid",
  };
}

// ─── Expected strings (verbatim copies of the Rust .snap bodies) ────

const EXPECTED_ALL_EMITTERS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7620000" cy="5715000"/><a:chOff x="0" y="0"/><a:chExt cx="7620000" cy="5715000"/></a:xfrm></a:grpSpPr><a:sp><a:nvSpPr><a:cNvPr id="2" name="R2"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="95250" y="190500"/><a:ext cx="952500" cy="762000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFEEAA"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:ln w="38100"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></a:spPr></a:sp><a:sp><a:nvSpPr><a:cNvPr id="3" name="R3"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="1143000" y="190500"/><a:ext cx="952500" cy="762000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="25400"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:ln></a:spPr></a:sp><a:sp><a:nvSpPr><a:cNvPr id="4" name="E4"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="2381250" y="190500"/><a:ext cx="952500" cy="762000"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="38100"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:ln></a:spPr></a:sp><a:cxnSp><a:nvCxnSpPr><a:cNvPr id="5" name="L5"/><a:cNvCxnSpPr/></a:nvCxnSpPr><a:spPr><a:xfrm><a:off x="95250" y="1428750"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="38100"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:tailEnd type="triangle" w="med" len="med"/></a:ln></a:spPr></a:cxnSp><a:sp><a:nvSpPr><a:cNvPr id="6" name="M6"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="3710940" y="2758440"/><a:ext cx="198120" cy="198120"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln w="14288"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></a:spPr><a:txSp><a:txBody><a:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0" wrap="none"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="975" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>1</a:t></a:r></a:p></a:txBody><a:useSpRect/></a:txSp></a:sp><a:sp><a:nvSpPr><a:cNvPr id="7" name="T7"/><a:cNvSpPr txBox="1"/></a:nvSpPr><a:spPr><a:xfrm><a:off x="95250" y="3810000"/><a:ext cx="1905000" cy="476250"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FFFFC8"><a:alpha val="92157"/></a:srgbClr></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></a:spPr><a:txSp><a:txBody><a:bodyPr wrap="square" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP" sz="1800" dirty="0"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:rPr><a:t>Hello</a:t></a:r></a:p></a:txBody><a:useSpRect/></a:txSp></a:sp><a:sp><a:nvSpPr><a:cNvPr id="8" name="F8"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="190500" cy="95250"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="190500" b="95250"/><a:pathLst><a:path w="190500" h="95250"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="95250" y="95250"/></a:lnTo><a:lnTo><a:pt x="190500" y="47625"/></a:lnTo></a:path></a:pathLst></a:custGeom><a:noFill/><a:ln w="25400" cap="rnd"><a:solidFill><a:srgbClr val="FF00FF"/></a:solidFill><a:round/></a:ln></a:spPr></a:sp><a:pic><a:nvPicPr><a:cNvPr id="9" name="Mosaic9"/><a:cNvPicPr><a:picLocks noChangeAspect="1"/></a:cNvPicPr></a:nvPicPr><a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:spPr><a:xfrm><a:off x="4762500" y="3810000"/><a:ext cx="952500" cy="762000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></a:spPr></a:pic></lc:lockedCanvas></a:graphicData></a:graphic>`;

const EXPECTED_WITH_SCREENSHOT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9753600" cy="7315200"/><a:chOff x="0" y="0"/><a:chExt cx="9753600" cy="7315200"/></a:xfrm></a:grpSpPr><a:pic><a:nvPicPr><a:cNvPr id="1000" name="Screenshot"/><a:cNvPicPr><a:picLocks noChangeAspect="1"/></a:cNvPicPr></a:nvPicPr><a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9753600" cy="7315200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></a:spPr></a:pic><a:sp><a:nvSpPr><a:cNvPr id="2" name="R2"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="95250" y="190500"/><a:ext cx="952500" cy="762000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFEEAA"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:ln w="38100"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></a:spPr></a:sp></lc:lockedCanvas></a:graphicData></a:graphic>`;

const EXPECTED_MARKER_ROUNDED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7620000" cy="5715000"/><a:chOff x="0" y="0"/><a:chExt cx="7620000" cy="5715000"/></a:xfrm></a:grpSpPr><a:sp><a:nvSpPr><a:cNvPr id="2" name="M2"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="4663440" y="2758440"/><a:ext cx="198120" cy="198120"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill><a:ln w="14288"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></a:spPr><a:txSp><a:txBody><a:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0" wrap="none"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="975" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>2</a:t></a:r></a:p></a:txBody><a:useSpRect/></a:txSp></a:sp></lc:lockedCanvas></a:graphicData></a:graphic>`;

const EXPECTED_CALLOUT_WITH_TAIL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7620000" cy="5715000"/><a:chOff x="0" y="0"/><a:chExt cx="7620000" cy="5715000"/></a:xfrm></a:grpSpPr><a:sp><a:nvSpPr><a:cNvPr id="2" name="T2"/><a:cNvSpPr txBox="1"/></a:nvSpPr><a:spPr><a:xfrm><a:off x="952500" y="3810000"/><a:ext cx="1428750" cy="476250"/></a:xfrm><a:prstGeom prst="wedgeRoundRectCallout"><a:avLst><a:gd name="adj1" fmla="val 83333"/><a:gd name="adj2" fmla="val 90000"/><a:gd name="adj3" fmla="val 5000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FFFFC8"><a:alpha val="92157"/></a:srgbClr></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></a:spPr><a:txSp><a:txBody><a:bodyPr wrap="square" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP" sz="1500" dirty="0"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:rPr><a:t>Callout!</a:t></a:r></a:p></a:txBody><a:useSpRect/></a:txSp></a:sp></lc:lockedCanvas></a:graphicData></a:graphic>`;

const EXPECTED_REDACT_SOLID_NO_OUTLINE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7620000" cy="5715000"/><a:chOff x="0" y="0"/><a:chExt cx="7620000" cy="5715000"/></a:xfrm></a:grpSpPr><a:sp><a:nvSpPr><a:cNvPr id="2" name="R2"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="476250" y="4762500"/><a:ext cx="1143000" cy="285750"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:ln><a:noFill/></a:ln></a:spPr></a:sp></lc:lockedCanvas></a:graphicData></a:graphic>`;

describe("buildDrawingXml byte-equivalence with Rust GVML goldens", () => {
  it("matches the Rust drawing_xml_all_emitters snapshot", () => {
    const { drawing, mediaFiles } = buildDrawingXml({
      shapes: [
        rect(),
        roundedRect(),
        ellipse(),
        arrow(),
        marker(),
        text(),
        freehand(),
        mosaic(),
      ],
      width: 800,
      height: 600,
      hasImage: false,
    });
    expect(drawing).toBe(EXPECTED_ALL_EMITTERS);
    expect(mediaFiles).toHaveLength(1);
    expect(mediaFiles[0]?.filename).toMatch(/^mosaic_/);
  });

  it("matches the Rust drawing_xml_with_screenshot snapshot", () => {
    const { drawing, mediaFiles } = buildDrawingXml({
      shapes: [rect()],
      width: 1024,
      height: 768,
      hasImage: true,
    });
    expect(drawing).toBe(EXPECTED_WITH_SCREENSHOT);
    expect(mediaFiles).toHaveLength(0);
  });

  it("matches the Rust drawing_xml_marker_rounded snapshot", () => {
    const { drawing } = buildDrawingXml({
      shapes: [markerRounded()],
      width: 800,
      height: 600,
      hasImage: false,
    });
    expect(drawing).toBe(EXPECTED_MARKER_ROUNDED);
  });

  it("matches the Rust drawing_xml_callout_with_tail snapshot", () => {
    const { drawing } = buildDrawingXml({
      shapes: [callout()],
      width: 800,
      height: 600,
      hasImage: false,
    });
    expect(drawing).toBe(EXPECTED_CALLOUT_WITH_TAIL);
  });

  it("emits <a:custGeom> with quadratic Bezier for curved arrows", () => {
    // The Rust GVML emitter never modeled curved arrows
    // (clipboard.rs's gvml_line had no curve branch); after
    // pptx-export-shared-builder-finish phase 3 the shared
    // builder gains the `arrow_curve_cx` / `arrow_curve_cy`
    // path. This fixture pins the new XML so subsequent
    // changes can't silently drop the control point.
    const { drawing } = buildDrawingXml({
      shapes: [curvedArrow()],
      width: 800,
      height: 600,
      hasImage: false,
    });
    // Bbox includes the control point: xs=[50, 150, 250],
    // ys=[100, 30, 100] → left=50, top=30, w=200, h=70.
    // EMU: left=476250, top=285750, w=1905000, h=666750.
    // Local path coords: moveTo (0,667750), quadBezTo control
    // (952500,0), end (1905000,667750). (Local y origin at
    // top=30; world y=100 → 100-30=70 → 70*9525=666750 EMU.)
    const expected = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7620000" cy="5715000"/><a:chOff x="0" y="0"/><a:chExt cx="7620000" cy="5715000"/></a:xfrm></a:grpSpPr><a:sp><a:nvSpPr><a:cNvPr id="2" name="L2"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="476250" y="285750"/><a:ext cx="1905000" cy="666750"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="1905000" b="666750"/><a:pathLst><a:path w="1905000" h="666750"><a:moveTo><a:pt x="0" y="666750"/></a:moveTo><a:quadBezTo><a:pt x="952500" y="0"/><a:pt x="1905000" y="666750"/></a:quadBezTo></a:path></a:pathLst></a:custGeom><a:ln w="38100"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:tailEnd type="triangle" w="med" len="med"/></a:ln></a:spPr></a:sp></lc:lockedCanvas></a:graphicData></a:graphic>`;
    expect(drawing).toBe(expected);
  });

  it("matches the Rust drawing_xml_redact_solid_no_outline snapshot", () => {
    const { drawing } = buildDrawingXml({
      shapes: [redactSolid()],
      width: 800,
      height: 600,
      hasImage: false,
    });
    expect(drawing).toBe(EXPECTED_REDACT_SOLID_NO_OUTLINE);
  });
});
