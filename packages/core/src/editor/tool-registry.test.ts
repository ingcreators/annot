// Default `node` environment — `TOOL_REGISTRY` is pure data + Element-
// taking helpers; the shape-invariant assertions don't need a DOM at
// all. The Element-classifier spot-checks elsewhere in this file
// construct a tiny synthetic Element shim so we don't pull happy-dom
// in for one or two attribute reads.
//
// Phase 1 of `docs/plans/toolbar-schema.md` — pin the registry's
// shape so a regression in any of:
//   - id ↔ key alignment
//   - variant value/label completeness
//   - `defaultVariant` membership
//   - `presetFields` referencing only valid `ToolOptions` keys
//   - the 8 expected tool ids being present
// surfaces immediately rather than waiting for a Toolbar wiring PR.

// @vitest-environment happy-dom
//
// Spot-checks for `extractStyleFromElement` need real `Element`
// instances (`querySelector`, attribute coercion). The shape-invariant
// + `variantKeyForElement` blocks above only use a tiny fakeEl and
// don't depend on happy-dom — but happy-dom is harmless for them.
import { describe, expect, it } from "vitest";
import { computeDasharray } from "../utils/dash-utils.js";
import type { ToolOptions } from "./tool-options.js";
import { readUniversalStyleAttrs } from "./tool-style-reader.js";
import {
  normalizeVariantSideFields,
  TOOL_REGISTRY,
  TOOL_REGISTRY_IDS,
} from "./tool-registry.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function emptyPreset(): ToolOptions {
  return {
    strokeColor: "#000",
    fillColor: "#fff",
    strokeWidth: 1,
    fontSize: 12,
    strokeDasharray: "",
    fillOpacity: 1,
  };
}

/** Minimal SVGElement-shaped stub. The classifier only reads
 *  `tagName`, `getAttribute`, `hasAttribute`, `querySelector` —
 *  emulate that surface without dragging happy-dom in for a node
 *  test. */
function fakeEl(
  tagName: string,
  attrs: Record<string, string> = {},
): SVGElement {
  return {
    tagName,
    getAttribute: (name: string) => (name in attrs ? attrs[name]! : null),
    hasAttribute: (name: string) => name in attrs,
    querySelector: () => null,
  } as unknown as SVGElement;
}

/** Reference set of every `ToolOptions` key. Source of truth for the
 *  presetFields validation below — duplicating the literal list keeps
 *  the test independent of `keyof ToolOptions` (which TypeScript can
 *  produce statically but vitest can't introspect at runtime). When a
 *  new field lands in `tool-options.ts`, the matching entry here gets
 *  added in the same PR. */
const VALID_TOOL_OPTIONS_KEYS = new Set<keyof ToolOptions>([
  "strokeColor",
  "fillColor",
  "strokeWidth",
  "fontSize",
  "strokeDasharray",
  "fillOpacity",
  "shapeType",
  "arrowHead",
  "textVariant",
  "fontFamily",
  "drawStyle",
  "redactStyle",
  "arrowHeadStart",
  "arrowHeadEnd",
  "arrowWidthStart",
  "arrowWidthEnd",
  "arrowLengthStart",
  "arrowLengthEnd",
  "strokeOpacity",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeGradient",
  "fillGradient",
  "highlightColor",
  "markerShape",
]);

