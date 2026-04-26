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

import { describe, expect, it } from "vitest";
import type { ToolOptions } from "./tool-options.js";
import { TOOL_REGISTRY, TOOL_REGISTRY_IDS } from "./tool-registry.js";

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
  "arrowSizeStart",
  "arrowSizeEnd",
  "strokeOpacity",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeGradient",
  "fillGradient",
  "highlightColor",
  "markerShape",
  "markerBorderColor",
  "markerBorderWidth",
  "markerBorderDasharray",
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
