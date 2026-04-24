import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import { createTextBox, stickyBgFor } from "../text-utils.js";
/**
 * TextTool — unified Text / Sticky Note / Callout tool.
 *
 * Drag out a box (or click for default size), a contenteditable
 * overlay appears for input. On finish, the overlay is replaced by
 * a textbox <g> matching the tool's configured variant:
 *    plain   → text only, transparent background
 *    sticky  → text + colored background (classic sticky note)
 *    callout → text + background + pointer tail
 *
 * All variants share the same DOM skeleton (see text-utils.ts) so
 * SelectionManager's drag / resize logic is variant-agnostic.
 */
import { ToolBase } from "./tool-base.js";
import type { TextVariant, ToolOptions } from "./tool-base.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 80;

export class TextTool extends ToolBase {
  readonly name = "text";
  #editing = false;
  #editTarget: SVGGElement | null = null;
  #foreignObject: SVGForeignObjectElement | null = null;
  #editDiv: HTMLDivElement | null = null;

  onTextBoxChanged?: (newEl: SVGElement) => void;

  constructor(canvas: CanvasManager, history: History, options: ToolOptions) {
    super(canvas, history, options);
    this.#setupDoubleClick();
  }

  onPointerDown(_e: PointerEvent, pt: DOMPoint): void {
    if (this.#editing) {
      this.#finishEditing();
      return;
    }
    this.#startEditing(pt.x, pt.y, null);
  }

  onPointerMove(_e: PointerEvent, _pt: DOMPoint): void {}
  onPointerUp(_e: PointerEvent, _pt: DOMPoint): void {}

  onDeactivate(): void {
    if (this.#editing) this.#finishEditing();
  }

  #setupDoubleClick(): void {
    this.canvas.svg.addEventListener("dblclick", (e) => {
      const target = e.target as SVGElement;
      const g = target.closest("g[data-type='textbox']") as SVGGElement | null;
      if (!g || !this.canvas.annotations.contains(g)) return;
      e.stopPropagation();
      this.#editExisting(g);
    });
  }

  #editExisting(g: SVGGElement): void {
    if (this.#editing) this.#finishEditing();

    const bg = g.querySelector("rect") as SVGRectElement | null;
    const x = Number.parseFloat(bg?.getAttribute("x") || "0");
    const y = Number.parseFloat(bg?.getAttribute("y") || "0");
    const w = Number.parseFloat(bg?.getAttribute("width") || String(DEFAULT_WIDTH));
    const h = Number.parseFloat(bg?.getAttribute("height") || String(DEFAULT_HEIGHT));
    const text = g.getAttribute("data-text") || g.querySelector("text")?.textContent || "";
    const fontSize = Number.parseFloat(
      g.getAttribute("data-font-size") || String(this.options.fontSize),
    );
    const fontFamily =
      g.getAttribute("data-font-family") || (this.options.fontFamily ?? "sans-serif");
    const color = g.getAttribute("data-color") || this.options.strokeColor;

    const transform = g.getAttribute("transform") || "";
    const match = transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
    const tx = match ? Number.parseFloat(match[1]) : 0;
    const ty = match ? Number.parseFloat(match[2]) : 0;

    this.#editTarget = g;
    g.style.display = "none";

    this.#startEditing(x + tx, y + ty, { text, fontSize, fontFamily, color, width: w, height: h });
  }

  #startEditing(
    x: number,
    y: number,
    existing: {
      text: string;
      fontSize: number;
      fontFamily: string;
      color: string;
      width: number;
      height: number;
    } | null,
  ): void {
    this.#editing = true;

    const fontSize = existing?.fontSize || this.options.fontSize;
    const fontFamily = existing?.fontFamily || (this.options.fontFamily ?? "sans-serif");
    const color = existing?.color || this.options.strokeColor;
    const w = existing?.width || DEFAULT_WIDTH;
    const h = existing?.height || DEFAULT_HEIGHT;
    const variant: TextVariant = this.options.textVariant ?? "sticky";

    const fo = document.createElementNS(SVG_NS, "foreignObject");
    fo.setAttribute("x", String(x));
    fo.setAttribute("y", String(y));
    fo.setAttribute("width", String(w));
    fo.setAttribute("height", String(h));

    const showBg = variant !== "plain";
    const div = document.createElement("div");
    div.contentEditable = "true";
    div.style.cssText = `
      color: ${color};
      font-size: ${fontSize}px;
      font-family: ${fontFamily};
      background: ${showBg ? stickyBgFor(color) : "transparent"};
      border: ${showBg ? "1px solid rgba(0,0,0,0.15)" : "1px dashed rgba(0,0,0,0.25)"};
      border-radius: 4px;
      box-shadow: ${showBg ? "2px 2px 6px rgba(0,0,0,0.15)" : "none"};
      padding: 8px 10px;
      width: ${w - 2}px;
      height: ${h - 2}px;
      white-space: pre-wrap;
      word-wrap: break-word;
      line-height: 1.4;
      outline: none;
      overflow-y: auto;
      box-sizing: border-box;
    `;

    if (existing?.text) div.innerText = existing.text;

    fo.appendChild(div);
    this.canvas.annotations.appendChild(fo);

    this.#foreignObject = fo;
    this.#editDiv = div;

    requestAnimationFrame(() => {
      div.focus();
      const sel = window.getSelection();
      if (sel && div.lastChild) {
        sel.selectAllChildren(div);
        sel.collapseToEnd();
      }
    });

    div.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.#finishEditing();
      e.stopPropagation();
    });
  }

  #finishEditing(): void {
    if (!this.#foreignObject || !this.#editDiv) return;
    this.#editing = false;

    const text = this.#editDiv.innerText.trim();
    const foX = Number.parseFloat(this.#foreignObject.getAttribute("x")!);
    const foY = Number.parseFloat(this.#foreignObject.getAttribute("y")!);
    const foW = Number.parseFloat(this.#foreignObject.getAttribute("width")!);
    const foH = Number.parseFloat(this.#foreignObject.getAttribute("height")!);
    // Preserve existing styling on edit; fall back to tool options on new.
    const fontSize = this.#editTarget
      ? Number.parseFloat(
          this.#editTarget.getAttribute("data-font-size") || String(this.options.fontSize),
        )
      : this.options.fontSize;
    const fontFamily = this.#editTarget
      ? this.#editTarget.getAttribute("data-font-family") ||
        (this.options.fontFamily ?? "sans-serif")
      : (this.options.fontFamily ?? "sans-serif");
    const color = this.#editTarget
      ? this.#editTarget.getAttribute("data-color") || this.options.strokeColor
      : this.options.strokeColor;
    const variant: TextVariant = this.#editTarget
      ? (this.#editTarget.getAttribute("data-text-variant") as TextVariant) || "sticky"
      : (this.options.textVariant ?? "sticky");

    this.#foreignObject.remove();
    this.#foreignObject = null;
    this.#editDiv = null;

    if (this.#editTarget) {
      this.#editTarget.remove();
      this.#editTarget = null;
    }

    if (!text) return;

    const newEl = createTextBox({
      x: foX,
      y: foY,
      w: foW,
      h: foH,
      variant,
      text,
      fontSize,
      fontFamily,
      color,
    });
    this.canvas.annotations.appendChild(newEl);
    this.history.save();
    this.onTextBoxChanged?.(newEl);
    this.onShapeComplete?.(newEl);
  }
}
