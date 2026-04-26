/**
 * Pure DOM widget + SVG-string builders for the editor property
 * panel. Extracted from `property-panel.ts` as Stage 3b-1 of
 * `docs/plans/pre-release-cleanup.md` to start whittling that
 * file down from its 2k-line shape.
 *
 * Every function here is fully pure: it takes its inputs as
 * arguments and returns either an `HTMLElement` (for widget
 * builders) or a `string` of inline SVG (for previews). No
 * `PropertyPanel`-private state is touched, no closures over
 * the panel instance.
 */

import { computeDasharray } from "@ingcreators/annot-core/utils";

// `arrowPreview` / `arrowPreviewContent` / `arrowSizePreview` moved
// to `@ingcreators/annot-core/editor/arrow-markers` (Tier B) by
// Phase C of `docs/plans/property-panel-schema-extensions.md` — the
// per-end arrow registry defs need them for `iconSvg` option fields,
// and Tier B can't import from Tier C without breaking the cycle
// invariant. The functions are pure SVG-string builders, jsdom-
// friendly, and have no side effects at module load. Importers should
// switch to `@ingcreators/annot-core/editor/arrow-markers`.

/**
 * Inline SVG showing a sample line in the requested dash style.
 * Used by the dash pulldown's option cells.
 */
export function dashPreview(key: string): string {
  const prev = 1.5;
  const da = computeDasharray(key, prev);
  const daAttr = da ? ` stroke-dasharray="${da}"` : "";
  return `<svg width="60" height="10" viewBox="0 0 60 10"><line x1="2" y1="5" x2="58" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"${daAttr}/></svg>`;
}

/**
 * Number input with unit suffix + custom up/down spinner buttons —
 * matches PowerPoint's "4.5 pt", "40 %", "90°" fields. The browser's
 * native spin buttons are suppressed by CSS so styling stays
 * consistent in both light and dark themes; our stacked caret
 * buttons take over their role, with Enter / blur committing the
 * current value to the caller.
 */
export function ppNumberInput(
  current: number,
  unit: string,
  min: number,
  max: number,
  step: number,
  onCommit: (value: number) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "pp-number";
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(current);
  const unitEl = document.createElement("span");
  unitEl.className = "pp-number-unit";
  unitEl.textContent = unit;
  wrap.appendChild(input);
  wrap.appendChild(unitEl);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const commit = () => {
    let v = Number.parseFloat(input.value);
    if (!Number.isFinite(v)) v = current;
    v = clamp(v);
    input.value = String(v);
    onCommit(v);
  };
  const bump = (dir: 1 | -1) => {
    const cur = Number.parseFloat(input.value);
    const base = Number.isFinite(cur) ? cur : current;
    const next = clamp(Math.round((base + dir * step) * 1e6) / 1e6);
    input.value = String(next);
    onCommit(next);
  };

  // Stacked spinner caret buttons, PowerPoint-style.
  const spinner = document.createElement("div");
  spinner.className = "pp-number-spinner";
  const up = document.createElement("button");
  up.type = "button";
  up.className = "pp-number-spin-up";
  up.setAttribute("aria-label", "Increase");
  up.tabIndex = -1;
  up.addEventListener("click", (e) => {
    e.preventDefault();
    bump(1);
  });
  const down = document.createElement("button");
  down.type = "button";
  down.className = "pp-number-spin-down";
  down.setAttribute("aria-label", "Decrease");
  down.tabIndex = -1;
  down.addEventListener("click", (e) => {
    e.preventDefault();
    bump(-1);
  });
  spinner.appendChild(up);
  spinner.appendChild(down);
  wrap.appendChild(spinner);

  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      input.blur();
    }
  });
  return wrap;
}

/**
 * Slider + matching number input pair (PowerPoint's transparency /
 * brightness rows use this).
 */
export function ppSliderRow(
  label: string,
  current: number,
  unit: string,
  onInput: (value: number) => void,
  onCommit: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "pp-slider-row";
  const lbl = document.createElement("div");
  lbl.className = "pp-row-label";
  lbl.textContent = label;
  row.appendChild(lbl);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.value = String(current);
  row.appendChild(slider);
  const num = ppNumberInput(current, unit, 0, 100, 1, (v) => {
    slider.value = String(v);
    onInput(v);
    onCommit();
  });
  row.appendChild(num);
  slider.addEventListener("input", () => {
    const v = Number.parseFloat(slider.value);
    (num.querySelector("input") as HTMLInputElement).value = String(v);
    onInput(v);
  });
  slider.addEventListener("change", () => onCommit());
  return row;
}
