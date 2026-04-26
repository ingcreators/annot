// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  CATEGORY_CONTROL_SHAPE,
  classifyPropertyElement,
  classifyPropertySelection,
  PROPERTY_CONTROL_IDS,
  PROPERTY_CONTROLS,
  PROPERTY_EFFECT_IDS,
  type PropertyCategory,
  type PropertyControlId,
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

describe("PROPERTY_CONTROLS registry", () => {
  const ALL_IDS: PropertyControlId[] = Object.values(PROPERTY_CONTROL_IDS);

  it("covers every PropertyControlId", () => {
    // Phase 1 landed 17 entries; Phase A of the extensions plan
    // (`property-panel-schema-extensions.md`) added 5 marker bg-
    // primitive ids → 22; Phase B added 3 shape transparency / cap
    // type ids → 25; Phase C added 4 per-end arrow ids → 29.
    // Pinning the count guards against a new id landing without a
    // matching def — the entry-count shape test alone won't catch
    // that if the new id accidentally duplicates another.
    expect(ALL_IDS).toHaveLength(29);
    for (const id of ALL_IDS) {
      expect(PROPERTY_CONTROLS[id], `missing def for "${id}"`).toBeDefined();
      expect(PROPERTY_CONTROLS[id].id).toBe(id);
    }
  });

  it("declares one of setValue / replace / effect per def", () => {
    // The mutation contract: each def carries EXACTLY ONE of the
    // three mutation paths. Multiple would make the renderer's
    // dispatch ambiguous; zero would leave the control read-only.
    for (const id of ALL_IDS) {
      const def = PROPERTY_CONTROLS[id];
      const present = [
        typeof def.setValue === "function",
        typeof def.replace === "function",
        typeof def.effect === "string",
      ].filter(Boolean).length;
      expect(present, `def "${id}" must declare exactly one of setValue / replace / effect`).toBe(
        1,
      );
    }
  });

  it("declares a getValue function on every def", () => {
    for (const id of ALL_IDS) {
      expect(typeof PROPERTY_CONTROLS[id].getValue, `def "${id}" missing getValue`).toBe(
        "function",
      );
    }
  });

  it("references only known PropertyEffectIds in `effect` fields", () => {
    const validEffects = new Set<string>(Object.values(PROPERTY_EFFECT_IDS));
    for (const id of ALL_IDS) {
      const eff = PROPERTY_CONTROLS[id].effect;
      if (eff) {
        expect(validEffects.has(eff), `def "${id}" references unknown effect "${eff}"`).toBe(true);
      }
    }
  });

  it("every id listed in CATEGORY_CONTROL_SHAPE has a matching def", () => {
    for (const [category, ids] of Object.entries(CATEGORY_CONTROL_SHAPE)) {
      for (const id of ids) {
        expect(PROPERTY_CONTROLS[id], `category "${category}" references missing def "${id}"`).toBeDefined();
      }
    }
  });

  it("every variantPicker / select def carries options OR getOptions", () => {
    for (const id of ALL_IDS) {
      const def = PROPERTY_CONTROLS[id];
      if (def.type === "variantPicker" || def.type === "select") {
        // Phase C added `getOptions` for dynamic option lists (per-
        // end arrow shape pulldowns filter by current variant). A
        // def must carry static `options` OR a `getOptions` fn.
        const hasOptions = (def.options?.length ?? 0) > 0;
        const hasGetOptions = typeof def.getOptions === "function";
        expect(
          hasOptions || hasGetOptions,
          `def "${id}" of type "${def.type}" must declare options or getOptions`,
        ).toBe(true);
      }
    }
  });

  it("getValue is callable on a synthetic SVG element of the matching family", () => {
    // Spot-check that getValue doesn't throw on a freshly-created
    // element. We don't assert on the returned value here — defaults
    // vary per control — only that the call shape is sane.
    const rect = svg("rect", {
      fill: "#ff0000",
      stroke: "#000",
      "stroke-width": "2",
      "data-dash-key": "dash",
    });
    expect(() => PROPERTY_CONTROLS.fillColor.getValue(rect)).not.toThrow();
    expect(() => PROPERTY_CONTROLS.strokeColor.getValue(rect)).not.toThrow();
    expect(() => PROPERTY_CONTROLS.strokeWidth.getValue(rect)).not.toThrow();
    expect(() => PROPERTY_CONTROLS.strokeStyle.getValue(rect)).not.toThrow();
    expect(() => PROPERTY_CONTROLS.shapeTypePicker.getValue(rect)).not.toThrow();

    const arrow = svg("g", { "data-type": "arrow", "data-arrow-end-shape": "triangle" });
    expect(PROPERTY_CONTROLS.arrowVariantPicker.getValue(arrow)).toBe("end");

    const freehand = svg("path", { "data-draw-style": "highlighter" });
    expect(PROPERTY_CONTROLS.drawStylePicker.getValue(freehand)).toBe("highlighter");

    const textbox = svg("g", { "data-type": "textbox" });
    const text = svg("text", { fill: "#123456", "font-size": "20", "font-family": "serif" });
    text.textContent = "hi";
    textbox.appendChild(text);
    expect(PROPERTY_CONTROLS.textColor.getValue(textbox)).toBe("#123456");
    expect(PROPERTY_CONTROLS.fontFamily.getValue(textbox)).toBe("serif");
    expect(PROPERTY_CONTROLS.fontSize.getValue(textbox)).toBe(20);

    const redactSolid = svg("rect", { "data-redact-style": "solid", fill: "#222" });
    expect(PROPERTY_CONTROLS.redactStylePicker.getValue(redactSolid)).toBe("solid");
    expect(PROPERTY_CONTROLS.redactSolidColor.getValue(redactSolid)).toBe("#222");

    const highlight = svg("rect", { "data-highlight": "1", fill: "#ffff00", "fill-opacity": "0.4" });
    expect(PROPERTY_CONTROLS.highlightColorPicker.getValue(highlight)).toBe("#ffff00");
    expect(PROPERTY_CONTROLS.highlightTransparency.getValue(highlight)).toBe(60);

    const marker = svg("g", { "data-marker": "1", "data-shape": "rounded" });
    const bg = svg("rect", {
      x: "0",
      y: "0",
      width: "24",
      height: "24",
      fill: "#aabbcc",
      stroke: "#112233",
      "stroke-width": "2",
    });
    const mtext = svg("text", { "font-size": "13" });
    mtext.textContent = "1";
    marker.appendChild(bg);
    marker.appendChild(mtext);
    expect(PROPERTY_CONTROLS.markerShapePicker.getValue(marker)).toBe("rounded");
    expect(PROPERTY_CONTROLS.markerSize.getValue(marker)).toBe(13);
    // Phase A bg-primitive defs read from the inner <circle>/<rect>
    expect(PROPERTY_CONTROLS.markerBgFillColor.getValue(marker)).toBe("#aabbcc");
    expect(PROPERTY_CONTROLS.markerBgStrokeColor.getValue(marker)).toBe("#112233");
    expect(PROPERTY_CONTROLS.markerBgStrokeWidth.getValue(marker)).toBe(2);
    // Solid (no data-dash-key, no stroke-dasharray) → ""
    expect(PROPERTY_CONTROLS.markerBgStrokeStyle.getValue(marker)).toBe("");
    expect(PROPERTY_CONTROLS.markerLabelValue.getValue(marker)).toBe(1);
  });

  it("Phase C per-end arrow defs read per-end shape + size from data attrs", () => {
    // Composed-arrow group with "Double arrow" variant (both ends
    // non-"none"). The per-end defs read the canonical
    // `data-arrow-{start,end}-{shape,w,l}` attrs.
    const arrow = svg("g", {
      "data-type": "arrow",
      "data-arrow-start-shape": "diamond",
      "data-arrow-start-width": "lg",
      "data-arrow-start-length": "sm",
      "data-arrow-end-shape": "triangle",
      "data-arrow-end-width": "md",
      "data-arrow-end-length": "lg",
    });
    expect(PROPERTY_CONTROLS.arrowStartShape.getValue(arrow)).toBe("diamond");
    expect(PROPERTY_CONTROLS.arrowStartSize.getValue(arrow)).toBe("lg-sm");
    expect(PROPERTY_CONTROLS.arrowEndShape.getValue(arrow)).toBe("triangle");
    expect(PROPERTY_CONTROLS.arrowEndSize.getValue(arrow)).toBe("md-lg");
  });

  it("Phase C arrow shape getOptions filters by current line variant", () => {
    // Variant "Line" (both ends none): both Type pulldowns show
    // ONLY "none".
    const line = svg("line");
    const startOpts1 = PROPERTY_CONTROLS.arrowStartShape.getOptions?.(line) ?? [];
    const endOpts1 = PROPERTY_CONTROLS.arrowEndShape.getOptions?.(line) ?? [];
    expect(startOpts1.map((o) => o.value)).toEqual(["none"]);
    expect(endOpts1.map((o) => o.value)).toEqual(["none"]);

    // Variant "Arrow" (start none, end triangle): start shows ONLY
    // "none", end shows non-"none" presets.
    const arrow = svg("g", {
      "data-type": "arrow",
      "data-arrow-start-shape": "none",
      "data-arrow-end-shape": "triangle",
    });
    const startOpts2 = PROPERTY_CONTROLS.arrowStartShape.getOptions?.(arrow) ?? [];
    const endOpts2 = PROPERTY_CONTROLS.arrowEndShape.getOptions?.(arrow) ?? [];
    expect(startOpts2.map((o) => o.value)).toEqual(["none"]);
    expect(endOpts2.map((o) => o.value)).toEqual([
      "triangle",
      "arrow",
      "stealth",
      "diamond",
      "oval",
    ]);

    // Variant "Double arrow" (both non-"none"): both pulldowns
    // show all 5 non-"none" presets.
    const doubleArrow = svg("g", {
      "data-type": "arrow",
      "data-arrow-start-shape": "diamond",
      "data-arrow-end-shape": "triangle",
    });
    const startOpts3 = PROPERTY_CONTROLS.arrowStartShape.getOptions?.(doubleArrow) ?? [];
    const endOpts3 = PROPERTY_CONTROLS.arrowEndShape.getOptions?.(doubleArrow) ?? [];
    expect(startOpts3.map((o) => o.value)).toEqual([
      "triangle",
      "arrow",
      "stealth",
      "diamond",
      "oval",
    ]);
    expect(endOpts3.map((o) => o.value)).toEqual(startOpts3.map((o) => o.value));
  });

  it("Phase C per-end arrow defs gate visibility to line-like targets only", () => {
    expect(PROPERTY_CONTROLS.arrowStartShape.visibleWhen?.(svg("line"))).toBe(true);
    const arrow = svg("g", { "data-type": "arrow" });
    expect(PROPERTY_CONTROLS.arrowStartSize.visibleWhen?.(arrow)).toBe(true);
    // Non-line: hidden
    expect(PROPERTY_CONTROLS.arrowEndShape.visibleWhen?.(svg("rect"))).toBe(false);
    expect(PROPERTY_CONTROLS.arrowEndSize.visibleWhen?.(svg("ellipse"))).toBe(false);
  });

  it("Phase B fillOpacity / strokeOpacity / strokeLinecap getValue/setValue", () => {
    const r = svg("rect", { fill: "#ff0000", "fill-opacity": "0.4" });
    expect(PROPERTY_CONTROLS.fillOpacity.getValue(r)).toBe(60);
    PROPERTY_CONTROLS.fillOpacity.setValue?.(r, 25);
    // 25% transparent ↔ 0.75 opacity
    expect(Number.parseFloat(r.getAttribute("fill-opacity") || "0")).toBeCloseTo(0.75, 3);

    // strokeOpacity: shapes write to `stroke-opacity`
    expect(PROPERTY_CONTROLS.strokeOpacity.getValue(r)).toBe(0); // default 1 → 0% transparent
    PROPERTY_CONTROLS.strokeOpacity.setValue?.(r, 40);
    expect(Number.parseFloat(r.getAttribute("stroke-opacity") || "0")).toBeCloseTo(0.6, 3);

    // strokeOpacity: line-like writes to `opacity` AND drops legacy `stroke-opacity`
    const line = svg("line", { "stroke-opacity": "0.3" });
    PROPERTY_CONTROLS.strokeOpacity.setValue?.(line, 20);
    expect(line.getAttribute("opacity")).toBeTruthy();
    expect(Number.parseFloat(line.getAttribute("opacity") || "0")).toBeCloseTo(0.8, 3);
    expect(line.hasAttribute("stroke-opacity")).toBe(false);

    // strokeLinecap: select with default "butt"
    expect(PROPERTY_CONTROLS.strokeLinecap.getValue(r)).toBe("butt");
    PROPERTY_CONTROLS.strokeLinecap.setValue?.(r, "round");
    expect(r.getAttribute("stroke-linecap")).toBe("round");
  });

  it("Phase B strokeColor / strokeWidth augmentations expand to freehand children + arrow head-fill / refreshArrowPath", () => {
    // Freehand <g> wrapper — writes propagate to <path> children.
    const fh = svg("g", { "data-type": "freehand" });
    const p1 = svg("path", { stroke: "#000000", "stroke-width": "2" });
    const p2 = svg("path", { stroke: "#000000", "stroke-width": "2" });
    fh.appendChild(p1);
    fh.appendChild(p2);
    PROPERTY_CONTROLS.strokeColor.setValue?.(fh, "#abcdef");
    expect(p1.getAttribute("stroke")).toBe("#abcdef");
    expect(p2.getAttribute("stroke")).toBe("#abcdef");

    PROPERTY_CONTROLS.strokeWidth.setValue?.(fh, 5);
    expect(p1.getAttribute("stroke-width")).toBe("5");
    expect(p2.getAttribute("stroke-width")).toBe("5");

    // Composed arrow group — strokeColor also paints the head-filled
    // subpath; strokeWidth triggers refreshArrowPath which generates
    // a stem `<path data-role="stem">` (creating it if missing).
    const arrow = svg("g", {
      "data-type": "arrow",
      stroke: "#222",
      "stroke-width": "3",
      "data-x1": "0",
      "data-y1": "0",
      "data-x2": "100",
      "data-y2": "0",
    });
    const headFilled = svg("path", { "data-role": "head-filled", fill: "#222" });
    arrow.appendChild(headFilled);
    PROPERTY_CONTROLS.strokeColor.setValue?.(arrow, "#cafe00");
    expect(headFilled.getAttribute("fill")).toBe("#cafe00");

    PROPERTY_CONTROLS.strokeWidth.setValue?.(arrow, 4);
    // refreshArrowPath upserts a `[data-role="stem"]` child with a
    // non-empty `d` attribute — proves the regen ran.
    const stem = arrow.querySelector('[data-role="stem"]');
    expect(stem).not.toBeNull();
    expect(stem?.getAttribute("d")?.length ?? 0).toBeGreaterThan(0);
  });

  it("marker bg-primitive setValues mutate the inner element + keep label/text in sync", () => {
    const marker = svg("g", { "data-marker": "1", "data-shape": "circle" });
    const bg = svg("circle", { cx: "12", cy: "12", r: "12", "stroke-width": "1.5" });
    const t = svg("text", { "font-size": "13" });
    t.textContent = "1";
    marker.appendChild(bg);
    marker.appendChild(t);

    PROPERTY_CONTROLS.markerBgFillColor.setValue?.(marker, "#deadbe");
    expect(bg.getAttribute("fill")).toBe("#deadbe");
    PROPERTY_CONTROLS.markerBgStrokeColor.setValue?.(marker, "#cafe00");
    expect(bg.getAttribute("stroke")).toBe("#cafe00");

    // Width also recomputes dasharray when a data-dash-key is set.
    bg.setAttribute("data-dash-key", "dash");
    PROPERTY_CONTROLS.markerBgStrokeWidth.setValue?.(marker, 3);
    expect(bg.getAttribute("stroke-width")).toBe("3");
    expect(bg.getAttribute("stroke-dasharray")).toBeTruthy();

    // Style "" removes the dash key.
    PROPERTY_CONTROLS.markerBgStrokeStyle.setValue?.(marker, "");
    expect(bg.hasAttribute("data-dash-key")).toBe(false);
    expect(bg.hasAttribute("stroke-dasharray")).toBe(false);

    // Label value: outer data-marker AND inner text content move together.
    PROPERTY_CONTROLS.markerLabelValue.setValue?.(marker, 42);
    expect(marker.getAttribute("data-marker")).toBe("42");
    expect(t.textContent).toBe("42");
  });

  it("setValue mutates element attributes for the simple Tier B controls", () => {
    // Sanity-check the in-place setters round-trip via getValue.
    const rect = svg("rect", { stroke: "#000", "stroke-width": "1" });
    PROPERTY_CONTROLS.fillColor.setValue?.(rect, "#abcdef");
    expect(rect.getAttribute("fill")).toBe("#abcdef");

    PROPERTY_CONTROLS.strokeWidth.setValue?.(rect, 4);
    expect(rect.getAttribute("stroke-width")).toBe("4");

    PROPERTY_CONTROLS.strokeStyle.setValue?.(rect, "dash");
    expect(rect.getAttribute("data-dash-key")).toBe("dash");
    // Setting "" should remove the dash key.
    PROPERTY_CONTROLS.strokeStyle.setValue?.(rect, "");
    expect(rect.hasAttribute("data-dash-key")).toBe(false);

    const highlight = svg("rect", { "data-highlight": "1", "fill-opacity": "0.4" });
    PROPERTY_CONTROLS.highlightTransparency.setValue?.(highlight, 25);
    // 25% transparency = 0.75 opacity.
    expect(Number.parseFloat(highlight.getAttribute("fill-opacity") || "0")).toBeCloseTo(0.75, 3);
  });

  it("visibleWhen gates fillColor for stroke-only families", () => {
    const rect = svg("rect");
    expect(PROPERTY_CONTROLS.fillColor.visibleWhen?.(rect)).toBe(true);

    const line = svg("line");
    expect(PROPERTY_CONTROLS.fillColor.visibleWhen?.(line)).toBe(false);

    const composedArrow = svg("g", { "data-type": "arrow" });
    expect(PROPERTY_CONTROLS.fillColor.visibleWhen?.(composedArrow)).toBe(false);

    const freehand = svg("path");
    expect(PROPERTY_CONTROLS.fillColor.visibleWhen?.(freehand)).toBe(false);

    const freehandGroup = svg("g", { "data-type": "freehand" });
    expect(PROPERTY_CONTROLS.fillColor.visibleWhen?.(freehandGroup)).toBe(false);
  });

  it("visibleWhen gates redactSolidColor to the solid variant only", () => {
    const solid = svg("rect", { "data-redact-style": "solid" });
    expect(PROPERTY_CONTROLS.redactSolidColor.visibleWhen?.(solid)).toBe(true);

    const mosaic = svg("image", { "data-redact-style": "mosaic" });
    expect(PROPERTY_CONTROLS.redactSolidColor.visibleWhen?.(mosaic)).toBe(false);

    const blur = svg("image", { "data-redact-style": "blur" });
    expect(PROPERTY_CONTROLS.redactSolidColor.visibleWhen?.(blur)).toBe(false);
  });
});
