/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for the writer / reader pair on arrow elements.
 * The 716-line `arrow-markers.ts` is mostly geometric SVG path
 * synthesis (`computeArrowParts`, `renderArrowHead`,
 * `arrowPreview`, …) that's exercised indirectly by toolbar +
 * PPTX golden tests. The remaining uncovered lines were the
 * data-attr CRUD on persisted endpoints + per-end specs +
 * control point. Those four reader/writer pairs ARE the
 * persistence contract the rest of the codebase reads through, so
 * direct round-trip coverage pins them at the boundary they're
 * supposed to enforce.
 */

import { describe, expect, it } from "vitest";
import type { ArrowSpec } from "./arrow-markers.js";
import {
  detectArrowSpec,
  readArrowControl,
  readArrowEndpoints,
  writeArrowControl,
  writeArrowEndpoints,
  writeArrowSpec,
} from "./arrow-markers.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeArrow(): SVGGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  document.body.appendChild(svg);
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.setAttribute("data-type", "arrow");
  svg.appendChild(g);
  return g;
}

describe("writeArrowEndpoints + readArrowEndpoints", () => {
  it("round-trips integer endpoints through data-x1/y1/x2/y2", () => {
    const arrow = makeArrow();
    writeArrowEndpoints(arrow, 10, 20, 110, 60);
    expect(arrow.getAttribute("data-x1")).toBe("10");
    expect(arrow.getAttribute("data-y1")).toBe("20");
    expect(arrow.getAttribute("data-x2")).toBe("110");
    expect(arrow.getAttribute("data-y2")).toBe("60");
    expect(readArrowEndpoints(arrow)).toEqual({ x1: 10, y1: 20, x2: 110, y2: 60 });
  });

  it("round-trips fractional endpoints (preserves precision via String())", () => {
    const arrow = makeArrow();
    writeArrowEndpoints(arrow, 10.5, 20.25, 110.125, 60.0625);
    const ep = readArrowEndpoints(arrow);
    expect(ep.x1).toBeCloseTo(10.5, 10);
    expect(ep.y1).toBeCloseTo(20.25, 10);
    expect(ep.x2).toBeCloseTo(110.125, 10);
    expect(ep.y2).toBeCloseTo(60.0625, 10);
  });

  it("readArrowEndpoints defaults missing attrs to 0", () => {
    const arrow = makeArrow();
    expect(readArrowEndpoints(arrow)).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });

  it("overwrites previous values rather than accumulating", () => {
    const arrow = makeArrow();
    writeArrowEndpoints(arrow, 1, 2, 3, 4);
    writeArrowEndpoints(arrow, 50, 60, 70, 80);
    expect(readArrowEndpoints(arrow)).toEqual({ x1: 50, y1: 60, x2: 70, y2: 80 });
  });
});

describe("writeArrowControl + readArrowControl", () => {
  it("writes data-cx/cy when control is provided", () => {
    const arrow = makeArrow();
    writeArrowControl(arrow, { x: 12.5, y: 34.5 });
    expect(arrow.getAttribute("data-cx")).toBe("12.5");
    expect(arrow.getAttribute("data-cy")).toBe("34.5");
    expect(readArrowControl(arrow)).toEqual({ x: 12.5, y: 34.5 });
  });

  it("clears data-cx/cy when control is null (straightens the arrow)", () => {
    const arrow = makeArrow();
    writeArrowControl(arrow, { x: 50, y: 50 });
    writeArrowControl(arrow, null);
    expect(arrow.hasAttribute("data-cx")).toBe(false);
    expect(arrow.hasAttribute("data-cy")).toBe(false);
    expect(readArrowControl(arrow)).toBeNull();
  });

  it("readArrowControl returns null when both attrs are absent", () => {
    expect(readArrowControl(makeArrow())).toBeNull();
  });

  it("readArrowControl returns null when only one attr is present (asymmetric)", () => {
    const arrow = makeArrow();
    arrow.setAttribute("data-cx", "10");
    expect(readArrowControl(arrow)).toBeNull();
  });

  it("readArrowControl returns null on non-finite values (NaN / Infinity defense)", () => {
    const arrow = makeArrow();
    arrow.setAttribute("data-cx", "not-a-number");
    arrow.setAttribute("data-cy", "10");
    expect(readArrowControl(arrow)).toBeNull();

    arrow.setAttribute("data-cx", "Infinity");
    expect(readArrowControl(arrow)).toBeNull();
  });

  it("clearing on an arrow that never had a control is a no-op", () => {
    const arrow = makeArrow();
    expect(() => writeArrowControl(arrow, null)).not.toThrow();
    expect(arrow.hasAttribute("data-cx")).toBe(false);
  });
});

describe("writeArrowSpec + detectArrowSpec", () => {
  it("round-trips a per-end spec through data-arrow-{end}-{shape,width,length}", () => {
    const arrow = makeArrow();
    const spec: ArrowSpec = { shape: "triangle", width: "lg", length: "md" };
    writeArrowSpec(arrow, "end", spec);
    expect(arrow.getAttribute("data-arrow-end-shape")).toBe("triangle");
    expect(arrow.getAttribute("data-arrow-end-width")).toBe("lg");
    expect(arrow.getAttribute("data-arrow-end-length")).toBe("md");
    expect(detectArrowSpec(arrow, "end")).toEqual(spec);
  });

  it("start + end specs are independent", () => {
    const arrow = makeArrow();
    writeArrowSpec(arrow, "start", { shape: "oval", width: "sm", length: "sm" });
    writeArrowSpec(arrow, "end", { shape: "stealth", width: "lg", length: "lg" });
    expect(detectArrowSpec(arrow, "start").shape).toBe("oval");
    expect(detectArrowSpec(arrow, "end").shape).toBe("stealth");
  });

  it("detectArrowSpec defaults shape=none, width=md, length=md when no attrs are set", () => {
    expect(detectArrowSpec(makeArrow(), "end")).toEqual({
      shape: "none",
      width: "md",
      length: "md",
    });
  });

  it("detectArrowSpec falls back to the legacy data-arrow-{end}-size for both width and length", () => {
    const arrow = makeArrow();
    arrow.setAttribute("data-arrow-end-shape", "triangle");
    arrow.setAttribute("data-arrow-end-size", "lg");
    expect(detectArrowSpec(arrow, "end")).toEqual({
      shape: "triangle",
      width: "lg",
      length: "lg",
    });
  });

  it("explicit width/length override the legacy size attribute", () => {
    const arrow = makeArrow();
    arrow.setAttribute("data-arrow-end-shape", "triangle");
    arrow.setAttribute("data-arrow-end-size", "lg");
    arrow.setAttribute("data-arrow-end-width", "sm");
    expect(detectArrowSpec(arrow, "end").width).toBe("sm");
    expect(detectArrowSpec(arrow, "end").length).toBe("lg");
  });
});
