/**
 * @vitest-environment happy-dom
 *
 * Coverage tests for `gradient-utils`. The helpers persist a
 * gradient spec as a JSON blob on `data-{stroke,fill}-gradient`
 * AND emit a matching `<linearGradient>` into `<defs>` referenced
 * via `url(#id)`. The contract enforced here:
 *
 *   - apply / detect / remove round-trip a spec through DOM state.
 *   - rebuildGradients() is self-healing (re-emits any missing
 *     `<linearGradient>` referenced by a `data-*-gradient` attr).
 *   - defaultGradientFrom() yields a sensible two-stop spec for
 *     the "turn gradient on" UI flow.
 *
 * happy-dom provides `document.createElementNS` + `ownerSVGElement`
 * + `ownerDocument.getElementById` which is everything these
 * helpers touch.
 */

import { describe, expect, it } from "vitest";
import {
  applyGradient,
  defaultGradientFrom,
  detectGradient,
  rebuildGradients,
  removeGradient,
} from "./gradient-utils.js";
import type { GradientSpec } from "./tool-options.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeSvgWithRect(): { svg: SVGSVGElement; rect: SVGRectElement } {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
  svg.appendChild(rect);
  document.body.appendChild(svg);
  return { svg, rect };
}

const SAMPLE_SPEC: GradientSpec = {
  type: "linear",
  angle: 90,
  stops: [
    { color: "#ff0000", offset: 0 },
    { color: "#0000ff", offset: 1, opacity: 0.5 },
  ],
};

