/**
 * @vitest-environment happy-dom
 *
 * Round-trip + uniform-collapse + legacy-rejection tests for the
 * unified text-bearing shape skeleton landed in Phase 1 of the
 * `rich-text-and-shape-text` plan.
 */
import { describe, expect, it } from "vitest";
import type { TextRun } from "../utils/tauri-bridge.js";
import { ANNOT_SVG_VERSION, ANNOT_SVG_VERSION_ATTR, stampAnnotVersion } from "./svg-format.js";
import {
  applyTextShapeColor,
  convertTextVariant,
  createTextShape,
  detectTextVariant,
  isTextShapeElement,
  plainTextToRuns,
  readTextShapeSpec,
  replaceRunsInPlace,
  runsToPlainText,
  stickyBgFor,
  unwrapBareTextShape,
  wrapBareRectForText,
} from "./text-utils.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function freshSvgRoot(): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  return root;
}

describe("createTextShape / readTextShapeSpec round-trip", () => {
  it("emits the unified <g data-type=shape data-shape-kind=...> skeleton", () => {
    const g = createTextShape({
      x: 10,
      y: 20,
      w: 200,
      h: 50,
      variant: "sticky",
      runs: plainTextToRuns("hello\nworld"),
      fontSize: 16,
      fontFamily: "sans-serif",
      color: "#ff0000",
    });
    expect(g.tagName).toBe("g");
    expect(g.getAttribute("data-type")).toBe("shape");
    expect(g.getAttribute("data-shape-kind")).toBe("sticky");
    expect(g.getAttribute("data-color")).toBe("#ff0000");
    expect(g.getAttribute("data-font-size")).toBe("16");
    // No legacy attributes leak in.
    expect(g.getAttribute("data-type")).not.toBe("textbox");
    expect(g.getAttribute("data-text-variant")).toBeNull();
    expect(g.getAttribute("data-text")).toBeNull();
  });

  it("uniform-collapse: one tspan per line, no per-tspan formatting attrs", () => {
    const g = createTextShape({
      x: 0,
      y: 0,
      w: 100,
      h: 60,
      variant: "plain",
      runs: plainTextToRuns("a\nb\nc"),
      fontSize: 12,
      fontFamily: "sans-serif",
      color: "#000",
    });
    const tspans = Array.from(g.querySelectorAll("tspan"));
    expect(tspans).toHaveLength(3);
    for (const t of tspans) {
      // Uniform style — none of the per-character attrs land on the
      // tspan; they're inherited from the parent <text>.
      expect(t.getAttribute("font-weight")).toBeNull();
      expect(t.getAttribute("font-style")).toBeNull();
      expect(t.getAttribute("text-decoration")).toBeNull();
      expect(t.getAttribute("font-size")).toBeNull();
      expect(t.getAttribute("font-family")).toBeNull();
      expect(t.getAttribute("fill")).toBeNull();
    }
  });

  it("rich-formatting: per-run flags lift onto the matching tspan attrs", () => {
    const richRuns: TextRun[] = [
      { text: "bold ", bold: true },
      { text: "italic ", italic: true },
      { text: "under", underline: true, color: "#00ff00" },
      { text: "lined" },
    ];
    const g = createTextShape({
      x: 0,
      y: 0,
      w: 200,
      h: 40,
      variant: "plain",
      runs: richRuns,
      fontSize: 14,
      fontFamily: "sans-serif",
      color: "#111",
    });
    const tspans = Array.from(g.querySelectorAll("tspan"));
    expect(tspans).toHaveLength(4);
    expect(tspans[0]!.getAttribute("font-weight")).toBe("bold");
    expect(tspans[1]!.getAttribute("font-style")).toBe("italic");
    expect(tspans[2]!.getAttribute("text-decoration")).toBe("underline");
    expect(tspans[2]!.getAttribute("fill")).toBe("#00ff00");
    expect(tspans[3]!.getAttribute("font-weight")).toBeNull();
  });

  it("readTextShapeSpec round-trips runs, variant, defaults, tail metadata", () => {
    const runs: TextRun[] = [
      { text: "hello", bold: true, line_break_after: true },
      { text: "world", italic: true, color: "#0033aa" },
    ];
    const original = createTextShape({
      x: 5,
      y: 7,
      w: 220,
      h: 60,
      variant: "callout",
      runs,
      fontSize: 18,
      fontFamily: "Inter",
      color: "#222",
      tailX: 50,
      tailY: 200,
    });
    const spec = readTextShapeSpec(original);
    expect(spec).toMatchObject({
      x: 5,
      y: 7,
      w: 220,
      h: 60,
      variant: "callout",
      fontSize: 18,
      fontFamily: "Inter",
      color: "#222",
      tailX: 50,
      tailY: 200,
    });
    expect(spec.runs).toEqual([
      { text: "hello", bold: true, line_break_after: true },
      { text: "world", italic: true, color: "#0033aa", line_break_after: false },
    ]);
  });

  it("plain-text helper: plainTextToRuns ↔ runsToPlainText", () => {
    const text = "alpha\nbeta\ngamma";
    const runs = plainTextToRuns(text);
    expect(runs).toEqual([
      { text: "alpha", line_break_after: true },
      { text: "beta", line_break_after: true },
      { text: "gamma", line_break_after: false },
    ]);
    expect(runsToPlainText(runs)).toBe(text);
  });
});

