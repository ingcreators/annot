// Phase 1 of `docs/plans/tool-property-renderer-schema.md` —
// shape-invariant tests for the Tool-side adapter registry. The
// renderer (Phase 2) is the first reader; today these tests exist
// to pin the data so a regression in any of:
//   - "every Tool-only id has an adapter"
//   - "every id used in panelControls has an adapter"
//   - "round-trip is a no-op against a fully-populated preset"
// surfaces immediately rather than waiting for a Phase 2 PR.
//
// Default `node` environment: pure data + closures over `ToolOptions`
// and `toolId`. No Element / DOM access at all.

import { describe, expect, it } from "vitest";
import { PROPERTY_CONTROL_IDS, PROPERTY_CONTROLS } from "./property-schema.js";
import type { ToolOptions } from "./tool-options.js";
import {
  selectionDefMetadata,
  TOOL_PANEL_ADAPTER_IDS,
  TOOL_PANEL_ADAPTERS,
  type ToolPanelAdapterId,
} from "./tool-panel-adapter.js";
import { TOOL_PANEL_EXTRA_CONTROL_IDS, TOOL_REGISTRY } from "./tool-registry.js";

/** A fully-populated `ToolOptions` covering every field the adapter
 *  registry might read. Round-trip tests use this so reads return
 *  concrete values (not the adapters' fallback paths) and writes hit
 *  fields that already exist on the preset. */
function fullyPopulatedPreset(): ToolOptions {
  return {
    strokeColor: "#123456",
    fillColor: "#abcdef",
    strokeWidth: 2.75,
    fontSize: 18,
    strokeDasharray: "dash",
    fillOpacity: 0.6,
    shapeType: "rounded",
    arrowHead: "both",
    textVariant: "callout",
    fontFamily: "serif",
    drawStyle: "highlighter",
    redactStyle: "blur",
    arrowHeadStart: "diamond",
    arrowHeadEnd: "stealth",
    arrowWidthStart: "sm",
    arrowWidthEnd: "lg",
    arrowLengthStart: "lg",
    arrowLengthEnd: "sm",
    strokeOpacity: 0.7,
    strokeLinecap: "round",
    strokeLinejoin: "miter",
    highlightColor: "#ffe100",
    markerShape: "rounded",
  };
}

/** Minimal preset for sanity tests that don't exercise every field. */
function minimalPreset(): ToolOptions {
  return {
    strokeColor: "#000",
    fillColor: "#fff",
    strokeWidth: 1,
    fontSize: 12,
    strokeDasharray: "",
    fillOpacity: 1,
  };
}

/** Round-trip a single adapter: write(preset, read(preset)) must
 *  leave subsequent reads stable. We also pin the read value's
 *  basic type when meaningful (number / string / null), which
 *  catches accidental "stringification of a number" regressions. */
function expectAdapterRoundTrip(id: ToolPanelAdapterId, toolId: string): void {
  const adapter = TOOL_PANEL_ADAPTERS[id];
  expect(adapter, `no adapter for id "${id}"`).toBeDefined();
  if (!adapter) return;
  const preset = fullyPopulatedPreset();
  const before = adapter.read(preset, toolId);
  adapter.write(preset, before, toolId);
  const after = adapter.read(preset, toolId);
  expect(after, `round-trip for "${id}" (toolId="${toolId}")`).toEqual(before);
}

describe("TOOL_PANEL_ADAPTERS — coverage invariants", () => {
  it("every ToolPanelExtraControlId has a registered adapter", () => {
    for (const id of TOOL_PANEL_EXTRA_CONTROL_IDS) {
      expect(
        TOOL_PANEL_ADAPTERS[id],
        `extra id "${id}" must have an adapter in TOOL_PANEL_ADAPTERS`,
      ).toBeDefined();
    }
  });

  it("every id referenced by a tool's panelControls has a registered adapter", () => {
    for (const [toolId, entry] of Object.entries(TOOL_REGISTRY)) {
      for (const def of entry.panelControls ?? []) {
        expect(
          TOOL_PANEL_ADAPTERS[def.id],
          `${toolId}.panelControls references id "${String(def.id)}", which has no adapter`,
        ).toBeDefined();
      }
    }
  });

  it("TOOL_PANEL_ADAPTER_IDS lists every key in TOOL_PANEL_ADAPTERS", () => {
    // Both directions: catch a missed Phase-2 addition where an
    // adapter is added to TOOL_PANEL_ADAPTERS but not appended to
    // TOOL_PANEL_ADAPTER_IDS (or vice versa).
    const declared = new Set<string>(TOOL_PANEL_ADAPTER_IDS);
    const registered = new Set(Object.keys(TOOL_PANEL_ADAPTERS));
    for (const id of declared) {
      expect(registered.has(id), `declared id "${id}" missing from TOOL_PANEL_ADAPTERS`).toBe(true);
    }
    for (const id of registered) {
      expect(
        declared.has(id),
        `registered adapter "${id}" missing from TOOL_PANEL_ADAPTER_IDS`,
      ).toBe(true);
    }
  });
});

