import type { ToolDOMSurface } from "@ingcreators/annot-core/editor/tool-lifecycle";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import { createCanvasToolSurface } from "./canvas-tool-surface.js";

// All `ToolOptions`-related pure types live in
// `@ingcreators/annot-core/editor/tool-options` so core/editor
// helpers (`shape-utils`, `text-utils`, `redact-utils`,
// `gradient-utils`, etc.) can read them without importing
// `annot-editor` and triggering a circular package dependency.
// Re-exported here for back-compat with the historical
// `from "@ingcreators/annot-editor/tools/tool-base"` import shape.
export type {
  ArrowDim,
  ArrowHead,
  ArrowShape,
  DrawStyle,
  GradientSpec,
  GradientStop,
  LineCap,
  LineJoin,
  MarkerShape,
  RedactStyle,
  ShapeType,
  TextVariant,
  ToolOptions,
} from "@ingcreators/annot-core/editor/tool-options";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";

const SVG_NS = "http://www.w3.org/2000/svg";

export abstract class ToolBase {
  abstract readonly name: string;

  /** DOM-side abstraction every tool depends on for canvas access.
   *  See `@ingcreators/annot-core/editor/tool-lifecycle` for the
   *  three-method contract. Always set: synthesised from `canvas` +
   *  `history` in the legacy three-arg constructor, or supplied
   *  directly in the surface-only constructor used by tests. */
  protected surface: ToolDOMSurface;
  protected options: ToolOptions;

  /** Legacy escape hatches — only set when the tool was constructed
   *  via the (canvas, history, options) shape. Tools that still need
   *  CanvasManager features outside the three-method surface
   *  (uiOverlay, defs, imageWidth, viewBox manipulation) read these
   *  directly. Marked with `!` because they're definitely-assigned
   *  on the legacy path; tools that inspect them while a test uses
   *  the surface-only construction will throw NPE — that's the
   *  intended signal that more of the tool needs to be migrated to
   *  the surface contract. */
  protected canvas!: CanvasManager;
  protected history!: History;

  constructor(surface: ToolDOMSurface, options: ToolOptions);
  constructor(canvas: CanvasManager, history: History, options: ToolOptions);
  constructor(
    arg1: CanvasManager | ToolDOMSurface,
    arg2: History | ToolOptions,
    arg3?: ToolOptions,
  ) {
    if (arg3 === undefined) {
      // Surface-only form: arg1=surface, arg2=options.
      this.surface = arg1 as ToolDOMSurface;
      this.options = arg2 as ToolOptions;
    } else {
      // Legacy form: arg1=canvas, arg2=history, arg3=options.
      const canvas = arg1 as CanvasManager;
      const history = arg2 as History;
      this.canvas = canvas;
      this.history = history;
      this.surface = createCanvasToolSurface(canvas, history);
      this.options = arg3;
    }
  }

  abstract onPointerDown(e: PointerEvent, pt: DOMPoint): void;
  abstract onPointerMove(e: PointerEvent, pt: DOMPoint): void;
  abstract onPointerUp(e: PointerEvent, pt: DOMPoint): void;

  onKeyDown?(e: KeyboardEvent): void;
  onActivate?(): void;
  onDeactivate?(): void;

  /** Called after a shape is completed; toolbar uses this to switch back to select mode */
  onShapeComplete?: (el?: SVGElement) => void;

  protected createSVG<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string>,
  ): SVGElementTagNameMap[K] {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    return el;
  }

  /** Mount a fully-formed annotation and snapshot history. Delegates
   *  to `surface.addAnnotation` so the test mock sees the call. */
  protected addAnnotation(el: SVGElement): void {
    this.surface.addAnnotation(el);
  }
}