describe("TOOL_REGISTRY shape invariants", () => {
  it("covers exactly the 8 toolbar tool ids", () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([...TOOL_REGISTRY_IDS].sort());
  });

  it("each entry's id matches its registry key", () => {
    for (const [key, entry] of Object.entries(TOOL_REGISTRY)) {
      expect(entry.id).toBe(key);
    }
  });

  it("each entry has a non-empty label and icon", () => {
    for (const [key, entry] of Object.entries(TOOL_REGISTRY)) {
      expect(entry.label, `${key}.label`).toMatch(/.+/);
      expect(entry.icon, `${key}.icon`).toMatch(/.+/);
    }
  });

  it("variants always carry both a value and a label", () => {
    for (const [key, entry] of Object.entries(TOOL_REGISTRY)) {
      for (const v of entry.variants ?? []) {
        expect(v.value, `${key}.variant.value`).toMatch(/.+/);
        expect(v.label, `${key}.variant[${v.value}].label`).toMatch(/.+/);
        expect(v.icon, `${key}.variant[${v.value}].icon`).toMatch(/.+/);
      }
    }
  });

  it("variant values are unique within each tool", () => {
    for (const [key, entry] of Object.entries(TOOL_REGISTRY)) {
      const values = (entry.variants ?? []).map((v) => v.value);
      expect(new Set(values).size, `${key} has duplicate variant values`).toBe(values.length);
    }
  });

  it("defaultVariant (if present) appears in the variants list", () => {
    for (const [key, entry] of Object.entries(TOOL_REGISTRY)) {
      if (entry.defaultVariant === undefined) continue;
      const values = (entry.variants ?? []).map((v) => v.value);
      expect(values, `${key}.defaultVariant must be a known variant`).toContain(
        entry.defaultVariant,
      );
    }
  });

  it("variantField is set iff variants are defined", () => {
    for (const [key, entry] of Object.entries(TOOL_REGISTRY)) {
      const hasVariants = (entry.variants?.length ?? 0) > 0;
      expect(
        entry.variantField !== undefined,
        `${key}: variantField presence must match variants presence`,
      ).toBe(hasVariants);
      // defaultVariant should also be set whenever variants exist —
      // otherwise the flyout has no fallback to highlight on first
      // load.
      if (hasVariants) {
        expect(entry.defaultVariant, `${key}.defaultVariant`).toBeDefined();
      }
    }
  });

  it("presetFields reference only valid ToolOptions keys", () => {
    for (const [key, entry] of Object.entries(TOOL_REGISTRY)) {
      for (const field of entry.presetFields) {
        expect(
          VALID_TOOL_OPTIONS_KEYS.has(field),
          `${key}.presetFields contains "${String(field)}", which is not a ToolOptions key`,
        ).toBe(true);
      }
    }
  });

  it("presetFields are unique within each tool", () => {
    for (const [key, entry] of Object.entries(TOOL_REGISTRY)) {
      const fields = entry.presetFields;
      expect(
        new Set(fields).size,
        `${key}.presetFields contains duplicates: ${fields.join(", ")}`,
      ).toBe(fields.length);
    }
  });
});

