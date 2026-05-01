/**
 * Phase 5 of `docs/plans/rich-text-and-shape-text.md` — golden
 * snapshots pinning the OOXML output of the rich-text path.
 *
 * The text builder in `shapes/text.ts` walks `AnnotationShape.runs[]`
 * to emit one `<a:r>` per run with a per-run `<a:rPr>` carrying
 * `b="1"` / `i="1"` / `u="sng"` flags + an `<a:latin>` typeface
 * override + `<a:solidFill>` color. `line_break_after` opens a new
 * `<a:p>`. The fixtures below cover the realistic combinations a
 * Phase-2 contentEditable user can produce; the snapshots travel
 * with the PR so any change to the per-run XML shape lands as a
 * reviewable diff.
 *
 * Cross-impl byte-equivalence with the Rust Office-clipboard side
 * is automatic since `_done/office-paste-shared-drawing-builder.md`
 * — the Rust crate consumes pre-assembled drawing XML, so this
 * golden IS the Office-paste golden.
 */

import type { AnnotationShape } from "@ingcreators/annot-core/tauri-bridge";
import { describe, expect, it } from "vitest";
import { buildShapeXml } from "./index.js";

function richTextbox(overrides: Partial<AnnotationShape> = {}): AnnotationShape {
  return {
    type: "text",
    x: 0,
    y: 0,
    width: 200,
    height: 60,
    font_size: 18,
    fill: "#222222",
    shape_kind: "plain",
    ...overrides,
  };
}

