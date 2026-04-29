/**
 * @vitest-environment happy-dom
 *
 * Regression test for the user-reported "clicking Yellow makes it
 * Pink" bug in the Selected Highlight TYPE picker.
 *
 * ## Root cause
 *
 * The pre-per-color Highlight tool stored a single `"highlight"`
 * preset whose value's `highlightColor` reflected whatever color the
 * user last drew. When the per-color preset scheme landed,
 * `migrateLegacyPresetKey` started appending the tool's
 * `defaultVariant` to legacy keys — so a stored preset under key
 * `"highlight"` with `highlightColor: "#ff91e0"` (Pink) gets
 * re-keyed as `"highlight.#ffe100"` (Yellow) without updating the
 * value's variant field. The result: a preset whose key claims
 * Yellow but whose payload says Pink.
 *
 * Then on a Selected Highlight TYPE-picker click:
 *   1. setValue writes el.fill = clicked-color (Yellow) ✓
 *   2. applyElementVariantPreset looks up the
 *      Yellow-keyed preset, finds the Pink payload, and applies its
 *      `highlightColor` (Pink) back to the element ✗
 *
 * ## Fix
 *
 * `healPresetVariantField` is now invoked at every load-from-storage
 * site AND inside `applyElementVariantPreset` itself, so the
 * value's variant field gets rewritten to match its key the first
 * time the corrupt preset is touched. The persisted preset is
 * resaved with consistent state.
 */

import { TOOL_REGISTRY } from "@ingcreators/annot-core/editor/tool-registry";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { describe, expect, it } from "vitest";
import {
  applyPresetStyleAttrs,
  healPresetVariantField,
  migrateLegacyPresetKey,
  seedPresetFromElement,
} from "./toolbar-preset-helpers.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeHighlightRect(fill: string): SVGRectElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  document.body.appendChild(svg);
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("data-highlight", "1");
  rect.setAttribute("fill", fill);
  rect.setAttribute("fill-opacity", "0.4");
  svg.appendChild(rect);
  return rect;
}

function makeOptions(overrides: Partial<ToolOptions> = {}): ToolOptions {
  return {
    strokeColor: "#000000",
    fillColor: "#ffffff",
    strokeWidth: 1,
    fontSize: 16,
    strokeDasharray: "",
    fillOpacity: 0.4,
    ...overrides,
  };
}

describe("healPresetVariantField", () => {
  it("rewrites the variant field when it disagrees with the key", () => {
    const preset = makeOptions({ highlightColor: "#ff91e0" }); // Pink
    const changed = healPresetVariantField(preset, "highlight", "highlight.#ffe100");
    expect(changed).toBe(true);
    expect(preset.highlightColor).toBe("#ffe100"); // Yellow now
  });

  it("returns false when key and value already agree", () => {
    const preset = makeOptions({ highlightColor: "#ffe100" });
    const changed = healPresetVariantField(preset, "highlight", "highlight.#ffe100");
    expect(changed).toBe(false);
    expect(preset.highlightColor).toBe("#ffe100");
  });

  it("is a no-op for keys without a `.<variant>` segment", () => {
    const preset = makeOptions({ highlightColor: "#ff91e0" });
    const changed = healPresetVariantField(preset, "highlight", "highlight");
    expect(changed).toBe(false);
    expect(preset.highlightColor).toBe("#ff91e0");
  });

  it("is a no-op for tools without a variantField (e.g. crop)", () => {
    const preset = makeOptions();
    const changed = healPresetVariantField(preset, "crop", "crop.something");
    expect(changed).toBe(false);
  });

  it("works for arrow / shape too — same single-source-of-truth invariant", () => {
    const arrow = makeOptions({ arrowHead: "end" });
    expect(healPresetVariantField(arrow, "arrow", "arrow.both")).toBe(true);
    expect(arrow.arrowHead).toBe("both");

    const shape = makeOptions({ shapeType: "rect" });
    expect(healPresetVariantField(shape, "shape", "shape.ellipse")).toBe(true);
    expect(shape.shapeType).toBe("ellipse");
  });
});

describe("Highlight legacy-preset migration corruption (regression)", () => {
  it("migrateLegacyPresetKey appends defaultVariant — and the value needs healing alongside", () => {
    const newKey = migrateLegacyPresetKey("highlight");
    expect(newKey).toBe(`highlight.${TOOL_REGISTRY.highlight!.defaultVariant}`);
    expect(newKey).toBe("highlight.#ffe100");
  });

  it("FIXED: clicking Yellow on Pink highlight applies Yellow even with corrupt preset (post-heal)", () => {
    // Set up: a corrupt preset under the Yellow key carrying a Pink
    // payload — exactly what legacy-migration produced for users who
    // last drew a Pink highlight before the per-color scheme landed.
    const presets = new Map<string, ToolOptions>();
    presets.set(
      "highlight.#ffe100",
      makeOptions({
        highlightColor: "#ff91e0", // Pink — the corruption
        fillOpacity: 0.4,
      }),
    );

    // Heal the loaded preset (mirrors what the load paths now do).
    const healed = healPresetVariantField(
      presets.get("highlight.#ffe100")!,
      "highlight",
      "highlight.#ffe100",
    );
    expect(healed).toBe(true);
    expect(presets.get("highlight.#ffe100")!.highlightColor).toBe("#ffe100");

    // User clicks Yellow chip on a Pink-on-canvas highlight.
    const rect = makeHighlightRect("#ff91e0");
    rect.setAttribute("fill", "#ffe100"); // setValue from the renderer

    // applyElementVariantPreset → applies the now-healed preset.
    applyPresetStyleAttrs(rect, presets.get("highlight.#ffe100")!);
    expect(rect.getAttribute("fill")).toBe("#ffe100"); // Yellow ✓
  });

  it("FIXED: applyElementVariantPreset's inline heal also catches corruption that slipped past load-time", () => {
    // Simulate the in-toolbar branch where the preset is fetched
    // from #presets and healed in place before applying. This
    // covers presets that were saved BEFORE the load-time heal
    // landed — they get corrected on the first variant-pick.
    const corrupt = makeOptions({ highlightColor: "#ff91e0" }); // Pink
    healPresetVariantField(corrupt, "highlight", "highlight.#ffe100");

    const rect = makeHighlightRect("#ff91e0");
    rect.setAttribute("fill", "#ffe100");
    applyPresetStyleAttrs(rect, corrupt);
    expect(rect.getAttribute("fill")).toBe("#ffe100"); // Yellow ✓
  });
});

describe("Highlight TYPE picker — fresh seed path stays correct", () => {
  it("first-time Yellow click on Pink highlight → seed produces Yellow preset", () => {
    const rect = makeHighlightRect("#ff91e0");
    rect.setAttribute("fill", "#ffe100"); // setValue
    const seed = seedPresetFromElement(
      rect,
      "highlight",
      "highlight.#ffe100",
      makeOptions({ highlightColor: "#ff91e0" }),
    );
    expect(seed.highlightColor).toBe("#ffe100");
    applyPresetStyleAttrs(rect, seed);
    expect(rect.getAttribute("fill")).toBe("#ffe100");
  });
});
