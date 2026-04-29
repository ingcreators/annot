/**
 * Tier B — generic preset (de)serializer driven by `TOOL_REGISTRY`'s
 * `presetFields`. Replaces the manual ~20-field camelCase ↔ snake_case
 * mappings in `Toolbar.#loadPresetsFrom* / #savePresetsTo*` with a
 * single source-of-truth case-conversion table.
 *
 * Phase 2 of `docs/plans/toolbar-schema.md`. The two paths the
 * toolbar persists through:
 *
 *   - Tauri (snake_case YAML via `tool-presets.yml`)
 *   - localStorage / chrome.storage (camelCase JSON)
 *
 * are now both expressed as `(opts, presetFields, format) => record`.
 * `format: "snake"` rewrites keys via the shared map; `format: "camel"`
 * passes them through unchanged. `presetFields` filters to what the
 * tool actually uses — so a Shape preset's wire record stops carrying
 * stale `arrow_head_start` / `marker_shape` fields it doesn't read.
 *
 * Pure, jsdom-friendly — no DOM globals, no closures over runtime
 * state. Importable in pure Node and exposed via `headless.ts`.
 */

import type { ToolOptions } from "./tool-options.js";

/** Wire format selector. `snake` rewrites camelCase keys to
 *  snake_case via the table below (matches the Tauri YAML schema in
 *  `packages/desktop/src-tauri/src/commands/settings.rs` and the
 *  TypeScript-side `ToolPreset` interface). `camel` passes the keys
 *  through unchanged (matches the localStorage / chrome.storage
 *  blobs, which historically just `JSON.stringify`'d the live
 *  `ToolOptions`). */
export type PresetWireFormat = "snake" | "camel";

/** Single source of truth for the camelCase ↔ snake_case mapping.
 *  Keys are the `ToolOptions` field names; values are the snake_case
 *  wire-format names emitted to YAML / read back from YAML.
 *
 *  Gradient fields (`strokeGradient`, `fillGradient`) are deliberately
 *  EXCLUDED — they're nested objects (`GradientSpec`), and the
 *  existing wire format never persisted them (the Rust YAML struct
 *  doesn't model the shape, and the localStorage blob never round-
 *  tripped them with intent). When a future plan adds gradient
 *  persistence, this is the point that needs extending. */
const FIELD_TO_SNAKE = {
  strokeColor: "stroke_color",
  fillColor: "fill_color",
  strokeWidth: "stroke_width",
  fontSize: "font_size",
  strokeDasharray: "stroke_dasharray",
  fillOpacity: "fill_opacity",
  shapeType: "shape_type",
  arrowHead: "arrow_head",
  textVariant: "shape_kind",
  fontFamily: "font_family",
  drawStyle: "draw_style",
  redactStyle: "redact_style",
  arrowHeadStart: "arrow_head_start",
  arrowHeadEnd: "arrow_head_end",
  arrowWidthStart: "arrow_width_start",
  arrowWidthEnd: "arrow_width_end",
  arrowLengthStart: "arrow_length_start",
  arrowLengthEnd: "arrow_length_end",
  highlightColor: "highlight_color",
  markerShape: "marker_shape",
  strokeOpacity: "stroke_opacity",
  strokeLinecap: "stroke_linecap",
  strokeLinejoin: "stroke_linejoin",
} as const satisfies Partial<Record<keyof ToolOptions, string>>;

/** Reverse map (snake → camel) computed once at module load. */
const SNAKE_TO_FIELD: Record<string, keyof ToolOptions> = (() => {
  const out: Record<string, keyof ToolOptions> = {};
  for (const [camel, snake] of Object.entries(FIELD_TO_SNAKE)) {
    out[snake] = camel as keyof ToolOptions;
  }
  return out;
})();

function camelToWireKey(field: keyof ToolOptions, format: PresetWireFormat): string {
  if (format === "camel") return field as string;
  return (FIELD_TO_SNAKE as Record<string, string>)[field as string] ?? (field as string);
}

function wireKeyForRead(
  field: keyof ToolOptions,
  format: PresetWireFormat,
  record: Record<string, unknown>,
): string | null {
  if (format === "camel") {
    return field in record ? (field as string) : null;
  }
  const snake = (FIELD_TO_SNAKE as Record<string, string>)[field as string];
  if (snake !== undefined && snake in record) return snake;
  return null;
}

/**
 * Convert a preset object to its wire form. Walks `presetFields` and
 * copies each defined value to the output, optionally rewriting the
 * key to snake_case. `undefined` values are dropped (matches
 * `JSON.stringify`'s behaviour, plus keeps the on-disk YAML diff-
 * friendly).
 *
 * Caller decides which fields are part of the wire schema by passing
 * the tool's `TOOL_REGISTRY[id].presetFields`. Adding a new field to
 * a tool means one entry in that array — no edit to this file
 * required (unless the field is brand-new and missing from the
 * `FIELD_TO_SNAKE` table, in which case `format: "snake"` will fall
 * through to camelCase for that field).
 */
export function presetToWire(
  opts: Partial<ToolOptions>,
  presetFields: ReadonlyArray<keyof ToolOptions>,
  format: PresetWireFormat,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of presetFields) {
    const v = opts[field];
    if (v === undefined) continue;
    out[camelToWireKey(field, format)] = v;
  }
  return out;
}

/**
 * Inverse of `presetToWire`. Reads each `presetFields` entry off
 * `record` (looking under the appropriate wire-format key) and
 * returns a partial `ToolOptions` containing the present values.
 *
 * Empty strings on optional fields are treated as "absent" — the old
 * imperative loader applied `|| undefined` to most variant fields
 * (`shape_type`, `arrow_head`, …) so a corrupted-empty value didn't
 * pollute the in-memory preset. We preserve that here uniformly so
 * the helper is safe to use on every field, not just the ones that
 * had the explicit `|| undefined` in the old code.
 */
export function presetFromWire(
  record: Record<string, unknown>,
  presetFields: ReadonlyArray<keyof ToolOptions>,
  format: PresetWireFormat,
): Partial<ToolOptions> {
  const out: Partial<ToolOptions> = {};
  for (const field of presetFields) {
    const key = wireKeyForRead(field, format, record);
    if (key === null) continue;
    const v = record[key];
    if (v === undefined) continue;
    if (v === "") continue;
    (out as Record<string, unknown>)[field] = v;
  }
  return out;
}

/** Translate a snake_case wire key back to its camelCase
 *  `ToolOptions` field name, or `undefined` if the key isn't in the
 *  shared SerDe table. Exposed as a low-level helper for callers
 *  (e.g. preset-key migration paths) that operate on raw wire
 *  records without the tool-fields filter. */
export function fieldForSnakeKey(snakeKey: string): keyof ToolOptions | undefined {
  return SNAKE_TO_FIELD[snakeKey];
}
