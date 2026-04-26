// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { computeDasharray } from "../utils/dash-utils.js";
import type { ToolOptions } from "./tool-options.js";
import { readUniversalStyleAttrs } from "./tool-style-reader.js";
import { writeUniversalStyleAttrs } from "./tool-style-writer.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function emptyPreset(overrides: Partial<ToolOptions> = {}): ToolOptions {
  return {
    strokeColor: "#000000",
    fillColor: "#ffffff",
    strokeWidth: 1,
    fontSize: 12,
    strokeDasharray: "",
    fillOpacity: 1,
    ...overrides,
  };
}

describe("writeUniversalStyleAttrs", () => {
  it("writes stroke + fill + stroke-width + fill-opacity onto the element", () => {
    const el = svg("rect");
    const preset = emptyPreset({
      strokeColor: "#112233",
      fillColor: "#445566",
      strokeWidth: 3.5,
      fillOpacity: 0.4,
    });
    writeUniversalStyleAttrs(el, preset);
    expect(el.getAttribute("stroke")).toBe("#112233");
    expect(el.getAttribute("fill")).toBe("#445566");
    expect(el.getAttribute("stroke-width")).toBe("3.5");
    expect(el.getAttribute("fill-opacity")).toBe("0.4");
  });

  it("writes stroke-dasharray (numeric) AND data-dash-key (canonical key)", () => {
    const el = svg("rect");
    const preset = emptyPreset({ strokeDasharray: "dash", strokeWidth: 2 });
    writeUniversalStyleAttrs(el, preset);
    expect(el.getAttribute("stroke-dasharray")).toBe(computeDasharray("dash", 2));
    expect(el.getAttribute("data-dash-key")).toBe("dash");
  });

  it("writes stroke-linecap and stroke-linejoin only when set", () => {
    const elA = svg("rect");
    writeUniversalStyleAttrs(elA, emptyPreset({ strokeLinecap: "round" }));
    expect(elA.getAttribute("stroke-linecap")).toBe("round");
    expect(elA.hasAttribute("stroke-linejoin")).toBe(false);

    const elB = svg("rect");
    writeUniversalStyleAttrs(elB, emptyPreset({ strokeLinejoin: "bevel" }));
    expect(elB.getAttribute("stroke-linejoin")).toBe("bevel");
    expect(elB.hasAttribute("stroke-linecap")).toBe(false);
  });

  it("routes strokeOpacity to `opacity` for <line>", () => {
    const el = svg("line");
    writeUniversalStyleAttrs(el, emptyPreset({ strokeOpacity: 0.5 }));
    expect(el.getAttribute("opacity")).toBe("0.5");
    expect(el.hasAttribute("stroke-opacity")).toBe(false);
  });

  it("routes strokeOpacity to `opacity` for arrow <g> (data-type=arrow)", () => {
    const el = svg("g", { "data-type": "arrow" });
    writeUniversalStyleAttrs(el, emptyPreset({ strokeOpacity: 0.7 }));
    expect(el.getAttribute("opacity")).toBe("0.7");
    expect(el.hasAttribute("stroke-opacity")).toBe(false);
  });

  it("routes strokeOpacity to `stroke-opacity` for non-line / non-arrow elements", () => {
    const el = svg("rect");
    writeUniversalStyleAttrs(el, emptyPreset({ strokeOpacity: 0.3 }));
    expect(el.getAttribute("stroke-opacity")).toBe("0.3");
    expect(el.hasAttribute("opacity")).toBe(false);
    // Plain <g> (no data-type=arrow) also takes the stroke-opacity branch.
    const g = svg("g");
    writeUniversalStyleAttrs(g, emptyPreset({ strokeOpacity: 0.2 }));
    expect(g.getAttribute("stroke-opacity")).toBe("0.2");
    expect(g.hasAttribute("opacity")).toBe(false);
  });

  it("skips falsy color fields so existing attributes are not clobbered", () => {
    const el = svg("rect", { stroke: "#preexisting", fill: "#alsopre" });
    // strokeColor / fillColor are gated on truthiness (not `!= null`),
    // mirroring the legacy `if (preset.strokeColor)` guards. Empty
    // strings must NOT clobber the existing attributes.
    const preset = emptyPreset({ strokeColor: "", fillColor: "" });
    writeUniversalStyleAttrs(el, preset);
    expect(el.getAttribute("stroke")).toBe("#preexisting");
    expect(el.getAttribute("fill")).toBe("#alsopre");
  });

  it("skips optional fields when undefined", () => {
    const el = svg("rect");
    // Build a preset with no optional fields set — only the required
    // base shape from `emptyPreset()`. The writer must not emit
    // stroke-linecap / stroke-linejoin / stroke-opacity attrs.
    writeUniversalStyleAttrs(el, emptyPreset());
    expect(el.hasAttribute("stroke-linecap")).toBe(false);
    expect(el.hasAttribute("stroke-linejoin")).toBe(false);
    expect(el.hasAttribute("stroke-opacity")).toBe(false);
    expect(el.hasAttribute("opacity")).toBe(false);
  });

  it("round-trips with readUniversalStyleAttrs (rect — stroke-opacity branch)", () => {
    const el = svg("rect");
    const original = emptyPreset({
      strokeColor: "#aabbcc",
      fillColor: "#ddeeff",
      strokeWidth: 2,
      strokeDasharray: "dot",
      fillOpacity: 0.6,
      strokeOpacity: 0.8,
      strokeLinecap: "round",
      strokeLinejoin: "miter",
    });
    writeUniversalStyleAttrs(el, original);

    const harvested = emptyPreset();
    readUniversalStyleAttrs(el, harvested);
    expect(harvested.strokeColor).toBe(original.strokeColor);
    expect(harvested.fillColor).toBe(original.fillColor);
    expect(harvested.strokeWidth).toBe(original.strokeWidth);
    // The reader prefers `data-dash-key` so the canonical key survives
    // the round-trip even though `stroke-dasharray` carries the numeric
    // expansion.
    expect(harvested.strokeDasharray).toBe(original.strokeDasharray);
    expect(harvested.fillOpacity).toBe(original.fillOpacity);
    expect(harvested.strokeOpacity).toBe(original.strokeOpacity);
    expect(harvested.strokeLinecap).toBe(original.strokeLinecap);
    expect(harvested.strokeLinejoin).toBe(original.strokeLinejoin);
  });

  it("round-trips with readUniversalStyleAttrs (arrow <g> — opacity branch)", () => {
    const el = svg("g", { "data-type": "arrow" });
    const original = emptyPreset({
      strokeColor: "#ff0000",
      strokeWidth: 3,
      strokeOpacity: 0.4,
    });
    writeUniversalStyleAttrs(el, original);
    // For arrow <g> the opacity attr (NOT stroke-opacity) carries the
    // value — confirm the read-side mirror picks it back up.
    expect(el.getAttribute("opacity")).toBe("0.4");

    const harvested = emptyPreset();
    readUniversalStyleAttrs(el, harvested);
    expect(harvested.strokeColor).toBe(original.strokeColor);
    expect(harvested.strokeWidth).toBe(original.strokeWidth);
    expect(harvested.strokeOpacity).toBe(original.strokeOpacity);
  });
});
