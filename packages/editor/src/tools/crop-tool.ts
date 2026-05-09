import { ToolBase } from "./tool-base.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * CropTool — drag a rect, then either press Enter / click Apply to
 * commit the crop, or press Escape / click Cancel to discard the
 * pending rect.
 *
 * Visual feedback uses a single `<path>` with `fill-rule="evenodd"`
 * — outer rect (current viewBox) + inner rect (the drawn crop) =
 * dim everything OUTSIDE the crop, leave the crop itself
 * full-brightness. The previous "overlay rect + half-finished
 * clipPath" implementation set `clip-path="none"` on the overlay
 * which made the punch-through never apply, leaving the user
 * looking at a fully dimmed image with no preview of the area
 * they were about to keep.
 *
 * Apply behaviour depends on whether the host wired up the
 * destructive-bake gate via `onCropConfirmed`:
 *
 *   - Wired (PWA + future hosts): the gate is responsible for
 *     showing a destructive-action confirmation dialog AND
 *     invoking `EditorShell.applyCrop`. The bitmap is replaced
 *     with the cropped pixels, the annotation tree is shifted to
 *     the new origin, and the result is persisted to storage.
 *     `Ctrl+Z` reverts within the session; after save, the
 *     cropped-out pixels are gone for good.
 *
 *   - Not wired (legacy): falls back to a session-only viewBox
 *     change. Still useful as a quick "zoom into a rect" gesture
 *     but lost on reload. This is the pre-Phase behaviour kept as
 *     a fallback so existing host wiring stays green during the
 *     rollout.
 *
 * Apply / Cancel buttons render inside the SVG `ui-overlay` via a
 * `<foreignObject>`, anchored to the bottom-right corner of the
 * crop rect. Keyboard shortcuts (Enter / Escape) work in parallel
 * — the buttons are an opt-in discoverability aid, not a
 * replacement for power-user keyboard flow.
 */
export class CropTool extends ToolBase {
  readonly name = "crop";

  /** Confirm-then-apply gate the host wires up. Receives the crop
   *  rect in world (viewBox) coordinates. Resolves `true` if the
   *  bake was applied, `false` if the user cancelled the dialog.
   *  When `null` / unset, the tool falls back to the session-only
   *  viewBox crop documented in the class comment. */
  onCropConfirmed: ((x: number, y: number, w: number, h: number) => Promise<boolean>) | null = null;

  #group: SVGGElement | null = null;
  #dimPath: SVGPathElement | null = null;
  #cropRect: SVGRectElement | null = null;
  #hint: SVGTextElement | null = null;
  #buttonsHost: SVGForeignObjectElement | null = null;
  #applyBtn: HTMLButtonElement | null = null;
  #cancelBtn: HTMLButtonElement | null = null;
  #startX = 0;
  #startY = 0;
  #drawing = false;
  #hasRect = false;
  /** True while an `onCropConfirmed` round-trip is in flight, so a
   *  double-Enter / double-click doesn't fire the bake twice. */
  #busy = false;

