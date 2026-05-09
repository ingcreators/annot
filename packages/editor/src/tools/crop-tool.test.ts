/**
 * @vitest-environment happy-dom
 *
 * CropTool — drag a rect, press Enter to apply (updates viewBox)
 * or Escape to cancel. Coverage focus:
 *
 *   - onActivate paints a `<g data-crop-overlay>` group into
 *     ui-overlay containing an instructional hint anchored to the
 *     current viewBox top-left.
 *   - onDeactivate removes the entire overlay group.
 *   - pointerdown adds an evenodd `<path>` (dim-outside-the-crop)
 *     and a teal dashed `<rect>` (the crop outline). Re-firing
 *     pointerdown reuses the same elements, no accumulation.
 *   - pointermove updates the crop rect's x/y/width/height
 *     (handles reverse-direction drags via min/abs) AND rewrites
 *     the path's `d` so the dim/clear regions track the drag.
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
  svg: SVGSVGElement;
  imageWidth: number;
  imageHeight: number;
  updateViewBox: ReturnType<typeof vi.fn>;
  setZoom: ReturnType<typeof vi.fn>;
  fitToView: ReturnType<typeof vi.fn>;
}

function makeCanvas(opts?: { viewBox?: string }): FakeCanvas {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", opts?.viewBox ?? "0 0 800 600");
  return {
    uiOverlay: document.createElementNS(SVG_NS, "g") as SVGGElement,
    defs: document.createElementNS(SVG_NS, "defs") as SVGDefsElement,
    svg,
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

function buildTool(opts?: { viewBox?: string }): {
  tool: CropTool;
  canvas: FakeCanvas;
  save: ReturnType<typeof vi.fn>;
} {
  const canvas = makeCanvas(opts);
  const { history, save } = makeHistory();
  const tool = new CropTool(canvas as unknown as CanvasManager, history, makeOptions());
  return { tool, canvas, save };
}

function overlayGroup(canvas: FakeCanvas): SVGGElement | null {
  return canvas.uiOverlay.querySelector<SVGGElement>("g[data-crop-overlay]");
}

describe("CropTool — onActivate / onDeactivate", () => {
  it("onActivate paints the overlay group + instructional hint into ui-overlay", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    const grp = overlayGroup(canvas);
    expect(grp).not.toBeNull();
    const text = grp!.querySelector("text");
    expect(text).not.toBeNull();
    expect(text!.textContent).toMatch(/Apply.*Enter to confirm.*Cancel.*Escape/);
    expect(text!.getAttribute("fill")).toBe("#00d4ff");
  });

  it("hint is positioned relative to the current viewBox so a previously-cropped image still shows it on screen", () => {
    const { tool, canvas } = buildTool({ viewBox: "100 50 400 300" });
    tool.onActivate?.();
    const text = overlayGroup(canvas)!.querySelector("text")!;
    // 10/30 offset from the viewBox's top-left origin.
    expect(text.getAttribute("x")).toBe("110");
    expect(text.getAttribute("y")).toBe("80");
  });

  it("onDeactivate removes the entire overlay group (hint + any in-flight crop rect)", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    expect(overlayGroup(canvas)).not.toBeNull();
    tool.onDeactivate?.();
    expect(overlayGroup(canvas)).toBeNull();
    expect(canvas.uiOverlay.children.length).toBe(0);
  });
});

describe("CropTool — pointerdown attaches dim path + crop rect", () => {
  it("paints an evenodd path that dims outside the crop AND a teal dashed crop rect", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 60));
    const grp = overlayGroup(canvas)!;
    const path = grp.querySelector("path")!;
    const rect = grp.querySelector("rect")!;
    expect(path).not.toBeNull();
    expect(path.getAttribute("fill")).toBe("rgba(0,0,0,0.5)");
    expect(path.getAttribute("fill-rule")).toBe("evenodd");
    expect(path.getAttribute("pointer-events")).toBe("none");
    // The path's `d` carries the outer (full viewBox) rect at minimum
    // — at click time width/height are still 0 so no inner subpath.
    const d = path.getAttribute("d") || "";
    expect(d).toContain("M 0 0");
    expect(d).toContain("h 800");
    expect(d).toContain("v 600");
    // Crop rect anchored at the click point with 0×0 size.
    expect(rect.getAttribute("x")).toBe("50");
    expect(rect.getAttribute("y")).toBe("60");
    expect(rect.getAttribute("width")).toBe("0");
    expect(rect.getAttribute("height")).toBe("0");
    expect(rect.getAttribute("stroke")).toBe("#00d4ff");
    expect(rect.getAttribute("stroke-dasharray")).toBe("6 4");
    expect(rect.getAttribute("fill")).toBe("none");
  });

  it("re-firing pointerdown reuses the same path + rect (no accumulation)", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 10));
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 60));
    const grp = overlayGroup(canvas)!;
    expect(grp.querySelectorAll("path").length).toBe(1);
    expect(grp.querySelectorAll("rect").length).toBe(1);
    // New start point reflected in the rect.
    const rect = grp.querySelector("rect")!;
    expect(rect.getAttribute("x")).toBe("50");
    expect(rect.getAttribute("y")).toBe("60");
  });
});

describe("CropTool — pointermove resize", () => {
  it("rewrites the crop rect's x/y/width/height (forward direction)", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(110, 80));
    const rect = overlayGroup(canvas)!.querySelector("rect")!;
    expect(rect.getAttribute("x")).toBe("10");
    expect(rect.getAttribute("y")).toBe("20");
    expect(rect.getAttribute("width")).toBe("100");
    expect(rect.getAttribute("height")).toBe("60");
  });

  it("supports reverse-direction drags (min/abs)", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(100, 100));
    tool.onPointerMove(pointerEvent(), new DOMPoint(40, 50));
    const rect = overlayGroup(canvas)!.querySelector("rect")!;
    expect(rect.getAttribute("x")).toBe("40");
    expect(rect.getAttribute("y")).toBe("50");
    expect(rect.getAttribute("width")).toBe("60");
    expect(rect.getAttribute("height")).toBe("50");
  });

  it("rewrites the dim path's `d` so the inner crop subpath tracks the drag", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(110, 80));
    const path = overlayGroup(canvas)!.querySelector("path")!;
    const d = path.getAttribute("d") || "";
    expect(d).toContain("M 10 20");
    expect(d).toContain("h 100");
    expect(d).toContain("v 60");
  });

  it("pointermove without a prior pointerdown is a silent no-op", () => {
    const { tool } = buildTool();
    tool.onActivate?.();
    expect(() => tool.onPointerMove(pointerEvent(), new DOMPoint(10, 10))).not.toThrow();
  });
});

describe("CropTool — pointerup", () => {
  it("ends the drag without removing the crop rect (waits for Enter / Apply)", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(110, 80));
    tool.onPointerUp(pointerEvent(), new DOMPoint(110, 80));
    // Crop rect persists, waiting for the user's Enter / Escape / Apply / Cancel.
    const grp = overlayGroup(canvas)!;
    expect(grp.querySelectorAll("rect").length).toBe(1);
    expect(grp.querySelectorAll("path").length).toBe(1);
  });

  it("surfaces the Apply / Cancel button pair after the drag ends", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(110, 80));
    // Buttons are NOT visible during the drag — only after pointerup.
    expect(overlayGroup(canvas)!.querySelector("foreignObject")).toBeNull();
    tool.onPointerUp(pointerEvent(), new DOMPoint(110, 80));
    const fo = overlayGroup(canvas)!.querySelector("foreignObject");
    expect(fo).not.toBeNull();
    expect(fo!.getAttribute("data-crop-buttons")).toBe("");
    const buttons = fo!.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    // Cancel first (Apply is the primary action; Cancel anchors left).
    expect(buttons[0]!.textContent).toBe("Cancel");
    expect(buttons[1]!.textContent).toBe("Apply");
  });

  it("anchors the buttons to the bottom-right corner of the crop rect", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 60));
    tool.onPointerMove(pointerEvent(), new DOMPoint(250, 260));
    tool.onPointerUp(pointerEvent(), new DOMPoint(250, 260));
    const fo = overlayGroup(canvas)!.querySelector("foreignObject")!;
    // Rect is 50,60..250,260 → bottom-right corner is (250, 260).
    // Buttons host is 200×44 anchored so its right edge sits at the
    // rect's right edge, with a 4px gap below.
    expect(fo.getAttribute("x")).toBe("50"); // 250 - 200
    expect(fo.getAttribute("y")).toBe("264"); // 260 + 4
    expect(fo.getAttribute("width")).toBe("200");
    expect(fo.getAttribute("height")).toBe("44");
  });
});

describe("CropTool — keydown Enter (apply)", () => {
  it("applies a sized crop: updateViewBox + setZoom(1) + fitToView + history.save", () => {
    const { tool, canvas, save } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(canvas.updateViewBox).toHaveBeenCalledWith(10, 20, 200, 200);
    expect(canvas.setZoom).toHaveBeenCalledWith(1);
    expect(canvas.fitToView).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    // After apply, the overlay is gone.
    expect(overlayGroup(canvas)).toBeNull();
  });

  it("rejects a too-small crop (<10×10): cleans up without applying", () => {
    const { tool, canvas, save } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(5, 5));
    tool.onPointerUp(pointerEvent(), new DOMPoint(5, 5));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(canvas.updateViewBox).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(overlayGroup(canvas)).toBeNull();
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
  it("cleans up the overlay without applying", () => {
    const { tool, canvas, save } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(canvas.updateViewBox).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(overlayGroup(canvas)).toBeNull();
  });

  it("Escape without a prior crop rect still cleans up the hint (defensive)", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    expect(overlayGroup(canvas)).not.toBeNull();
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlayGroup(canvas)).toBeNull();
  });
});

describe("CropTool — onCropConfirmed (destructive bake gate)", () => {
  it("Enter routes through the gate (not the legacy viewBox path) when wired", async () => {
    const { tool, canvas, save } = buildTool();
    const onCropConfirmed = vi.fn(async () => true);
    tool.onCropConfirmed = onCropConfirmed;
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Enter" }));
    // Microtask drain so the async gate resolves before assertions.
    await Promise.resolve();
    await Promise.resolve();
    expect(onCropConfirmed).toHaveBeenCalledWith(10, 20, 200, 200);
    // Legacy viewBox + history path is bypassed when the gate is wired —
    // the gate's bake (EditorShell.applyCrop) owns those calls now.
    expect(canvas.updateViewBox).not.toHaveBeenCalled();
    expect(canvas.setZoom).not.toHaveBeenCalled();
    expect(canvas.fitToView).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    // Overlay is cleaned up immediately so the dialog doesn't open
    // on top of the dim/dashed visualization.
    expect(overlayGroup(canvas)).toBeNull();
  });

  it("Apply button click also routes through the gate", async () => {
    const { tool, canvas } = buildTool();
    const onCropConfirmed = vi.fn(async () => true);
    tool.onCropConfirmed = onCropConfirmed;
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    const apply = overlayGroup(canvas)!
      .querySelector("foreignObject")!
      .querySelectorAll("button")[1]!;
    apply.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onCropConfirmed).toHaveBeenCalledWith(10, 20, 200, 200);
  });

  it("Cancel button click cleans up without invoking the gate", async () => {
    const { tool, canvas } = buildTool();
    const onCropConfirmed = vi.fn(async () => true);
    tool.onCropConfirmed = onCropConfirmed;
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    const cancel = overlayGroup(canvas)!
      .querySelector("foreignObject")!
      .querySelectorAll("button")[0]!;
    cancel.click();
    await Promise.resolve();
    expect(onCropConfirmed).not.toHaveBeenCalled();
    expect(overlayGroup(canvas)).toBeNull();
  });
});

describe("CropTool — non-Enter / Escape keys ignored", () => {
  it("'a' / 'Tab' / etc. don't trigger apply or cleanup", () => {
    const { tool, canvas, save } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(100, 100));
    tool.onPointerUp(pointerEvent(), new DOMPoint(100, 100));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "a" }));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Tab" }));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: " " }));
    expect(canvas.updateViewBox).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    // Crop overlay still in place.
    const grp = overlayGroup(canvas)!;
    expect(grp.querySelectorAll("rect").length).toBe(1);
    expect(grp.querySelectorAll("path").length).toBe(1);
  });
});