describe("TOOL_PANEL_ADAPTERS — round-trip per adapter", () => {
  it("every adapter is read/write stable against a populated preset", () => {
    // For most adapters the toolId argument is ignored, so any non-
    // empty stringly value does. `tool.typeChips` IS toolId-sensitive
    // — the dedicated test below exercises it across every
    // panel-rendering tool.
    for (const id of TOOL_PANEL_ADAPTER_IDS) {
      if (id === "tool.typeChips") continue;
      expectAdapterRoundTrip(id, "shape");
    }
  });

  it("tool.typeChips round-trips for every variant-bearing tool", () => {
    // The variant field varies per tool; covering them all pins the
    // dynamic dispatch in the adapter so a typo in a registry
    // variantField surfaces here, not in Phase 2 rendering.
    for (const toolId of Object.keys(TOOL_REGISTRY)) {
      const entry = TOOL_REGISTRY[toolId];
      if (!entry?.variantField) continue;
      expectAdapterRoundTrip("tool.typeChips", toolId);
    }
  });

  it("tool.freehandDone is a stable no-op (read=null, write ignores)", () => {
    const adapter = TOOL_PANEL_ADAPTERS["tool.freehandDone"]!;
    const preset = fullyPopulatedPreset();
    const snapshot = JSON.stringify(preset);
    expect(adapter.read(preset, "freehand")).toBeNull();
    adapter.write(preset, null, "freehand");
    expect(JSON.stringify(preset), "freehandDone.write must not mutate preset").toBe(snapshot);
  });
});

describe("TOOL_PANEL_ADAPTERS — value semantics spot-checks", () => {
  // Pin the exact percent ↔ opacity conversions the adapters use, so
  // a regression in the Phase 2 renderer that mis-routes the three
  // transparency / opacity ids (each writes a different field /
  // direction) shows up here.

  it("tool.transparencyPercent is the inverse of strokeOpacity", () => {
    const adapter = TOOL_PANEL_ADAPTERS["tool.transparencyPercent"]!;
    const preset = minimalPreset();
    preset.strokeOpacity = 0.4;
    expect(adapter.read(preset, "shape")).toBe(60); // 1 - 0.4 = 60%
    adapter.write(preset, 25, "shape");
    expect(preset.strokeOpacity).toBeCloseTo(0.75, 5); // 1 - 25/100
  });

  it("tool.fillTransparencyPercent is the inverse of fillOpacity", () => {
    const adapter = TOOL_PANEL_ADAPTERS["tool.fillTransparencyPercent"]!;
    const preset = minimalPreset();
    preset.fillOpacity = 0.4;
    expect(adapter.read(preset, "highlight")).toBe(60); // 1 - 0.4 = 60%
    adapter.write(preset, 80, "highlight");
    expect(preset.fillOpacity).toBeCloseTo(0.2, 5); // 1 - 80/100
  });

  it("tool.fillOpacityPercent is the DIRECT mapping of fillOpacity", () => {
    const adapter = TOOL_PANEL_ADAPTERS["tool.fillOpacityPercent"]!;
    const preset = minimalPreset();
    preset.fillOpacity = 0.4;
    expect(adapter.read(preset, "shape")).toBe(40); // 0.4 * 100 = 40%
    adapter.write(preset, 75, "shape");
    expect(preset.fillOpacity).toBeCloseTo(0.75, 5); // 75/100
  });

  it("arrowStartSize encodes preset.arrowWidthStart + arrowLengthStart as 'w-l'", () => {
    const adapter = TOOL_PANEL_ADAPTERS.arrowStartSize!;
    const preset = fullyPopulatedPreset();
    // From `fullyPopulatedPreset()`: arrowWidthStart="sm",
    // arrowLengthStart="lg" → "sm-lg".
    expect(adapter.read(preset, "arrow")).toBe("sm-lg");
    adapter.write(preset, "md-md", "arrow");
    expect(preset.arrowWidthStart).toBe("md");
    expect(preset.arrowLengthStart).toBe("md");
  });

  it("arrowEndSize falls back to 'md-md' when fields are missing", () => {
    const adapter = TOOL_PANEL_ADAPTERS.arrowEndSize!;
    const preset = minimalPreset();
    // No arrowWidthEnd / arrowLengthEnd set → "md-md" default.
    expect(adapter.read(preset, "arrow")).toBe("md-md");
  });

  it("tool.typeChips reads the per-tool variantField", () => {
    const adapter = TOOL_PANEL_ADAPTERS["tool.typeChips"]!;
    const preset = fullyPopulatedPreset();
    // shape.shapeType="rounded", arrow.arrowHead="both",
    // text.textVariant="callout", freehand.drawStyle="highlighter",
    // marker.markerShape="rounded", redact.redactStyle="blur",
    // highlight.highlightColor="#ffe100".
    expect(adapter.read(preset, "shape")).toBe("rounded");
    expect(adapter.read(preset, "arrow")).toBe("both");
    expect(adapter.read(preset, "text")).toBe("callout");
    expect(adapter.read(preset, "freehand")).toBe("highlighter");
    expect(adapter.read(preset, "marker")).toBe("rounded");
    expect(adapter.read(preset, "redact")).toBe("blur");
    expect(adapter.read(preset, "highlight")).toBe("#ffe100");
  });

  it("tool.typeChips write routes value to the per-tool variantField", () => {
    const adapter = TOOL_PANEL_ADAPTERS["tool.typeChips"]!;
    const preset = minimalPreset();
    adapter.write(preset, "ellipse", "shape");
    expect(preset.shapeType).toBe("ellipse");
    adapter.write(preset, "none", "arrow");
    expect(preset.arrowHead).toBe("none");
    adapter.write(preset, "pen", "freehand");
    expect(preset.drawStyle).toBe("pen");
  });

  it("tool.typeChips is a no-op for tools without a variantField (crop)", () => {
    const adapter = TOOL_PANEL_ADAPTERS["tool.typeChips"]!;
    const preset = minimalPreset();
    const snapshot = JSON.stringify(preset);
    expect(adapter.read(preset, "crop")).toBeUndefined();
    adapter.write(preset, "anything", "crop");
    expect(JSON.stringify(preset)).toBe(snapshot);
  });
});

