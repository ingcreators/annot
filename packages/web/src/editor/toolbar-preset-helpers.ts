/**
 * Pure helpers for the editor toolbar's preset system. None of these
 * read or mutate `Toolbar`-private state; they take whatever they
 * need as parameters and return a value or mutate a passed-in
 * preset / element.
 *
 * Extracted from `toolbar.ts` as Stage 3a-5 of
 * `docs/plans/pre-release-cleanup.md`. The state-managing parts
 * (`#presets` Map, `#lastVariantByTool`, persistence I/O,
 * `#changeVariant` / `#handlePanelVariantChange` / `#getCurrentPreset`
 * / `#saveCurrentPreset`) stay in toolbar.ts for now — promoting them
 * to a `ToolbarPresetManager` class is a separate, larger refactor
 * that does not need to land in the same PR as this carve-out.
 */

import {
  normalizeVariantSideFields,
  readUniversalStyleAttrs,
  TOOL_REGISTRY,
} from "@ingcreators/annot-core/editor";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";

// `normalizeVariantSideFields` lives in `@ingcreators/annot-core/editor`
// (relocated in Phase 5 of `_done/toolbar-schema.md`). Callers should
// import it from core directly; this file no longer re-exports it.

/** Map a legacy tool-ID-keyed preset entry to the matching element
 *  key. `"shape"` → `"shape.rect"` (the shape tool's fallback
 *  variant), `"arrow"` → `"arrow.end"`, etc. New-format keys that
 *  already contain "." pass through unchanged.
 *
 *  NOTE: this only rewrites the KEY. Callers that hold the matching
 *  preset value should also call {@link healPresetVariantField}
 *  on the value so the stored variant field agrees with the new
 *  key — without that, a pre-per-color `"highlight"` preset whose
 *  `highlightColor` reflects the user's last-drawn color (Pink, say)
 *  ends up cached under `"highlight.#ffe100"` (Yellow) with a Pink
 *  payload. Applying that mismatched preset back to a Yellow-keyed
 *  element flips its fill to Pink — the bug behind the user-reported
 *  "clicking Yellow makes it Pink" symptom. */
export function migrateLegacyPresetKey(rawKey: string): string {
  if (rawKey.includes(".")) return rawKey;
  const meta = TOOL_REGISTRY[rawKey];
  if (!meta?.variants || !meta.defaultVariant) return rawKey;
  return `${rawKey}.${meta.defaultVariant}`;
}

/** Auto-heal a stored preset's variant-defining field so it agrees
 *  with the key it lives under. The legacy `migrateLegacyPresetKey`
 *  path appends `defaultVariant` to bare tool-id keys (e.g.
 *  `"highlight"` → `"highlight.#ffe100"`) without touching the
 *  preset's value, so a per-color preset can end up with a value
 *  whose `highlightColor` doesn't match the new key's variant. The
 *  `applyElementVariantPreset` and load-from-storage paths both call
 *  this so the corruption gets corrected the first time the preset
 *  is touched.
 *
 *  Pure mutation — returns `true` if a write happened (so callers
 *  can persist the corrected preset back to disk), `false` if the
 *  preset was already consistent. No-op for tools without a
 *  `variantField` or for keys without a `.<variant>` segment.
 *
 *  Mirrors the variant-field write that
 *  {@link mergePresetForVariantChange} performs after a flyout pick
 *  — sharing the contract keeps "stored preset's variant field is
 *  authoritative under its key" as a single invariant. */
export function healPresetVariantField(
  preset: ToolOptions,
  toolId: string,
  presetKey: string,
): boolean {
  const meta = TOOL_REGISTRY[toolId];
  if (!meta?.variantField) return false;
  const dotIdx = presetKey.indexOf(".");
  if (dotIdx < 0) return false;
  const variant = presetKey.slice(dotIdx + 1);
  const presetRec = preset as unknown as Record<string, unknown>;
  if (presetRec[meta.variantField as string] === variant) return false;
  presetRec[meta.variantField as string] = variant;
  return true;
}

