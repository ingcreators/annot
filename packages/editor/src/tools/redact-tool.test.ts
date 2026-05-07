/**
 * @vitest-environment happy-dom
 *
 * RedactTool — drag-out marquee → redaction element. Three styles:
 *
 *   - "solid"  → opaque <rect> (testable directly under happy-dom)
 *   - "mosaic" → block-averaged PNG via `renderMosaicRedact`, which
 *                requires `<canvas>` raster sampling — out of reach
 *                under happy-dom. Exercised here through the catch-
 *                fallback branch (mosaic throws → solid fallback).
 *   - "blur"   → similar to mosaic; catch-fallback path tested.
 *
 * Coverage focus:
 *   - pointerdown attaches a teal marquee to ui-overlay (NOT
 *     annotations — drafts shouldn't survive a cancel).
 *   - pointermove rewrites the marquee size + position (handles
 *     reverse-direction drags via min/abs).
 *   - pointerup with too-small marquee discards without saving.
 *   - "solid" path: appends a <rect> to annotations + fires
 *     history.save + onShapeComplete.
 *   - "solid" honors the user's fillColor preference; falls back to
 *     REDACT_SOLID_COLOR when fillColor is unset / 'none'.
 *   - The async render's error path falls back to renderSolidRedact
 *     so the user's intent ("hide this region") still succeeds.
 */

import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import { RedactTool } from "./redact-tool.js";

const SVG_NS = "http://www.w3.org/2000/svg";

interface FakeCanvas {
  annotations: SVGGElement;
  uiOverlay: SVGGElement;
  imageWidth: number;
  imageHeight: number;
  defs: SVGDefsElement;
}

function makeCanvas(): FakeCanvas {
  const annotations = document.createElementNS(SVG_NS, "g") as SVGGElement;
  const uiOverlay = document.createElementNS(SVG_NS, "g") as SVGGElement;
  const defs = document.createElementNS(SVG_NS, "defs") as SVGDefsElement;
  return { annotations, uiOverlay, imageWidth: 800, imageHeight: 600, defs };
}

function makeHistory(): { history: History; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn();
  return { history: { save } as unknown as History, save };
}

function makeOptions(overrides: Partial<ToolOptions> = {}): ToolOptions {
  return {
    strokeColor: "#000000",
    fillColor: "none",
    strokeWidth: 1,
    fontSize: 14,
    strokeDasharray: "",
    fillOpacity: 1,
    redactStyle: "solid",
    ...overrides,
  };
}

function pointerEvent(): PointerEvent {
  const Ctor =
    typeof PointerEvent === "function" ? PointerEvent : (MouseEvent as typeof PointerEvent);
  return new Ctor("pointerdown", { bubbles: true });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RedactTool — pointerdown marquee", () => {
  it("attaches a teal marquee to ui-overlay (NOT annotations) at the click point", () => {
    const canvas = makeCanvas();
    const { history } = makeHistory();
    const tool = new RedactTool(
      canvas as unknown as CanvasManager,
      history,
      makeOptions(),
    );
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 60));
    expect(canvas.annotations.children.length).toBe(0);
    expect(canvas.uiOverlay.children.length).toBe(1);
    const marquee = canvas.uiOverlay.firstElementChild!;
    expect(marquee.tagName.toLowerCase()).toBe("rect");
    expect(marquee.getAttribute("x")).toBe("50");
    expect(marquee.getAttribute("y")).toBe("60");
    expect(marquee.getAttribute("stroke")).toBe("#00d4ff");
    expect(marquee.getAttribute("stroke-dasharray")).toBe("4");
  });
});

describe("RedactTool — pointermove resize", () => {
  it("rewrites x/y/width/height as the cursor moves (forward direction)", () => {
    const canvas = makeCanvas();
    const { history } = makeHistory();
    const tool = new RedactTool(canvas as unknown as CanvasManager, history, makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(110, 80));
    const marquee = canvas.uiOverlay.firstElementChild!;
    expect(marquee.getAttribute("x")).toBe("10");
    expect(marquee.getAttribute("y")).toBe("20");
    expect(marquee.getAttribute("width")).toBe("100");
    expect(marquee.getAttribute("height")).toBe("60");
  });

  it("supports reverse-direction drags via min/abs (cursor moves up-left from start)", () => {
    const canvas = makeCanvas();
    const { history } = makeHistory();
    const tool = new RedactTool(canvas as unknown as CanvasManager, history, makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(100, 100));
    tool.onPointerMove(pointerEvent(), new DOMPoint(40, 50));
    const marquee = canvas.uiOverlay.firstElementChild!;
    // Marquee origin is min(start, current) on each axis.
    expect(marquee.getAttribute("x")).toBe("40");
    expect(marquee.getAttribute("y")).toBe("50");
    expect(marquee.getAttribute("width")).toBe("60");
    expect(marquee.getAttribute("height")).toBe("50");
  });

  it("pointermove without a prior pointerdown is a silent no-op", () => {
    const canvas = makeCanvas();
    const { history } = makeHistory();
    const tool = new RedactTool(canvas as unknown as CanvasManager, history, makeOptions());
    expect(() => tool.onPointerMove(pointerEvent(), new DOMPoint(50, 50))).not.toThrow();
    expect(canvas.uiOverlay.children.length).toBe(0);
  });
});