describe("TOOL_REGISTRY.panelControls — shape invariants", () => {
  // The plan promises `panelControls` is populated for ALL 7 panel-
  // rendering tools (everything except crop). Pin this so a future
  // edit can't silently drop the field for one tool and break the
  // schema-driven renderer's input.

  it("every tool except crop has a non-empty panelControls array", () => {
    for (const [toolId, entry] of Object.entries(TOOL_REGISTRY)) {
      if (toolId === "crop") {
        expect(entry.panelControls, "crop has no side panel").toBeUndefined();
        continue;
      }
      expect(entry.panelControls, `${toolId}.panelControls must be defined`).toBeDefined();
      expect(
        (entry.panelControls ?? []).length,
        `${toolId}.panelControls must be non-empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("every panelControls entry's section is one of Type / Fill / Line / Label", () => {
    const allowed = new Set(["Type", "Fill", "Line", "Label"]);
    for (const [toolId, entry] of Object.entries(TOOL_REGISTRY)) {
      for (const def of entry.panelControls ?? []) {
        expect(
          allowed.has(def.section),
          `${toolId}.panelControls has invalid section "${def.section}"`,
        ).toBe(true);
      }
    }
  });

  it("every variant-bearing tool's panelControls leads with a Type entry", () => {
    // The Type chip row is rendered as the first pp-section for every
    // tool with a variant flyout (matches the imperative renderer's
    // ordering). A regression here would reorder the panel.
    for (const [toolId, entry] of Object.entries(TOOL_REGISTRY)) {
      if (!entry.variantField) continue;
      const first = entry.panelControls?.[0];
      expect(first, `${toolId}.panelControls must start with a Type entry`).toBeDefined();
      expect(first?.section, `${toolId}.panelControls[0].section`).toBe("Type");
    }
  });
});

describe("selectionDefMetadata — Tool ↔ SELECTION metadata bridge", () => {
  // Phase 4 of `tool-property-renderer-schema.md` makes
  // `PROPERTY_CONTROLS` the single source of truth for option arrays
  // (dash / cap / font), labels, ranges, and the color-picker
  // `allowNone` flag. These tests pin the bridge so a regression in
  // either side surfaces here, not as a UI drift.

  it("returns null for adapters without a selectionDef (Tool-only ids)", () => {
    // `tool.typeChips` / `tool.freehandDone` / `tool.fillOpacityPercent`
    // declare `selectionDef: null` because they have no SELECTION-
    // side analogue. Renderers fall back to per-id hardcoded metadata
    // when this returns null.
    expect(selectionDefMetadata("tool.typeChips")).toBeNull();
    expect(selectionDefMetadata("tool.freehandDone")).toBeNull();
    expect(selectionDefMetadata("tool.fillOpacityPercent")).toBeNull();
  });

  it("strokeStyle: pulls the dash option list from PROPERTY_CONTROLS", () => {
    const meta = selectionDefMetadata(PROPERTY_CONTROL_IDS.strokeStyle);
    expect(meta).not.toBeNull();
    const expectedValues = (PROPERTY_CONTROLS.strokeStyle.options ?? []).map((o) => o.value);
    const actualValues = (meta?.options ?? []).map((o) => o.value);
    expect(actualValues).toEqual(expectedValues);
  });

  it("strokeLinecap: pulls the cap option list from PROPERTY_CONTROLS", () => {
    const meta = selectionDefMetadata(PROPERTY_CONTROL_IDS.strokeLinecap);
    const expectedValues = (PROPERTY_CONTROLS.strokeLinecap.options ?? []).map((o) => o.value);
    const actualValues = (meta?.options ?? []).map((o) => o.value);
    expect(actualValues).toEqual(expectedValues);
  });

  it("fontFamily: pulls the font option list from PROPERTY_CONTROLS", () => {
    const meta = selectionDefMetadata(PROPERTY_CONTROL_IDS.fontFamily);
    const expectedValues = (PROPERTY_CONTROLS.fontFamily.options ?? []).map((o) => o.value);
    const actualValues = (meta?.options ?? []).map((o) => o.value);
    expect(actualValues).toEqual(expectedValues);
  });

  it("strokeWidth: pulls min / step / unit / label from PROPERTY_CONTROLS", () => {
    // Tool overrides `max` per tool (40 for shape/arrow/freehand, 20
    // for marker — both narrower than SELECTION's 200). Min / step /
    // unit / label flow through unchanged.
    const meta = selectionDefMetadata(PROPERTY_CONTROL_IDS.strokeWidth);
    expect(meta?.label).toBe(PROPERTY_CONTROLS.strokeWidth.label);
    expect(meta?.min).toBe(PROPERTY_CONTROLS.strokeWidth.min);
    expect(meta?.step).toBe(PROPERTY_CONTROLS.strokeWidth.step);
    expect(meta?.unit).toBe(PROPERTY_CONTROLS.strokeWidth.unit);
  });

  it("fontSize: pulls min / step / unit / label from PROPERTY_CONTROLS", () => {
    const meta = selectionDefMetadata(PROPERTY_CONTROL_IDS.fontSize);
    expect(meta?.label).toBe(PROPERTY_CONTROLS.fontSize.label);
    expect(meta?.min).toBe(PROPERTY_CONTROLS.fontSize.min);
    expect(meta?.step).toBe(PROPERTY_CONTROLS.fontSize.step);
    expect(meta?.unit).toBe(PROPERTY_CONTROLS.fontSize.unit);
  });

  it("fillColor: pulls allowNone + label from PROPERTY_CONTROLS", () => {
    const meta = selectionDefMetadata(PROPERTY_CONTROL_IDS.fillColor);
    expect(meta?.label).toBe(PROPERTY_CONTROLS.fillColor.label);
    expect(meta?.allowNone).toBe(PROPERTY_CONTROLS.fillColor.allowNone);
  });

  it("transparency adapters reuse the SELECTION fillOpacity / strokeOpacity defs", () => {
    const stroke = selectionDefMetadata("tool.transparencyPercent");
    expect(stroke?.label).toBe(PROPERTY_CONTROLS.strokeOpacity.label);
    expect(stroke?.unit).toBe(PROPERTY_CONTROLS.strokeOpacity.unit);
    expect(stroke?.min).toBe(PROPERTY_CONTROLS.strokeOpacity.min);
    expect(stroke?.max).toBe(PROPERTY_CONTROLS.strokeOpacity.max);
    const fill = selectionDefMetadata("tool.fillTransparencyPercent");
    expect(fill?.label).toBe(PROPERTY_CONTROLS.fillOpacity.label);
    expect(fill?.unit).toBe(PROPERTY_CONTROLS.fillOpacity.unit);
  });
});
