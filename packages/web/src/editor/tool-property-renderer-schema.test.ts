/**
 * @vitest-environment happy-dom
 *
 * Phase 2 of `docs/plans/tool-property-renderer-schema.md` —
 * byte-equivalence golden snapshots between the imperative
 * `populateToolPropertyPanel` and the schema-driven
 * `populateToolPropertyPanelFromRegistry`. Both renderers consume
 * the same shared primitives (`createColorPullButton`,
 * `createNumberInput`, `createCustomSelect`, `createPropertySection`,
 * `createArrowEndsRows`); the registry-driven dispatch SHOULD produce
 * the same `pp-section` cards + `pp-row` rows + `pp-type-row` chip
 * grid the imperative cascade does today.
 *
 * One test per panel-rendering tool. Each:
 *   1. Builds a fully-populated preset fixture.
 *   2. Renders the imperative output into a fresh `<div>`.
 *   3. Renders the schema output into a fresh `<div>` (with an
 *      independent preset clone).
 *   4. Asserts `imperative.outerHTML === schema.outerHTML`.
 *
 * The `<canvas>`-coupled `ctx.canvas` is stubbed — the freehand
 * "Done drawing" button only reads `ctx.canvas.activeTool` on click,
 * which the snapshots don't trigger. Same for `handlePanelVariantChange`
 * which is a no-op stub since the tests don't simulate chip clicks.
 */

import { describe, expect, it } from "vitest";
import type { CanvasManager } from "@ingcreators/annot-editor";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";

import {
  populateToolPropertyPanel,
  type ToolPropertyRendererContext,
} from "./tool-property-renderer.js";
import { populateToolPropertyPanelFromRegistry } from "./tool-property-renderer-schema.js";

// ─── Fixtures ────────────────────────────────────────────────────────

function basePreset(): ToolOptions {
  return {
    strokeColor: "#222222",
    fillColor: "#ffaa00",
    strokeWidth: 2,
    fontSize: 16,
    strokeDasharray: "dash",
    fillOpacity: 0.6,
    strokeOpacity: 0.85,
    strokeLinecap: "round",
  };
}