describe("convertTextVariant preserves runs across kind changes", () => {
  it("sticky → callout keeps runs + transform", () => {
    const root = freshSvgRoot();
    const g = createTextShape({
      x: 0,
      y: 0,
      w: 100,
      h: 40,
      variant: "sticky",
      runs: plainTextToRuns("note"),
      fontSize: 14,
      fontFamily: "sans-serif",
      color: "#f00",
    });
    g.setAttribute("transform", "translate(20, 30)");
    root.appendChild(g);
    const next = convertTextVariant(g, "callout");
    expect(detectTextVariant(next as SVGElement)).toBe("callout");
    expect(next.getAttribute("transform")).toBe("translate(20, 30)");
    const runs = readTextShapeSpec(next as SVGElement).runs;
    expect(runs.map((r) => r.text)).toEqual(["note"]);
  });
});

describe("legacy rejection", () => {
  it("readTextShapeSpec throws on <g data-type=textbox>", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    g.setAttribute("data-type", "textbox");
    g.setAttribute("data-text-variant", "sticky");
    expect(() => readTextShapeSpec(g)).toThrow(/Legacy <g data-type="textbox">/);
  });

  it("detectTextVariant throws on <g data-type=textbox>", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    g.setAttribute("data-type", "textbox");
    expect(() => detectTextVariant(g as SVGElement)).toThrow(/Legacy/);
  });

  it("isTextShapeElement returns false for the legacy skeleton", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    g.setAttribute("data-type", "textbox");
    g.setAttribute("data-text-variant", "sticky");
    expect(isTextShapeElement(g)).toBe(false);
  });
});

