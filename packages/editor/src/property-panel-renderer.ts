/**
 * Schema-driven control renderer for PropertyPanel.
 *
 * Phase 2 of `docs/plans/property-panel-schema.md` — consumes the
 * Tier B `PropertyControlDef` registry and produces the same DOM the
 * imperative `#renderXxxControls` methods do today. Phase 3 will
 * migrate the live PropertyPanel one category at a time; this file
 * stays a free function so it can be unit-tested in isolation.
 *
 * The renderer is deliberately stateless across calls — each
 * `renderControl` call builds a fresh element. Internal mutable state
 * (current target list, active-chip class) lives on closure variables
 * inside the single returned element.
 */

import type {
  PropertyControlDef,
  PropertyControlOption,
  PropertyEffectId,
} from "@ingcreators/annot-core/editor/property-schema";
import { setTooltip } from "./tooltip.js";
import { createCustomSelect } from "./custom-select.js";
import { createColorPullButton } from "./property-controls.js";
import { ppNumberInput } from "./property-panel-helpers.js";

/** Result of an in-place or replacing mutation. `oldEl === newEl`
 *  for `setValue` / `effect` paths that mutate in place; `oldEl !==
 *  newEl` for `replace` and for `effect` handlers that swap nodes
 *  (e.g. the redact converter). */
export interface ElementReplacement {
  oldEl: SVGElement;
  newEl: SVGElement;
}

/** Effect-handler signature. Returns the post-mutation element list
 *  (one entry per input element, preserving order). Async because
 *  the redact converter samples canvas pixels.
 *
 *  The renderer awaits the result before firing `onCommit`, so the
 *  handler can be synchronous (return the array directly) OR
 *  asynchronous (return a `Promise`). */
export type PropertyEffectHandler = (
  elements: readonly SVGElement[],
  value: unknown,
) => ElementReplacement[] | Promise<ElementReplacement[]>;

/** What the renderer needs from its host (PropertyPanel) to wire
 *  mutations through to history + the onStyleChanged / onVariantChanged
 *  rubber-band. The renderer doesn't import `CanvasManager` directly
 *  because the only piece that needs it is the redact effect handler,
 *  which is supplied via `effects` (the Phase 3 PropertyPanel will
 *  bind handlers that close over its `#canvas` reference). */
export interface RenderControlDeps {
  /** Per-effect-id handler table. The PropertyPanel (Phase 3) wires
   *  these up to its `applyArrowHead`, `applyDrawStyle`, `convert-
   *  MarkerShape`, `resizeMarker`, `convertRedactStyle` calls. Tests
   *  pass spies / no-op handlers. */
  effects: Partial<Record<PropertyEffectId, PropertyEffectHandler>>;
  /** Fired after every mutation succeeds and the renderer has
   *  updated its own internal state. The host uses this to push
   *  history and fire its rubber-band callbacks (`onStyleChanged`
   *  for non-variant edits, `onVariantChanged` for variant changes). */
  onCommit: (info: CommitInfo) => void;
}

export interface CommitInfo {
  /** Element replacements from `replace` or `effect` paths. Empty
   *  for in-place `setValue` mutations. PropertyPanel uses this to
   *  update its `#targets` + fire `onTargetReplaced`. */
  replacements: ElementReplacement[];
  /** True for variant pickers (shape / arrow / draw style / marker
   *  shape / text variant / redact style / highlight color). The
   *  host loads the new variant's preset on this path instead of
   *  rubber-banding the current style into it. */
  variantChange: boolean;
}

/**
 * Render a single PropertyControlDef against the current selection.
 * Returns the produced element, or `null` when the def's
 * `visibleWhen` predicate excludes the first selected element.
 *
 * Internal state (current value snapshot, current target list) lives
 * on closures inside the returned element so a subsequent click /
 * input event uses the latest snapshot — even after a `replace` swap.
 */
export function renderControl(
  def: PropertyControlDef,
  initialTargets: readonly SVGElement[],
  deps: RenderControlDeps,
): HTMLElement | null {
  if (initialTargets.length === 0) return null;
  const sample = initialTargets[0]!;
  if (def.visibleWhen && !def.visibleWhen(sample)) return null;

  // Mutable target list — `replace` / `effect` swaps update this so
  // subsequent edits route to the post-swap elements. The host
  // Property panel will keep its own `#targets` in sync via the
  // `onCommit` callback.
  const targets: SVGElement[] = [...initialTargets];

  switch (def.type) {
    case "color":
      return renderColor(def, targets, deps);
    case "number":
      return renderNumber(def, targets, deps);
    case "select":
      return renderSelect(def, targets, deps);
    case "variantPicker":
      return renderVariantPicker(def, targets, deps);
  }
}

