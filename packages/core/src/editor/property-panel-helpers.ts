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

import { computeDasharray } from "../utils/dash-utils.js";
import { type ArrowSpec, computeArrowParts } from "./arrow-markers.js";
import type { ArrowDim, ArrowShape } from "./tools/tool-base.js";

/**
 * Inline SVG for an arrow-end shape used by the per-end pulldown
 * cells. Shared 40×14 viewBox with `arrowSizePreview` so Begin/End
 * type and size buttons render at the same apparent stem length —
 * the four rows line up visually in the right panel instead of
 * looking like mismatched pairs.
 */
export function arrowPreview(shape: ArrowShape, dir: "left" | "right" = "right"): string {
  const content = arrowPreviewContent(shape);
  const wrap =
    dir === "left" ? `<g transform="translate(40,0) scale(-1,1)">${content}</g>` : content;
  return `<svg width="40" height="14" viewBox="0 0 40 14">${wrap}</svg>`;
}

/**
 * Inner SVG for `arrowPreview` — the head + stem geometry without
 * the wrapping `<svg>` element. Exposed separately so callers can
 * compose it inside their own `<svg>` (used by the toolbar's
 * variant flyout).
 *
 * 40×14 viewBox. Stem along y=7, head occupies x∈[28,38], 10-unit
 * long × 10-unit wide (tip at x=38, base at x=28). The stem's
 * right endpoint varies per shape so it touches the marker's
 * attachment point (chevron tip, stealth notch, filled base, etc).
 */
export function arrowPreviewContent(shape: ArrowShape): string {
  const mkStem = (x2: number) =>
    `<line x1="2" y1="7" x2="${x2}" y2="7" stroke="currentColor" stroke-width="1.6" stroke-linecap="butt"/>`;
  switch (shape) {
    case "none":
      // Plain line, full width.
      return `<line x1="2" y1="7" x2="38" y2="7" stroke="currentColor" stroke-width="1.6" stroke-linecap="butt"/>`;
    case "triangle":
      return `${mkStem(28)}<polygon points="28 2, 38 7, 28 12" fill="currentColor"/>`;
    case "arrow":
      // Open chevron with thick rounded outline — matches
      // PowerPoint's "arrow" preset. Stem extends through to the
      // tip so the stem line has no visible gap at the opening.
      return `${mkStem(38)}<polyline points="26 1, 38 7, 26 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    case "stealth":
      // Notch at ~30% of length → x = 28 + 10*0.3 = 31.
      return `${mkStem(31)}<polygon points="28 2, 38 7, 28 12, 31 7" fill="currentColor"/>`;
    case "diamond":
      return `${mkStem(28)}<polygon points="24 7, 31 2, 38 7, 31 12" fill="currentColor"/>`;
    case "oval":
      return `${mkStem(28)}<circle cx="33" cy="7" r="5" fill="currentColor"/>`;
  }
}

/**
 * Render an arrow head preview at the requested width × length so
 * the per-end size pulldown's cells accurately reflect the actual
 * canvas rendering. Uses the same `computeArrowParts` engine the
 * canvas uses, eliminating the previous ad-hoc scale table that
 * tended to drift from real geometry.
 */
export function arrowSizePreview(
  w: ArrowDim,
  l: ArrowDim,
  dir: "left" | "right" = "right",
): string {
  const VB_W = 40;
  const VB_H = 14;
  const cy = VB_H / 2;
  // A moderate preview stroke so the ~12×8 viewBox comfortably
  // shows the head; arrow-markers' output scales with this value.
  const previewStroke = 1.2;
  const x1 = 2;
  const x2 = VB_W - 2;
  const specStart: ArrowSpec = { shape: "none", width: w, length: l };
  const specEnd: ArrowSpec = { shape: "triangle", width: w, length: l };
  const { stemD, headFilledD, headOpenD } = computeArrowParts(
    x1,
    cy,
    x2,
    cy,
    specStart,
    specEnd,
    previewStroke,
  );
  const headAttrs = `stroke="currentColor" stroke-width="${previewStroke}" stroke-linecap="round" stroke-linejoin="miter"`;
  const content =
    `<path d="${stemD}" fill="none" stroke="currentColor" stroke-width="${previewStroke}" stroke-linecap="butt"/>` +
    `<path d="${headFilledD}" fill="currentColor" ${headAttrs}/>` +
    `<path d="${headOpenD}" fill="none" ${headAttrs}/>`;
  const wrap =
    dir === "left" ? `<g transform="translate(${VB_W},0) scale(-1,1)">${content}</g>` : content;
  return `<svg width="${VB_W}" height="${VB_H}" viewBox="0 0 ${VB_W} ${VB_H}">${wrap}</svg>`;
}

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
