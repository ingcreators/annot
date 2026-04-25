import type { CanvasManager } from "@ingcreators/annot-core/editor/canvas-manager";
import type { History } from "../history.js";

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
  MarkerSize,
  RedactStyle,
  ShapeType,
  TextVariant,
  ToolOptions,
} from "@ingcreators/annot-core/editor/tool-options";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";

const SVG_NS = "http://www.w3.org/2000/svg";

export abstract class ToolBase {
  abstract readonly name: string;

  protected canvas: CanvasManager;
  protected history: History;
  protected options: ToolOptions;

  constructor(canvas: CanvasManager, history: History, options: ToolOptions) {
    this.canvas = canvas;
    this.history = history;
    this.options = options;
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

  protected addAnnotation(el: SVGElement): void {
    this.canvas.annotations.appendChild(el);
    this.history.save();
  }
}
