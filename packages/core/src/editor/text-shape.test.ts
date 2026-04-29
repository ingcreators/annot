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
  convertTextVariant,
  createTextShape,
  detectTextVariant,
  isTextShapeElement,
  plainTextToRuns,
  readTextShapeSpec,
  replaceRunsInPlace,
  runsToPlainText,
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

  it("readTextShapeSpec on a Pattern A wrapper returns x/y/w/h from the geometry rect", () => {
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