describe("applyGradient + detectGradient round-trip", () => {
  it("applies stroke gradient: emits <defs><linearGradient> + url() ref + data-stroke-gradient", () => {
    const { svg, rect } = makeSvgWithRect();
    applyGradient(rect, "stroke", SAMPLE_SPEC);

    const defs = svg.querySelector("defs");
    expect(defs).not.toBeNull();

    const grad = defs!.querySelector("linearGradient");
    expect(grad).not.toBeNull();

    const id = grad!.id;
    expect(id).toMatch(/^grad-stroke-/);

    expect(rect.getAttribute("stroke")).toBe(`url(#${id})`);
    expect(rect.getAttribute("data-stroke-gradient")).toBe(JSON.stringify(SAMPLE_SPEC));
  });

  it("applies fill gradient: data-fill-gradient + fill=url(...)", () => {
    const { rect } = makeSvgWithRect();
    applyGradient(rect, "fill", SAMPLE_SPEC);
    expect(rect.getAttribute("fill")).toMatch(/^url\(#grad-fill-/);
    expect(rect.getAttribute("data-fill-gradient")).toBe(JSON.stringify(SAMPLE_SPEC));
  });

  it("emits <stop> elements with stop-color + opacity (only when <1)", () => {
    const { svg, rect } = makeSvgWithRect();
    applyGradient(rect, "stroke", SAMPLE_SPEC);
    const stops = svg.querySelectorAll("stop");
    expect(stops.length).toBe(2);
    expect(stops[0]!.getAttribute("offset")).toBe("0");
    expect(stops[0]!.getAttribute("stop-color")).toBe("#ff0000");
    // opacity 1 (default / unset) → no stop-opacity attribute
    expect(stops[0]!.hasAttribute("stop-opacity")).toBe(false);
    expect(stops[1]!.getAttribute("stop-color")).toBe("#0000ff");
    expect(stops[1]!.getAttribute("stop-opacity")).toBe("0.5");
  });

  it("converts angle to (x1,y1)-(x2,y2) on the unit box", () => {
    const { svg, rect } = makeSvgWithRect();
    applyGradient(rect, "fill", { ...SAMPLE_SPEC, angle: 0 });
    const grad = svg.querySelector("linearGradient")!;
    // angle 0 → horizontal gradient: x1=0, x2=1, y1=y2=0.5
    expect(Number.parseFloat(grad.getAttribute("x1")!)).toBeCloseTo(0, 5);
    expect(Number.parseFloat(grad.getAttribute("x2")!)).toBeCloseTo(1, 5);
    expect(Number.parseFloat(grad.getAttribute("y1")!)).toBeCloseTo(0.5, 5);
    expect(Number.parseFloat(grad.getAttribute("y2")!)).toBeCloseTo(0.5, 5);
  });

  it("creates <defs> on the owning <svg> if absent", () => {
    const { svg, rect } = makeSvgWithRect();
    expect(svg.querySelector("defs")).toBeNull();
    applyGradient(rect, "stroke", SAMPLE_SPEC);
    expect(svg.querySelector("defs")).not.toBeNull();
  });

  it("reuses an existing <defs> instead of creating a duplicate", () => {
    const { svg, rect } = makeSvgWithRect();
    const defs = document.createElementNS(SVG_NS, "defs");
    svg.insertBefore(defs, svg.firstChild);
    applyGradient(rect, "stroke", SAMPLE_SPEC);
    expect(svg.querySelectorAll("defs").length).toBe(1);
    expect(defs.querySelector("linearGradient")).not.toBeNull();
  });

  it("throws when the element has no ownerSVGElement", () => {
    const orphan = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    expect(() => applyGradient(orphan, "stroke", SAMPLE_SPEC)).toThrow(
      /no ownerSVGElement/,
    );
  });
});

describe("detectGradient", () => {
  it("returns the parsed spec for a previously-applied gradient", () => {
    const { rect } = makeSvgWithRect();
    applyGradient(rect, "stroke", SAMPLE_SPEC);
    expect(detectGradient(rect, "stroke")).toEqual(SAMPLE_SPEC);
  });

  it("returns null when the data-* attribute is absent", () => {
    const { rect } = makeSvgWithRect();
    expect(detectGradient(rect, "stroke")).toBeNull();
    expect(detectGradient(rect, "fill")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    const { rect } = makeSvgWithRect();
    rect.setAttribute("data-stroke-gradient", "{not-json");
    expect(detectGradient(rect, "stroke")).toBeNull();
  });

  it("returns null on a JSON shape that isn't a linear gradient", () => {
    const { rect } = makeSvgWithRect();
    rect.setAttribute("data-stroke-gradient", JSON.stringify({ type: "radial" }));
    expect(detectGradient(rect, "stroke")).toBeNull();
  });

  it("returns null when stops is missing or not an array", () => {
    const { rect } = makeSvgWithRect();
    rect.setAttribute(
      "data-stroke-gradient",
      JSON.stringify({ type: "linear", angle: 0, stops: "not-an-array" }),
    );
    expect(detectGradient(rect, "stroke")).toBeNull();
  });
});

describe("removeGradient", () => {
  it("removes the <linearGradient> from <defs>, restores fallback color, drops data attr", () => {
    const { svg, rect } = makeSvgWithRect();
    applyGradient(rect, "stroke", SAMPLE_SPEC);
    expect(svg.querySelector("linearGradient")).not.toBeNull();

    removeGradient(rect, "stroke", "#888888");

    expect(svg.querySelector("linearGradient")).toBeNull();
    expect(rect.getAttribute("stroke")).toBe("#888888");
    expect(rect.hasAttribute("data-stroke-gradient")).toBe(false);
  });

  it("is safe when the attribute doesn't reference a url(...)", () => {
    const { rect } = makeSvgWithRect();
    rect.setAttribute("stroke", "#aabbcc");
    // No exception expected; falls back to writing the new color.
    removeGradient(rect, "stroke", "#000000");
    expect(rect.getAttribute("stroke")).toBe("#000000");
  });

  it("works for fill side as well as stroke", () => {
    const { svg, rect } = makeSvgWithRect();
    applyGradient(rect, "fill", SAMPLE_SPEC);
    removeGradient(rect, "fill", "#101010");
    expect(svg.querySelector("linearGradient")).toBeNull();
    expect(rect.getAttribute("fill")).toBe("#101010");
    expect(rect.hasAttribute("data-fill-gradient")).toBe(false);
  });
});

describe("rebuildGradients (self-healing)", () => {
  it("re-emits a missing <linearGradient> referenced by data-stroke-gradient", () => {
    const { svg, rect } = makeSvgWithRect();
    applyGradient(rect, "stroke", SAMPLE_SPEC);
    // Simulate a stripped <defs> on a saved file: drop the gradient
    // but keep the data-* attr + the `url(#id)` reference.
    const oldRef = rect.getAttribute("stroke")!;
    svg.querySelector("defs")?.remove();
    rect.setAttribute("stroke", oldRef);

    rebuildGradients(svg);

    const grad = svg.querySelector("linearGradient");
    expect(grad).not.toBeNull();
    // The new id replaces the stripped ref; the stroke attr is updated.
    expect(rect.getAttribute("stroke")).toBe(`url(#${grad!.id})`);
  });

  it("re-emits missing fill gradients too", () => {
    const { svg, rect } = makeSvgWithRect();
    applyGradient(rect, "fill", SAMPLE_SPEC);
    svg.querySelector("defs")?.remove();
    rebuildGradients(svg);
    expect(svg.querySelector("linearGradient")).not.toBeNull();
  });

  it("is idempotent — leaves an existing referenced <linearGradient> alone", () => {
    const { svg, rect } = makeSvgWithRect();
    applyGradient(rect, "stroke", SAMPLE_SPEC);
    const before = svg.querySelector("linearGradient")!.id;
    rebuildGradients(svg);
    expect(svg.querySelector("linearGradient")!.id).toBe(before);
  });

  it("creates <defs> on the svg if it was stripped along with the gradient", () => {
    const { svg, rect } = makeSvgWithRect();
    rect.setAttribute("data-stroke-gradient", JSON.stringify(SAMPLE_SPEC));
    rect.setAttribute("stroke", "url(#missing-id)");
    expect(svg.querySelector("defs")).toBeNull();
    rebuildGradients(svg);
    expect(svg.querySelector("defs")).not.toBeNull();
    expect(svg.querySelector("linearGradient")).not.toBeNull();
  });
});

describe("defaultGradientFrom", () => {
  it("returns a 90° two-stop spec from the original color and a darker variant", () => {
    const spec = defaultGradientFrom("#ff0000");
    expect(spec.type).toBe("linear");
    expect(spec.angle).toBe(90);
    expect(spec.stops.length).toBe(2);
    expect(spec.stops[0]).toEqual({ color: "#ff0000", offset: 0 });
    // Darken with amount=0.5 → 0xff * 0.5 = 0x80
    expect(spec.stops[1]).toEqual({ color: "#800000", offset: 1 });
  });

  it("handles 6-digit hex with no leading #", () => {
    const spec = defaultGradientFrom("00ff00");
    expect(spec.stops[1]?.color).toBe("#008000");
  });

  it("falls back to the input string when the hex parse fails", () => {
    const spec = defaultGradientFrom("not-a-color");
    expect(spec.stops[1]?.color).toBe("not-a-color");
  });
});
