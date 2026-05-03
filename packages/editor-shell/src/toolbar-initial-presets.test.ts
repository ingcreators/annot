/**
 * Toolbar initial-preset map. Pure helper — no DOM required, but the
 * happy-dom env keeps the test file consistent with its sibling
 * `toolbar-preset-helpers.test.ts`.
 *
 * @vitest-environment happy-dom
 */

import { HIGHLIGHT_COLORS, TOOL_REGISTRY } from "@ingcreators/annot-core/editor";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { describe, expect, it } from "vitest";
import { buildInitialPresets } from "./toolbar-initial-presets.js";

/** Mirror of the global defaults the live Toolbar constructor seeds
 *  into `#options`. Values pulled from `core/utils/constants.ts` so
 *  the fixture stays in sync with production. */
function makeGlobalDefaults(): ToolOptions {
  return {
    strokeColor: "#ff0000",
    fillColor: "none",
    strokeWidth: 3,
    fontSize: 24,
    strokeDasharray: "",
    fillOpacity: 1.0,
  };
}

describe("buildInitialPresets", () => {
  it("seeds the highlight default variant with yellow + 0.4 opacity + no stroke", () => {
    const presets = buildInitialPresets(makeGlobalDefaults());
    const defaultHl = TOOL_REGISTRY.highlight!.defaultVariant!;
    const hl = presets.get(`highlight.${defaultHl}`);
    expect(hl).toBeDefined();
    expect(hl!.shapeType).toBe("highlight");
    expect(hl!.highlightColor).toBe(defaultHl);
    expect(hl!.fillOpacity).toBe(0.4);
    expect(hl!.strokeColor).toBe("none");
    expect(hl!.strokeWidth).toBe(0);
  });

  it("seeds the marker default variant with a visible red bg + white border (regression: invisible counter bug)", () => {
    const presets = buildInitialPresets(makeGlobalDefaults());
    const defaultM = TOOL_REGISTRY.marker!.defaultVariant!;
    const m = presets.get(`marker.${defaultM}`);
    expect(m).toBeDefined();
    // The whole point: fillColor must NOT inherit the global "none"
    // value, otherwise the counter badge paints invisible.
    expect(m!.fillColor).not.toBe("none");
    expect(m!.fillColor).toBe("#ff0000");
    // White border so the badge reads against any background.
    expect(m!.strokeColor).toBe("#ffffff");
    expect(m!.strokeWidth).toBe(1.5);
    expect(m!.markerShape).toBe(defaultM);
  });

  it("seeds arrow with a round linecap on the default variant", () => {
    const presets = buildInitialPresets(makeGlobalDefaults());
    const defaultA = TOOL_REGISTRY.arrow!.defaultVariant!;
    const a = presets.get(`arrow.${defaultA}`);
    expect(a).toBeDefined();
    expect(a!.strokeLinecap).toBe("round");
    expect(a!.arrowHead).toBe(defaultA);
  });

  it("seeds freehand pen with a round linecap (default variant)", () => {
    const presets = buildInitialPresets(makeGlobalDefaults());
    const defaultF = TOOL_REGISTRY.freehand!.defaultVariant!;
    const pen = presets.get(`freehand.${defaultF}`);
    expect(pen).toBeDefined();
    expect(pen!.strokeLinecap).toBe("round");
    expect(pen!.drawStyle).toBe(defaultF);
  });

  it("seeds freehand highlighter as a distinct semi-transparent yellow wide-stroke variant", () => {
    const presets = buildInitialPresets(makeGlobalDefaults());
    const hl = presets.get("freehand.highlighter");
    expect(hl).toBeDefined();
    expect(hl!.drawStyle).toBe("highlighter");
    expect(hl!.strokeColor).toBe(HIGHLIGHT_COLORS[0]!.value);
    expect(hl!.strokeWidth).toBe(16);
    expect(hl!.strokeOpacity).toBe(0.4);
    // Real highlighters leave squared-off ends; round would smear
    // into adjacent letters.
    expect(hl!.strokeLinecap).toBe("butt");
  });

  it("seeds all three text variants with dark grey text + 20pt font (legibility on yellow sticky bg)", () => {
    const presets = buildInitialPresets(makeGlobalDefaults());
    for (const variant of ["plain", "sticky", "callout"] as const) {
      const t = presets.get(`text.${variant}`);
      expect(t, `expected text.${variant} preset`).toBeDefined();
      // TextTool reads the text fill from `strokeColor`, not
      // `fillColor` — so the dark-text fix lives there.
      expect(t!.strokeColor).toBe("#1a1a1a");
      expect(t!.fontSize).toBe(20);
      expect(t!.textVariant).toBe(variant);
    }
  });

  it("does not seed shape / redact / crop — they rely on global defaults / per-tool fallbacks", () => {
    const presets = buildInitialPresets(makeGlobalDefaults());
    expect(presets.has("shape.rect")).toBe(false);
    expect(presets.has("shape.rounded")).toBe(false);
    expect(presets.has("shape.ellipse")).toBe(false);
    expect(presets.has("redact.solid")).toBe(false);
    expect(presets.has("redact.mosaic")).toBe(false);
    expect(presets.has("redact.blur")).toBe(false);
    expect(presets.has("crop")).toBe(false);
  });

  it("returns a fresh Map on each call (no shared mutable state)", () => {
    const a = buildInitialPresets(makeGlobalDefaults());
    const b = buildInitialPresets(makeGlobalDefaults());
    expect(a).not.toBe(b);
    // Mutating one shouldn't affect the other.
    a.delete("text.plain");
    expect(b.has("text.plain")).toBe(true);
  });

  it("preserves the global-default fields the seed doesn't override (e.g. strokeDasharray)", () => {
    const globals = makeGlobalDefaults();
    globals.strokeDasharray = "dash";
    const presets = buildInitialPresets(globals);
    // Arrow doesn't override dasharray, so the global flows through.
    const arrow = presets.get(`arrow.${TOOL_REGISTRY.arrow!.defaultVariant!}`);
    expect(arrow!.strokeDasharray).toBe("dash");
    // Highlight doesn't override dasharray either.
    const hl = presets.get(`highlight.${TOOL_REGISTRY.highlight!.defaultVariant!}`);
    expect(hl!.strokeDasharray).toBe("dash");
  });
});
