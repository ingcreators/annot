/**
 * property-controls — shared control builders for the PowerPoint-style
 * property editor used by BOTH the selection-side PropertyPanel and
 * the tool-side properties (Toolbar's #populateToolProperties).
 *
 * Why a shared module: both surfaces previously used different
 * primitives — selection used `<button>` + popover color pickers,
 * number inputs with ±spinner, `createCustomSelect` pulldowns; tool
 * side used inline color palettes, chip rows for widths, and plain
 * `<select>` elements. Different widgets, different labels ("Style"
 * vs "Dash type", etc). This module normalizes both onto one vocabulary.
 *
 * Every exported factory returns a DOM node (or a `{section, body}`
 * pair) that the caller inserts into their container. None of them
 * assume a particular parent or commit semantics — the caller wires
 * `onChange` callbacks to whatever persistence / history hooks they
 * need.
 */

import { builtinIcon, renderIconHtml } from "@ingcreators/annot-core";
import type { ArrowSpec } from "@ingcreators/annot-core/editor/arrow-markers";
import { computeArrowParts } from "@ingcreators/annot-core/editor/arrow-markers";
import type { ArrowDim, ArrowShape } from "@ingcreators/annot-core/editor/tool-options";
import { openAnchoredPopover } from "./anchored-popover.js";
import { createColorPalette } from "./color-palette.js";
import { createCustomSelect } from "./custom-select.js";
import { setTooltip } from "./tooltip.js";

export interface ArrowEndsState {
  start: ArrowSpec;
  end: ArrowSpec;
}

/** A labeled row: `[label] [control]` — the PowerPoint line-item
 *  layout. `label` is the text on the left; `control` is whatever
 *  input/button the caller built. Returns the row `<div>`. */
export function createPropertyRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "pp-row";
  const lbl = document.createElement("div");
  lbl.className = "pp-row-label";
  lbl.textContent = label;
  row.appendChild(lbl);
  row.appendChild(control);
  return row;
}

/** A titled section: a header + a body that the caller populates with
 *  rows. Returns both elements so the caller can append rows into
 *  `body` and then append the whole `section` to its container. */
export function createPropertySection(title: string): { section: HTMLElement; body: HTMLElement } {
  const section = document.createElement("div");
  section.className = "pp-section";
  const header = document.createElement("div");
  header.className = "pp-section-header";
  header.textContent = title;
  section.appendChild(header);
  const body = document.createElement("div");
  body.className = "pp-section-body";
  section.appendChild(body);
  return { section, body };
}