describe("TOOL_REGISTRY variantKeyForElement spot-checks", () => {
  // These are NOT exhaustive behaviour tests — that's Phase 5's job
  // when the classifier becomes the sole replacement for
  // `toolIdForElement` + `elementKeyFromElement`. The cases here just
  // pin the contract: each tool's classifier returns the full
  // `tool.variant` key for its own element, `null` for elements
  // owned by another tool.

  it("shape: rect / rounded / ellipse map to their variants", () => {
    expect(TOOL_REGISTRY.shape!.variantKeyForElement!(fakeEl("rect"))).toBe("shape.rect");
    expect(
      TOOL_REGISTRY.shape!.variantKeyForElement!(fakeEl("rect", { "data-rounded": "1" })),
    ).toBe("shape.rounded");
    expect(TOOL_REGISTRY.shape!.variantKeyForElement!(fakeEl("ellipse"))).toBe("shape.ellipse");
  });

  it("shape: yields null for highlight / redact-solid rects", () => {
    expect(
      TOOL_REGISTRY.shape!.variantKeyForElement!(fakeEl("rect", { "data-highlight": "1" })),
    ).toBeNull();
    expect(
      TOOL_REGISTRY.shape!.variantKeyForElement!(
        fakeEl("rect", { "data-redact-style": "solid" }),
      ),
    ).toBeNull();
  });

  it("highlight: rect[data-highlight=1] yields lowercased fill", () => {
    expect(
      TOOL_REGISTRY.highlight!.variantKeyForElement!(
        fakeEl("rect", { "data-highlight": "1", fill: "#FFE100" }),
      ),
    ).toBe("highlight.#ffe100");
  });

  it("highlight: yields null for non-highlight rects", () => {
    expect(TOOL_REGISTRY.highlight!.variantKeyForElement!(fakeEl("rect"))).toBeNull();
  });

  it("arrow: <line> + <g data-type=arrow> classify by per-end shape", () => {
    expect(TOOL_REGISTRY.arrow!.variantKeyForElement!(fakeEl("line"))).toBe("arrow.none");
    expect(
      TOOL_REGISTRY.arrow!.variantKeyForElement!(
        fakeEl("line", { "data-arrow-end-shape": "triangle" }),
      ),
    ).toBe("arrow.end");
    expect(
      TOOL_REGISTRY.arrow!.variantKeyForElement!(
        fakeEl("g", {
          "data-type": "arrow",
          "data-arrow-start-shape": "triangle",
          "data-arrow-end-shape": "triangle",
        }),
      ),
    ).toBe("arrow.both");
  });

  it("text: <g data-type=textbox> reads data-text-variant", () => {
    expect(
      TOOL_REGISTRY.text!.variantKeyForElement!(
        fakeEl("g", { "data-type": "textbox", "data-text-variant": "callout" }),
      ),
    ).toBe("text.callout");
  });

  it("freehand: <path data-draw-style> reads the style attr", () => {
    expect(
      TOOL_REGISTRY.freehand!.variantKeyForElement!(
        fakeEl("path", { "data-draw-style": "highlighter" }),
      ),
    ).toBe("freehand.highlighter");
  });

  it("marker: <g data-marker> reads data-shape", () => {
    expect(
      TOOL_REGISTRY.marker!.variantKeyForElement!(
        fakeEl("g", { "data-marker": "1", "data-shape": "rounded" }),
      ),
    ).toBe("marker.rounded");
  });

  it("redact: rect[data-redact-style=solid] + image[mosaic/blur]", () => {
    expect(
      TOOL_REGISTRY.redact!.variantKeyForElement!(
        fakeEl("rect", { "data-redact-style": "solid" }),
      ),
    ).toBe("redact.solid");
    expect(
      TOOL_REGISTRY.redact!.variantKeyForElement!(
        fakeEl("image", { "data-redact-style": "mosaic" }),
      ),
    ).toBe("redact.mosaic");
    expect(
      TOOL_REGISTRY.redact!.variantKeyForElement!(
        fakeEl("image", { "data-redact-style": "blur" }),
      ),
    ).toBe("redact.blur");
  });

  it("redact: <image> without data-redact-style falls back to mosaic", () => {
    // Matches the legacy `toolIdForElement`'s catch-all for `<image>`
    // → "redact" + `elementKeyFromElement`'s fallback to the group's
    // default variant ("mosaic"). Without this branch a redact image
    // saved before the redact-style attribute existed would fail
    // tool routing.
    expect(TOOL_REGISTRY.redact!.variantKeyForElement!(fakeEl("image"))).toBe(
      "redact.mosaic",
    );
  });

  it("crop: has no variantKeyForElement (no on-canvas element)", () => {
    expect(TOOL_REGISTRY.crop!.variantKeyForElement).toBeUndefined();
  });

  it("each non-crop tool's variantKeyForElement is defined", () => {
    for (const [id, entry] of Object.entries(TOOL_REGISTRY)) {
      if (id === "crop") continue;
      expect(entry.variantKeyForElement, `${id}.variantKeyForElement`).toBeDefined();
    }
  });
});