/** Compute the element key for an existing SVG element. Used by
 *  `syncPresetFromElement` so that rubber-band style propagation
 *  targets the RIGHT variant's preset — e.g. editing a rounded
 *  rectangle updates "shape.rounded" only, not "shape.rect".
 *
 *  Routes through the registry's `variantKeyForElement` classifier —
 *  the per-tool branches that used to live here are now Tier B in
 *  `tool-registry.ts` (Phase 4 of `docs/plans/toolbar-schema.md`). */
export function elementKeyFromElement(el: SVGElement, toolId: string): string {
  const meta = TOOL_REGISTRY[toolId];
  if (!meta?.variants || !meta.defaultVariant) return toolId;
  const key = meta.variantKeyForElement?.(el);
  // The registry's classifier returns the FULL `tool.variant` key
  // when it claims the element. If it returns null (element doesn't
  // match the tool we were asked about — e.g. `<rect>` without
  // `data-highlight` passed with `toolId="highlight"`), fall back to
  // the tool's default variant so the legacy "always returns a
  // variant key" contract holds.
  return key ?? `${toolId}.${meta.defaultVariant}`;
}

/**
 * Pick the right starting point for a variant-switch merge: prefer
 * the stored preset for the new variant if one exists (so the user
 * gets back the look they last saved for "Double arrow" / "Sticky"
 * / etc.), otherwise carry over the style fields the user is
 * currently editing on the OLD variant (so a first-time switch into
 * "Sticky" inherits the color / font you just set on "Plain").
 *
 * The variant-defining field (e.g. `arrowHead`, `shapeType`) is
 * always overwritten with `newVariant`, regardless of branch.
 *
 * Pure: returns a new ToolOptions object, never mutates either
 * input. The callee is also responsible for invoking
 * {@link normalizeVariantSideFields} on the result before applying
 * — matching the legacy two-step contract that `Toolbar.#changeVariant`
 * established.
 */
export function mergePresetForVariantChange(
  currentPreset: ToolOptions,
  storedPreset: ToolOptions | undefined,
  toolId: string,
  newVariant: string,
): ToolOptions {
  const meta = TOOL_REGISTRY[toolId];
  // No-variant tools (crop, highlight when called incorrectly): return
  // a defensive copy of the current preset so callers can mutate freely.
  if (!meta?.variants || !meta.variantField) return { ...currentPreset };
  const seed = storedPreset ? { ...storedPreset } : { ...currentPreset };
  (seed as unknown as Record<string, unknown>)[meta.variantField as string] = newVariant;
  normalizeVariantSideFields(toolId, newVariant, seed);
  return seed;
}

/**
 * Validate that a preset is internally consistent for the named
 * tool. Today this catches the arrow side-field invariants
 * (begin/end shape must agree with `arrowHead` variant). Returns an
 * array of human-readable problems — empty array means valid.
 *
 * Useful at the storage boundary: when loading presets from disk,
 * callers can warn / repair / drop entries that fail validation
 * instead of silently rendering a "Double arrow" with both ends
 * actually "none". Pure — does not mutate the preset.
 */
export function validatePresetForTool(preset: ToolOptions, toolId: string): string[] {
  const errors: string[] = [];
  const meta = TOOL_REGISTRY[toolId];
  if (!meta?.variants || !meta.variantField) return errors;

  // The variant-defining field must hold a value the toolbar advertises.
  const variantValue = (preset as unknown as Record<string, unknown>)[
    meta.variantField as string
  ];
  if (variantValue !== undefined) {
    const known = meta.variants.some((v) => v.value === variantValue);
    if (!known) {
      errors.push(
        `${toolId}: preset.${String(meta.variantField)}="${String(variantValue)}" is not a known variant`,
      );
    }
  }

  if (toolId === "arrow") {
    const variant = preset.arrowHead;
    const start = preset.arrowHeadStart;
    const end = preset.arrowHeadEnd;
    if (variant === "none") {
      if (start !== undefined && start !== "none") {
        errors.push(`arrow: variant=none requires arrowHeadStart=none (got "${start}")`);
      }
      if (end !== undefined && end !== "none") {
        errors.push(`arrow: variant=none requires arrowHeadEnd=none (got "${end}")`);
      }
    } else if (variant === "end") {
      if (start !== undefined && start !== "none") {
        errors.push(`arrow: variant=end requires arrowHeadStart=none (got "${start}")`);
      }
      if (end === "none") {
        errors.push("arrow: variant=end requires arrowHeadEnd!=none");
      }
    } else if (variant === "both") {
      if (start === "none") {
        errors.push("arrow: variant=both requires arrowHeadStart!=none");
      }
      if (end === "none") {
        errors.push("arrow: variant=both requires arrowHeadEnd!=none");
      }
    }
  }

  return errors;
}