export interface NumberInputOpts {
  current: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

/** PowerPoint-style number input: text field + unit label + stacked
 *  up/down spinner buttons. Commits on Enter / blur / spinner click. */
export function createNumberInput(opts: NumberInputOpts): HTMLElement {
  const { current, unit, min, max, step, onChange } = opts;
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
    onChange(v);
  };
  const bump = (dir: 1 | -1) => {
    const cur = Number.parseFloat(input.value);
    const base = Number.isFinite(cur) ? cur : current;
    const next = clamp(Math.round((base + dir * step) * 1e6) / 1e6);
    input.value = String(next);
    onChange(next);
  };

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

/** Color-swatch button that opens a color palette popover on click.
 *  The swatch background reflects the current color; a caret makes the
 *  pulldown-like affordance obvious. Users see the exact palette the
 *  rest of the app uses (createColorPalette).
 *
 *  `onPick` fires once per color chosen from the popover; the popover
 *  auto-closes after a pick. Supports a special "none" value to
 *  represent "no fill" — rendered with a diagonal strike. */
export function createColorPullButton(
  current: string,
  onPick: (color: string) => void,
  opts: { allowNone?: boolean; tooltip?: string } = {},
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pp-color-btn";
  if (opts.tooltip) setTooltip(btn, opts.tooltip);
  const swatch = document.createElement("span");
  swatch.className = "pp-color-swatch";
  const applySwatch = (c: string) => {
    if (c === "none") {
      swatch.classList.add("pp-color-swatch-none");
      swatch.style.background = "transparent";
    } else {
      swatch.classList.remove("pp-color-swatch-none");
      swatch.style.background = c;
    }
  };
  applySwatch(current);
  btn.appendChild(swatch);
  const caret = document.createElement("span");
  caret.innerHTML = renderIconHtml(builtinIcon("expand_more"));
  btn.appendChild(caret);
  btn.addEventListener("click", () => {
    openAnchoredPopoverForColor(
      btn,
      current,
      (color) => {
        applySwatch(color);
        onPick(color);
      },
      { allowNone: opts.allowNone },
    );
  });
  return btn;
}

/** Open a color palette in a popover anchored to a button. Kept as a
 *  separate primitive so callers that need more control over the
 *  popover's content (e.g. the gradient editor) can wire it directly. */
export function openAnchoredPopoverForColor(
  anchor: HTMLElement,
  current: string,
  onPick: (color: string) => void,
  opts: { allowNone?: boolean } = {},
): void {
  const palette = createColorPalette({
    currentColor: current?.startsWith("#") ? current : "#ff0000",
    onChange: (c) => {
      onPick(c);
      // Close the popover after a pick so the user doesn't have to
      // click-outside to dismiss it.
      const id = anchor.dataset.popoverId ?? "";
      document.body.querySelector<HTMLElement>(`[data-anchor-popover="${id}"]`)?.remove();
      anchor.dataset.popoverId = "";
    },
  });
  openAnchoredPopover(
    anchor,
    (root) => {
      root.style.padding = "8px";
      if (opts.allowNone) {
        // A "No fill / No color" button above the palette — picks the
        // sentinel "none" value that callers (e.g. shape fill) handle
        // specially. Visually distinct so it's clear it's not a color.
        const noneBtn = document.createElement("button");
        noneBtn.type = "button";
        noneBtn.className = "pp-color-none-btn";
        noneBtn.textContent = "No fill";
        noneBtn.addEventListener("click", () => {
          onPick("none");
          const id = anchor.dataset.popoverId ?? "";
          document.body.querySelector<HTMLElement>(`[data-anchor-popover="${id}"]`)?.remove();
          anchor.dataset.popoverId = "";
        });
        root.appendChild(noneBtn);
      }
      root.appendChild(palette);
    },
    { placement: "below" },
  );
}

// =============================================================================
// Arrow per-end pickers
//
// "Begin arrow" (start of line) and "End arrow" (end of line) each get:
//   - Type picker: 6 OOXML presets (none / triangle / arrow / stealth /
//     diamond / oval) in a 3-column grid.
//   - Size picker: 3×3 (width × length) grid.
//
// The picker auto-filters type options by the current "variant" rule:
//   - All-none state     → both ends show only "None"
//   - Single-sided arrow → begin shows only "None", end shows non-"None"
//   - Both ends marked   → both ends show non-"None"
// Matches the Type picker (Line / Arrow / Double arrow) defined in both
// the toolbar flyout and the selection-side Type row.
// =============================================================================

/** Inline SVG preview for an arrow-shape dropdown row. */
export function arrowShapePreview(shape: ArrowShape, dir: "left" | "right"): string {
  const mkStem = (x2: number) =>
    `<line x1="2" y1="7" x2="${x2}" y2="7" stroke="currentColor" stroke-width="1.6" stroke-linecap="butt"/>`;
  let content: string;
  switch (shape) {
    case "none":
      content = `<line x1="2" y1="7" x2="38" y2="7" stroke="currentColor" stroke-width="1.6" stroke-linecap="butt"/>`;
      break;
    case "triangle":
      content = `${mkStem(28)}<polygon points="28 2, 38 7, 28 12" fill="currentColor"/>`;
      break;
    case "arrow":
      content = `${mkStem(38)}<polyline points="26 1, 38 7, 26 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
      break;
    case "stealth":
      content = `${mkStem(31)}<polygon points="28 2, 38 7, 28 12, 31 7" fill="currentColor"/>`;
      break;
    case "diamond":
      content = `${mkStem(28)}<polygon points="24 7, 31 2, 38 7, 31 12" fill="currentColor"/>`;
      break;
    case "oval":
      content = `${mkStem(28)}<circle cx="33" cy="7" r="5" fill="currentColor"/>`;
      break;
    default:
      content = "";
  }
  const wrap =
    dir === "left" ? `<g transform="translate(40,0) scale(-1,1)">${content}</g>` : content;
  return `<svg width="40" height="14" viewBox="0 0 40 14">${wrap}</svg>`;
}

/** Inline SVG preview for an arrow-size dropdown cell. Uses the same
 *  rendering engine (computeArrowParts) as the canvas so cells
 *  accurately reflect stroke-width shortening + per-preset proportions. */
export function arrowSizePreview(
  w: ArrowDim,
  l: ArrowDim,
  dir: "left" | "right" = "right",
): string {
  const VB_W = 40;
  const VB_H = 14;
  const cy = VB_H / 2;
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

/** Build the 4 rows for per-end arrow configuration (Begin type,
 *  Begin size, End type, End size) into `body`. The caller provides
 *  `current` state and an `onChange` callback that fires whenever
 *  ANY of the pickers mutate the spec; the new full spec is passed.
 *
 *  Used by both:
 *    - Selection panel (callback applies via applyArrowHead + commit)
 *    - Tool panel      (callback updates preset fields)
 */
export function createArrowEndsRows(
  body: HTMLElement,
  current: ArrowEndsState,
  onChange: (next: ArrowEndsState) => void,
): void {
  const DIMS: ArrowDim[] = ["sm", "md", "lg"];

  // Mutable snapshot that updates as the user picks. A copy so
  // upstream state isn't mutated directly — the `onChange` callback
  // is the supported mutation path.
  const state: ArrowEndsState = {
    start: { ...current.start },
    end: { ...current.end },
  };

  const hStart = state.start.shape !== "none";
  const hEnd = state.end.shape !== "none";
  const lineVariant: "none" | "end" | "both" =
    !hStart && !hEnd ? "none" : hStart && hEnd ? "both" : "end";

  const shapesFor = (end: "start" | "end") => {
    const dir: "left" | "right" = end === "start" ? "left" : "right";
    const allShapes = [
      { value: "none", label: "None", preview: arrowShapePreview("none", dir) },
      { value: "triangle", label: "Triangle", preview: arrowShapePreview("triangle", dir) },
      { value: "arrow", label: "Arrow", preview: arrowShapePreview("arrow", dir) },
      { value: "stealth", label: "Stealth", preview: arrowShapePreview("stealth", dir) },
      { value: "diamond", label: "Diamond", preview: arrowShapePreview("diamond", dir) },
      { value: "oval", label: "Oval", preview: arrowShapePreview("oval", dir) },
    ] as Array<{ value: ArrowShape; label: string; preview: string }>;
    return allShapes.filter((s) => {
      const isNone = s.value === "none";
      if (lineVariant === "none") return isNone;
      if (lineVariant === "both") return !isNone;
      return end === "start" ? isNone : !isNone;
    });
  };

  const sizesFor = (end: "start" | "end") => {
    const dir: "left" | "right" = end === "start" ? "left" : "right";
    const out: Array<{ value: string; label: string; preview: string }> = [];
    for (const w of DIMS) {
      for (const l of DIMS) {
        out.push({
          value: `${w}-${l}`,
          label: `W:${w.toUpperCase()}  L:${l.toUpperCase()}`,
          preview: arrowSizePreview(w, l, dir),
        });
      }
    }
    return out;
  };

  const fire = () => {
    onChange({
      start: { ...state.start },
      end: { ...state.end },
    });
  };

  const push = (end: "start" | "end", typeLabel: string, sizeLabel: string) => {
    body.appendChild(
      createPropertyRow(
        typeLabel,
        createCustomSelect({
          options: shapesFor(end),
          current: state[end].shape,
          ariaLabel: typeLabel,
          columns: 3,
          popupWidth: 170,
          onChange: (v) => {
            state[end].shape = v as ArrowShape;
            fire();
          },
        }),
      ),
    );
    body.appendChild(
      createPropertyRow(
        sizeLabel,
        createCustomSelect({
          options: sizesFor(end),
          current: `${state[end].width}-${state[end].length}`,
          ariaLabel: sizeLabel,
          columns: 3,
          popupWidth: 180,
          onChange: (v) => {
            const [w, l] = v.split("-") as [ArrowDim, ArrowDim];
            state[end].width = w;
            state[end].length = l;
            fire();
          },
        }),
      ),
    );
  };
  push("start", "Begin arrow type", "Begin arrow size");
  push("end", "End arrow type", "End arrow size");
}
