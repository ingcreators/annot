// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  CATEGORY_CONTROL_SHAPE,
  classifyPropertyElement,
  classifyPropertySelection,
  PROPERTY_CONTROL_IDS,
  type PropertyCategory,
} from "./property-schema.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

describe("classifyPropertyElement", () => {
  it("classifies <g data-type=textbox> as textbox", () => {
    expect(classifyPropertyElement(svg("g", { "data-type": "textbox" }))).toBe("textbox");
  });

  it("classifies <g data-type=group> as group", () => {
    expect(classifyPropertyElement(svg("g", { "data-type": "group" }))).toBe("group");
  });

  it("classifies <g data-marker=...> as marker", () => {
    expect(classifyPropertyElement(svg("g", { "data-marker": "1" }))).toBe("marker");
  });

  it("treats a marker element with both data-marker and data-type=arrow as marker first", () => {
    // The legacy panel checks textbox/group/marker before arrow, but a
    // composed arrow group never carries `data-marker`, so this is a
    // theoretical disambiguation. The test pins the precedence.
    const el = svg("g", { "data-type": "arrow", "data-marker": "1" });
    expect(classifyPropertyElement(el)).toBe("marker");
  });

  it("classifies <g data-type=arrow> as shape (composed arrow)", () => {
    expect(classifyPropertyElement(svg("g", { "data-type": "arrow" }))).toBe("shape");
  });

  it("classifies <rect data-highlight=1> as highlight", () => {
    expect(classifyPropertyElement(svg("rect", { "data-highlight": "1" }))).toBe("highlight");
  });

  it("classifies redact variants from data-redact-style", () => {
    expect(classifyPropertyElement(svg("rect", { "data-redact-style": "solid" }))).toBe(
      "redact-solid",
    );
    expect(classifyPropertyElement(svg("image", { "data-redact-style": "mosaic" }))).toBe(
      "redact-mosaic",
    );
    expect(classifyPropertyElement(svg("image", { "data-redact-style": "blur" }))).toBe(
      "redact-blur",
    );
  });

  it("ignores unknown data-redact-style values", () => {
    expect(classifyPropertyElement(svg("rect", { "data-redact-style": "futureVariant" }))).toBe(
      "shape",
    );
  });

  it("classifies vanilla shape primitives as shape", () => {
    expect(classifyPropertyElement(svg("rect"))).toBe("shape");
    expect(classifyPropertyElement(svg("ellipse"))).toBe("shape");
    expect(classifyPropertyElement(svg("circle"))).toBe("shape");
    expect(classifyPropertyElement(svg("line"))).toBe("shape");
    expect(classifyPropertyElement(svg("path"))).toBe("shape");
    expect(classifyPropertyElement(svg("polygon"))).toBe("shape");
  });

  it("does not misclassify a plain <g> with no data-* attributes", () => {
    expect(classifyPropertyElement(svg("g"))).toBe("shape");
  });
});

describe("classifyPropertySelection", () => {
  it("returns null for an empty selection", () => {
    expect(classifyPropertySelection([])).toEqual({ category: null, uniform: true });
  });

  it("reports uniform=true when all elements share a category", () => {
    const a = svg("rect");
    const b = svg("ellipse");
    expect(classifyPropertySelection([a, b])).toEqual({ category: "shape", uniform: true });
  });

  it("reports uniform=false when categories differ, with category=first", () => {
    const a = svg("g", { "data-type": "textbox" });
    const b = svg("rect");
    expect(classifyPropertySelection([a, b])).toEqual({ category: "textbox", uniform: false });
  });
});

describe("CATEGORY_CONTROL_SHAPE", () => {
  it("covers every category in the union", () => {
    const categories: PropertyCategory[] = [
      "textbox",
      "marker",
      "redact-mosaic",
      "redact-solid",
      "redact-blur",
      "highlight",
      "group",
      "shape",
    ];
    for (const c of categories) {
      expect(Array.isArray(CATEGORY_CONTROL_SHAPE[c])).toBe(true);
    }
  });

  it("declares group as having zero per-element controls", () => {
    expect(CATEGORY_CONTROL_SHAPE.group).toHaveLength(0);
  });

  it("declares the textbox shape as variant + color + font + size", () => {
    expect(CATEGORY_CONTROL_SHAPE.textbox).toEqual([
      PROPERTY_CONTROL_IDS.textVariantPicker,
      PROPERTY_CONTROL_IDS.textColor,
      PROPERTY_CONTROL_IDS.fontFamily,
      PROPERTY_CONTROL_IDS.fontSize,
    ]);
  });

  it("only the solid redact variant exposes a fill-color control", () => {
    expect(CATEGORY_CONTROL_SHAPE["redact-solid"]).toContain(PROPERTY_CONTROL_IDS.redactSolidColor);
    expect(CATEGORY_CONTROL_SHAPE["redact-mosaic"]).not.toContain(
      PROPERTY_CONTROL_IDS.redactSolidColor,
    );
    expect(CATEGORY_CONTROL_SHAPE["redact-blur"]).not.toContain(
      PROPERTY_CONTROL_IDS.redactSolidColor,
    );
  });

  it("the shape category exposes the full geometric stroke / fill control set", () => {
    const ids = CATEGORY_CONTROL_SHAPE.shape;
    expect(ids).toContain(PROPERTY_CONTROL_IDS.fillColor);
    expect(ids).toContain(PROPERTY_CONTROL_IDS.strokeColor);
    expect(ids).toContain(PROPERTY_CONTROL_IDS.strokeWidth);
    expect(ids).toContain(PROPERTY_CONTROL_IDS.strokeStyle);
  });
});