function presetWith(overrides: Partial<ToolOptions>): ToolOptions {
  return { ...basePreset(), ...overrides };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface RendererFixture {
  menu: HTMLElement;
  preset: ToolOptions;
  options: ToolOptions;
  ctx: ToolPropertyRendererContext;
}

function makeFixture(initialPreset: ToolOptions): RendererFixture {
  // The renderer mutates `preset` in place; clone so the two
  // renderers don't see each other's mutations.
  const preset = deepClone(initialPreset);
  const options = deepClone(initialPreset);
  const presetMap = new Map<string, ToolOptions>();
  // Stub canvas — only `activeTool` is read, and only on a
  // freehand-done click which the snapshot tests never trigger.
  const canvas = { activeTool: null } as unknown as CanvasManager;
  const ctx: ToolPropertyRendererContext = {
    canvas,
    options,
    getCurrentPreset: (toolId) => {
      const p = presetMap.get(toolId);
      if (p) return p;
      const seeded = deepClone(preset);
      presetMap.set(toolId, seeded);
      return seeded;
    },
    saveCurrentPreset: (toolId, p) => {
      presetMap.set(toolId, p);
    },
    handlePanelVariantChange: () => {
      // Snapshot tests don't simulate variant chip clicks; the
      // imperative + schema renderers both attach this same handler
      // so its presence affects neither's outerHTML.
    },
  };
  const menu = document.createElement("div");
  menu.className = "tool-properties-menu";
  return { menu, preset, options, ctx };
}

/** Render both surfaces independently, return their outerHTML pair.
 *  Each renderer gets its own fixture + preset clone so mutations
 *  during render (default-variant seeding, etc.) don't bleed across. */
function renderBoth(toolId: string, initial: ToolOptions): {
  imperative: string;
  schema: string;
} {
  // Pre-seed each renderer's preset map identically, since both
  // renderers call `ctx.getCurrentPreset(toolId)` exactly once at
  // entry and operate on the returned object thereafter.
  const fImp = makeFixture(initial);
  populateToolPropertyPanel(toolId, fImp.menu, fImp.ctx);
  const fSch = makeFixture(initial);
  populateToolPropertyPanelFromRegistry(toolId, fSch.menu, fSch.ctx);
  return { imperative: fImp.menu.outerHTML, schema: fSch.menu.outerHTML };
}

// ─── Per-tool byte-equivalence ───────────────────────────────────────

describe("populateToolPropertyPanelFromRegistry — byte-equivalent to imperative", () => {
  it("arrow", () => {
    const initial = presetWith({
      arrowHead: "both",
      arrowHeadStart: "diamond",
      arrowHeadEnd: "triangle",
      arrowWidthStart: "md",
      arrowLengthStart: "lg",
      arrowWidthEnd: "lg",
      arrowLengthEnd: "md",
    });
    const { imperative, schema } = renderBoth("arrow", initial);
    expect(schema).toBe(imperative);
  });

  it("shape (rectangle variant)", () => {
    const initial = presetWith({ shapeType: "rect" });
    const { imperative, schema } = renderBoth("shape", initial);
    expect(schema).toBe(imperative);
  });

  it("shape (rounded variant)", () => {
    const initial = presetWith({ shapeType: "rounded" });
    const { imperative, schema } = renderBoth("shape", initial);
    expect(schema).toBe(imperative);
  });

  it("shape (ellipse variant, fill = none)", () => {
    const initial = presetWith({ shapeType: "ellipse", fillColor: "none" });
    const { imperative, schema } = renderBoth("shape", initial);
    expect(schema).toBe(imperative);
  });

  it("highlight (default color)", () => {
    const initial = presetWith({ highlightColor: "#ffe100", fillOpacity: 0.4 });
    const { imperative, schema } = renderBoth("highlight", initial);
    expect(schema).toBe(imperative);
  });

  it("highlight (alternate color + transparency)", () => {
    const initial = presetWith({ highlightColor: "#ff8a8a", fillOpacity: 0.55 });
    const { imperative, schema } = renderBoth("highlight", initial);
    expect(schema).toBe(imperative);
  });

  it("text (sticky variant)", () => {
    const initial = presetWith({ textVariant: "sticky", fontFamily: "serif" });
    const { imperative, schema } = renderBoth("text", initial);
    expect(schema).toBe(imperative);
  });

  it("text (callout variant)", () => {
    const initial = presetWith({
      textVariant: "callout",
      fontFamily: "monospace",
      fontSize: 24,
    });
    const { imperative, schema } = renderBoth("text", initial);
    expect(schema).toBe(imperative);
  });

  it("freehand (pen variant)", () => {
    const initial = presetWith({ drawStyle: "pen" });
    const { imperative, schema } = renderBoth("freehand", initial);
    expect(schema).toBe(imperative);
  });

  it("freehand (highlighter variant)", () => {
    const initial = presetWith({ drawStyle: "highlighter" });
    const { imperative, schema } = renderBoth("freehand", initial);
    expect(schema).toBe(imperative);
  });

  it("marker (circle variant)", () => {
    const initial = presetWith({ markerShape: "circle" });
    const { imperative, schema } = renderBoth("marker", initial);
    expect(schema).toBe(imperative);
  });

  it("marker (rounded variant + no fill)", () => {
    const initial = presetWith({ markerShape: "rounded", fillColor: "none" });
    const { imperative, schema } = renderBoth("marker", initial);
    expect(schema).toBe(imperative);
  });

  it("redact (mosaic — no Fill section)", () => {
    const initial = presetWith({ redactStyle: "mosaic" });
    const { imperative, schema } = renderBoth("redact", initial);
    expect(schema).toBe(imperative);
  });

  it("redact (solid — Fill section appears)", () => {
    const initial = presetWith({ redactStyle: "solid", fillColor: "#222222" });
    const { imperative, schema } = renderBoth("redact", initial);
    expect(schema).toBe(imperative);
  });

  it("redact (blur — no Fill section)", () => {
    const initial = presetWith({ redactStyle: "blur" });
    const { imperative, schema } = renderBoth("redact", initial);
    expect(schema).toBe(imperative);
  });
});

describe("populateToolPropertyPanelFromRegistry — fresh preset (default-variant seeding)", () => {
  // The imperative renderer seeds defaults inline (`if (!preset.shapeType)
  // preset.shapeType = "rect"` etc.) before rendering the Type chip
  // row; the schema renderer's `seedDefaultVariantIfNeeded` mirrors
  // that. Cover the UNSET case for every variant-bearing tool so a
  // regression in the seed path surfaces here.

  function strippedPreset(): ToolOptions {
    return {
      strokeColor: "#000000",
      fillColor: "#ffffff",
      strokeWidth: 1,
      fontSize: 14,
      strokeDasharray: "",
      fillOpacity: 1,
    };
  }

  it("arrow seeds arrowHead = end", () => {
    const { imperative, schema } = renderBoth("arrow", strippedPreset());
    expect(schema).toBe(imperative);
  });

  it("shape seeds shapeType = rect", () => {
    const { imperative, schema } = renderBoth("shape", strippedPreset());
    expect(schema).toBe(imperative);
  });

  it("highlight uses the first palette entry by default", () => {
    const { imperative, schema } = renderBoth("highlight", strippedPreset());
    expect(schema).toBe(imperative);
  });

  it("text seeds textVariant = sticky", () => {
    const { imperative, schema } = renderBoth("text", strippedPreset());
    expect(schema).toBe(imperative);
  });

  it("freehand seeds drawStyle = pen", () => {
    const { imperative, schema } = renderBoth("freehand", strippedPreset());
    expect(schema).toBe(imperative);
  });

  it("marker seeds markerShape = circle", () => {
    const { imperative, schema } = renderBoth("marker", strippedPreset());
    expect(schema).toBe(imperative);
  });

  it("redact seeds redactStyle = mosaic", () => {
    const { imperative, schema } = renderBoth("redact", strippedPreset());
    expect(schema).toBe(imperative);
  });
});

describe("populateToolPropertyPanelFromRegistry — empty / no-op cases", () => {
  it("produces an empty menu for tools without panelControls (crop)", () => {
    const f = makeFixture(basePreset());
    populateToolPropertyPanelFromRegistry("crop", f.menu, f.ctx);
    expect(f.menu.children.length).toBe(0);
  });

  it("produces an empty menu for unknown toolIds", () => {
    const f = makeFixture(basePreset());
    populateToolPropertyPanelFromRegistry("nonexistent-tool", f.menu, f.ctx);
    expect(f.menu.children.length).toBe(0);
  });
});
