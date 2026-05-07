/**
 * Imperative `<annot-icon>` builder for non-Lit DOM code.
 *
 * Phase 4 of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
 *
 * Many existing UI sites build `<span
 * class="material-symbols-outlined">name</span>` via
 * `document.createElement` + `el.textContent` rather than via Lit
 * templates. This helper produces the equivalent imperative
 * `<annot-icon>` element so the migration is a 1:1 line replace
 * rather than a structural rewrite.
 *
 * Lit-template call sites should compose `<annot-icon
 * .spec=${builtinIcon("name")}>` directly via the `lit.js`
 * subpath; this helper exists for the imperative DOM remainder.
 */

import { builtinIcon, type IconSpec } from "@ingcreators/annot-core";
import type { AnnotIconElement } from "./annot-icon.js";
import "./annot-icon.js";

/** Build an `<annot-icon>` rendering the supplied builtin id.
 *  Optional `className` is set on the element so the imperative
 *  call site preserves whatever sizing / positioning class the
 *  former `<span class="material-symbols-outlined …">` carried.
 *
 *  `id` is typed loosely as `string` so call sites that already
 *  carry plain string icon names (TOOL_REGISTRY variant `icon`
 *  fields, plugin-supplied tab descriptors, etc.) don't need
 *  per-site `as BuiltinIconId` casts. The renderer treats unknown
 *  ids as "no icon" — typo'd strings fail open, not closed. */
export function createBuiltinIcon(id: string, className?: string): AnnotIconElement {
  const el = document.createElement("annot-icon") as AnnotIconElement;
  el.spec = builtinIcon(id);
  if (className) el.className = className;
  return el;
}

/** Build an `<annot-icon>` for any IconSpec — generic variant of
 *  `createBuiltinIcon` for sites that take an externally supplied
 *  spec (e.g. plugin metadata). */
export function createIcon(spec: IconSpec, className?: string): AnnotIconElement {
  const el = document.createElement("annot-icon") as AnnotIconElement;
  el.spec = spec;
  if (className) el.className = className;
  return el;
}
