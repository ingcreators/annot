/**
 * @vitest-environment happy-dom
 *
 * `CanvasManager` is the keystone editor primitive — every tool
 * mounts onto its `annotations` group, every selection / property-
 * panel call reaches into its `uiOverlay`, and the host's zoom UI
 * drives `setZoom` / `fitToView`. Coverage focus:
 *
 *   - Constructor builds the documented SVG structure (defs, base
 *     image, annotations group, ui-overlay) + stamps the format
 *     version + sets the viewBox.
 *   - Width / height / zoom getters reflect the constructor state.
 *   - `setActiveTool` calls onActivate / onDeactivate at the right
 *     edge transitions and updates the cursor.
 *   - `setZoom` clamps via core's clampZoom, fires onZoomChange,
 *     exits fit mode.
 *   - `fitToView` enters fit mode + drives setZoom; `refitIfFitMode`
 *     no-ops outside fit mode and re-fits inside it.
 *   - `updateViewBox` writes the viewBox attribute + updates the
 *     stored width/height.
 *   - `destroy()` aborts so listeners stop firing.
 *   - Right-click always preventDefault and forwards to onContextMenu
 *     when wired (else silent).
 *   - Pointer events route through the active tool's callbacks +
 *     ignore non-primary buttons; middle button enters pan mode.
 *
 * happy-dom doesn't ship a real `getScreenCTM` — `svgPoint()`'s
 * inverse-affine math is exercised through pointer-event handlers
 * that resolve `null` from getScreenCTM and fall back to the raw
 * client coords. The returned point is still a `DOMPoint` from
 * `createSVGPoint` either way.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasManager } from "./canvas-manager.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

function makeContainer(width = 800, height = 600): HTMLDivElement {
  const div = document.createElement("div");
  // happy-dom doesn't compute layout — set clientWidth/Height
  // explicitly so fitToView() can read them.
  Object.defineProperty(div, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(div, "clientHeight", { configurable: true, value: height });
  document.body.appendChild(div);
  return div;
}

function makeCanvas(opts: {
  containerW?: number;
  containerH?: number;
  imageW?: number;
  imageH?: number;
} = {}): { svg: SVGSVGElement; container: HTMLDivElement; cm: CanvasManager } {
  const container = makeContainer(opts.containerW ?? 800, opts.containerH ?? 600);
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  container.appendChild(svg);
  const cm = new CanvasManager(svg, PNG, opts.imageW ?? 400, opts.imageH ?? 300);
  return { svg, container, cm };
}

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

describe("CanvasManager — constructor: SVG structure", () => {
  it("sets viewBox + width + height attributes from the supplied dimensions", () => {
    const { svg } = makeCanvas({ imageW: 1024, imageH: 768 });
    expect(svg.getAttribute("viewBox")).toBe("0 0 1024 768");
    // Width/height are subsequently overwritten by setZoom() inside fitToView,
    // but the viewBox stays as the image-coord rectangle.
  });

  it("creates defs / image / annotations / ui-overlay children in that order", () => {
    const { svg, cm } = makeCanvas();
    expect(svg.children[0]).toBe(cm.defs);
    expect(svg.children[1]).toBe(cm.imageEl);
    expect(svg.children[2]).toBe(cm.annotations);
    expect(svg.children[3]).toBe(cm.uiOverlay);
    expect(cm.annotations.id).toBe("annotations");
    expect(cm.uiOverlay.id).toBe("ui-overlay");
  });

  it("stamps the Annot SVG format version on the root", () => {
    const { svg } = makeCanvas();
    // The exact attribute name lives in core/editor/svg-format. Read
    // the documented data attribute to confirm the stamp ran.
    expect(svg.hasAttribute("data-annot-version")).toBe(true);
  });

  it("imageEl carries href + width + height from the constructor args", () => {
    const { cm } = makeCanvas({ imageW: 1024, imageH: 768 });
    expect(cm.imageEl.getAttribute("href")).toBe(PNG);
    expect(cm.imageEl.getAttribute("width")).toBe("1024");
    expect(cm.imageEl.getAttribute("height")).toBe("768");
  });
});

describe("CanvasManager — getters", () => {
  it("imageWidth / imageHeight reflect the constructor", () => {
    const { cm } = makeCanvas({ imageW: 1234, imageH: 567 });
    expect(cm.imageWidth).toBe(1234);
    expect(cm.imageHeight).toBe(567);
  });

  it("zoom is set by the constructor's fitToView() — capped at 1 when the image fits comfortably", () => {
    const { cm } = makeCanvas({ containerW: 800, containerH: 600, imageW: 400, imageH: 300 });
    // computeFitZoom caps at maxZoom=1 by default, so a small image
    // in a generous container fits at 1x (no upscaling).
    expect(cm.zoom).toBe(1);
  });

  it("zoom shrinks below 1 when the image is larger than the container (minus the FIT_VIEW_PADDING)", () => {
    // Image 1000×1000 in a 540×540 container → (540-40)/1000 = 0.5.
    const { cm } = makeCanvas({ containerW: 540, containerH: 540, imageW: 1000, imageH: 1000 });
    expect(cm.zoom).toBeCloseTo(0.5, 5);
  });

  it("isFitMode is true after the constructor's fitToView()", () => {
    const { cm } = makeCanvas();
    expect(cm.isFitMode).toBe(true);
  });
});

describe("CanvasManager — setActiveTool", () => {
  it("activeTool starts null and is set by setActiveTool", () => {
    const { cm } = makeCanvas();
    expect(cm.activeTool).toBeNull();
    const tool = {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    };
    cm.setActiveTool(tool);
    expect(cm.activeTool).toBe(tool);
  });

  it("calls onActivate on the new tool + onDeactivate on the previous", () => {
    const { cm } = makeCanvas();
    const a = {
      onActivate: vi.fn(),
      onDeactivate: vi.fn(),
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    };
    const b = {
      onActivate: vi.fn(),
      onDeactivate: vi.fn(),
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    };
    cm.setActiveTool(a);
    expect(a.onActivate).toHaveBeenCalledTimes(1);
    cm.setActiveTool(b);
    expect(a.onDeactivate).toHaveBeenCalledTimes(1);
    expect(b.onActivate).toHaveBeenCalledTimes(1);
  });

  it("setActiveTool(null) deactivates the prior tool + clears the cursor", () => {
    const { cm, svg } = makeCanvas();
    const a = {
      onDeactivate: vi.fn(),
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    };
    cm.setActiveTool(a);
    expect(svg.style.cursor).toBe("crosshair");
    cm.setActiveTool(null);
    expect(a.onDeactivate).toHaveBeenCalledTimes(1);
    expect(svg.style.cursor).toBe("default");
  });
});

describe("CanvasManager — zoom / fit / viewBox", () => {
  it("setZoom clamps via core's clampZoom (sub-zero collapses to the floor)", () => {
    const { cm } = makeCanvas();
    cm.setZoom(-5);
    // clampZoom enforces a positive floor — exact value depends on the
    // shared util, but it MUST be > 0 and finite.
    expect(cm.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(cm.zoom)).toBe(true);
  });

  it("setZoom exits fit mode (any explicit zoom is user-initiated)", () => {
    const { cm } = makeCanvas();
    expect(cm.isFitMode).toBe(true);
    cm.setZoom(1.5);
    expect(cm.isFitMode).toBe(false);
  });

  it("setZoom fires onZoomChange with the clamped value", () => {
    const { cm } = makeCanvas();
    const observed: number[] = [];
    cm.onZoomChange = (z) => observed.push(z);
    cm.setZoom(2);
    expect(observed).toEqual([2]);
  });

  it("setZoom rewrites width/height attributes + style according to the new zoom", () => {
    const { svg, cm } = makeCanvas({ imageW: 100, imageH: 50 });
    cm.setZoom(2);
    expect(svg.getAttribute("width")).toBe("200");
    expect(svg.getAttribute("height")).toBe("100");
    expect(svg.style.width).toBe("200px");
    expect(svg.style.height).toBe("100px");
  });

  it("refitIfFitMode is a no-op when not in fit mode", () => {
    const { cm } = makeCanvas();
    cm.setZoom(1); // exit fit mode
    const before = cm.zoom;
    cm.refitIfFitMode();
    expect(cm.zoom).toBe(before);
    expect(cm.isFitMode).toBe(false);
  });

  it("refitIfFitMode re-fits when in fit mode (e.g. container shrunk)", () => {
    // Start with image 1000x1000 in a generous 1040x1040 container —
    // fits at 1x (cap). Then shrink the container so the next refit
    // produces a < 1 zoom.
    const { container, cm } = makeCanvas({
      containerW: 1040,
      containerH: 1040,
      imageW: 1000,
      imageH: 1000,
    });
    expect(cm.zoom).toBe(1);
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 540 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 540 });
    cm.refitIfFitMode();
    // (540-40)/1000 = 0.5
    expect(cm.zoom).toBeCloseTo(0.5, 5);
    expect(cm.isFitMode).toBe(true);
  });

  it("fitToView is a no-op when the svg has no parent (orphan node)", () => {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    const cm = new CanvasManager(svg, PNG, 400, 300);
    // Constructor's fitToView short-circuits on no-parent, leaving
    // the default zoom in place.
    expect(cm.zoom).toBe(1);
    expect(cm.isFitMode).toBe(false);
  });

  it("updateViewBox writes the viewBox attribute + updates imageWidth/imageHeight", () => {
    const { svg, cm } = makeCanvas();
    cm.updateViewBox(10, 20, 500, 250);
    expect(svg.getAttribute("viewBox")).toBe("10 20 500 250");
    expect(cm.imageWidth).toBe(500);
    expect(cm.imageHeight).toBe(250);
  });
});

describe("CanvasManager — pointer event routing", () => {
  function dispatchPointer(svg: SVGSVGElement, type: string, button: number): void {
    // happy-dom may not have a PointerEvent constructor — fall back to
    // MouseEvent with a `button` field, which the listener reads.
    const Ctor =
      typeof PointerEvent === "function" ? PointerEvent : (MouseEvent as typeof PointerEvent);
    const ev = new Ctor(type, { bubbles: true, button, clientX: 100, clientY: 50 });
    svg.dispatchEvent(ev);
  }

  it("primary-button pointerdown → active tool's onPointerDown receives the event + a DOMPoint", () => {
    const { svg, cm } = makeCanvas();
    const onPointerDown = vi.fn();
    cm.setActiveTool({
      onPointerDown,
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    });
    dispatchPointer(svg, "pointerdown", 0);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    const [event, pt] = onPointerDown.mock.calls[0]!;
    expect(event.type).toBe("pointerdown");
    expect(typeof pt.x).toBe("number");
    expect(typeof pt.y).toBe("number");
  });

  it("non-primary buttons (right-click via button=2) are ignored by pointerdown", () => {
    const { svg, cm } = makeCanvas();
    const onPointerDown = vi.fn();
    cm.setActiveTool({
      onPointerDown,
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    });
    dispatchPointer(svg, "pointerdown", 2);
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it("middle-mouse button (button=1) enters pan mode (no tool callback)", () => {
    const { svg, cm } = makeCanvas();
    const onPointerDown = vi.fn();
    cm.setActiveTool({
      onPointerDown,
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    });
    dispatchPointer(svg, "pointerdown", 1);
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it("with no active tool, pointerdown is a silent no-op (doesn't throw)", () => {
    const { svg } = makeCanvas();
    expect(() => dispatchPointer(svg, "pointerdown", 0)).not.toThrow();
  });
});

describe("CanvasManager — right-click context menu", () => {
  it("always preventDefault on contextmenu (suppresses the browser's stock menu)", () => {
    const { svg } = makeCanvas();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    svg.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("forwards to onContextMenu(event, point) when registered", () => {
    const { svg, cm } = makeCanvas();
    const onContextMenu = vi.fn();
    cm.onContextMenu = onContextMenu;
    const ev = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 25,
    });
    svg.dispatchEvent(ev);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0]![0]).toBe(ev);
    const pt = onContextMenu.mock.calls[0]![1];
    expect(typeof pt.x).toBe("number");
    expect(typeof pt.y).toBe("number");
  });

  it("with no onContextMenu wired, the event is silent (no throw)", () => {
    const { svg } = makeCanvas();
    expect(() =>
      svg.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    ).not.toThrow();
  });
});

describe("CanvasManager — destroy", () => {
  it("aborts the AbortController so subsequent pointerdown is a no-op", () => {
    const { svg, cm } = makeCanvas();
    const onPointerDown = vi.fn();
    cm.setActiveTool({
      onPointerDown,
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
    });
    cm.destroy();
    const ev = new MouseEvent("pointerdown", { bubbles: true, button: 0 });
    svg.dispatchEvent(ev);
    expect(onPointerDown).not.toHaveBeenCalled();
  });
});
