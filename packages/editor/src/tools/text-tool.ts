import { htmlToRuns, runsToHtml } from "@ingcreators/annot-core/editor/rich-text-mapper";
import {
  createTextShape,
  readTextShapeSpec,
  replaceRunsInPlace,
  stickyBgFor,
  unwrapBareTextShape,
  wrapBareRectForText,
} from "@ingcreators/annot-core/editor/text-utils";
import type { TextRun } from "@ingcreators/annot-core/tauri-bridge";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import { createTextMiniToolbar, type TextMiniToolbarHandle } from "../text-mini-toolbar.js";
import type { TextVariant, ToolOptions } from "./tool-base.js";
/**
 * TextTool — unified Text / Sticky Note / Callout tool.
 *
 * Drag out a box (or click for default size), a contenteditable
 * overlay appears for input. On finish, the overlay is replaced by
 * a text-bearing shape <g> matching the tool's configured variant:
 *    plain   → text only, transparent background
 *    sticky  → text + colored background (classic sticky note)
 *    callout → text + background + pointer tail
 *
 * All variants share the same DOM skeleton (see text-utils.ts) so
 * SelectionManager's drag / resize logic is variant-agnostic.
 */
import { ToolBase } from "./tool-base.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 80;

/** Per-SVG state pinned to the dblclick singleton listener. The
 *  listener stays armed for the lifetime of the SVG; the `active`
 *  pointer changes every time a fresh `TextTool` is constructed
 *  so the latest instance owns the edit flow. */
interface TextToolDblclickMeta {
  installed: boolean;
  active: TextTool | null;
}

const TEXT_TOOL_DBLCLICK_META = Symbol("annot:text-tool-dblclick");

function textToolDblclickMeta(svg: SVGSVGElement): TextToolDblclickMeta {
  const carrier = svg as SVGSVGElement & {
    [TEXT_TOOL_DBLCLICK_META]?: TextToolDblclickMeta;
  };
  let meta = carrier[TEXT_TOOL_DBLCLICK_META];
  if (!meta) {
    meta = { installed: false, active: null };
    carrier[TEXT_TOOL_DBLCLICK_META] = meta;
  }
  return meta;
}

export class TextTool extends ToolBase {
  readonly name = "text";
  #editing = false;
  #editTarget: SVGGElement | null = null;
  #foreignObject: SVGForeignObjectElement | null = null;
  #editDiv: HTMLDivElement | null = null;
  #miniToolbar: TextMiniToolbarHandle | null = null;
  /** Set when the current edit session was opened by promoting a
   *  bare `<rect>` (Pattern A double-click). On cancel-without-
   *  typing we roll the promotion back via `unwrapBareTextShape`
   *  so the canvas stays clean. */
  #promotedFromBareRect = false;

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

  override onDeactivate(): void {
    if (this.#editing) this.#finishEditing();
    // Intentionally KEEP `meta.active` pointing at this instance
    // (or whichever later TextTool reclaimed ownership). The
    // listener stays installed on the SVG and the active pointer
    // stays valid so re-editing existing text works even when
    // another tool is the user's current pick on the toolbar
    // (PowerPoint-style: dblclick a textbox always opens its
    // editor, regardless of what's selected on the toolbar).
    // The next TextTool activation reclaims ownership in
    // `#setupDoubleClick`.
  }

  #setupDoubleClick(): void {
    // Singleton listener pattern: every TextTool instance points
    // the SVG-level "active TextTool" pointer at itself, but the
    // dblclick listener is installed exactly once per SVG. The
    // listener delegates to whichever instance currently owns
    // the pointer, so:
    //   - The latest TextTool's options / private state drive
    //     the edit flow (a fresh activation supersedes the prior
    //     instance without leaving stale handlers behind).
    //   - The listener stays armed across tool deactivations so
    //     dblclick-to-edit works regardless of the active tool.
    //   - No duplication symptom from N parallel listeners
    //     racing on the same dblclick.
    const meta = textToolDblclickMeta(this.canvas.svg);
    meta.active = this;
    if (meta.installed) return;
    meta.installed = true;
    this.canvas.svg.addEventListener("dblclick", (e) => {
      const tool = textToolDblclickMeta(this.canvas.svg).active;
      if (!tool) return;
      tool.#handleDblclick(e);
    });
  }

  #handleDblclick(e: Event): void {
    const target = e.target as SVGElement;

    // Existing text-bearing shape — straight to the edit flow.
    const g = target.closest("g[data-type='shape']") as SVGGElement | null;
    if (g && this.canvas.annotations.contains(g)) {
      e.stopPropagation();
      this.#editExisting(g);
      return;
    }

