/**
 * @vitest-environment happy-dom
 *
 * CropTool — drag a rect, press Enter to apply (updates viewBox)
 * or Escape to cancel. Coverage focus:
 *
 *   - onActivate paints an instructional hint into ui-overlay.
 *   - onDeactivate cleans up hint + any in-flight rect/overlay.
 *   - pointerdown attaches a 50%-black overlay + a teal dashed crop
 *     rect to ui-overlay; clears any prior crop rect.
 *   - pointermove updates the rect's x/y/width/height (handles
 *     reverse-direction drags via min/abs) AND maintains the
 *     `#annot-crop-clip` clipPath in `defs` for the overlay punch-out.
 *   - pointerup terminates the drag (no commit yet).
 *   - keydown 'Enter' on a sized rect invokes
 *     canvas.updateViewBox + setZoom(1) + fitToView + history.save.
 *   - keydown 'Enter' on a too-small rect (<10×10) cleans up
 *     without applying.
 *   - keydown 'Escape' cleans up without applying.
 */

import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { describe, expect, it, vi } from "vitest";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import { CropTool } from "./crop-tool.js";

const SVG_NS = "http://www.w3.org/2000/svg";

interface FakeCanvas {
  uiOverlay: SVGGElement;
  defs: SVGDefsElement;
  imageWidth: number;
  imageHeight: number;
  updateViewBox: ReturnType<typeof vi.fn>;
  setZoom: ReturnType<typeof vi.fn>;
  fitToView: ReturnType<typeof vi.fn>;
}

function makeCanvas(): FakeCanvas {
  return {
    uiOverlay: document.createElementNS(SVG_NS, "g") as SVGGElement,
    defs: document.createElementNS(SVG_NS, "defs") as SVGDefsElement,
    imageWidth: 800,
    imageHeight: 600,
    updateViewBox: vi.fn(),
    setZoom: vi.fn(),
    fitToView: vi.fn(),
  };
}

function makeHistory(): { history: History; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn();
  return { history: { save } as unknown as History, save };
}

function makeOptions(): ToolOptions {
  return {
    strokeColor: "#000000",
    fillColor: "#ffffff",
    strokeWidth: 1,
    fontSize: 14,
    strokeDasharray: "",
    fillOpacity: 1,
  };
}

function pointerEvent(): PointerEvent {
  const Ctor =
    typeof PointerEvent === "function" ? PointerEvent : (MouseEvent as typeof PointerEvent);
  return new Ctor("pointerdown", { bubbles: true });
}

function buildTool(): { tool: CropTool; canvas: FakeCanvas; save: ReturnType<typeof vi.fn> } {
  const canvas = makeCanvas();
  const { history, save } = makeHistory();
  const tool = new CropTool(canvas as unknown as CanvasManager, history, makeOptions());
  return { tool, canvas, save };
}

describe("CropTool — onActivate / onDeactivate", () => {
  it("onActivate paints the instructional hint into ui-overlay", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    const text = canvas.uiOverlay.querySelector("text");
    expect(text).not.toBeNull();
    expect(text!.textContent).toMatch(/Enter to confirm or Escape to cancel/);
    expect(text!.getAttribute("fill")).toBe("#00d4ff");
  });

  it("onDeactivate removes the hint + any in-flight crop rect / overlay", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    expect(canvas.uiOverlay.children.length).toBeGreaterThan(0);
    tool.onDeactivate?.();
    expect(canvas.uiOverlay.children.length).toBe(0);
  });
});

describe("CropTool — pointerdown attaches dimming overlay + crop rect", () => {
  it("paints a 50%-black full-image overlay AND a teal dashed crop rect", () => {
    const { tool, canvas } = buildTool();
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 60));
    const rects = canvas.uiOverlay.querySelectorAll("rect");
    expect(rects.length).toBe(2);
    // First rect (overlay) covers the full image at 50% opacity black.
    const overlay = rects[0]!;
    expect(overlay.getAttribute("width")).toBe("800");
    expect(overlay.getAttribute("height")).toBe("600");
    expect(overlay.getAttribute("fill")).toBe("rgba(0,0,0,0.5)");
    expect(overlay.getAttribute("pointer-events")).toBe("none");
    // Second rect (crop) starts at the click point with 0×0 size.
    const crop = rects[1]!;
    expect(crop.getAttribute("x")).toBe("50");
    expect(crop.getAttribute("y")).toBe("60");
    expect(crop.getAttribute("width")).toBe("0");
    expect(crop.getAttribute("height")).toBe("0");
    expect(crop.getAttribute("stroke")).toBe("#00d4ff");
    expect(crop.getAttribute("stroke-dasharray")).toBe("6");
  });

  it("clears any prior crop rect + overlay when pointerdown fires again", () => {
    const { tool, canvas } = buildTool();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 10));
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 60));
    // Still exactly two rects (overlay + new crop), not four.
    expect(canvas.uiOverlay.querySelectorAll("rect").length).toBe(2);
  });
});