describe("RedactTool — pointerup with solid style", () => {
  it("appends a <rect> to annotations + saves history + fires onShapeComplete", async () => {
    const canvas = makeCanvas();
    const { history, save } = makeHistory();
    const tool = new RedactTool(canvas as unknown as CanvasManager, history, makeOptions());
    const onShapeComplete = vi.fn();
    tool.onShapeComplete = onShapeComplete;
    tool.onPointerDown(pointerEvent(), new DOMPoint(10, 20));
    tool.onPointerMove(pointerEvent(), new DOMPoint(110, 80));
    await tool.onPointerUp(pointerEvent(), new DOMPoint(110, 80));
    expect(canvas.annotations.children.length).toBe(1);
    expect(canvas.annotations.firstElementChild!.tagName.toLowerCase()).toBe("rect");
    expect(save).toHaveBeenCalledTimes(1);
    expect(onShapeComplete).toHaveBeenCalledTimes(1);
    // The marquee in ui-overlay is removed.
    expect(canvas.uiOverlay.children.length).toBe(0);
  });

  it("uses options.fillColor for the solid bar when explicitly set", async () => {
    const canvas = makeCanvas();
    const { history } = makeHistory();
    const tool = new RedactTool(
      canvas as unknown as CanvasManager,
      history,
      makeOptions({ redactStyle: "solid", fillColor: "#abcdef" }),
    );
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(100, 50));
    await tool.onPointerUp(pointerEvent(), new DOMPoint(100, 50));
    const rect = canvas.annotations.firstElementChild!;
    expect(rect.getAttribute("fill")).toBe("#abcdef");
  });

  it("falls back to the REDACT_SOLID_COLOR constant when fillColor is the 'none' sentinel", async () => {
    const canvas = makeCanvas();
    const { history } = makeHistory();
    const tool = new RedactTool(
      canvas as unknown as CanvasManager,
      history,
      makeOptions({ redactStyle: "solid", fillColor: "none" }),
    );
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(100, 50));
    await tool.onPointerUp(pointerEvent(), new DOMPoint(100, 50));
    const rect = canvas.annotations.firstElementChild!;
    // REDACT_SOLID_COLOR is the project's canonical opaque-bar color.
    // Just assert it isn't the empty fillColor and is a hex / rgb value.
    expect(rect.getAttribute("fill")).toMatch(/^(#|rgb)/);
    expect(rect.getAttribute("fill")).not.toBe("none");
  });

  it("discards a too-small marquee (<5px on either axis) without saving history", async () => {
    const canvas = makeCanvas();
    const { history, save } = makeHistory();
    const tool = new RedactTool(canvas as unknown as CanvasManager, history, makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(3, 3));
    await tool.onPointerUp(pointerEvent(), new DOMPoint(3, 3));
    expect(canvas.annotations.children.length).toBe(0);
    expect(save).not.toHaveBeenCalled();
    // The marquee in ui-overlay is removed even on the abort path.
    expect(canvas.uiOverlay.children.length).toBe(0);
  });

  it("pointerup without a prior pointerdown is a silent no-op", async () => {
    const canvas = makeCanvas();
    const { history, save } = makeHistory();
    const tool = new RedactTool(canvas as unknown as CanvasManager, history, makeOptions());
    await tool.onPointerUp(pointerEvent(), new DOMPoint(10, 10));
    expect(canvas.annotations.children.length).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("RedactTool — error fallback to solid", () => {
  // The mosaic / blur paths need a real <canvas> to sample image
  // pixels. Under happy-dom these throw — exercising the catch
  // branch which falls back to renderSolidRedact so the user's
  // "hide this region" intent still succeeds.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("mosaic style under happy-dom (no canvas) → catches + falls back to solid + saves", async () => {
    const canvas = makeCanvas();
    const { history, save } = makeHistory();
    const tool = new RedactTool(
      canvas as unknown as CanvasManager,
      history,
      makeOptions({ redactStyle: "mosaic" }),
    );
    const onShapeComplete = vi.fn();
    tool.onShapeComplete = onShapeComplete;
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(100, 50));
    await tool.onPointerUp(pointerEvent(), new DOMPoint(100, 50));
    // Either the mosaic succeeded (real canvas) or the fallback ran;
    // either way the user gets ONE element committed + history saved.
    expect(canvas.annotations.children.length).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onShapeComplete).toHaveBeenCalledTimes(1);
  });

  it("blur style: same fallback contract (committed + saved on error)", async () => {
    const canvas = makeCanvas();
    const { history, save } = makeHistory();
    const tool = new RedactTool(
      canvas as unknown as CanvasManager,
      history,
      makeOptions({ redactStyle: "blur" }),
    );
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(100, 50));
    await tool.onPointerUp(pointerEvent(), new DOMPoint(100, 50));
    expect(canvas.annotations.children.length).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("default redactStyle is 'mosaic' when options.redactStyle is unset", async () => {
    const canvas = makeCanvas();
    const { history, save } = makeHistory();
    const opts = makeOptions();
    delete (opts as { redactStyle?: string }).redactStyle;
    const tool = new RedactTool(canvas as unknown as CanvasManager, history, opts);
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    tool.onPointerMove(pointerEvent(), new DOMPoint(100, 50));
    await tool.onPointerUp(pointerEvent(), new DOMPoint(100, 50));
    // mosaic path triggered; either real or fallback resulted in 1 commit
    expect(canvas.annotations.children.length).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
