import { stampAnnotVersion } from "@ingcreators/annot-core/editor/svg-format";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Minimal structural shape canvas-manager needs from an active
 * tool. The full `ToolBase` class lives in `@ingcreators/annot-editor/tools/tool-base`
 * — referencing it here would create a circular package
 * dependency (annot-core → annot-editor) once Phase 2 of
 * `docs/plans/three-package-split.md` lands. TypeScript's
 * structural typing means any `ToolBase` instance assigns to
 * this interface without an explicit `implements` clause.
 */
interface CanvasActiveTool {
  /** Discriminator string ToolBase subclasses set so call sites can
   *  branch on tool identity (e.g. `if (active.name === "freehand")`).
   *  Made optional here so future Tier C Active-tool interfaces with
   *  different naming conventions don't have to satisfy the field. */
  readonly name?: string;
  onActivate?(): void;
  onDeactivate?(): void;
  onPointerDown(e: PointerEvent, pt: DOMPoint): void;
  onPointerMove(e: PointerEvent, pt: DOMPoint): void;
  onPointerUp(e: PointerEvent, pt: DOMPoint): void;
  onKeyDown?(e: KeyboardEvent): void;
}

export class CanvasManager {
  readonly svg: SVGSVGElement;
  readonly defs: SVGDefsElement;
  readonly imageEl: SVGImageElement;
  readonly annotations: SVGGElement;
  readonly uiOverlay: SVGGElement;

  #imageWidth: number;
  #imageHeight: number;
  #zoom = 1;
  /** True while the canvas is in "Fit to window" mode. fitToView()
   *  enters it; any explicit setZoom(numericValue) exits it. The
   *  host observes container resizes and calls refitIfFitMode() so
   *  the fit stays correct across window resizes and right-panel
   *  open/close — consistent with Figma / Draw.io behavior. */
  #fitMode = false;
  #activeTool: CanvasActiveTool | null = null;
  #isPanning = false;
  #panStartX = 0;
  #panStartY = 0;
  /** Controls the lifetime of every DOM listener this manager attaches.
   *  Aborting in destroy() prevents listener accumulation when the
   *  editor reuses the same svg element across sessions. */
  #abort = new AbortController();

  onZoomChange?: (zoom: number) => void;
  /** Fired when the user right-clicks on the canvas. The host (Toolbar)
   *  subscribes to this and opens the Insert-Here context menu. Leaving
   *  this unset means right-click is a no-op — the browser's native
   *  context menu is still suppressed to prevent an unexpected stock
   *  menu from appearing on top of the editor UI. */
  onContextMenu?: (e: MouseEvent, pt: DOMPoint) => void;