/** Build a fresh preset from the current style attributes of an
 *  existing element. Used when a target variant has no saved preset
 *  yet — the new preset inherits the element's current look so
 *  variant conversion doesn't surprise the user with unrelated
 *  defaults. `liveOptions` is the tool's currently-active
 *  ToolOptions reference (used as the seed before element-specific
 *  attrs are layered on top). */
export function seedPresetFromElement(
  el: SVGElement,
  toolId: string,
  elementKey: string,
  liveOptions: ToolOptions,
): ToolOptions {
  // Start from the tool's live options (reflecting whatever the
  // tool was last configured with), then layer element-specific
  // style attrs on top via the same universal reader the rubber-
  // band path uses (`Toolbar.syncPresetFromElement`). Sharing the
  // reader means a freehand-group seed inherits from the last
  // path child + every captured attr (stroke / fill / dasharray /
  // opacity / cap / join) round-trips into the new variant.
  const seed: ToolOptions = { ...liveOptions };
  readUniversalStyleAttrs(el, seed);
  // Ensure the variant-defining field matches this element's variant.
  const meta = TOOL_REGISTRY[toolId];
  if (meta?.variants && meta.variantField && elementKey.includes(".")) {
    const variant = elementKey.slice(elementKey.indexOf(".") + 1);
    (seed as unknown as Record<string, unknown>)[meta.variantField as string] = variant;
    normalizeVariantSideFields(toolId, variant, seed);
  }
  return seed;
}

/** Write the "style" fields of a preset (color / width / dash /
 *  opacity / linecap / linejoin) onto an existing element.
 *  Deliberately does NOT touch fields that define the element's
 *  type/variant (shapeType, arrowHead, textVariant, etc.) because
 *  those were already established by the variant-change path that
 *  invoked this helper.
 *
 *  Generic dispatch: walks `TOOL_REGISTRY` looking for the entry
 *  whose `variantKeyForElement` claims `el`, then routes to that
 *  tool's `applyStyleToElement` callback. The per-tool handlers
 *  (registered in `tool-registry.ts`) own the tool-specific quirks
 *  — marker walks the bg primitive, textbox writes data-color +
 *  text fill, highlight routes fill through `highlightColor`,
 *  arrow runs `refreshArrowPath` after the universal write, etc.
 *
 *  Phase 3 of `docs/plans/toolbar-apply-style-to-element.md`:
 *  the imperative element-tag cascade that used to live here was
 *  replaced by registry dispatch — symmetric with how Phase 5 of
 *  `_done/toolbar-schema.md` collapsed the read-side cascade in
 *  `Toolbar.syncPresetFromElement`. */
export function applyPresetStyleAttrs(el: SVGElement, preset: ToolOptions): void {
  for (const entry of Object.values(TOOL_REGISTRY)) {
    if (!entry.variantKeyForElement) continue;
    if (entry.variantKeyForElement(el) === null) continue;
    entry.applyStyleToElement?.(el, preset);
    return;
  }
  // No tool claimed the element. The legacy implementation fell
  // through to the universal generic path here, but every concrete
  // on-canvas element today is claimed by some tool's classifier
  // (see `TOOL_REGISTRY variantKeyForElement spot-checks` in
  // `tool-registry.test.ts`). Leaving this as a silent no-op
  // matches the closed-set assumption — if a future element type
  // shows up unclaimed, the missing write will be visibly broken
  // and a new registry entry needs to be added.
}
