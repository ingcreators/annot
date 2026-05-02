import { htmlToRuns, runsToHtml } from "@ingcreators/annot-core/editor/rich-text-mapper";
import {
  applyTextShapeColor,
  createTextShape,
  isTextOnShape,
  readTextShapeSpec,
  replaceRunsInPlace,
  stickyBgFor,
  type TextAnchor,
  type TextVerticalAnchor,
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
   *  bare `<rect>` to a text-on-shape wrapper (the user double-
   *  clicked a Shape-tool rect to add a label). On cancel-without-
   *  typing we roll the promotion back via `unwrapBareTextShape`
   *  so the canvas stays clean. */
  #promotedFromBareRect = false;
  /** Capture-phase pointerdown handler installed for the lifetime
   *  of an edit session so a click outside the contentEditable
   *  commits the edit (PowerPoint-style "outside click finishes
   *  text editing"). Without this, the user can drag the
   *  underlying shape while the editor is still open — the
   *  shape's transform changes but the editor overlay stays
   *  pinned to the original position. */
  #onOutsidePointerDown: ((e: PointerEvent) => void) | null = null;

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

    // Promote a bare `<rect>` drawn by ShapeTool / HighlightTool
    // to a text-on-shape wrapper, then enter the same edit flow.
    // Redact rects (`data-redact-style`) are excluded; the user's
    // expectation for those is "the black box hides content" not
    // "labelled shape".
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

    // Wrappers that already paint a visible body — text-on-shape
    // (rect / rounded / ellipse), sticky (yellow rounded body),
    // and callout (yellow body + tail wedge) — stay visible
    // during edit. Hiding ONLY the inner `<text>` child stops
    // the text from double-rendering behind the contentEditable
    // overlay; the overlay itself paints transparently on top
    // (see `#startEditing`'s `wrapperHasVisibleBody` branch),
    // so the body stays in view (callout's tail in particular).
    //
    // The `plain` variant is the lone outlier: its bg rect is
    // `fill="none" stroke="none"`, so there's no visible body
    // to keep. Hide the whole wrapper so the contentEditable
    // overlay's own dashed border is the only edit-mode chrome
    // the user sees.
    const shapeKind = g.getAttribute("data-shape-kind");
    const wrapperHasVisibleBody = isTextOnShape(g) || shapeKind === "sticky" || shapeKind === "callout";
    if (wrapperHasVisibleBody) {
      const existingText = g.querySelector("text");
      if (existingText instanceof SVGElement) existingText.style.display = "none";
    } else {
      g.style.display = "none";
    }

    this.#startEditing(spec.x + tx, spec.y + ty, {
      runs: spec.runs,
      fontSize: spec.fontSize,
      fontFamily: spec.fontFamily,
      color: spec.color,
      width: spec.w,
      height: spec.h,
      textAnchor: spec.textAnchor,
      textVerticalAnchor: spec.textVerticalAnchor,
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
      textAnchor?: TextAnchor;
      textVerticalAnchor?: TextVerticalAnchor;
    } | null,
  ): void {
    this.#editing = true;

    const fontSize = existing?.fontSize || this.options.fontSize;
    const fontFamily = existing?.fontFamily || (this.options.fontFamily ?? "sans-serif");
    const color = existing?.color || this.options.strokeColor;
    const w = existing?.width || DEFAULT_WIDTH;
    const h = existing?.height || DEFAULT_HEIGHT;
    // The contentEditable overlay paints a transparent body
    // whenever the underlying wrapper already has a visible body
    // (text-on-shape geometry, sticky's yellow rect, callout's
    // yellow rect + tail wedge — see `#editExisting`'s
    // `wrapperHasVisibleBody` branch). Painting a yellow bg on
    // top of those wrappers would either double-tint the body
    // or hide the callout's tail. The `plain` variant is the
    // lone wrapper-hidden case — the overlay needs its own
    // dashed border there to give the user some visual indication
    // of the edit area.
    const editTargetKind = this.#editTarget?.getAttribute("data-shape-kind") ?? null;
    const wrapperHasVisibleBody =
      this.#editTarget != null &&
      (isTextOnShape(this.#editTarget) ||
        editTargetKind === "sticky" ||
        editTargetKind === "callout");
    const variant: TextVariant = this.options.textVariant ?? "sticky";
    const showBg = !wrapperHasVisibleBody && variant !== "plain";

    // Resolve the wrapper's stored anchors so the editor's visible
    // layout matches the committed shape. Without this, a centered
    // shape would jump to top-left while the user is editing it,
    // which is visually disorienting AND moves the caret out of the
    // glyph the user clicked on. For a fresh draw the wrapper doesn't
    // exist yet — fall back to the active tool preset so the overlay
    // matches the alignment the user last picked on the Tool panel.
    const hAnchor: TextAnchor = existing?.textAnchor ?? this.options.textAnchor ?? "start";
    const vAnchor: TextVerticalAnchor =
      existing?.textVerticalAnchor ?? this.options.textVerticalAnchor ?? "top";
    const textAlign =
      hAnchor === "middle" ? "center" : hAnchor === "end" ? "right" : "left";
    const justifyContent =
      vAnchor === "middle" ? "center" : vAnchor === "bottom" ? "flex-end" : "flex-start";

    const fo = document.createElementNS(SVG_NS, "foreignObject");
    fo.setAttribute("x", String(x));
    fo.setAttribute("y", String(y));
    fo.setAttribute("width", String(w));
    fo.setAttribute("height", String(h));

    // Outer flex container handles VERTICAL alignment + the visible
    // chrome (border / background / padding). The inner div is the
    // contentEditable that handles HORIZONTAL alignment via
    // text-align. Splitting the two layers keeps the contentEditable
    // free of `display: flex`, which is known to cause caret-
    // placement quirks under contenteditable in some browsers.
    const outer = document.createElement("div");
    outer.style.cssText = wrapperHasVisibleBody
      ? `
      display: flex;
      flex-direction: column;
      justify-content: ${justifyContent};
      background: transparent;
      border: 1px dashed rgba(0,0,0,0.35);
      border-radius: 0;
      box-shadow: none;
      padding: 8px 10px;
      width: ${w}px;
      height: ${h}px;
      box-sizing: border-box;
      overflow: hidden;
    `
      : `
      display: flex;
      flex-direction: column;
      justify-content: ${justifyContent};
      background: ${showBg ? stickyBgFor(color) : "transparent"};
      border: ${showBg ? "1px solid rgba(0,0,0,0.15)" : "1px dashed rgba(0,0,0,0.25)"};
      border-radius: 4px;
      box-shadow: ${showBg ? "2px 2px 6px rgba(0,0,0,0.15)" : "none"};
      padding: 8px 10px;
      width: ${w - 2}px;
      height: ${h - 2}px;
      box-sizing: border-box;
      overflow: hidden;
    `;

    const div = document.createElement("div");
    div.contentEditable = "true";
    // `overflow: hidden` matches PowerPoint's behaviour (text
    // larger than the box clips); the user can resize the shape
    // or shrink the text via the autofit options. Browser-default
    // scrollbars no longer appear during edit.
    div.style.cssText = `
      color: ${color};
      font-size: ${fontSize}px;
      font-family: ${fontFamily};
      text-align: ${textAlign};
      width: 100%;
      white-space: pre-wrap;
      word-wrap: break-word;
      line-height: 1.4;
      outline: none;
      box-sizing: border-box;
    `;

    // Seed the contentEditable from the run array so per-character
    // formatting (bold / italic / underline) survives the round-trip.
    if (existing?.runs && existing.runs.length > 0) {
      div.innerHTML = runsToHtml(existing.runs);
    }

    outer.appendChild(div);
    fo.appendChild(outer);
    // The contentEditable overlay is editor-session UI, NOT a
    // user-visible annotation. Live in `canvas.uiOverlay` so the
    // SelectionManager / annotation enumerators don't pick it up
    // as a draggable shape — appending to `canvas.annotations`
    // would let the user grab the overlay's bbox handles and
    // move it independently of the underlying shape.
    this.canvas.uiOverlay.appendChild(fo);

    this.#foreignObject = fo;
    this.#editDiv = div;

    // Notify the PropertyPanel (and any other observer) that a
    // text edit session has begun. The panel flips into "Selected
    // Text" mode showing only the Text + Text box property
    // sections — the underlying shape's object-mode properties
    // (fill / stroke / variant picker) stay hidden until the
    // user commits / cancels the edit. The mode split matches
    // PowerPoint's "click selects the shape, dblclick enters text
    // editing" UX.
    if (this.#editTarget) {
      this.canvas.svg.dispatchEvent(
        new CustomEvent("annot:text-edit-start", {
          detail: { target: this.#editTarget },
          bubbles: false,
        }),
      );
    }

    // PowerPoint-style mini toolbar — Bold / Italic / Underline
    // toggles, font family / size dropdowns, A+ / A−, alignment,
    // color picker. Hovers above the active selection while a
    // non-empty range is selected; closes on `#finishEditing`.
    //
    // Alignment writes route to the OUTER wrapper element (the
    // `<g data-type="shape">`) rather than the contentEditable
    // span tree — Annot's text alignment is a shape-level layout
    // attribute (`data-text-anchor`), not a per-character span
    // style. The wrapper's `data-text-anchor` is consumed by
    // `replaceRunsInPlace` on commit.
    this.#miniToolbar = createTextMiniToolbar({
      host: div,
      onAlignmentChange: (anchor) => {
        const wrapper = this.#editTarget;
        if (wrapper) wrapper.setAttribute("data-text-anchor", anchor);
      },
    });

    // Outside-click commits the edit (PowerPoint-style). Without
    // this, the user could press-and-drag the underlying shape
    // while the editor is still open — the wrapper would move via
    // SelectionManager but the foreignObject stays pinned in the
    // ui-overlay layer at its original position, leaving the
    // textbox visually orphaned from the shape it belongs to.
    // Capture phase + pointerdown so the commit runs BEFORE the
    // SelectionManager's pointerdown gets a chance to start a
    // drag; the same pointerdown then bubbles down (foreignObject
    // gone) and the user's drag on the shape proceeds normally.
    //
    // Scoping: only canvas-SVG pointerdowns commit. Clicks on the
    // right panel (Align / Type / Fill controls), the floating
    // mini-toolbar in `document.body`, the top toolbar — anything
    // outside the canvas — must NOT commit, because the user may
    // be adjusting text-side properties of the active edit. The
    // SelectionManager's drag handlers live on the canvas SVG, so
    // restricting the commit to canvas-targeted pointerdowns
    // preserves the original drag-protection behaviour while
    // letting UI panels function normally during edit.
    const canvasSvg = this.canvas.svg;
    const onOutsidePointerDown = (e: PointerEvent): void => {
      if (!this.#foreignObject) return;
      const target = e.target as Node | null;
      if (target && this.#foreignObject.contains(target)) return;
      // Editor overlays in ui-overlay aren't reached by `contains`
      // when the click lands on the bare `<foreignObject>` rect
      // outside the inner contentEditable div. Both should be
      // treated as "inside" so the click doesn't accidentally
      // commit when the user is just clicking near the edge.
      if (target instanceof Node && fo.contains(target)) return;
      // Clicks outside the canvas SVG (right panel, mini-toolbar,
      // top toolbar, etc.) don't trigger drags and don't need to
      // commit. PowerPoint's textbox edit session stays open while
      // the user adjusts properties on the ribbon / format pane.
      if (!(target instanceof Node) || !canvasSvg.contains(target)) return;
      this.#finishEditing();
    };
    this.#onOutsidePointerDown = onOutsidePointerDown;
    document.addEventListener("pointerdown", onOutsidePointerDown, true);

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

  /**
   * Commit the active edit session. One unified path for every
   * text-shape variant — the wrapper is mutated in place if it
   * already exists (re-edit), or created via `createTextShape`
   * if not (fresh draw).
   *
   * Earlier revisions split the re-edit path into two: an in-place
   * mutation for text-on-shape wrappers (the ones built by
   * promoting a Shape-tool rect via `wrapBareRectForText` —
   * `data-shape-kind` ∈ rect / rounded / ellipse, see
   * `isTextOnShape`) and a remove-then-rebuild via
   * `createTextShape` for the variants the Text tool drew directly
   * (plain / sticky / callout). The rebuild path was a shortcut to
   * refresh the sticky / callout body tint after a text-color
   * change, but the rebuild also dropped any wrapper-level attribute
   * not reflected in `TextShapeSpec` (autofit, per-side margins, …),
   * forcing a hand-maintained carry-over list and producing the
   * "Autofit setting doesn't persist" symptom users reported.
   *
   * Mutating the wrapper in place across every variant fixes that
   * by construction: the wrapper's element identity is preserved,
   * so every `data-*` attribute, transform, and history reference
   * carries through automatically. The body-tint update that the
   * rebuild path used to provide moves into `applyTextShapeColor`
   * — a Tier B helper that derives the sticky / callout bg fill
   * from `stickyBgFor(textColor)` and skips the geometry primitive
   * for variants whose bg is the user's deliberate drawn color.
   */
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

    this.#miniToolbar?.close();
    this.#miniToolbar = null;
    this.#foreignObject.remove();
    this.#foreignObject = null;
    this.#editDiv = null;
    if (this.#onOutsidePointerDown) {
      document.removeEventListener("pointerdown", this.#onOutsidePointerDown, true);
      this.#onOutsidePointerDown = null;
    }

    if (this.#editTarget) {
      this.#commitReEdit(this.#editTarget, runs, flatText);
    } else {
      this.#commitFreshDraw(foX, foY, foW, foH, runs, flatText);
    }
  }

  /** Re-edit commit path. Mutates the existing wrapper in place
   *  so every wrapper-level attribute (transform, autofit, margins,
   *  variant-specific data-*) survives without an explicit carry-
   *  over list — element identity is preserved. */
  #commitReEdit(wrapper: SVGGElement, runs: TextRun[], flatText: string): void {
    this.#editTarget = null;
    const promoted = this.#promotedFromBareRect;
    this.#promotedFromBareRect = false;

    // Restore the wrapper's visibility — `#editExisting` hides the
    // WHOLE wrapper for auto-bg variants (plain / sticky / callout)
    // so only the contentEditable overlay paints the yellow bg
    // during edit. Without restoring it on commit, the wrapper stays
    // `display: none` and the yellow area + text both vanish (user
    // bug: "Sticky note の Autofit を変更すると黄色いエリアが透明
    // になって文字も見えなくなる" — the autofit / margin / color /
    // anchor changes during edit are fine; the symptom shows up
    // when the user commits the edit and the wrapper that's been
    // hidden the whole time fails to come back).
    //
    // Text-on-shape wrappers don't have `g.style.display` set
    // (only the inner `<text>` was hidden, so the user-drawn shape
    // stays visible underneath the overlay), but clearing
    // `g.style.display` is a no-op there — clearing both is
    // idempotent and keeps this branch single-path.
    wrapper.style.display = "";
    const innerText = wrapper.querySelector("text");
    if (innerText instanceof SVGElement) innerText.style.display = "";

    if (!flatText) {
      // Cancel-without-typing on a freshly-promoted bare-rect →
      // roll back the promotion so the canvas stays clean.
      if (promoted) unwrapBareTextShape(wrapper);
      this.canvas.svg.dispatchEvent(
        new CustomEvent("annot:text-edit-end", {
          detail: { target: wrapper },
          bubbles: false,
        }),
      );
      return;
    }

    // Read the wrapper's existing styling so a re-edit doesn't
    // silently revert font / color choices made via the property
    // panel between sessions.
    const fontSize = Number.parseFloat(
      wrapper.getAttribute("data-font-size") || String(this.options.fontSize),
    );
    const fontFamily =
      wrapper.getAttribute("data-font-family") || (this.options.fontFamily ?? "sans-serif");
    const color = wrapper.getAttribute("data-color") || this.options.strokeColor;

    wrapper.setAttribute("data-font-size", String(fontSize));
    wrapper.setAttribute("data-font-family", fontFamily);
    // `applyTextShapeColor` writes `data-color` + the inner
    // `<text>` fill, AND for sticky / callout variants also
    // refreshes the bg rect / tail fill so the body tint tracks
    // the text color the way it would after a fresh `createTextShape`.
    applyTextShapeColor(wrapper, color);
    replaceRunsInPlace(wrapper, runs);

    this.history.save();
    this.onTextBoxChanged?.(wrapper);
    this.onShapeComplete?.(wrapper);
    this.canvas.svg.dispatchEvent(
      new CustomEvent("annot:text-edit-end", { detail: { target: wrapper }, bubbles: false }),
    );
  }

  /** Fresh-draw commit path. No existing wrapper, so `createTextShape`
   *  builds one from the active tool preset and the foreignObject's
   *  bounds. */
  #commitFreshDraw(
    x: number,
    y: number,
    w: number,
    h: number,
    runs: TextRun[],
    flatText: string,
  ): void {
    this.#promotedFromBareRect = false;

    if (!flatText) {
      this.canvas.svg.dispatchEvent(
        new CustomEvent("annot:text-edit-end", {
          detail: { target: null },
          bubbles: false,
        }),
      );
      return;
    }

    const fontSize = this.options.fontSize;
    const fontFamily = this.options.fontFamily ?? "sans-serif";
    const color = this.options.strokeColor;
    const variant: TextVariant = this.options.textVariant ?? "sticky";

    const newEl = createTextShape({
      x,
      y,
      w,
      h,
      variant,
      runs,
      fontSize,
      fontFamily,
      color,
      textAnchor: this.options.textAnchor,
      textVerticalAnchor: this.options.textVerticalAnchor,
    });
    this.canvas.annotations.appendChild(newEl);
    this.history.save();
    this.onTextBoxChanged?.(newEl);
    this.onShapeComplete?.(newEl);
    this.canvas.svg.dispatchEvent(
      new CustomEvent("annot:text-edit-end", { detail: { target: newEl }, bubbles: false }),
    );
  }
}