describe("Pattern A — wrap / unwrap a bare <rect> for text-on-shape", () => {
  it("wrapBareRectForText replaces the rect with a <g data-type=shape>", () => {
    const root = freshSvgRoot();
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "10");
    rect.setAttribute("y", "20");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "60");
    rect.setAttribute("stroke", "#ff0000");
    root.appendChild(rect);

    const wrapper = wrapBareRectForText(rect);
    expect(wrapper.tagName).toBe("g");
    expect(wrapper.getAttribute("data-type")).toBe("shape");
    expect(wrapper.getAttribute("data-shape-kind")).toBe("rect");
    // Original rect is now the wrapper's first child, NOT replaced.
    expect(wrapper.firstElementChild).toBe(rect);
    // Wrapper sits in the parent slot the rect used to occupy.
    expect(root.firstElementChild).toBe(wrapper);
    // ClipPath + empty <text> attached.
    expect(wrapper.querySelector("clipPath")).not.toBeNull();
    expect(wrapper.querySelector("text")).not.toBeNull();
    // Text colour defaults to black (PowerPoint-style) and is
    // intentionally INDEPENDENT of the rect's stroke — preserving
    // the user's Shape-tool colour settings on the underlying
    // geometry while letting them control the text colour
    // separately via the mini-toolbar / PropertyPanel.
    expect(wrapper.getAttribute("data-color")).toBe("#000000");
  });

  it("rect with rx > 0 wraps as data-shape-kind='rounded'", () => {
    const root = freshSvgRoot();
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "60");
    rect.setAttribute("height", "40");
    rect.setAttribute("rx", "8");
    root.appendChild(rect);
    const wrapper = wrapBareRectForText(rect);
    expect(wrapper.getAttribute("data-shape-kind")).toBe("rounded");
  });

  it("rect with data-rounded='true' wraps as data-shape-kind='rounded'", () => {
    const root = freshSvgRoot();
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "60");
    rect.setAttribute("height", "40");
    rect.setAttribute("data-rounded", "true");
    root.appendChild(rect);
    const wrapper = wrapBareRectForText(rect);
    expect(wrapper.getAttribute("data-shape-kind")).toBe("rounded");
  });

  it("unwrapBareTextShape restores the original rect", () => {
    const root = freshSvgRoot();
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "5");
    rect.setAttribute("y", "5");
    rect.setAttribute("width", "50");
    rect.setAttribute("height", "30");
    root.appendChild(rect);

    const wrapper = wrapBareRectForText(rect);
    expect(root.firstElementChild).toBe(wrapper);
    const restored = unwrapBareTextShape(wrapper);
    expect(restored).toBe(rect);
    expect(root.firstElementChild).toBe(rect);
  });

  it("unwrapBareTextShape is a no-op on a non-wrapper element", () => {
    const root = freshSvgRoot();
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    root.appendChild(rect);
    expect(unwrapBareTextShape(rect)).toBe(rect);
    expect(root.firstElementChild).toBe(rect);
  });

  it("replaceRunsInPlace writes per-run tspans into the wrapper's <text>", () => {
    const root = freshSvgRoot();
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "120");
    rect.setAttribute("height", "60");
    root.appendChild(rect);
    const wrapper = wrapBareRectForText(rect);

    replaceRunsInPlace(wrapper, [
      { text: "Hello ", bold: true },
      { text: "world", italic: true },
    ]);
    const tspans = Array.from(wrapper.querySelectorAll("tspan"));
    expect(tspans).toHaveLength(2);
    expect(tspans[0]!.getAttribute("font-weight")).toBe("bold");
    expect(tspans[1]!.getAttribute("font-style")).toBe("italic");
  });

  it("replaceRunsInPlace spaces lines by the largest run font_size, not just the wrapper default", () => {
    // Mini-toolbar font-size changes attach a per-run `font_size`
    // override (rendered as tspan font-size). Without scaling the
    // line height to match, two-line text where the runs are bigger
    // than the wrapper's `data-font-size` (16) would render with
    // overlapping baselines — the visible glyphs collide because
    // the SVG line height stayed at 16*1.4 = 22.4.
    const root = freshSvgRoot();
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "200");
    rect.setAttribute("height", "200");
    root.appendChild(rect);
    const wrapper = wrapBareRectForText(rect);

    replaceRunsInPlace(wrapper, [
      { text: "aaaas", font_size: 48, line_break_after: true },
      { text: "afafs", font_size: 48 },
    ]);
    const tspans = Array.from(wrapper.querySelectorAll("tspan"));
    expect(tspans).toHaveLength(2);
    const y0 = Number.parseFloat(tspans[0]!.getAttribute("y") ?? "");
    const y1 = Number.parseFloat(tspans[1]!.getAttribute("y") ?? "");
    // Baselines must be at least the run's own font size apart so
    // glyph bounding boxes don't intersect.
    expect(y1 - y0).toBeGreaterThanOrEqual(48);
  });

  it("autofit=resize grows the bg rect when the run block exceeds the box height", () => {
    const root = freshSvgRoot();
    const g = createTextShape({
      x: 0,
      y: 0,
      w: 100,
      h: 40,
      variant: "sticky",
      runs: [{ text: "one" }],
      fontSize: 16,
      fontFamily: "sans-serif",
      color: "#000",
    });
    root.appendChild(g);
    g.setAttribute("data-text-autofit", "resize");

    // Replace with seven 16pt lines — at 1.4 line-height that's
    // 7 × 22.4 = 156.8px of run block, plus 8/8 sticky margins =
    // 172.8 required. The starting box is only 40px tall.
    const lines: TextRun[] = [];
    for (let i = 1; i <= 7; i++) {
      lines.push({ text: `line${i}`, line_break_after: i < 7 });
    }
    replaceRunsInPlace(g, lines);

    const bgRect = g.querySelector("rect")!;
    const newH = Number.parseFloat(bgRect.getAttribute("height")!);
    expect(newH).toBeGreaterThanOrEqual(170);
    // ClipPath rect should have grown in lockstep.
    const clipRect = g.querySelector("clipPath > rect")!;
    expect(clipRect.getAttribute("height")).toBe(bgRect.getAttribute("height"));
  });

  it("autofit=resize grows for mixed-size runs by per-line height sum", () => {
    const root = freshSvgRoot();
    const g = createTextShape({
      x: 0,
      y: 0,
      w: 200,
      h: 40,
      variant: "sticky",
      runs: [{ text: "tiny" }],
      fontSize: 16,
      fontFamily: "sans-serif",
      color: "#000",
    });
    root.appendChild(g);
    g.setAttribute("data-text-autofit", "resize");

    // One 48pt line + three 16pt lines:
    //   per-line heights = [48*1.4, 16*1.4, 16*1.4, 16*1.4]
    //                    = [67.2, 22.4, 22.4, 22.4]   sum = 134.4
    //   plus 8/8 sticky margins = 150.4 required. Box starts at 40.
    replaceRunsInPlace(g, [
      { text: "BIG", font_size: 48, line_break_after: true },
      { text: "small1", line_break_after: true },
      { text: "small2", line_break_after: true },
      { text: "small3" },
    ]);

    const bgRect = g.querySelector("rect")!;
    const newH = Number.parseFloat(bgRect.getAttribute("height")!);
    expect(newH).toBeGreaterThan(140);
    expect(newH).toBeLessThan(170);
  });

  it("readTextShapeSpec on a text-on-shape wrapper returns x/y/w/h from the geometry rect", () => {
    const root = freshSvgRoot();
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "12");
    rect.setAttribute("y", "34");
    rect.setAttribute("width", "200");
    rect.setAttribute("height", "100");
    root.appendChild(rect);
    const wrapper = wrapBareRectForText(rect);
    replaceRunsInPlace(wrapper, [{ text: "label" }]);
    const spec = readTextShapeSpec(wrapper);
    expect(spec.x).toBe(12);
    expect(spec.y).toBe(34);
    expect(spec.w).toBe(200);
    expect(spec.h).toBe(100);
    expect(spec.runs).toEqual([{ text: "label", line_break_after: false }]);
  });
});

