/**
 * custom-select — PowerPoint-style dropdown button.
 *
 * Native `<select>` can't render SVG / icon previews inside its
 * option list, so we build a lightweight popup that:
 *   1. Closes the gap between "choose from a list of visual
 *      treatments" and the native-looking button affordance (caret
 *      down, hover state, focus outline).
 *   2. Shares the same open/close/reposition plumbing as the toolbar
 *      flyouts so behavior stays consistent across the editor.
 *
 * Options are a plain list; each option carries its machine `value`,
 * a human `label` (shown in tooltips / a text fallback), and an
 * optional `preview` HTML fragment that gets rendered inside both
 * the button and the popup row.
 */

import { openAnchoredPopover } from "./toolbar.js";
import { setTooltip } from "../utils/tooltip.js";

export interface CustomSelectOption {
  value: string;
  label: string;
  /** SVG / HTML fragment used as visual preview. Falls back to
   *  `label` (plain text) when omitted. */
  preview?: string;
}

export interface CustomSelectOpts {
  options: CustomSelectOption[];
  current: string;
  onChange: (value: string) => void;
  /** Optional aria-label / tooltip on the button itself. */
  ariaLabel?: string;
  /** Width hint for the popup (px). Default auto. */
  popupWidth?: number;
  /** Force a column layout for the popup (one option per row). */
  columns?: number;
  /** Invoked when the popup is displayed, e.g. so the caller can
   *  refresh a disabled state on reopen. */
  onOpen?: () => void;
}

/**
 * Build a PowerPoint-style dropdown button. Caller appends the
 * returned element wherever it wants; clicking opens a popover with
 * the options and a visible active state.
 */
export function createCustomSelect(opts: CustomSelectOpts): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pp-select";
  if (opts.ariaLabel) {
    btn.setAttribute("aria-label", opts.ariaLabel);
    setTooltip(btn, opts.ariaLabel);
  }

  // Preview sits on the left, caret on the right — mirrors PowerPoint.
  const previewEl = document.createElement("span");
  previewEl.className = "pp-select-preview";
  btn.appendChild(previewEl);
  const caret = document.createElement("span");
  caret.className = "pp-select-caret material-symbols-outlined";
  caret.textContent = "expand_more";
  btn.appendChild(caret);

  const renderPreview = (value: string) => {
    const opt = opts.options.find((o) => o.value === value) ?? opts.options[0];
    if (!opt) { previewEl.textContent = ""; return; }
    if (opt.preview) previewEl.innerHTML = opt.preview;
    else previewEl.textContent = opt.label;
  };
  renderPreview(opts.current);

  // Local state so the button can re-render its preview without
  // relying on the caller to rebuild the component. Mutations go via
  // `setValue(value, fire)` which single-sources the update.
  let current = opts.current;
  const setValue = (value: string, fire: boolean) => {
    current = value;
    renderPreview(value);
    if (fire) opts.onChange(value);
  };

  btn.addEventListener("click", () => {
    opts.onOpen?.();
    openAnchoredPopover(btn, (root) => {
      root.classList.add("pp-select-popup");
      if (opts.popupWidth) root.style.minWidth = `${opts.popupWidth}px`;
      const grid = document.createElement("div");
      grid.className = "pp-select-grid";
      if (opts.columns) grid.style.gridTemplateColumns = `repeat(${opts.columns}, 1fr)`;
      for (const o of opts.options) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "pp-select-item" + (o.value === current ? " active" : "");
        setTooltip(item, o.label);
        item.setAttribute("aria-label", o.label);
        if (o.preview) item.innerHTML = o.preview;
        else item.textContent = o.label;
        item.addEventListener("click", () => {
          setValue(o.value, true);
          // Let the popover's own outside-click path close it.
          const t = document.body.querySelector<HTMLElement>(
            `[data-anchor-popover="${btn.dataset.popoverId ?? ""}"]`,
          );
          t?.remove();
          if (btn.dataset.popoverId) btn.dataset.popoverId = "";
        });
        grid.appendChild(item);
      }
      root.appendChild(grid);
    }, { placement: "below", className: "tool-flyout-pp-select" });
  });

  // Expose a setter so callers can push external state back in
  // (e.g. rubber-band refresh) without re-creating the button.
  (btn as HTMLElement & { setValue?: (v: string) => void }).setValue =
    (v: string) => setValue(v, false);

  return btn;
}
