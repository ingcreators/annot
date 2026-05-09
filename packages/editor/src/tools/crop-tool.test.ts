/**
 * @vitest-environment happy-dom
 *
 * CropTool — drag a rect; releasing the pointer (or pressing Enter)
 * opens the host's destructive-action confirmation dialog. The
 * dialog's Crop / Cancel buttons replace the in-canvas buttons + hint
 * a previous iteration shipped — those were redundant with the
 * dialog itself. Coverage focus:
 *
 *   - onActivate paints a `<g data-crop-overlay>` group into
 *     ui-overlay (no hint, no buttons — the dialog is the only
 *     confirm UI).
 *   - onDeactivate removes the entire overlay group.
 *   - pointerdown adds an evenodd `<path>` (dim-outside-the-crop)
 *     and a teal dashed `<rect>` (the crop outline). Re-firing
 *     pointerdown on an existing rect resets it.
 *   - pointermove updates the crop rect's x/y/width/height
 *     (handles reverse-direction drags via min/abs) AND rewrites
 *     the path's `d` so the dim/clear regions track the drag.
 *   - pointerup automatically invokes the host's `onCropConfirmed`
 *     gate (no separate Apply button click needed). The overlay
 *     STAYS visible while the dialog is open so the user can verify
 *     the crop region before confirming.
 *   - keydown 'Enter' on a sized rect routes through the same gate
 *     (keyboard-equivalent of pointerup auto-trigger).
 *   - On dialog confirm (gate resolves true): the overlay is torn
 *     down AND `onShapeComplete` fires so the toolbar auto-switches
 *     to Select.
 *   - On dialog cancel (gate resolves false): the rect stays in
 *     place — the user can drag a fresh rect to adjust.
 *   - keydown 'Escape' immediately cleans up, bypassing the dialog.
 *   - Tiny rect (<10×10) at pointerup discards silently — no dialog.
 *   - Without `onCropConfirmed`, falls back to a session-only
 *     viewBox crop (legacy path).
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

/** Yield long enough for a chained `await` inside `#applyCrop` to
 *  drain into post-bake DOM mutations + onShapeComplete fires.
 *  Two `await Promise.resolve()` ticks cover the typical
 *  `await onCropConfirmed; if (applied) cleanup; onShapeComplete`
 *  chain. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("CropTool — onActivate / onDeactivate", () => {
  it("onActivate paints an empty overlay group (no hint, no buttons — the dialog is the confirm UI)", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    const grp = overlayGroup(canvas);
    expect(grp).not.toBeNull();
    expect(grp!.querySelector("text")).toBeNull();
    expect(grp!.querySelector("foreignObject")).toBeNull();
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

describe("CropTool — pointerup auto-opens the dialog (no Apply button click needed)", () => {
  it("routes through onCropConfirmed automatically when the rect is large enough", async () => {
    const { tool, canvas } = buildTool();
    const onCropConfirmed = vi.fn(async () => true);
    tool.onCropConfirmed = onCropConfirmed;
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    await flushMicrotasks();
    expect(onCropConfirmed).toHaveBeenCalledTimes(1);
    expect(onCropConfirmed).toHaveBeenCalledWith(10, 20, 200, 200);
    // Successful bake → overlay torn down.
    expect(overlayGroup(canvas)).toBeNull();
  });

  it("discards a tiny (<10×10) rect silently — no dialog, no overlay residue", async () => {
    const { tool, canvas } = buildTool();
    const onCropConfirmed = vi.fn(async () => true);
    tool.onCropConfirmed = onCropConfirmed;
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(5, 5));
    tool.onPointerUp(pointerEvent(), new DOMPoint(5, 5));
    await flushMicrotasks();
    expect(onCropConfirmed).not.toHaveBeenCalled();
    expect(overlayGroup(canvas)).toBeNull();
  });

  it("pointerup without a prior pointerdown is a silent no-op", async () => {
    const { tool } = buildTool();
    const onCropConfirmed = vi.fn(async () => true);
    tool.onCropConfirmed = onCropConfirmed;
    tool.onActivate?.();
    tool.onPointerUp(pointerEvent(), new DOMPoint(0, 0));
    await flushMicrotasks();
    expect(onCropConfirmed).not.toHaveBeenCalled();
  });
});

describe("CropTool — onCropConfirmed gate (destructive bake path)", () => {
  it("keeps the overlay visible while the dialog is open (so the user can see what gets cropped)", async () => {
    const { tool, canvas } = buildTool();
    let resolveDialog: (v: boolean) => void = () => {};
    const dialogPromise = new Promise<boolean>((resolve) => {
      resolveDialog = resolve;
    });
    tool.onCropConfirmed = vi.fn(async () => dialogPromise);
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    // Dialog is "open" — overlay must STILL be present.
    await Promise.resolve();
    const grp = overlayGroup(canvas);
    expect(grp).not.toBeNull();
    expect(grp!.querySelector("path")).not.toBeNull();
    expect(grp!.querySelector("rect")).not.toBeNull();
    // Now resolve the dialog with confirm.
    resolveDialog(true);
    await flushMicrotasks();
    expect(overlayGroup(canvas)).toBeNull();
  });

  it("on dialog confirm: tears down the overlay AND fires onShapeComplete (toolbar auto-switches to Select)", async () => {
    const { tool, canvas } = buildTool();
    tool.onCropConfirmed = vi.fn(async () => true);
    const onShapeComplete = vi.fn();
    tool.onShapeComplete = onShapeComplete;
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    await flushMicrotasks();
    expect(overlayGroup(canvas)).toBeNull();
    expect(onShapeComplete).toHaveBeenCalledTimes(1);
  });

  it("on dialog cancel: keeps the rect in place AND does NOT fire onShapeComplete (user can re-drag to adjust)", async () => {
    const { tool, canvas } = buildTool();
    tool.onCropConfirmed = vi.fn(async () => false);
    const onShapeComplete = vi.fn();
    tool.onShapeComplete = onShapeComplete;
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    await flushMicrotasks();
    // Overlay still in place — the user can adjust by re-dragging.
    expect(overlayGroup(canvas)).not.toBeNull();
    const rect = overlayGroup(canvas)!.querySelector("rect")!;
    expect(rect.getAttribute("x")).toBe("10");
    expect(rect.getAttribute("y")).toBe("20");
    expect(rect.getAttribute("width")).toBe("200");
    expect(rect.getAttribute("height")).toBe("200");
    expect(onShapeComplete).not.toHaveBeenCalled();
  });

  it("locks input while the dialog is open (a second pointerup mid-flight is dropped)", async () => {
    const { tool } = buildTool();
    let resolveDialog: (v: boolean) => void = () => {};
    const dialogPromise = new Promise<boolean>((resolve) => {
      resolveDialog = resolve;
    });
    const onCropConfirmed = vi.fn(async () => dialogPromise);
    tool.onCropConfirmed = onCropConfirmed;
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    // Try a second pointerdown + up while the dialog is "open".
    tool.onPointerDown(pointerEvent(), new DOMPoint(30, 40));
    tool.onPointerUp(pointerEvent(), new DOMPoint(80, 80));
    await Promise.resolve();
    expect(onCropConfirmed).toHaveBeenCalledTimes(1);
    resolveDialog(true);
    await flushMicrotasks();
  });
});

describe("CropTool — keydown Enter (apply via gate)", () => {
  it("opens the gate on Enter when a rect is drawn", async () => {
    const { tool, canvas } = buildTool();
    tool.onCropConfirmed = vi.fn(async () => true);
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    // Note: NOT calling onPointerUp — we want to test the
    // keyboard-only path (Enter while still dragging would be
    // unusual but still valid).
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushMicrotasks();
    expect(tool.onCropConfirmed).toHaveBeenCalledWith(10, 20, 200, 200);
    expect(overlayGroup(canvas)).toBeNull();
  });

  it("Enter without a crop rect is a silent no-op", async () => {
    const { tool, canvas } = buildTool();
    tool.onCropConfirmed = vi.fn(async () => true);
    tool.onActivate?.();
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushMicrotasks();
    expect(tool.onCropConfirmed).not.toHaveBeenCalled();
    expect(overlayGroup(canvas)).not.toBeNull();
  });
});

describe("CropTool — keydown Escape (immediate cancel, bypasses dialog)", () => {
  it("cleans up the overlay without invoking the gate", async () => {
    const { tool, canvas } = buildTool();
    const onCropConfirmed = vi.fn(async () => true);
    tool.onCropConfirmed = onCropConfirmed;
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushMicrotasks();
    expect(onCropConfirmed).not.toHaveBeenCalled();
    expect(overlayGroup(canvas)).toBeNull();
  });

  it("Escape without a prior crop rect still cleans up the overlay group (defensive)", () => {
    const { tool, canvas } = buildTool();
    tool.onActivate?.();
    expect(overlayGroup(canvas)).not.toBeNull();
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlayGroup(canvas)).toBeNull();
  });
});

describe("CropTool — fallback (no onCropConfirmed): legacy session-only viewBox crop", () => {
  it("on pointerup applies updateViewBox + setZoom(1) + fitToView + history.save + onShapeComplete", async () => {
    const { tool, canvas, save } = buildTool();
    const onShapeComplete = vi.fn();
    tool.onShapeComplete = onShapeComplete;
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(210, 220));
    tool.onPointerUp(pointerEvent(), new DOMPoint(210, 220));
    await flushMicrotasks();
    expect(canvas.updateViewBox).toHaveBeenCalledWith(10, 20, 200, 200);
    expect(canvas.setZoom).toHaveBeenCalledWith(1);
    expect(canvas.fitToView).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onShapeComplete).toHaveBeenCalledTimes(1);
    expect(overlayGroup(canvas)).toBeNull();
  });

  it("rejects a too-small crop (<10×10) without applying", async () => {
    const { tool, canvas, save } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(5, 5));
    tool.onPointerUp(pointerEvent(), new DOMPoint(5, 5));
    await flushMicrotasks();
    expect(canvas.updateViewBox).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(overlayGroup(canvas)).toBeNull();
  });
});

describe("CropTool — non-Enter / Escape keys ignored", () => {
  it("'a' / 'Tab' / etc. don't trigger apply or cleanup", async () => {
    const { tool, canvas, save } = buildTool();
    tool.onActivate?.();
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(100, 100));
    // NOT calling pointerup — we want the rect to stay in place
    // for the keyboard-noise test.
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "a" }));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: "Tab" }));
    tool.onKeyDown?.(new KeyboardEvent("keydown", { key: " " }));
    await flushMicrotasks();
    expect(canvas.updateViewBox).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    // Crop overlay still in place.
    const grp = overlayGroup(canvas)!;
    expect(grp.querySelectorAll("rect").length).toBe(1);
    expect(grp.querySelectorAll("path").length).toBe(1);
  });
});
