// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { ToolOptions } from "./tool-options.js";
import { readUniversalStyleAttrs, resolveStyleReadSource } from "./tool-style-reader.js";

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

describe("resolveStyleReadSource", () => {
  it("returns the element itself for non-groups", () => {
    const rect = svg("rect");
    expect(resolveStyleReadSource(rect)).toBe(rect);
  });

  it("returns the element itself for non-freehand <g>s", () => {
    const g = svg("g", { "data-type": "arrow" });
    expect(resolveStyleReadSource(g)).toBe(g);
  });

  it("returns the LAST <path> child for freehand <g>", () => {
    const g = svg("g", { "data-type": "freehand" });
    const first = svg("path", { stroke: "#aaa" });
    const second = svg("path", { stroke: "#bbb" });
    g.append(first, second);
    expect(resolveStyleReadSource(g)).toBe(second);
  });

  it("falls back to the freehand <g> itself when it has no path children", () => {
    const g = svg("g", { "data-type": "freehand" });
    expect(resolveStyleReadSource(g)).toBe(g);
  });
});

describe("readUniversalStyleAttrs", () => {
  it("reads stroke + fill + stroke-width + fill-opacity onto the preset", () => {
    const preset = emptyPreset();
    readUniversalStyleAttrs(
      svg("rect", {
        stroke: "#112233",
        fill: "#445566",
        "stroke-width": "3.5",
        "fill-opacity": "0.4",
      }),
      preset,
    );
    expect(preset.strokeColor).toBe("#112233");
    expect(preset.fillColor).toBe("#445566");
    expect(preset.strokeWidth).toBe(3.5);
    expect(preset.fillOpacity).toBe(0.4);
  });

  it("ignores zero / non-finite stroke-width", () => {
    const preset = emptyPreset({ strokeWidth: 7 });
    readUniversalStyleAttrs(svg("rect", { "stroke-width": "0" }), preset);
    expect(preset.strokeWidth).toBe(7);
    readUniversalStyleAttrs(svg("rect", { "stroke-width": "not-a-number" }), preset);
    expect(preset.strokeWidth).toBe(7);
  });

  it("prefers data-dash-key over stroke-dasharray", () => {
    const preset = emptyPreset();
    readUniversalStyleAttrs(
      svg("rect", { "data-dash-key": "dash", "stroke-dasharray": "8 4" }),
      preset,
    );
    expect(preset.strokeDasharray).toBe("dash");
  });

  it("falls back to stroke-dasharray when data-dash-key is absent", () => {
    const preset = emptyPreset();
    readUniversalStyleAttrs(svg("rect", { "stroke-dasharray": "8 4" }), preset);
    expect(preset.strokeDasharray).toBe("8 4");
  });

  it("prefers `opacity` over `stroke-opacity` for strokeOpacity capture", () => {
    const preset = emptyPreset();
    readUniversalStyleAttrs(svg("line", { opacity: "0.5", "stroke-opacity": "0.9" }), preset);
    expect(preset.strokeOpacity).toBe(0.5);
  });

  it("falls back to `stroke-opacity` when `opacity` is absent", () => {
    const preset = emptyPreset();
    readUniversalStyleAttrs(svg("rect", { "stroke-opacity": "0.7" }), preset);
    expect(preset.strokeOpacity).toBe(0.7);
  });

  it("whitelists stroke-linecap values", () => {
    const preset = emptyPreset();
    readUniversalStyleAttrs(svg("rect", { "stroke-linecap": "round" }), preset);
    expect(preset.strokeLinecap).toBe("round");
    // Unknown value is silently ignored.
    const preset2 = emptyPreset();
    readUniversalStyleAttrs(svg("rect", { "stroke-linecap": "wonky" }), preset2);
    expect(preset2.strokeLinecap).toBeUndefined();
  });

  it("whitelists stroke-linejoin values", () => {
    const preset = emptyPreset();
    readUniversalStyleAttrs(svg("rect", { "stroke-linejoin": "bevel" }), preset);
    expect(preset.strokeLinejoin).toBe("bevel");
    const preset2 = emptyPreset();
    readUniversalStyleAttrs(svg("rect", { "stroke-linejoin": "wonky" }), preset2);
    expect(preset2.strokeLinejoin).toBeUndefined();
  });

  it("reads from the freehand-group's last <path> child", () => {
    const g = svg("g", { "data-type": "freehand" });
    g.append(
      svg("path", { stroke: "#oldcolor", "stroke-width": "1" }),
      svg("path", { stroke: "#ff0000", "stroke-width": "4" }),
    );
    const preset = emptyPreset();
    readUniversalStyleAttrs(g, preset);
    expect(preset.strokeColor).toBe("#ff0000");
    expect(preset.strokeWidth).toBe(4);
  });

  it("does not touch fields that are absent from the element", () => {
    const preset = emptyPreset({ strokeColor: "#aaaaaa", fillColor: "#bbbbbb" });
    readUniversalStyleAttrs(svg("rect"), preset);
    // Empty rect → preset stays unchanged.
    expect(preset.strokeColor).toBe("#aaaaaa");
    expect(preset.fillColor).toBe("#bbbbbb");
    expect(preset.strokeOpacity).toBeUndefined();
    expect(preset.strokeLinecap).toBeUndefined();
  });
});