// ─── Per-type renderers ─────────────────────────────────────────────

function renderColor(
  def: PropertyControlDef,
  targets: SVGElement[],
  deps: RenderControlDeps,
): HTMLElement {
  // `getValue` returns `unknown`; for color controls the underlying
  // T is string. Coerce here — the registry contract guarantees the
  // shape; a non-string would be a registry-author bug.
  const current = String(def.getValue(targets[0]!));
  const btn = createColorPullButton(
    current,
    (color) => {
      const replacements = applySync(def, targets, color);
      // Color setValue mutates in place — replacements is empty.
      deps.onCommit({ replacements, variantChange: false });
    },
    { allowNone: def.allowNone },
  );
  return ppRow(def.label, btn);
}

function renderNumber(
  def: PropertyControlDef,
  targets: SVGElement[],
  deps: RenderControlDeps,
): HTMLElement {
  const current = Number(def.getValue(targets[0]!));
  const min = def.min ?? 0;
  const max = def.max ?? 100;
  const step = def.step ?? 1;
  const unit = def.unit ?? "";
  const input = ppNumberInput(current, unit, min, max, step, async (v) => {
    if (def.effect) {
      const replacements = await runEffect(def.effect, deps, targets, v);
      syncTargets(targets, replacements);
      deps.onCommit({ replacements, variantChange: false });
    } else {
      const replacements = applySync(def, targets, v);
      deps.onCommit({ replacements, variantChange: false });
    }
  });
  return ppRow(def.label, input);
}

function renderSelect(
  def: PropertyControlDef,
  targets: SVGElement[],
  deps: RenderControlDeps,
): HTMLElement {
  const opts = def.options ?? [];
  const current = String(def.getValue(targets[0]!));
  const select = createCustomSelect({
    options: opts.map((o) => ({
      value: String(o.value),
      label: o.label,
    })),
    current,
    ariaLabel: def.label,
    onChange: (v) => {
      const replacements = applySync(def, targets, v);
      deps.onCommit({ replacements, variantChange: false });
    },
  });
  return ppRow(def.label, select);
}

function renderVariantPicker(
  def: PropertyControlDef,
  targets: SVGElement[],
  deps: RenderControlDeps,
): HTMLElement {
  // Chip row matches the imperative panel's `#addXxxPicker` layout —
  // a `<div class="pp-type-row">` wrapper with one
  // `.prop-choice-chip` per option. NO label / pp-row wrapping — the
  // variant chips anchor directly under the section header.
  const row = document.createElement("div");
  row.className = "pp-type-row";

  const opts = def.options ?? [];
  const currentRaw = def.getValue(targets[0]!);
  let current = stringifyValue(currentRaw);

  // Preserve the chip refs so we can flip the active class on click
  // without re-querying the DOM.
  const chips: HTMLElement[] = [];

  for (const opt of opts) {
    const chip = renderChip(opt, current === stringifyValue(opt.value), def.label);
    chip.addEventListener("click", async () => {
      const value = opt.value;
      if (stringifyValue(value) === current) return;

      // Optimistic active-state update so the chip feels responsive
      // while the (potentially-async) mutation runs. Reverted if the
      // effect throws.
      const previousActive = chips.find((c) => c.classList.contains("active")) ?? null;
      previousActive?.classList.remove("active");
      chip.classList.add("active");

      try {
        let replacements: ElementReplacement[] = [];
        if (def.effect) {
          replacements = await runEffect(def.effect, deps, targets, value);
        } else if (def.replace) {
          replacements = applyReplace(def, targets, value);
        } else if (def.setValue) {
          replacements = applySync(def, targets, value);
        }
        syncTargets(targets, replacements);
        current = stringifyValue(value);
        deps.onCommit({ replacements, variantChange: true });
      } catch (err) {
        // Roll back the active flip so the UI stays consistent with
        // the actual element state. The failure is logged for the
        // host to surface (e.g. a toast); silently swallowing would
        // leave the user wondering why the click did nothing.
        chip.classList.remove("active");
        previousActive?.classList.add("active");
        console.error("[property-panel-renderer] variant pick failed", err);
      }
    });
    chips.push(chip);
    row.appendChild(chip);
  }

  return row;
}