describe("buildShapeXml — rich-text textbox snapshots", () => {
  it("uniformly-styled single run renders one paragraph with a single run", () => {
    const xml = buildShapeXml(richTextbox({ runs: [{ text: "Hello" }] }), { ns: "p", id: 1 });
    expect(xml).toMatchInlineSnapshot(
      `"<p:sp><p:nvSpPr><p:cNvPr id="1" name="T1"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="571500"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom><a:noFill/><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP" sz="1350" dirty="0"><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:rPr><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp>"`,
    );
  });

  it("bold + italic + underline runs each lift the matching <a:rPr> flag", () => {
    const xml = buildShapeXml(
      richTextbox({
        runs: [
          { text: "B ", bold: true },
          { text: "I ", italic: true },
          { text: "U", underline: true },
        ],
      }),
      { ns: "p", id: 2 },
    );
    expect(xml).toMatchInlineSnapshot(
      `"<p:sp><p:nvSpPr><p:cNvPr id="2" name="T2"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="571500"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom><a:noFill/><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP" sz="1350" b="1" dirty="0"><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:rPr><a:t>B </a:t></a:r><a:r><a:rPr lang="ja-JP" sz="1350" i="1" dirty="0"><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:rPr><a:t>I </a:t></a:r><a:r><a:rPr lang="ja-JP" sz="1350" u="sng" dirty="0"><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:rPr><a:t>U</a:t></a:r></a:p></p:txBody></p:sp>"`,
    );
  });

  it("per-run color / size / family overrides land on the matching <a:rPr> + <a:latin>", () => {
    const xml = buildShapeXml(
      richTextbox({
        runs: [
          { text: "small ", font_size: 12 },
          { text: "red ", color: "#ff0000" },
          { text: "fancy", font_family: "Inter, sans-serif" },
        ],
      }),
      { ns: "p", id: 3 },
    );
    expect(xml).toMatchInlineSnapshot(
      `"<p:sp><p:nvSpPr><p:cNvPr id="3" name="T3"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="571500"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom><a:noFill/><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP" sz="900" dirty="0"><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:rPr><a:t>small </a:t></a:r><a:r><a:rPr lang="ja-JP" sz="1350" dirty="0"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>red </a:t></a:r><a:r><a:rPr lang="ja-JP" sz="1350" dirty="0"><a:solidFill><a:srgbClr val="222222"/></a:solidFill><a:latin typeface="Inter, sans-serif"/></a:rPr><a:t>fancy</a:t></a:r></a:p></p:txBody></p:sp>"`,
    );
  });

  it("line_break_after splits runs across paragraphs", () => {
    const xml = buildShapeXml(
      richTextbox({
        runs: [
          { text: "para1", bold: true, line_break_after: true },
          { text: "para2", italic: true },
        ],
      }),
      { ns: "p", id: 4 },
    );
    expect(xml).toMatchInlineSnapshot(
      `"<p:sp><p:nvSpPr><p:cNvPr id="4" name="T4"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="571500"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom><a:noFill/><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP" sz="1350" b="1" dirty="0"><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:rPr><a:t>para1</a:t></a:r></a:p><a:p><a:r><a:rPr lang="ja-JP" sz="1350" i="1" dirty="0"><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:rPr><a:t>para2</a:t></a:r></a:p></p:txBody></p:sp>"`,
    );
  });

  it("bold + italic + underline combined on a single run lifts all three flags", () => {
    const xml = buildShapeXml(
      richTextbox({ runs: [{ text: "BIU", bold: true, italic: true, underline: true }] }),
      { ns: "p", id: 5 },
    );
    expect(xml).toContain('b="1"');
    expect(xml).toContain('i="1"');
    expect(xml).toContain('u="sng"');
  });

  it("XML-special characters in run text are escaped", () => {
    const xml = buildShapeXml(richTextbox({ runs: [{ text: "<&>" }] }), { ns: "p", id: 6 });
    expect(xml).toContain("<a:t>&lt;&amp;&gt;</a:t>");
  });

  it("text-on-shape rect emits sharp-corner geometry, not roundRect", () => {
    // shape_kind="rect" represents the user's drawn sharp
    // rectangle promoted to carry text. Emitting `roundRect`
    // here would round the corners visibly in PowerPoint — Annot
    // draws sharp ones.
    const xml = buildShapeXml(
      richTextbox({
        shape_kind: "rect",
        stroke: "#ff0000",
        stroke_width: 2,
        runs: [{ text: "centered" }],
      }),
      { ns: "p", id: 10 },
    );
    expect(xml).toContain('<a:prstGeom prst="rect">');
    expect(xml).not.toContain('<a:prstGeom prst="roundRect">');
  });

  it("text-on-shape rounded emits roundRect; ellipse emits ellipse", () => {
    const rounded = buildShapeXml(
      richTextbox({ shape_kind: "rounded", stroke: "#00ff00", runs: [{ text: "x" }] }),
      { ns: "p", id: 11 },
    );
    expect(rounded).toContain('<a:prstGeom prst="roundRect">');
    const ellipse = buildShapeXml(
      richTextbox({ shape_kind: "ellipse", stroke: "#0000ff", runs: [{ text: "x" }] }),
      { ns: "p", id: 12 },
    );
    expect(ellipse).toContain('<a:prstGeom prst="ellipse">');
  });

  it("text-on-shape preserves the user's stroke color + width on `<a:ln>`", () => {
    const xml = buildShapeXml(
      richTextbox({
        shape_kind: "rect",
        stroke: "#ff0000",
        stroke_width: 4,
        runs: [{ text: "x" }],
      }),
      { ns: "p", id: 13 },
    );
    // text-on-shape skips the auto-bg-variant hardcoded BFBFBF
    // border; the user's red stroke shows through
    // `<a:solidFill><a:srgbClr val="FF0000">`.
    expect(xml).not.toContain('<a:srgbClr val="BFBFBF"/>');
    expect(xml).toContain('<a:srgbClr val="FF0000"/>');
  });

  it("text_anchor='middle' lifts <a:pPr algn=\"ctr\"/> on every paragraph", () => {
    const xml = buildShapeXml(
      richTextbox({
        shape_kind: "rect",
        stroke: "#000000",
        text_anchor: "middle",
        runs: [
          { text: "para1", line_break_after: true },
          { text: "para2" },
        ],
      }),
      { ns: "p", id: 14 },
    );
    // Both paragraphs carry the explicit center alignment.
    const matches = xml.match(/<a:pPr algn="ctr"\/>/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("text_vertical_anchor='middle' lifts anchor=\"ctr\" onto <a:bodyPr>", () => {
    const xml = buildShapeXml(
      richTextbox({
        shape_kind: "rect",
        stroke: "#000000",
        text_vertical_anchor: "middle",
        runs: [{ text: "x" }],
      }),
      { ns: "p", id: 15 },
    );
    expect(xml).toContain('<a:bodyPr wrap="square" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="ctr"/>');
  });

  it("text_vertical_anchor='top' (default) omits the anchor attribute", () => {
    const xml = buildShapeXml(
      richTextbox({ shape_kind: "rect", stroke: "#000000", runs: [{ text: "x" }] }),
      { ns: "p", id: 16 },
    );
    expect(xml).not.toContain("anchor=");
  });

  it("callout shape with rich text preserves the wedgeRoundRectCallout preset", () => {
    const xml = buildShapeXml(
      richTextbox({
        x: 100,
        y: 200,
        width: 150,
        height: 50,
        shape_kind: "callout",
        text_bg_color: "rgba(255,255,200,0.92)",
        tail_x: 300,
        tail_y: 270,
        runs: [{ text: "Callout!", bold: true }],
      }),
      { ns: "p", id: 7 },
    );
    expect(xml).toContain('<a:prstGeom prst="wedgeRoundRectCallout">');
    expect(xml).toContain('b="1"');
  });
});