describe("CropTool — pointermove resize", () => {
  it("rewrites the crop rect's x/y/width/height (forward direction)", () => {
    const { tool, canvas } = buildTool();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(110, 80));
    const crop = canvas.uiOverlay.querySelectorAll("rect")[1]!;
    expect(crop.getAttribute("x")).toBe("10");
    expect(crop.getAttribute("y")).toBe("20");
    expect(crop.getAttribute("width")).toBe("100");
    expect(crop.getAttribute("height")).toBe("60");
  });

  it("supports reverse-direction drags (min/abs)", () => {
    const { tool, canvas } = buildTool();
    tool.onPointerDown(pointerEvent(), new DOMPoint(100, 100));
    tool.onPointerMove(pointerEvent(), new DOMPoint(40, 50));
    const crop = canvas.uiOverlay.querySelectorAll("rect")[1]!;
    expect(crop.getAttribute("x")).toBe("40");
    expect(crop.getAttribute("y")).toBe("50");
    expect(crop.getAttribute("width")).toBe("60");
    expect(crop.getAttribute("height")).toBe("50");
  });

  it("creates an #annot-crop-clip clipPath on first move (reused on subsequent moves)", () => {
    const { tool, canvas } = buildTool();
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(50, 50));
    expect(canvas.defs.querySelector("#annot-crop-clip")).not.toBeNull();
    tool.onPointerMove(pointerEvent(), new DOMPoint(80, 80));
    // Still only one clipPath in defs.
    expect(canvas.defs.querySelectorAll("#annot-crop-clip").length).toBe(1);
  });

  it("pointermove without a prior pointerdown is a silent no-op", () => {
    const { tool } = buildTool();
    expect(() => tool.onPointerMove(pointerEvent(), new DOMPoint(10, 10))).not.toThrow();
  });
});

describe("CropTool — pointerup", () => {
  it("ends the drag without removing the crop rect (waits for Enter)", () => {
    const { tool, canvas } = buildTool();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(110, 80));
    tool.onPointerUp(pointerEvent(), new DOMPoint(110, 80));
    // Crop rect persists, waiting for the user's Enter / Escape.
    expect(canvas.uiOverlay.querySelectorAll("rect").length).toBe(2);
  });
});

describe("CropTool — keydown Enter (apply)", () => {
  it("applies a sized crop: updateViewBox + setZoom(1) + fitToView + history.save", () => {
    const { tool, canvas, save } = buildTool();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(canvas.updateViewBox).toHaveBeenCalledWith(10, 20, 200, 200);
    expect(canvas.setZoom).toHaveBeenCalledWith(1);
    expect(canvas.fitToView).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    // After apply, the crop rect + overlay are cleaned up.
    expect(canvas.uiOverlay.querySelectorAll("rect").length).toBe(0);
  });

  it("rejects a too-small crop (<10×10): cleans up without applying", () => {
    const { tool, canvas, save } = buildTool();
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(5, 5));
    tool.onPointerUp(pointerEvent(), new DOMPoint(5, 5));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(canvas.updateViewBox).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(canvas.uiOverlay.querySelectorAll("rect").length).toBe(0);
  });

  it("Enter without a crop rect is a silent no-op", () => {
    const { tool, canvas, save } = buildTool();
    tool.onActivate?.();
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(canvas.updateViewBox).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("CropTool — keydown Escape (cancel)", () => {
  it("cleans up the crop rect + overlay + hint without applying", () => {
    const { tool, canvas, save } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(canvas.updateViewBox).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(canvas.uiOverlay.children.length).toBe(0);
    expect(canvas.defs.querySelector("#annot-crop-clip")).toBeNull();
  });

  it("Escape without a prior crop rect still cleans up the hint (defensive)", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    expect(canvas.uiOverlay.children.length).toBe(1); // hint
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(canvas.uiOverlay.children.length).toBe(0);
  });
});

describe("CropTool — non-Enter / Escape keys ignored", () => {
  it("'a' / 'Tab' / etc. don't trigger apply or cleanup", () => {
    const { tool, canvas, save } = buildTool();
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(100, 100));
    tool.onPointerUp(pointerEvent(), new DOMPoint(100, 100));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "a" }));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Tab" }));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: " " }));
    expect(canvas.updateViewBox).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    // Crop rect still in place.
    expect(canvas.uiOverlay.querySelectorAll("rect").length).toBe(2);
  });
});