  override onActivate(): void {
    this.#group = document.createElementNS(SVG_NS, "g") as SVGGElement;
    this.#group.setAttribute("data-crop-overlay", "");
    this.canvas.uiOverlay.appendChild(this.#group);
    this.#renderHint();
  }

  override onDeactivate(): void {
    this.#cleanup();
  }

  onPointerDown(_e: PointerEvent, pt: DOMPoint): void {
    if (!this.#group) {
      // Defensive — pointerdown fired without onActivate (shouldn't
      // happen via CanvasManager's wiring, but stay robust).
      this.onActivate();
    }
    this.#drawing = true;
    this.#hasRect = true;
    this.#startX = pt.x;
    this.#startY = pt.y;
    this.#renderOverlay(pt.x, pt.y, 0, 0);
  }

  onPointerMove(_e: PointerEvent, pt: DOMPoint): void {
    if (!this.#drawing) return;
    const x = Math.min(this.#startX, pt.x);
    const y = Math.min(this.#startY, pt.y);
    const w = Math.abs(pt.x - this.#startX);
    const h = Math.abs(pt.y - this.#startY);
    this.#renderOverlay(x, y, w, h);
  }

  onPointerUp(_e: PointerEvent, _pt: DOMPoint): void {
    this.#drawing = false;
    // After the drag ends, surface the Apply / Cancel buttons so the
    // user has a discoverable affordance even if they didn't read
    // the hint about Enter / Escape.
    this.#renderButtons();
  }

  override onKeyDown(e: KeyboardEvent): void {
    if (this.#busy) return;
    if (e.key === "Enter" && this.#hasRect) {
      e.preventDefault();
      void this.#applyCrop();
    } else if (e.key === "Escape") {
      this.#cleanup();
    }
  }

  #renderOverlay(x: number, y: number, w: number, h: number): void {
    const group = this.#group;
    if (!group) return;
    const vb = this.#getViewBox();

    if (!this.#dimPath) {
      const p = document.createElementNS(SVG_NS, "path") as SVGPathElement;
      p.setAttribute("fill", "rgba(0,0,0,0.5)");
      p.setAttribute("fill-rule", "evenodd");
      p.setAttribute("pointer-events", "none");
      // Insert behind the crop rect so the dashed outline draws on top.
      group.insertBefore(p, group.firstChild);
      this.#dimPath = p;
    }
    // Outer subpath = the entire visible viewBox; inner subpath = the
    // crop rect. With `fill-rule="evenodd"`, fill applies where a
    // point is inside an odd number of subpaths — i.e. inside the
    // outer but NOT inside the inner. That's the dim-outside-keep-
    // crop-bright effect we want.
    const outer = `M ${vb.x} ${vb.y} h ${vb.w} v ${vb.h} h ${-vb.w} Z`;
    const inner = w > 0 && h > 0 ? `M ${x} ${y} h ${w} v ${h} h ${-w} Z` : "";
    this.#dimPath.setAttribute("d", inner ? `${outer} ${inner}` : outer);

    if (!this.#cropRect) {
      const r = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
      r.setAttribute("stroke", "#00d4ff");
      r.setAttribute("stroke-width", "2");
      r.setAttribute("vector-effect", "non-scaling-stroke");
      r.setAttribute("stroke-dasharray", "6 4");
      r.setAttribute("fill", "none");
      r.setAttribute("pointer-events", "none");
      group.appendChild(r);
      this.#cropRect = r;
    }
    this.#cropRect.setAttribute("x", String(x));
    this.#cropRect.setAttribute("y", String(y));
    this.#cropRect.setAttribute("width", String(w));
    this.#cropRect.setAttribute("height", String(h));

    // Keep the buttons (if already shown) tracking the rect's
    // bottom-right corner across drag continuations.
    this.#positionButtons();
  }

  #renderHint(): void {
    const group = this.#group;
    if (!group) return;
    const vb = this.#getViewBox();
    const hint = document.createElementNS(SVG_NS, "text") as SVGTextElement;
    // Position relative to the CURRENT viewBox so the hint stays in
    // the visible top-left even if the user has previously cropped.
    hint.setAttribute("x", String(vb.x + 10));
    hint.setAttribute("y", String(vb.y + 30));
    hint.setAttribute("fill", "#00d4ff");
    hint.setAttribute("font-size", "16");
    hint.setAttribute("font-family", "sans-serif");
    hint.setAttribute("pointer-events", "none");
    hint.textContent =
      "Draw crop area, then click Apply / press Enter to confirm or Cancel / Escape to discard";
    group.appendChild(hint);
    this.#hint = hint;
  }

  /** Mount the Apply / Cancel button pair via a `<foreignObject>` so
   *  we get real `<button>` elements (focus management, hover
   *  styles, click area) instead of having to draw + hit-test SVG
   *  shapes ourselves. Idempotent — re-renders attach the existing
   *  pair instead of creating a second one. */
  #renderButtons(): void {
    const group = this.#group;
    if (!group || !this.#cropRect) return;
    if (!this.#buttonsHost) {
      const fo = document.createElementNS(SVG_NS, "foreignObject") as SVGForeignObjectElement;
      // Width / height are sized at #positionButtons time. Initial
      // dims are placeholders; the foreignObject hides any overflow
      // so a too-small box just clips the buttons rather than
      // throwing.
      fo.setAttribute("width", "200");
      fo.setAttribute("height", "44");
      fo.setAttribute("data-crop-buttons", "");
      group.appendChild(fo);
      this.#buttonsHost = fo;

      const wrap = document.createElementNS(XHTML_NS, "div") as HTMLDivElement;
      wrap.setAttribute("class", "annot-crop-buttons");
      // Inline minimal styling so the buttons render legibly even
      // when the host's stylesheet hasn't shipped a rule for the
      // class yet. Hosts are free to override via the `class` hook.
      wrap.style.cssText =
        "display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:6px;";
      fo.appendChild(wrap);

      const cancelBtn = document.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.cssText =
        "padding:4px 12px;border-radius:4px;border:1px solid #888;" +
        "background:#222;color:#eee;font:13px sans-serif;cursor:pointer;";
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.#busy) return;
        this.#cleanup();
      });
      // Stop pointer events from bubbling to the canvas — otherwise
      // the click would also land on `pointerdown` and start a new
      // crop rect.
      cancelBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      wrap.appendChild(cancelBtn);
      this.#cancelBtn = cancelBtn;

      const applyBtn = document.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
      applyBtn.type = "button";
      applyBtn.textContent = "Apply";
      applyBtn.style.cssText =
        "padding:4px 12px;border-radius:4px;border:1px solid #00d4ff;" +
        "background:#00d4ff;color:#001018;font:600 13px sans-serif;cursor:pointer;";
      applyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.#busy) return;
        void this.#applyCrop();
      });
      applyBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      wrap.appendChild(applyBtn);
      this.#applyBtn = applyBtn;
    }
    this.#positionButtons();
  }

  /** Anchor the Apply / Cancel pair to the bottom-right corner of
   *  the crop rect, with a small inset so the buttons don't sit
   *  flush against the dashed outline. */
  #positionButtons(): void {
    const fo = this.#buttonsHost;
    const rect = this.#cropRect;
    if (!fo || !rect) return;
    const rx = Number.parseFloat(rect.getAttribute("x") || "0");
    const ry = Number.parseFloat(rect.getAttribute("y") || "0");
    const rw = Number.parseFloat(rect.getAttribute("width") || "0");
    const rh = Number.parseFloat(rect.getAttribute("height") || "0");
    // Button host is 200 × 44 in viewBox units. For the typical
    // <800×600 image this is plenty; for very small crops the
    // buttons may overflow the rect to the right — that's
    // acceptable, the buttons remain on screen because the canvas
    // svg's overflow is visible by default in most hosts.
    const w = 200;
    const h = 44;
    fo.setAttribute("x", String(rx + rw - w));
    fo.setAttribute("y", String(ry + rh + 4));
    fo.setAttribute("width", String(w));
    fo.setAttribute("height", String(h));
  }

