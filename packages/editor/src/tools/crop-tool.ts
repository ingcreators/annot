import { ToolBase } from "./tool-base.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * CropTool — drag a rect to define the crop area; releasing the
 * pointer (or pressing Enter) opens the host's destructive-action
 * confirmation dialog. The dialog's Crop / Cancel buttons replace
 * the in-canvas buttons + hint a previous iteration shipped — those
 * were redundant with the dialog itself, and the hint message
 * suffered low contrast against image content. Press Escape any
 * time to discard the rect immediately without going through the
 * dialog.
 *
 * Visual feedback is a single `<path fill-rule="evenodd">` carrying
 * an outer subpath (current viewBox) and an inner subpath (the
 * drawn rect). With evenodd, fill applies inside outer XOR inside
 * inner — the crop area stays full-brightness, everything outside
 * dims at 50%. The punch-out STAYS VISIBLE while the dialog is
 * open so the user can verify what's about to be cropped before
 * confirming.
 *
 * Apply behaviour depends on whether the host wired the
 * destructive-bake gate via `onCropConfirmed`:
 *
 *   - Wired (PWA + VSCode + Desktop): the gate is responsible for
 *     showing the destructive-action dialog AND invoking
 *     `EditorShell.applyCrop`. The bitmap is replaced with the
 *     cropped pixels, the annotation tree shifts to the new
 *     origin, and the result is persisted to storage. On
 *     successful bake, `onShapeComplete` fires so the toolbar
 *     auto-switches back to Select (matching every other drawing
 *     tool's lifecycle). On dialog cancel, the rect stays so the
 *     user can adjust it via a fresh drag.
 *
 *   - Not wired (legacy): falls back to a session-only viewBox
 *     change on Enter. Useful as a quick "zoom into a rect"
 *     gesture but lost on reload. Kept so existing host wiring
 *     stays green during the rollout.
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
  #startX = 0;
  #startY = 0;
  #drawing = false;
  #hasRect = false;
  /** True while an `onCropConfirmed` round-trip is in flight, so a
   *  double-Enter / double-pointerup doesn't fire the bake twice. */
  #busy = false;

  override onActivate(): void {
    this.#group = document.createElementNS(SVG_NS, "g") as SVGGElement;
    this.#group.setAttribute("data-crop-overlay", "");
    this.canvas.uiOverlay.appendChild(this.#group);
  }

  override onDeactivate(): void {
    this.#cleanup();
  }

  onPointerDown(_e: PointerEvent, pt: DOMPoint): void {
    if (this.#busy) return;
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
    if (!this.#drawing) return;
    this.#drawing = false;
    // Releasing the pointer immediately opens the host's
    // confirmation dialog (when wired). The punch-out stays visible
    // behind the dialog so the user can verify "this is what gets
    // cropped" before confirming. Tiny rects (under 10×10) never
    // open the dialog — they're treated as a misclick, the rect
    // gets discarded silently.
    if (!this.#cropRect) return;
    void this.#applyCrop();
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
    if (this.#busy) return;
    const x = Number.parseFloat(this.#cropRect.getAttribute("x") || "0");
    const y = Number.parseFloat(this.#cropRect.getAttribute("y") || "0");
    const w = Number.parseFloat(this.#cropRect.getAttribute("width") || "0");
    const h = Number.parseFloat(this.#cropRect.getAttribute("height") || "0");
    if (w < 10 || h < 10) {
      this.#cleanup();
      return;
    }
    if (this.onCropConfirmed) {
      // Destructive bake path. Keep the punch-out visible while the
      // dialog is open so the user can verify the crop region; only
      // tear down the overlay AFTER a successful bake. Dialog cancel
      // leaves the rect in place — the user can drag a fresh rect to
      // adjust without re-entering the tool.
      this.#busy = true;
      let applied = false;
      try {
        applied = await this.onCropConfirmed(x, y, w, h);
      } finally {
        this.#busy = false;
      }
      if (applied) {
        // Bake succeeded. Tear the overlay down + fire
        // onShapeComplete so the toolbar auto-switches to Select
        // (matching every other drawing tool's lifecycle).
        this.#cleanup();
        this.onShapeComplete?.();
      }
      // History snapshot lives inside EditorShell.applyCrop — no
      // extra `history.save()` here so the snapshot count stays at
      // exactly one for the bake.
      return;
    }
    // Fallback: session-only viewBox crop (legacy behaviour for
    // hosts that haven't wired the gate yet).
    this.canvas.updateViewBox(x, y, w, h);
    this.canvas.setZoom(1);
    this.canvas.fitToView();
    this.#cleanup();
    this.history.save();
    this.onShapeComplete?.();
  }

  #cleanup(): void {
    this.#group?.remove();
    this.#group = null;
    this.#dimPath = null;
    this.#cropRect = null;
    this.#hasRect = false;
    this.#drawing = false;
  }
}