describe("TOOL_REGISTRY extractStyleFromElement", () => {
  // Each spot-check builds a synthetic element with the on-canvas
  // attributes the corresponding tool would emit, runs the
  // extractor, and asserts the harvested preset fields match.
  // Happy-dom-backed Element so `querySelector` works.

  it("shape: ellipse → shapeType=ellipse", () => {
    const preset = emptyPreset();
    TOOL_REGISTRY.shape!.extractStyleFromElement!(svg("ellipse"), preset);
    expect(preset.shapeType).toBe("ellipse");
  });

  it("shape: rect[data-rounded] → shapeType=rounded", () => {
    const preset = emptyPreset();
    TOOL_REGISTRY.shape!.extractStyleFromElement!(svg("rect", { "data-rounded": "1" }), preset);
    expect(preset.shapeType).toBe("rounded");
  });

  it("highlight: routes fill into highlightColor", () => {
    const preset = emptyPreset();
    TOOL_REGISTRY.highlight!.extractStyleFromElement!(
      svg("rect", { "data-highlight": "1", fill: "#ffe100" }),
      preset,
    );
    expect(preset.highlightColor).toBe("#ffe100");
  });

  it("freehand: data-draw-style → drawStyle", () => {
    const preset = emptyPreset();
    TOOL_REGISTRY.freehand!.extractStyleFromElement!(
      svg("path", { "data-draw-style": "highlighter" }),
      preset,
    );
    expect(preset.drawStyle).toBe("highlighter");
  });

  it("redact: data-redact-style → redactStyle", () => {
    const preset = emptyPreset();
    TOOL_REGISTRY.redact!.extractStyleFromElement!(
      svg("rect", { "data-redact-style": "solid" }),
      preset,
    );
    expect(preset.redactStyle).toBe("solid");
  });

  it("text: <g data-type=textbox> reads variant + font + text-color", () => {
    const g = svg("g", {
      "data-type": "textbox",
      "data-text-variant": "callout",
      "data-color": "#222222",
    });
    const t = svg("text", { "font-size": "20", "font-family": "Inter", fill: "#222222" });
    g.appendChild(t);
    const preset = emptyPreset();
    TOOL_REGISTRY.text!.extractStyleFromElement!(g, preset);
    expect(preset.textVariant).toBe("callout");
    expect(preset.fontSize).toBe(20);
    expect(preset.fontFamily).toBe("Inter");
    expect(preset.strokeColor).toBe("#222222");
  });

  it("marker: bg primitive's fill+stroke → fillColor+strokeColor", () => {
    const g = svg("g", { "data-marker": "1", "data-shape": "rounded" });
    const bg = svg("rect", { fill: "#abc", stroke: "#def", "stroke-width": "2.5" });
    g.appendChild(bg);
    const t = svg("text", { "font-size": "16" });
    g.appendChild(t);
    const preset = emptyPreset();
    TOOL_REGISTRY.marker!.extractStyleFromElement!(g, preset);
    expect(preset.markerShape).toBe("rounded");
    expect(preset.fillColor).toBe("#abc");
    expect(preset.strokeColor).toBe("#def");
    expect(preset.strokeWidth).toBe(2.5);
    expect(preset.fontSize).toBe(16);
  });

  it("arrow: per-end shape attrs round-trip into per-end preset fields", () => {
    const el = svg("g", {
      "data-type": "arrow",
      "data-arrow-start-shape": "diamond",
      "data-arrow-end-shape": "stealth",
      "data-arrow-start-width": "lg",
      "data-arrow-end-length": "sm",
    });
    const preset = emptyPreset();
    TOOL_REGISTRY.arrow!.extractStyleFromElement!(el, preset);
    expect(preset.arrowHead).toBe("both");
    expect(preset.arrowHeadStart).toBe("diamond");
    expect(preset.arrowHeadEnd).toBe("stealth");
    expect(preset.arrowWidthStart).toBe("lg");
    expect(preset.arrowLengthEnd).toBe("sm");
  });

  it("arrow: variant=none clamps both ends to none via normalizeVariantSideFields", () => {
    // Build a line with no per-end shape attrs — variant is "none".
    const el = svg("line");
    const preset = emptyPreset();
    preset.arrowHeadStart = "triangle";
    preset.arrowHeadEnd = "triangle";
    TOOL_REGISTRY.arrow!.extractStyleFromElement!(el, preset);
    expect(preset.arrowHead).toBe("none");
    expect(preset.arrowHeadStart).toBe("none");
    expect(preset.arrowHeadEnd).toBe("none");
  });

  it("crop has no extractStyleFromElement (no on-canvas element)", () => {
    expect(TOOL_REGISTRY.crop!.extractStyleFromElement).toBeUndefined();
  });
});