describe("applyTextShapeColor", () => {
  it("sticky: writes data-color, <text> fill, and refreshes bg fill via stickyBgFor", () => {
    const g = createTextShape({
      x: 0,
      y: 0,
      w: 200,
      h: 80,
      variant: "sticky",
      runs: [{ text: "x" }],
      fontSize: 16,
      fontFamily: "sans-serif",
      color: "#ff0000",
    });
    expect(g.getAttribute("data-color")).toBe("#ff0000");
    const bg = g.querySelector("rect")!;
    expect(bg.getAttribute("fill")).toBe(stickyBgFor("#ff0000"));

    applyTextShapeColor(g, "#0000ff");
    expect(g.getAttribute("data-color")).toBe("#0000ff");
    expect(g.querySelector("text")!.getAttribute("fill")).toBe("#0000ff");
    expect(bg.getAttribute("fill")).toBe(stickyBgFor("#0000ff"));
  });

  it("callout: bg rect AND tail path both follow stickyBgFor on color change", () => {
    const g = createTextShape({
      x: 0,
      y: 0,
      w: 200,
      h: 80,
      variant: "callout",
      runs: [{ text: "x" }],
      fontSize: 16,
      fontFamily: "sans-serif",
      color: "#ff0000",
    });
    const bg = g.querySelector("rect")!;
    const tail = g.querySelector("path")!;
    expect(bg.getAttribute("fill")).toBe(stickyBgFor("#ff0000"));
    expect(tail.getAttribute("fill")).toBe(stickyBgFor("#ff0000"));

    applyTextShapeColor(g, "#00ff00");
    expect(bg.getAttribute("fill")).toBe(stickyBgFor("#00ff00"));
    expect(tail.getAttribute("fill")).toBe(stickyBgFor("#00ff00"));
  });

  it("text-on-shape (rect/rounded/ellipse) preserves the user's drawn fill", () => {
    // wrapBareRectForText keeps the original rect's stroke / fill;
    // a text-color change must NOT overwrite the user-set fill.
    const root = freshSvgRoot();
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "120");
    rect.setAttribute("height", "60");
    rect.setAttribute("fill", "#abcdef");
    root.appendChild(rect);
    const wrapper = wrapBareRectForText(rect);

    applyTextShapeColor(wrapper, "#ff0000");
    expect(wrapper.getAttribute("data-color")).toBe("#ff0000");
    // bg rect's fill is intact — Pattern A geometry primitive
    // owns its own color.
    expect(rect.getAttribute("fill")).toBe("#abcdef");
  });
});

describe("svg-format version stamp is unaffected by text-shape changes", () => {
  it("rich-formatting documents still stamp data-annot-version=1", () => {
    const root = freshSvgRoot();
    const g = createTextShape({
      x: 0,
      y: 0,
      w: 100,
      h: 40,
      variant: "plain",
      runs: [{ text: "bold", bold: true, line_break_after: true }, { text: "plain" }],
      fontSize: 14,
      fontFamily: "sans-serif",
      color: "#000",
    });
    root.appendChild(g);
    stampAnnotVersion(root);
    // The plan freezes the version stamp at "1" through Phase 1 —
    // pre-release schema is mutable, no v2 stamping trigger.
    expect(root.getAttribute(ANNOT_SVG_VERSION_ATTR)).toBe(ANNOT_SVG_VERSION);
    expect(ANNOT_SVG_VERSION).toBe("1");
  });
});
