/**
 * @vitest-environment happy-dom
 *
 * Toolbar preset helpers — `mergePresetForVariantChange` and
 * `validatePresetForTool` are pure (no DOM in their bodies); the
 * happy-dom env is only here so the surrounding `applyPresetStyleAttrs`
 * suite can grow alongside without env mismatches.
 */

import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { describe, expect, it } from "vitest";
import { mergePresetForVariantChange, validatePresetForTool } from "./toolbar-preset-helpers.js";

/** Minimal full ToolOptions object — every field required at the
 *  type level gets a sensible default so test fixtures can spread
 *  over only what they care about. */
function makeOptions(overrides: Partial<ToolOptions> = {}): ToolOptions {
  return {
    strokeColor: "#000000",
    fillColor: "#ffffff",
    strokeWidth: 1,
    fontSize: 16,
    strokeDasharray: "",
    fillOpacity: 1,
    ...overrides,
  };
}

const baseArrow: ToolOptions = makeOptions({
  strokeColor: "#ff0000",
  strokeWidth: 2,
  arrowHead: "end",
  arrowHeadStart: "none",
  arrowHeadEnd: "triangle",
});

describe("mergePresetForVariantChange — current → variant", () => {
  it("seeds from currentPreset when no stored preset exists, overwriting the variant field", () => {
    const out = mergePresetForVariantChange(baseArrow, undefined, "arrow", "both");
    expect(out.arrowHead).toBe("both");
    // Style fields carry over from current.
    expect(out.strokeColor).toBe("#ff0000");
    expect(out.strokeWidth).toBe(2);
    // The mutation does not leak back into the input.
    expect(baseArrow.arrowHead).toBe("end");
  });

  it("seeds from storedPreset when one exists, ignoring currentPreset's style", () => {
    const stored = makeOptions({
      strokeColor: "#0000ff",
      strokeWidth: 5,
      arrowHead: "both",
      arrowHeadStart: "diamond",
      arrowHeadEnd: "diamond",
    });
    const out = mergePresetForVariantChange(baseArrow, stored, "arrow", "both");
    expect(out.strokeColor).toBe("#0000ff"); // from stored, not from current
    expect(out.strokeWidth).toBe(5);
    expect(out.arrowHeadStart).toBe("diamond");
  });

  it("forces the variant-defining field even when stored disagrees", () => {
    // Stored preset claims arrowHead=end but we're switching to none.
    const stored = { ...baseArrow, arrowHead: "end" } as ToolOptions;
    const out = mergePresetForVariantChange(baseArrow, stored, "arrow", "none");
    expect(out.arrowHead).toBe("none");
  });

  it("normalises arrow side fields after switching to 'none'", () => {
    const stored: ToolOptions = {
      ...baseArrow,
      arrowHead: "both",
      arrowHeadStart: "triangle",
      arrowHeadEnd: "diamond",
    } as ToolOptions;
    const out = mergePresetForVariantChange(baseArrow, stored, "arrow", "none");
    expect(out.arrowHeadStart).toBe("none");
    expect(out.arrowHeadEnd).toBe("none");
  });

  it("normalises arrow side fields after switching to 'end'", () => {
    const stored: ToolOptions = {
      ...baseArrow,
      arrowHead: "none",
      arrowHeadStart: "none",
      arrowHeadEnd: "none",
    } as ToolOptions;
    const out = mergePresetForVariantChange(baseArrow, stored, "arrow", "end");
    expect(out.arrowHeadStart).toBe("none");
    expect(out.arrowHeadEnd).toBe("triangle"); // seeded with the canonical default
  });

  it("preserves a valid 'end' shape when switching from 'end' to 'both'", () => {
    const stored: ToolOptions = {
      ...baseArrow,
      arrowHead: "end",
      arrowHeadStart: "none",
      arrowHeadEnd: "diamond",
    } as ToolOptions;
    const out = mergePresetForVariantChange(baseArrow, stored, "arrow", "both");
    // 'both' requires a non-"none" start; we seed triangle.
    expect(out.arrowHeadStart).toBe("triangle");
    // Existing 'end' shape (diamond) is preserved.
    expect(out.arrowHeadEnd).toBe("diamond");
  });

  it("returns a copy (not the same reference) so callers can mutate freely", () => {
    const out = mergePresetForVariantChange(baseArrow, undefined, "arrow", "both");
    expect(out).not.toBe(baseArrow);
  });

  it("returns a copy of currentPreset for tools without variants", () => {
    const out = mergePresetForVariantChange(baseArrow, undefined, "crop", "anything");
    expect(out).toEqual(baseArrow);
    expect(out).not.toBe(baseArrow);
  });

  it("seeds from current when 'shape' switches to 'rounded' for the first time", () => {
    const current = makeOptions({ strokeColor: "#00ff00", shapeType: "rect" });
    const out = mergePresetForVariantChange(current, undefined, "shape", "rounded");
    expect(out.shapeType).toBe("rounded");
    expect(out.strokeColor).toBe("#00ff00");
  });
});

describe("validatePresetForTool", () => {
  it("returns no errors for a clean arrow preset (variant=end, end=triangle)", () => {
    expect(validatePresetForTool(baseArrow, "arrow")).toEqual([]);
  });

  it("returns no errors for tools without a variant catalogue", () => {
    expect(validatePresetForTool(baseArrow, "crop")).toEqual([]);
  });

  it("flags an unknown variant value", () => {
    const bad: ToolOptions = { ...baseArrow, arrowHead: "futureKind" as never };
    const errs = validatePresetForTool(bad, "arrow");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/futureKind/);
  });

  it("flags arrow.variant=none with non-none side shapes", () => {
    const bad: ToolOptions = {
      ...baseArrow,
      arrowHead: "none",
      arrowHeadStart: "triangle",
      arrowHeadEnd: "triangle",
    } as ToolOptions;
    const errs = validatePresetForTool(bad, "arrow");
    expect(errs).toHaveLength(2);
    expect(errs.join(" ")).toMatch(/arrowHeadStart=none/);
    expect(errs.join(" ")).toMatch(/arrowHeadEnd=none/);
  });

  it("flags arrow.variant=end with start != none", () => {
    const bad: ToolOptions = {
      ...baseArrow,
      arrowHead: "end",
      arrowHeadStart: "diamond",
      arrowHeadEnd: "triangle",
    } as ToolOptions;
    const errs = validatePresetForTool(bad, "arrow");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/arrowHeadStart=none/);
  });

  it("flags arrow.variant=end with end == none", () => {
    const bad: ToolOptions = {
      ...baseArrow,
      arrowHead: "end",
      arrowHeadStart: "none",
      arrowHeadEnd: "none",
    } as ToolOptions;
    const errs = validatePresetForTool(bad, "arrow");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/arrowHeadEnd!=none/);
  });

  it("flags arrow.variant=both with either side == none", () => {
    const bad: ToolOptions = {
      ...baseArrow,
      arrowHead: "both",
      arrowHeadStart: "none",
      arrowHeadEnd: "none",
    } as ToolOptions;
    const errs = validatePresetForTool(bad, "arrow");
    expect(errs).toHaveLength(2);
  });
});