describe("TOOL_REGISTRY applyStyleToElement", () => {
  // Phase 2 of `docs/plans/toolbar-apply-style-to-element.md`.
  // Each block builds a synthetic element with attrs, harvests a
  // preset (universal reader + tool-specific extractor — mirrors
  // `Toolbar.syncPresetFromElement`), builds a fresh element of the
  // same shape, applies the writer, then re-harvests and asserts
  // round-trip equivalence on the fields the tool actually owns.

  /** Mirrors `Toolbar.syncPresetFromElement` minus the toolId
   *  classifier dance — call universal reader THEN the tool-
   *  specific extractor so the harvested preset reflects what the
   *  toolbar would have stored after a rubber-band capture. */
  function harvest(toolId: keyof typeof TOOL_REGISTRY, el: SVGElement): ToolOptions {
    const preset = emptyPreset();
    readUniversalStyleAttrs(el, preset);
    TOOL_REGISTRY[toolId]!.extractStyleFromElement?.(el, preset);
    return preset;
  }

  describe("shape", () => {
    it("rect: round-trips stroke / fill / width / dasharray / opacity", () => {
      const original = svg("rect", {
        stroke: "#112233",
        fill: "#445566",
        "stroke-width": "2",
        "stroke-dasharray": computeDasharray("dash", 2),
        "data-dash-key": "dash",
        "stroke-opacity": "0.6",
        "fill-opacity": "0.8",
        "stroke-linecap": "round",
        "stroke-linejoin": "miter",
      });
      const preset = harvest("shape", original);
      const fresh = svg("rect");
      TOOL_REGISTRY.shape!.applyStyleToElement!(fresh, preset);
      const reharvested = harvest("shape", fresh);
      expect(reharvested.strokeColor).toBe(preset.strokeColor);
      expect(reharvested.fillColor).toBe(preset.fillColor);
      expect(reharvested.strokeWidth).toBe(preset.strokeWidth);
      expect(reharvested.strokeDasharray).toBe(preset.strokeDasharray);
      expect(reharvested.strokeOpacity).toBe(preset.strokeOpacity);
      expect(reharvested.fillOpacity).toBe(preset.fillOpacity);
      expect(reharvested.strokeLinecap).toBe(preset.strokeLinecap);
      expect(reharvested.strokeLinejoin).toBe(preset.strokeLinejoin);
    });
  });

  describe("highlight", () => {
    it("rect[data-highlight=1]: round-trips highlightColor + fillOpacity", () => {
      const original = svg("rect", {
        "data-highlight": "1",
        fill: "#ffe100",
        "fill-opacity": "0.4",
      });
      const preset = harvest("highlight", original);
      const fresh = svg("rect", { "data-highlight": "1" });
      TOOL_REGISTRY.highlight!.applyStyleToElement!(fresh, preset);
      // Highlight writes `fill` from `highlightColor` (NOT `fillColor`).
      expect(fresh.getAttribute("fill")).toBe("#ffe100");
      expect(fresh.getAttribute("fill-opacity")).toBe("0.4");
      // Round-trip: harvest again and verify highlightColor matches.
      const reharvested = harvest("highlight", fresh);
      expect(reharvested.highlightColor).toBe("#ffe100");
      expect(reharvested.fillOpacity).toBe(0.4);
    });
  });

  describe("text", () => {
    it("<g data-type=textbox>: round-trips strokeColor / fontFamily / fontSize", () => {
      const original = svg("g", {
        "data-type": "textbox",
        "data-text-variant": "callout",
        "data-color": "#222222",
        "data-font-family": "Inter",
      });
      const t = svg("text", { fill: "#222222", "font-family": "Inter", "font-size": "20" });
      original.appendChild(t);
      const preset = harvest("text", original);
      // Build a fresh textbox <g> with an empty inner <text>.
      const fresh = svg("g", { "data-type": "textbox", "data-text-variant": "callout" });
      const freshT = svg("text");
      fresh.appendChild(freshT);
      TOOL_REGISTRY.text!.applyStyleToElement!(fresh, preset);
      // Wrapper cache attrs are populated.
      expect(fresh.getAttribute("data-color")).toBe("#222222");
      expect(fresh.getAttribute("data-font-family")).toBe("Inter");
      // Inner <text> picks up fill / font-family / font-size.
      expect(freshT.getAttribute("fill")).toBe("#222222");
      expect(freshT.getAttribute("font-family")).toBe("Inter");
      expect(freshT.getAttribute("font-size")).toBe("20");
      // Re-harvest and confirm the preset round-trips back.
      const reharvested = harvest("text", fresh);
      expect(reharvested.strokeColor).toBe(preset.strokeColor);
      expect(reharvested.fontFamily).toBe(preset.fontFamily);
      expect(reharvested.fontSize).toBe(preset.fontSize);
    });
  });

  describe("freehand", () => {
    it("<path>: round-trips stroke + width + dasharray", () => {
      const original = svg("path", {
        "data-draw-style": "pen",
        stroke: "#ff0000",
        "stroke-width": "3",
        "stroke-dasharray": computeDasharray("dot", 3),
        "data-dash-key": "dot",
        fill: "none",
      });
      const preset = harvest("freehand", original);
      const fresh = svg("path", { "data-draw-style": "pen" });
      TOOL_REGISTRY.freehand!.applyStyleToElement!(fresh, preset);
      const reharvested = harvest("freehand", fresh);
      expect(reharvested.strokeColor).toBe(preset.strokeColor);
      expect(reharvested.strokeWidth).toBe(preset.strokeWidth);
      expect(reharvested.strokeDasharray).toBe(preset.strokeDasharray);
      expect(reharvested.drawStyle).toBe("pen");
    });
  });

  describe("marker", () => {
    it("<g data-marker>: round-trips bg fill / stroke / width / dasharray + counter font-size", () => {
      const original = svg("g", { "data-marker": "1", "data-shape": "rounded" });
      const bg = svg("rect", {
        fill: "#abcdef",
        stroke: "#123456",
        "stroke-width": "2.5",
        "stroke-dasharray": computeDasharray("dash", 2.5),
        "data-dash-key": "dash",
      });
      original.appendChild(bg);
      const t = svg("text", { "font-size": "18" });
      original.appendChild(t);
      const preset = harvest("marker", original);
      // Build fresh: same composite shape, no style attrs.
      const fresh = svg("g", { "data-marker": "1", "data-shape": "rounded" });
      const freshBg = svg("rect");
      fresh.appendChild(freshBg);
      const freshT = svg("text");
      fresh.appendChild(freshT);
      TOOL_REGISTRY.marker!.applyStyleToElement!(fresh, preset);
      // Bg picks up the style writes (NOT the outer <g>).
      expect(freshBg.getAttribute("fill")).toBe("#abcdef");
      expect(freshBg.getAttribute("stroke")).toBe("#123456");
      expect(freshBg.getAttribute("stroke-width")).toBe("2.5");
      expect(freshBg.getAttribute("data-dash-key")).toBe("dash");
      expect(freshBg.getAttribute("stroke-dasharray")).toBe(
        computeDasharray("dash", 2.5),
      );
      // Counter <text> picks up font-size.
      expect(freshT.getAttribute("font-size")).toBe("18");
      // Re-harvest round-trip.
      const reharvested = harvest("marker", fresh);
      expect(reharvested.fillColor).toBe(preset.fillColor);
      expect(reharvested.strokeColor).toBe(preset.strokeColor);
      expect(reharvested.strokeWidth).toBe(preset.strokeWidth);
      expect(reharvested.strokeDasharray).toBe(preset.strokeDasharray);
      expect(reharvested.fontSize).toBe(preset.fontSize);
      expect(reharvested.markerShape).toBe("rounded");
    });

    it("falls back to the bg's existing stroke-width for dashes when preset.strokeWidth is absent", () => {
      // Build a preset with strokeDasharray set but strokeWidth absent
      // (deleted) — exercises the legacy fallback in
      // `applyMarkerPresetStyle` that reads the bg's own stroke-width.
      const fresh = svg("g", { "data-marker": "1", "data-shape": "circle" });
      const freshBg = svg("circle", { "stroke-width": "4" });
      fresh.appendChild(freshBg);
      const preset = emptyPreset();
      preset.strokeDasharray = "lgDash";
      delete (preset as { strokeWidth?: number }).strokeWidth;
      TOOL_REGISTRY.marker!.applyStyleToElement!(fresh, preset);
      // Dash is computed against the bg's existing stroke-width (4),
      // NOT the preset's missing one.
      expect(freshBg.getAttribute("stroke-dasharray")).toBe(
        computeDasharray("lgDash", 4),
      );
    });
  });

  describe("redact", () => {
    it("solid: writes universal style attrs onto the rect", () => {
      const fresh = svg("rect", { "data-redact-style": "solid" });
      const preset = emptyPreset();
      preset.fillColor = "#000000";
      TOOL_REGISTRY.redact!.applyStyleToElement!(fresh, preset);
      expect(fresh.getAttribute("fill")).toBe("#000000");
    });

    it("mosaic / blur are no-ops (PNG-baked, no stylable attrs)", () => {
      const mosaic = svg("image", { "data-redact-style": "mosaic" });
      const blur = svg("image", { "data-redact-style": "blur" });
      const preset = emptyPreset();
      preset.fillColor = "#ffffff";
      TOOL_REGISTRY.redact!.applyStyleToElement!(mosaic, preset);
      TOOL_REGISTRY.redact!.applyStyleToElement!(blur, preset);
      expect(mosaic.hasAttribute("fill")).toBe(false);
      expect(blur.hasAttribute("fill")).toBe(false);
    });
  });

  describe("arrow", () => {
    it("<line> (arrow.none): round-trips universal style attrs", () => {
      const original = svg("line", {
        stroke: "#ff0000",
        "stroke-width": "3",
        opacity: "0.5",
      });
      const preset = harvest("arrow", original);
      const fresh = svg("line");
      TOOL_REGISTRY.arrow!.applyStyleToElement!(fresh, preset);
      // Lines use `opacity` (NOT `stroke-opacity`) for transparency
      // so SVG-marker arrowheads fade with the stem.
      expect(fresh.getAttribute("stroke")).toBe("#ff0000");
      expect(fresh.getAttribute("stroke-width")).toBe("3");
      expect(fresh.getAttribute("opacity")).toBe("0.5");
      expect(fresh.hasAttribute("stroke-opacity")).toBe(false);
    });

    it("<g data-type=arrow>: refreshArrowPath rebuilds the head paths after writing", () => {
      // Need real endpoint data so refreshArrowPath has something to
      // generate. Synthetic 100x0 → 200x0 horizontal arrow with a
      // triangular end head.
      const fresh = svg("g", {
        "data-type": "arrow",
        "data-x1": "100",
        "data-y1": "0",
        "data-x2": "200",
        "data-y2": "0",
        "data-arrow-end-shape": "triangle",
        "data-arrow-end-width": "md",
        "data-arrow-end-length": "md",
      });
      const preset = emptyPreset();
      preset.strokeColor = "#00ff00";
      preset.strokeWidth = 2;
      TOOL_REGISTRY.arrow!.applyStyleToElement!(fresh, preset);
      // Universal writer wrote stroke + stroke-width on the <g>.
      expect(fresh.getAttribute("stroke")).toBe("#00ff00");
      expect(fresh.getAttribute("stroke-width")).toBe("2");
      // refreshArrowPath created the stem + head subpaths.
      const stem = fresh.querySelector('[data-role="stem"]');
      const head = fresh.querySelector('[data-role="head-filled"]');
      expect(stem?.getAttribute("d")).toBeTruthy();
      expect(head?.getAttribute("d")).toBeTruthy();
      // Head fill is re-derived from the new stroke color.
      expect(head?.getAttribute("fill")).toBe("#00ff00");
    });
  });

  it("crop has no applyStyleToElement (no on-canvas element)", () => {
    expect(TOOL_REGISTRY.crop!.applyStyleToElement).toBeUndefined();
  });
});

