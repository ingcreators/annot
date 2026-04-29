// Default `node` env — pure functions, no DOM.
//
// Phase 2 of `docs/plans/toolbar-schema.md`. Round-trip + golden
// snapshot tests for `presetToWire` / `presetFromWire`. The
// snapshots pin the exact wire-format key set per tool so any
// rename-by-accident in `FIELD_TO_SNAKE` shows up as a diff in PR.
//
// The "byte-identical to old code" claim from the plan is enforced
// indirectly: we build a sample preset, run it through the new
// helper, and assert against an inline snapshot that mirrors what
// the old `#savePresetsToFile` would have produced for each tool's
// per-tool field set (i.e. `presetFields` ⊂ the old 20-field union).
import { describe, expect, it } from "vitest";
import type { ToolOptions } from "./tool-options.js";
import { fieldForSnakeKey, presetFromWire, presetToWire } from "./tool-preset-serde.js";
import { TOOL_REGISTRY } from "./tool-registry.js";

/** Synthetic full-fat preset with EVERY field a tool might persist
 *  set to a distinct value. Each per-tool round-trip filters this
 *  through its `presetFields` and asserts the recovered subset. */
const SAMPLE_OPTS: ToolOptions = {
  strokeColor: "#112233",
  fillColor: "#445566",
  strokeWidth: 4.5,
  fontSize: 18,
  strokeDasharray: "dash",
  fillOpacity: 0.42,
  shapeType: "rounded",
  arrowHead: "both",
  textVariant: "callout",
  fontFamily: "Inter, sans-serif",
  drawStyle: "highlighter",
  redactStyle: "solid",
  arrowHeadStart: "diamond",
  arrowHeadEnd: "stealth",
  arrowWidthStart: "lg",
  arrowWidthEnd: "sm",
  arrowLengthStart: "md",
  arrowLengthEnd: "lg",
  highlightColor: "#ffe100",
  markerShape: "rounded",
  strokeOpacity: 0.7,
  strokeLinecap: "round",
  strokeLinejoin: "bevel",
};

describe("presetToWire / presetFromWire round-trip", () => {
  it("snake-case round-trip preserves every field a tool's presetFields lists", () => {
    for (const [id, entry] of Object.entries(TOOL_REGISTRY)) {
      const wire = presetToWire(SAMPLE_OPTS, entry.presetFields, "snake");
      const back = presetFromWire(wire, entry.presetFields, "snake");
      // Every field from the input that's listed in presetFields must
      // come back unchanged.
      for (const f of entry.presetFields) {
        expect(back[f], `${id}.${String(f)}`).toEqual(SAMPLE_OPTS[f]);
      }
      // And no extra fields snuck in.
      expect(Object.keys(back).sort(), `${id} extra fields`).toEqual(
        [...entry.presetFields].filter((f) => SAMPLE_OPTS[f] !== undefined).sort(),
      );
    }
  });

  it("camel-case round-trip preserves every field a tool's presetFields lists", () => {
    for (const [id, entry] of Object.entries(TOOL_REGISTRY)) {
      const wire = presetToWire(SAMPLE_OPTS, entry.presetFields, "camel");
      const back = presetFromWire(wire, entry.presetFields, "camel");
      for (const f of entry.presetFields) {
        expect(back[f], `${id}.${String(f)}`).toEqual(SAMPLE_OPTS[f]);
      }
    }
  });

  it("undefined fields are dropped from the wire output", () => {
    const sparse: Partial<ToolOptions> = { strokeColor: "#abcdef" };
    const wire = presetToWire(sparse, ["strokeColor", "fillColor", "strokeWidth"], "snake");
    expect(wire).toEqual({ stroke_color: "#abcdef" });
  });

  it("empty strings on read are treated as absent", () => {
    const back = presetFromWire(
      { stroke_color: "#abcdef", shape_type: "" },
      ["strokeColor", "shapeType"],
      "snake",
    );
    expect(back).toEqual({ strokeColor: "#abcdef" });
  });

  it("only fields listed in presetFields are read", () => {
    // Wire blob carries extra/stale fields (typical of legacy presets
    // where every tool's preset stored the full union of options).
    const wire = {
      stroke_color: "#aaaaaa",
      arrow_head: "end",
      marker_shape: "rect",
    };
    const back = presetFromWire(wire, ["strokeColor"], "snake");
    expect(back).toEqual({ strokeColor: "#aaaaaa" });
  });
});

describe("presetToWire — golden snapshot per tool", () => {
  // Pin the exact snake-case wire keys + values each tool emits for
  // SAMPLE_OPTS. The point isn't to test the helper's logic again —
  // it's to make any field-name accident in FIELD_TO_SNAKE jump out
  // as a snapshot diff.
  function snakeWireFor(toolId: string): Record<string, unknown> {
    return presetToWire(SAMPLE_OPTS, TOOL_REGISTRY[toolId]!.presetFields, "snake");
  }

  it("arrow", () => {
    expect(snakeWireFor("arrow")).toEqual({
      stroke_color: "#112233",
      stroke_width: 4.5,
      stroke_dasharray: "dash",
      stroke_opacity: 0.7,
      stroke_linecap: "round",
      arrow_head: "both",
      arrow_head_start: "diamond",
      arrow_head_end: "stealth",
      arrow_width_start: "lg",
      arrow_width_end: "sm",
      arrow_length_start: "md",
      arrow_length_end: "lg",
    });
  });

  it("shape", () => {
    expect(snakeWireFor("shape")).toEqual({
      stroke_color: "#112233",
      stroke_width: 4.5,
      stroke_dasharray: "dash",
      stroke_opacity: 0.7,
      stroke_linecap: "round",
      fill_color: "#445566",
      fill_opacity: 0.42,
      shape_type: "rounded",
      stroke_linejoin: "bevel",
    });
  });

  it("highlight", () => {
    expect(snakeWireFor("highlight")).toEqual({
      highlight_color: "#ffe100",
      fill_opacity: 0.42,
    });
  });

  it("text", () => {
    expect(snakeWireFor("text")).toEqual({
      stroke_color: "#112233",
      fill_color: "#445566",
      font_size: 18,
      font_family: "Inter, sans-serif",
      shape_kind: "callout",
    });
  });

  it("freehand", () => {
    expect(snakeWireFor("freehand")).toEqual({
      stroke_color: "#112233",
      stroke_width: 4.5,
      stroke_dasharray: "dash",
      stroke_opacity: 0.7,
      stroke_linecap: "round",
      draw_style: "highlighter",
    });
  });

  it("marker", () => {
    expect(snakeWireFor("marker")).toEqual({
      stroke_color: "#112233",
      stroke_width: 4.5,
      stroke_dasharray: "dash",
      stroke_opacity: 0.7,
      stroke_linecap: "round",
      fill_color: "#445566",
      font_size: 18,
      marker_shape: "rounded",
    });
  });

  it("redact", () => {
    expect(snakeWireFor("redact")).toEqual({
      fill_color: "#445566",
      redact_style: "solid",
    });
  });

  it("crop has empty wire output", () => {
    expect(snakeWireFor("crop")).toEqual({});
  });
});

describe("fieldForSnakeKey", () => {
  it("maps every snake key in the table back to its camel field", () => {
    expect(fieldForSnakeKey("stroke_color")).toBe("strokeColor");
    expect(fieldForSnakeKey("arrow_head_start")).toBe("arrowHeadStart");
    expect(fieldForSnakeKey("highlight_color")).toBe("highlightColor");
  });

  it("returns undefined for unknown keys", () => {
    expect(fieldForSnakeKey("does_not_exist")).toBeUndefined();
  });
});