    // Pattern A — promote a bare `<rect>` drawn by ShapeTool /
    // HighlightTool into the unified shape skeleton, then enter
    // the same edit flow. Redact rects (`data-redact-style`)
    // are excluded; the user's expectation for those is "the
    // black box hides content" not "labelled shape".
    const bareRect = target.closest("rect") as SVGRectElement | null;
    if (
      bareRect &&
      bareRect.parentNode === this.canvas.annotations &&
      !bareRect.hasAttribute("data-redact-style")
    ) {
      e.stopPropagation();
      const wrapper = wrapBareRectForText(bareRect);
      this.#promotedFromBareRect = true;
      this.#editExisting(wrapper);
    }
  }

  #editExisting(g: SVGGElement): void {
    if (this.#editing) this.#finishEditing();

    // Read the spec via the canonical text-utils reader so per-tspan
    // formatting flows into the contentEditable as styled HTML.
    const spec = readTextShapeSpec(g);

    const transform = g.getAttribute("transform") || "";
    const match = transform.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
    // Both capture groups are required by the regex, so `match[1]` /
    // `match[2]` are present when `match` is truthy.
    const tx = match ? Number.parseFloat(match[1]!) : 0;
    const ty = match ? Number.parseFloat(match[2]!) : 0;

    this.#editTarget = g;
    g.style.display = "none";

    this.#startEditing(spec.x + tx, spec.y + ty, {
      runs: spec.runs,
      fontSize: spec.fontSize,
      fontFamily: spec.fontFamily,
      color: spec.color,
      width: spec.w,
      height: spec.h,
    });
  }

  #startEditing(
    x: number,
    y: number,
    existing: {
      runs: TextRun[];
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

    // Seed the contentEditable from the run array so per-character
    // formatting (bold / italic / underline) survives the round-trip.
    if (existing?.runs && existing.runs.length > 0) {
      div.innerHTML = runsToHtml(existing.runs);
    }

    fo.appendChild(div);
    this.canvas.annotations.appendChild(fo);

    this.#foreignObject = fo;
    this.#editDiv = div;

    // Floating Bold / Italic / Underline toolbar — shows above the
    // active selection while a non-empty range is selected. Closes
    // automatically on `#finishEditing`.
    this.#miniToolbar = createTextMiniToolbar({ host: div });

    requestAnimationFrame(() => {
      div.focus();
      const sel = window.getSelection();
      if (sel && div.lastChild) {
        sel.selectAllChildren(div);
        sel.collapseToEnd();
      }
    });

    div.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.#finishEditing();
        return;
      }
      // Phase 2: Ctrl+B / Ctrl+I / Ctrl+U toggle inline formatting
      // on the active selection (or the next-typed character if the
      // selection is collapsed). Uses the deprecated-but-still-canonical
      // execCommand path that contentEditable hosts continue to
      // support; the floating mini-toolbar offers a fallback affordance.
      if (e.ctrlKey || e.metaKey) {
        const cmd =
          e.key === "b" || e.key === "B"
            ? "bold"
            : e.key === "i" || e.key === "I"
              ? "italic"
              : e.key === "u" || e.key === "U"
                ? "underline"
                : null;
        if (cmd) {
          e.preventDefault();
          if (typeof document.execCommand === "function") {
            document.execCommand(cmd);
          }
          return;
        }
      }
      e.stopPropagation();
    });
  }

  #finishEditing(): void {
    if (!this.#foreignObject || !this.#editDiv) return;
    this.#editing = false;

    // Read styled runs from the contentEditable's HTML so inline
    // bold / italic / underline / span overrides survive the commit.
    const runs = htmlToRuns(this.#editDiv);
    const flatText = runs
      .map((r) => r.text)
      .join("")
      .trim();
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
    const shapeKindAttr = this.#editTarget?.getAttribute("data-shape-kind") ?? null;
    const isPatternA =
      shapeKindAttr === "rect" || shapeKindAttr === "rounded" || shapeKindAttr === "ellipse";

    this.#miniToolbar?.close();
    this.#miniToolbar = null;
    this.#foreignObject.remove();
    this.#foreignObject = null;
    this.#editDiv = null;

    // Pattern A path — the user double-clicked a bare shape;
    // we wrapped it then opened the editor. The wrapper carries
    // the shape's geometry (rect / rounded / ellipse) so we
    // rewrite the `<text>` content in place rather than building
    // a fresh sticky / callout `<g>` that would replace the
    // user's original geometry.
    if (this.#editTarget && isPatternA) {
      const wrapper = this.#editTarget;
      this.#editTarget = null;
      const promoted = this.#promotedFromBareRect;
      this.#promotedFromBareRect = false;

      if (!flatText) {
        // Cancel-without-typing on a freshly-promoted shape →
        // roll back the promotion so the canvas stays clean.
        if (promoted) unwrapBareTextShape(wrapper);
        else wrapper.style.display = ""; // existing wrapped shape — just unhide
        return;
      }

      // Persist text formatting on the wrapper so a later
      // re-edit reads the same defaults.
      wrapper.setAttribute("data-font-size", String(fontSize));
      wrapper.setAttribute("data-font-family", fontFamily);
      wrapper.setAttribute("data-color", color);
      replaceRunsInPlace(wrapper, runs);
      wrapper.style.display = "";

      this.history.save();
      this.onTextBoxChanged?.(wrapper);
      this.onShapeComplete?.(wrapper);
      return;
    }

    // Legacy plain / sticky / callout path — the entire wrapper
    // gets rebuilt from scratch via `createTextShape` so the bg
    // tint follows any color change made during the edit.
    const variant: TextVariant = this.#editTarget
      ? (shapeKindAttr as TextVariant) || "sticky"
      : (this.options.textVariant ?? "sticky");

    if (this.#editTarget) {
      this.#editTarget.remove();
      this.#editTarget = null;
    }
    this.#promotedFromBareRect = false;

    if (!flatText) return;

    const newEl = createTextShape({
      x: foX,
      y: foY,
      w: foW,
      h: foH,
      variant,
      runs,
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