describe("TOOL_REGISTRY extract/apply symmetry", () => {
  // Phase 4 of `docs/plans/toolbar-apply-style-to-element.md`.
  // Structural guard: every tool with a `extractStyleFromElement`
  // must have a paired `applyStyleToElement`, and vice versa. Adding
  // a new tool with a one-sided callback (or removing one half of an
  // existing pair without removing the other) fails the build here
  // instead of silently diverging at runtime when the read side and
  // the write side drift apart.
  it("every tool with extractStyleFromElement has applyStyleToElement (and vice versa)", () => {
    for (const [id, entry] of Object.entries(TOOL_REGISTRY)) {
      if (entry.extractStyleFromElement) {
        expect(
          entry.applyStyleToElement,
          `${id}: extractStyleFromElement defined but applyStyleToElement missing`,
        ).toBeDefined();
      }
      if (entry.applyStyleToElement) {
        expect(
          entry.extractStyleFromElement,
          `${id}: applyStyleToElement defined but extractStyleFromElement missing`,
        ).toBeDefined();
      }
    }
  });
});

describe("normalizeVariantSideFields", () => {
  it("non-arrow tool ids are no-ops", () => {
    const preset = emptyPreset();
    preset.arrowHeadStart = "triangle";
    normalizeVariantSideFields("shape", "rect", preset);
    expect(preset.arrowHeadStart).toBe("triangle");
  });

  it("arrow.none forces both ends to none", () => {
    const preset = emptyPreset();
    preset.arrowHeadStart = "diamond";
    preset.arrowHeadEnd = "stealth";
    normalizeVariantSideFields("arrow", "none", preset);
    expect(preset.arrowHeadStart).toBe("none");
    expect(preset.arrowHeadEnd).toBe("none");
  });

  it("arrow.end forces start=none, defaults end=triangle when absent", () => {
    const preset = emptyPreset();
    normalizeVariantSideFields("arrow", "end", preset);
    expect(preset.arrowHeadStart).toBe("none");
    expect(preset.arrowHeadEnd).toBe("triangle");
  });

  it("arrow.both preserves valid per-end values; defaults invalid to triangle", () => {
    const preset = emptyPreset();
    preset.arrowHeadStart = "none";
    preset.arrowHeadEnd = "diamond";
    normalizeVariantSideFields("arrow", "both", preset);
    expect(preset.arrowHeadStart).toBe("triangle");
    expect(preset.arrowHeadEnd).toBe("diamond");
  });
});