// ─── Building blocks ────────────────────────────────────────────────

/** Chip element matching the imperative panel's three flavours:
 *    materialIcon → `.material-symbols-outlined` ligature
 *    iconSvg      → inline SVG via innerHTML
 *    swatchColor  → `.pp-color-chip` with --swatch-color custom prop */
function renderChip(
  opt: PropertyControlOption,
  active: boolean,
  category: string,
): HTMLElement {
  const chip = document.createElement("div");
  if (opt.swatchColor) {
    chip.className = `prop-choice-chip pp-color-chip${active ? " active" : ""}`;
    chip.style.setProperty("--swatch-color", opt.swatchColor);
  } else if (opt.materialIcon) {
    chip.className = `prop-choice-chip material-symbols-outlined${active ? " active" : ""}`;
    chip.textContent = opt.materialIcon;
  } else if (opt.iconSvg) {
    chip.className = `prop-choice-chip${active ? " active" : ""}`;
    chip.innerHTML = opt.iconSvg;
  } else {
    chip.className = `prop-choice-chip${active ? " active" : ""}`;
    chip.textContent = opt.label;
  }
  setTooltip(chip, opt.label);
  // Stamp the value as a data attribute so test fixtures can address
  // chips by their option value without parsing the icon markup.
  chip.dataset.value = stringifyValue(opt.value);
  // Stamp the category so multiple variant pickers in one panel
  // remain distinguishable in the DOM.
  chip.dataset.category = category;
  return chip;
}

/** 2-column label/control row. Mirrors `PropertyPanel#ppRow`. */
function ppRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "pp-row";
  const lbl = document.createElement("div");
  lbl.className = "pp-row-label";
  lbl.textContent = label;
  row.appendChild(lbl);
  row.appendChild(control);
  return row;
}

// ─── Mutation dispatch ──────────────────────────────────────────────

/** Apply `def.setValue` to every target in place. Returns identity
 *  replacements (`oldEl === newEl`) so the caller's `onCommit` can
 *  treat all paths uniformly. */
function applySync(
  def: PropertyControlDef,
  targets: SVGElement[],
  value: unknown,
): ElementReplacement[] {
  if (!def.setValue) return [];
  for (const t of targets) def.setValue(t, value);
  return [];
}

/** Apply `def.replace` to every target. Returns the per-target
 *  swap list so the caller can update the host's selection. */
function applyReplace(
  def: PropertyControlDef,
  targets: SVGElement[],
  value: unknown,
): ElementReplacement[] {
  if (!def.replace) return [];
  const out: ElementReplacement[] = [];
  for (const t of targets) {
    const newEl = def.replace(t, value);
    out.push({ oldEl: t, newEl });
  }
  return out;
}

/** Look up the matching effect handler and invoke it. Throws when
 *  the deps table lacks a handler for the requested effect id —
 *  this is a wiring bug, not a runtime fallback. */
async function runEffect(
  id: PropertyEffectId,
  deps: RenderControlDeps,
  targets: SVGElement[],
  value: unknown,
): Promise<ElementReplacement[]> {
  const handler = deps.effects[id];
  if (!handler) {
    throw new Error(`[property-panel-renderer] no handler bound for effect "${id}"`);
  }
  const result = await handler(targets, value);
  return result;
}

/** Update the renderer's mutable target list from a replacement
 *  batch so subsequent clicks operate on post-swap elements. */
function syncTargets(targets: SVGElement[], replacements: ElementReplacement[]): void {
  if (replacements.length === 0) return;
  for (const { oldEl, newEl } of replacements) {
    if (oldEl === newEl) continue;
    const idx = targets.indexOf(oldEl);
    if (idx >= 0) targets[idx] = newEl;
  }
}

/** Stringify an option's value for chip-vs-current comparison and
 *  the `data-value` stamp. Variant picker values are typed as a
 *  union of string literals (ShapeType / ArrowHead / DrawStyle /
 *  …); the registry never declares a non-stringifiable value, so
 *  this is a thin coercion rather than a JSON serializer. */
function stringifyValue(v: unknown): string {
  return String(v);
}