  constructor(svg: SVGSVGElement, dataUrl: string, width: number, height: number) {
    this.svg = svg;
    this.#imageWidth = width;
    this.#imageHeight = height;

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));

    // Stamp the Annot SVG format version on the live root so every
    // clone-based serialization path (exportSVGString,
    // exportAnnotationsSVGString, …) inherits it automatically. See
    // svg-format.ts + docs/svg-format.md for the versioning contract.
    stampAnnotVersion(svg);

    // Defs
    this.defs = document.createElementNS(SVG_NS, "defs");
    this.#createArrowMarker();
    svg.appendChild(this.defs);

    // Base image
    this.imageEl = document.createElementNS(SVG_NS, "image");
    this.imageEl.setAttribute("href", dataUrl);
    this.imageEl.setAttribute("width", String(width));
    this.imageEl.setAttribute("height", String(height));
    svg.appendChild(this.imageEl);

    // Annotations group
    this.annotations = document.createElementNS(SVG_NS, "g");
    this.annotations.id = "annotations";
    svg.appendChild(this.annotations);

    // UI overlay (selection handles, etc.)
    this.uiOverlay = document.createElementNS(SVG_NS, "g");
    this.uiOverlay.id = "ui-overlay";
    svg.appendChild(this.uiOverlay);

    this.#setupEvents();
    this.fitToView();
  }

  get imageWidth(): number {
    return this.#imageWidth;
  }
  get imageHeight(): number {
    return this.#imageHeight;
  }
  get zoom(): number {
    return this.#zoom;
  }

  setActiveTool(tool: CanvasActiveTool | null): void {
    this.#activeTool?.onDeactivate?.();
    this.#activeTool = tool;
    this.#activeTool?.onActivate?.();
    this.svg.style.cursor = tool ? "crosshair" : "default";
  }

  get activeTool(): CanvasActiveTool | null {
    return this.#activeTool;
  }

  /** Release all DOM listeners this manager attached. */
  destroy(): void {
    this.#abort.abort();
  }

  svgPoint(e: MouseEvent | PointerEvent): DOMPoint {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = this.svg.getScreenCTM();
    if (ctm) {
      return pt.matrixTransform(ctm.inverse());
    }
    return pt;
  }

  fitToView(): void {
    const container = this.svg.parentElement;
    if (!container) return;
    const cw = container.clientWidth - 40;
    const ch = container.clientHeight - 40;
    const scale = Math.min(cw / this.#imageWidth, ch / this.#imageHeight, 1);
    // setZoom() clears fitMode as a side-effect (any zoom call is
    // assumed to be user-initiated and exit fit). Re-set it here
    // because THIS call IS the fit that should persist.
    this.setZoom(scale);
    this.#fitMode = true;
    this.onZoomChange?.(this.#zoom);
  }

  /** Re-run fitToView() only if the canvas is currently in fit mode.
   *  Hosts call this from a ResizeObserver so the canvas stays fitted
   *  as the viewport (or the surrounding panels) change size. */
  refitIfFitMode(): void {
    if (this.#fitMode) this.fitToView();
  }

  /** True when the canvas is tracking the viewport via "Fit to window"
   *  mode. Hosts can use this to highlight the "Fit" menu item and
   *  label the zoom chip as "Fit" instead of "N%". */
  get isFitMode(): boolean {
    return this.#fitMode;
  }

  setZoom(z: number): void {
    this.#zoom = Math.max(0.1, Math.min(z, 5));
    // Any explicit zoom set exits fit mode (the user is requesting
    // a specific zoom level, not "whatever fits"). fitToView() re-
    // enables it right after calling this, so fit-driven zoom sets
    // land in fit mode correctly.
    this.#fitMode = false;
    const w = Math.round(this.#imageWidth * this.#zoom);
    const h = Math.round(this.#imageHeight * this.#zoom);
    this.svg.setAttribute("width", String(w));
    this.svg.setAttribute("height", String(h));
    this.svg.style.width = `${w}px`;
    this.svg.style.height = `${h}px`;
    this.onZoomChange?.(this.#zoom);
  }

  /**
   * Legacy `anno-arrowhead` marker def.
   *
   * Historically this file generated a 45-marker matrix (6 shapes ×
   * 3 widths × 3 lengths) for the old SVG-marker-based arrow
   * rendering. After the arrow-markers.ts refactor, ArrowTool now
   * produces self-contained composed-path `<g data-type="arrow">`
   * elements that don't reference any marker id, so those 45
   * markers are no longer needed.
   *
   * We keep the single `anno-arrowhead` def as a safety net for
   * annotation content drawn by the pre-refactor toolbar (which
   * wrote `marker-end="url(#anno-arrowhead)"` on `<line>` elements).
   * When such content is loaded, this marker lets it render without
   * a migration step.
   */
  #createArrowMarker(): void {
    // Legacy alias. Keeps old saved files with `url(#anno-arrowhead)`
    // rendering correctly — renders identically to an "md/md" triangle.
    const legacy = document.createElementNS(SVG_NS, "marker");
    legacy.id = "anno-arrowhead";
    legacy.setAttribute("markerWidth", "12");
    legacy.setAttribute("markerHeight", "8");
    legacy.setAttribute("refX", "11");
    legacy.setAttribute("refY", "4");
    legacy.setAttribute("orient", "auto-start-reverse");
    legacy.setAttribute("markerUnits", "strokeWidth");
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", "0 0, 12 4, 0 8");
    polygon.setAttribute("fill", "context-stroke");
    legacy.appendChild(polygon);
    this.defs.appendChild(legacy);
  }

  #setupEvents(): void {
    const opts = { signal: this.#abort.signal };

    this.svg.addEventListener(
      "pointerdown",
      (e) => {
        // Middle mouse for panning
        if (e.button === 1) {
          this.#isPanning = true;
          this.#panStartX = e.clientX;
          this.#panStartY = e.clientY;
          e.preventDefault();
          return;
        }
        if (e.button !== 0) return;
        const pt = this.svgPoint(e);
        this.#activeTool?.onPointerDown(e, pt);
      },
      opts,
    );

    this.svg.addEventListener(
      "pointermove",
      (e) => {
        if (this.#isPanning) {
          const container = this.svg.parentElement!;
          container.scrollLeft -= e.clientX - this.#panStartX;
          container.scrollTop -= e.clientY - this.#panStartY;
          this.#panStartX = e.clientX;
          this.#panStartY = e.clientY;
          return;
        }
        const pt = this.svgPoint(e);
        this.#activeTool?.onPointerMove(e, pt);
      },
      opts,
    );

    this.svg.addEventListener(
      "pointerup",
      (e) => {
        if (this.#isPanning) {
          this.#isPanning = false;
          return;
        }
        if (e.button !== 0) return;
        const pt = this.svgPoint(e);
        this.#activeTool?.onPointerUp(e, pt);
      },
      opts,
    );

    // Right-click — always swallow the browser's stock context menu so
    // we don't flash the default "Save image as…" / "Inspect" menu on
    // top of any annotation UI. If a host has registered `onContextMenu`,
    // forward the event (with SVG-space coords) so it can open its own
    // Insert-Here menu. No host subscription → silent no-op.
    this.svg.addEventListener(
      "contextmenu",
      (e) => {
        e.preventDefault();
        if (!this.onContextMenu) return;
        const pt = this.svgPoint(e);
        this.onContextMenu(e, pt);
      },
      opts,
    );

    // Zoom with Ctrl+Wheel
    this.svg.parentElement?.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          const delta = e.deltaY > 0 ? -0.1 : 0.1;
          this.setZoom(this.#zoom + delta);
        }
      },
      { passive: false, signal: this.#abort.signal },
    );

    // Keyboard
    document.addEventListener(
      "keydown",
      (e) => {
        this.#activeTool?.onKeyDown?.(e);
      },
      opts,
    );
  }

  updateViewBox(x: number, y: number, w: number, h: number): void {
    this.svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    this.#imageWidth = w;
    this.#imageHeight = h;
  }
}