  /** Read the current viewBox from the live SVG. Prefers the
   *  `SVGSVGElement.viewBox.baseVal` API when available (real
   *  browsers); falls back to parsing the attribute string for
   *  happy-dom / jsdom unit tests. */
  #getViewBox(): { x: number; y: number; w: number; h: number } {
    const vbAnimated = (this.canvas.svg as SVGSVGElement).viewBox;
    const baseVal = vbAnimated?.baseVal;
    if (baseVal && baseVal.width > 0 && baseVal.height > 0) {
      return {
        x: baseVal.x,
        y: baseVal.y,
        w: baseVal.width,
        h: baseVal.height,
      };
    }
    const attr = this.canvas.svg.getAttribute("viewBox") || "";
    const parts = attr.split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { x: parts[0]!, y: parts[1]!, w: parts[2]!, h: parts[3]! };
    }
    return {
      x: 0,
      y: 0,
      w: this.canvas.imageWidth,
      h: this.canvas.imageHeight,
    };
  }

  async #applyCrop(): Promise<void> {
    if (!this.#cropRect) return;
    const x = Number.parseFloat(this.#cropRect.getAttribute("x") || "0");
    const y = Number.parseFloat(this.#cropRect.getAttribute("y") || "0");
    const w = Number.parseFloat(this.#cropRect.getAttribute("width") || "0");
    const h = Number.parseFloat(this.#cropRect.getAttribute("height") || "0");
    if (w < 10 || h < 10) {
      this.#cleanup();
      return;
    }
    if (this.onCropConfirmed) {
      // Destructive bake path. Hide the overlay BEFORE the dialog
      // opens so the dim-outside-the-crop visual stays out of the
      // user's way while they read the confirmation prompt; cleanup
      // also disables the buttons against double-click. The host's
      // gate handles the dialog + the EditorShell.applyCrop call;
      // we just trust its boolean resolution.
      this.#busy = true;
      this.#cleanup();
      try {
        await this.onCropConfirmed(x, y, w, h);
      } finally {
        this.#busy = false;
      }
      // History snapshot lives inside EditorShell.applyCrop — no
      // extra `history.save()` here so the snapshot count stays at
      // exactly one for the bake.
      return;
    }
    // Fallback: session-only viewBox crop (legacy behaviour).
    this.canvas.updateViewBox(x, y, w, h);
    this.canvas.setZoom(1);
    this.canvas.fitToView();
    this.#cleanup();
    this.history.save();
  }

  #cleanup(): void {
    this.#group?.remove();
    this.#group = null;
    this.#dimPath = null;
    this.#cropRect = null;
    this.#hint = null;
    this.#buttonsHost = null;
    this.#applyBtn = null;
    this.#cancelBtn = null;
    this.#hasRect = false;
    this.#drawing = false;
  }
}
