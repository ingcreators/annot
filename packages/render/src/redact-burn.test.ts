/// <reference lib="dom" />
// @vitest-environment happy-dom
//
// Unit tests for `burnRedactionsIntoBitmap` (Phase 1 of
// `docs/plans/redact-burn-into-image.md`).
//
// happy-dom can build SVG element fixtures, but its `<canvas>` does
// no actual rasterisation — `getImageData` returns zeros and `toBlob`
// fires asynchronously without producing meaningful pixels. The
// pixel-level burn fidelity is a Phase 4 / integration concern; here
// we cover what's actually testable at this layer:
//
//   1. The element walk + classifier dispatches solid → fillRect,
//      mosaic / blur → drawImage with the embedded PNG href.
//   2. Non-redact elements (no `data-redact-style`) are skipped.
//   3. Geometry attributes (`x` / `y` / `width` / `height`) flow
//      through to the canvas calls in DOM order.
//
// We mock the 2D context's `fillRect` / `drawImage` to record the
// dispatched calls without depending on happy-dom's rasterisation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { burnRedactionsIntoBitmap, classifyRedact } from "./redact-burn.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

interface CanvasCallLog {
  drawImage: Array<{ src: string; x: number; y: number; w: number; h: number }>;
  fillRect: Array<{ fill: string; x: number; y: number; w: number; h: number }>;
  /** Phase 4: every state-change call (save / restore / translate
   *  / rotate / scale) in DOM order so tests can assert the
   *  transform stack matches `T(cx,cy) * R(θ) * S(sx,sy) *
   *  T(-cx,-cy)` for rotated / flipped redactions. */
  state: Array<
    | { kind: "save" }
    | { kind: "restore" }
    | { kind: "translate"; x: number; y: number }
    | { kind: "rotate"; rad: number }
    | { kind: "scale"; sx: number; sy: number }
  >;
}

interface MockSetup {
  log: CanvasCallLog;
  base: HTMLImageElement;
  blob: Blob;
}

function setupMockedCanvas(naturalWidth = 200, naturalHeight = 100): MockSetup {
  const log: CanvasCallLog = { drawImage: [], fillRect: [], state: [] };
  const blob = new Blob(["mock-png"], { type: "image/png" });

  // Stub the 2D context returned by every newly-created canvas. The
  // base-image draw is logged with src=""<base>"" so the test can
  // confirm it ran first; subsequent drawImage calls use the
  // dispatched element's href.
  const ctxStub = {
    drawImage: (img: CanvasImageSource, x: number, y: number, w: number, h: number) => {
      const src = (img as HTMLImageElement).src ?? "";
      log.drawImage.push({ src, x, y, w, h });
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      log.fillRect.push({ fill: ctxStub.fillStyle, x, y, w, h });
    },
    save: () => log.state.push({ kind: "save" }),
    restore: () => log.state.push({ kind: "restore" }),
    translate: (x: number, y: number) => log.state.push({ kind: "translate", x, y }),
    rotate: (rad: number) => log.state.push({ kind: "rotate", rad }),
    scale: (sx: number, sy: number) => log.state.push({ kind: "scale", sx, sy }),
    fillStyle: "" as string,
  };

  // happy-dom's HTMLCanvasElement.getContext returns null by default
  // for "2d"; stub it on the prototype so the helper picks it up.
  const canvasProto = HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
    toBlob: (cb: (b: Blob | null) => void, type?: string) => void;
  };
  canvasProto.getContext = () => ctxStub;
  canvasProto.toBlob = (cb) => {
    // Fire async to mirror real canvas behaviour.
    queueMicrotask(() => cb(blob));
  };

  // Stub HTMLImageElement to fire `onload` synchronously so the
  // helper's `await loadImage(...)` resolves without needing real
  // network / data-URL decoding.
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true,
    set(this: HTMLImageElement & { _src?: string }, value: string) {
      this._src = value;
      // Schedule onload after the current microtask so the caller
      // has a chance to attach the handler.
      queueMicrotask(() => {
        this.onload?.(new Event("load"));
      });
    },
    get(this: HTMLImageElement & { _src?: string }) {
      return this._src ?? "";
    },
  });

  // Build a base image with the fake natural dimensions.
  const base = new Image() as HTMLImageElement & {
    naturalWidth: number;
    naturalHeight: number;
  };
  Object.defineProperty(base, "naturalWidth", { value: naturalWidth, configurable: true });
  Object.defineProperty(base, "naturalHeight", { value: naturalHeight, configurable: true });

  return { log, base, blob };
}

let teardown: Array<() => void> = [];

beforeEach(() => {
  teardown = [];
});

afterEach(() => {
  for (const fn of teardown) fn();
  vi.restoreAllMocks();
});

describe("classifyRedact", () => {
  it("returns null for elements without a redact-style attribute", () => {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("x", "10");
    el.setAttribute("y", "20");
    el.setAttribute("width", "30");
    el.setAttribute("height", "40");
    expect(classifyRedact(el as unknown as SVGElement)).toBeNull();
  });

  it("returns null for elements with an unknown redact-style", () => {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("data-redact-style", "obfuscated");
    el.setAttribute("width", "10");
    el.setAttribute("height", "10");
    expect(classifyRedact(el as unknown as SVGElement)).toBeNull();
  });

  it("returns null when geometry collapses to zero / negative", () => {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("data-redact-style", "solid");
    el.setAttribute("width", "0");
    el.setAttribute("height", "10");
    expect(classifyRedact(el as unknown as SVGElement)).toBeNull();
  });

  it("classifies a <rect data-redact-style=\"solid\"> with fill", () => {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("data-redact-style", "solid");
    el.setAttribute("x", "5");
    el.setAttribute("y", "6");
    el.setAttribute("width", "30");
    el.setAttribute("height", "40");
    el.setAttribute("fill", "#abcdef");
    expect(classifyRedact(el as unknown as SVGElement)).toEqual({
      kind: "solid",
      x: 5,
      y: 6,
      width: 30,
      height: 40,
      rotation: 0,
      flipH: false,
      flipV: false,
      fill: "#abcdef",
    });
  });

  it("falls back to a default fill when <rect> has no fill attr", () => {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("data-redact-style", "solid");
    el.setAttribute("width", "30");
    el.setAttribute("height", "40");
    const out = classifyRedact(el as unknown as SVGElement);
    expect(out).not.toBeNull();
    expect(out?.fill).toBe("#000");
  });

  it("classifies a mosaic <image> and surfaces the embedded href", () => {
    const el = document.createElementNS(SVG_NS, "image");
    el.setAttribute("data-redact-style", "mosaic");
    el.setAttribute("href", TINY_PNG_DATA_URL);
    el.setAttribute("x", "10");
    el.setAttribute("y", "20");
    el.setAttribute("width", "100");
    el.setAttribute("height", "50");
    expect(classifyRedact(el as unknown as SVGElement)).toEqual({
      kind: "mosaic",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      flipH: false,
      flipV: false,
      href: TINY_PNG_DATA_URL,
    });
  });

  it("classifies a blur <image> identically to mosaic apart from the kind tag", () => {
    const el = document.createElementNS(SVG_NS, "image");
    el.setAttribute("data-redact-style", "blur");
    el.setAttribute("href", TINY_PNG_DATA_URL);
    el.setAttribute("width", "10");
    el.setAttribute("height", "10");
    expect(classifyRedact(el as unknown as SVGElement)?.kind).toBe("blur");
  });

  it("returns null when a mosaic / blur element has no href", () => {
    const el = document.createElementNS(SVG_NS, "image");
    el.setAttribute("data-redact-style", "mosaic");
    el.setAttribute("width", "10");
    el.setAttribute("height", "10");
    expect(classifyRedact(el as unknown as SVGElement)).toBeNull();
  });

  // Phase 4: rotation / flip read from `data-rot` / `data-flip-{h,v}`,
  // matching the schema `transform-utils.ts:writeTransformState`
  // persists. Test the round-trip: a `<rect>` with each combination
  // surfaces the right TransformState fields on the classified output.
  it("reads data-rot as the rotation field", () => {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("data-redact-style", "solid");
    el.setAttribute("width", "10");
    el.setAttribute("height", "10");
    el.setAttribute("data-rot", "45");
    expect(classifyRedact(el as unknown as SVGElement)?.rotation).toBe(45);
  });

  it("treats data-rot=\"\" / non-numeric as 0", () => {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("data-redact-style", "solid");
    el.setAttribute("width", "10");
    el.setAttribute("height", "10");
    el.setAttribute("data-rot", "");
    expect(classifyRedact(el as unknown as SVGElement)?.rotation).toBe(0);
  });

  it("reads data-flip-h / data-flip-v as flipH / flipV (\"1\" = true)", () => {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("data-redact-style", "solid");
    el.setAttribute("width", "10");
    el.setAttribute("height", "10");
    el.setAttribute("data-flip-h", "1");
    el.setAttribute("data-flip-v", "1");
    const out = classifyRedact(el as unknown as SVGElement);
    expect(out?.flipH).toBe(true);
    expect(out?.flipV).toBe(true);
  });

  it("treats any non-\"1\" value of data-flip-* as false", () => {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("data-redact-style", "solid");
    el.setAttribute("width", "10");
    el.setAttribute("height", "10");
    el.setAttribute("data-flip-h", "true"); // not the canonical "1"
    el.setAttribute("data-flip-v", "0");
    const out = classifyRedact(el as unknown as SVGElement);
    expect(out?.flipH).toBe(false);
    expect(out?.flipV).toBe(false);
  });
});

describe("burnRedactionsIntoBitmap dispatch", () => {
  it("is a no-op (no fillRect, no compositing) when the redact list is empty", async () => {
    const { log, base } = setupMockedCanvas(50, 60);
    const blob = await burnRedactionsIntoBitmap(base, []);
    expect(blob).toBeInstanceOf(Blob);
    expect(log.fillRect).toHaveLength(0);
    // Only the base-image draw should have run.
    expect(log.drawImage).toHaveLength(1);
    expect(log.drawImage[0]).toMatchObject({ x: 0, y: 0, w: 50, h: 60 });
  });

  it("dispatches solid → fillRect at the element's geometry with its fill", async () => {
    const { log, base } = setupMockedCanvas(200, 100);
    const solid = document.createElementNS(SVG_NS, "rect");
    solid.setAttribute("data-redact-style", "solid");
    solid.setAttribute("x", "10");
    solid.setAttribute("y", "20");
    solid.setAttribute("width", "30");
    solid.setAttribute("height", "40");
    solid.setAttribute("fill", "#112233");

    await burnRedactionsIntoBitmap(base, [solid as unknown as SVGElement]);

    expect(log.fillRect).toHaveLength(1);
    expect(log.fillRect[0]).toEqual({
      fill: "#112233",
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    });
  });

  it("dispatches mosaic / blur → drawImage with the embedded href, in DOM order", async () => {
    const { log, base } = setupMockedCanvas(200, 100);

    const mosaic = document.createElementNS(SVG_NS, "image");
    mosaic.setAttribute("data-redact-style", "mosaic");
    mosaic.setAttribute("href", "data:image/png;base64,MOSAIC");
    mosaic.setAttribute("x", "1");
    mosaic.setAttribute("y", "2");
    mosaic.setAttribute("width", "10");
    mosaic.setAttribute("height", "10");

    const blur = document.createElementNS(SVG_NS, "image");
    blur.setAttribute("data-redact-style", "blur");
    blur.setAttribute("href", "data:image/png;base64,BLUR");
    blur.setAttribute("x", "50");
    blur.setAttribute("y", "60");
    blur.setAttribute("width", "20");
    blur.setAttribute("height", "20");

    await burnRedactionsIntoBitmap(base, [
      mosaic as unknown as SVGElement,
      blur as unknown as SVGElement,
    ]);

    // First drawImage = the base; the next two are the two redacts in
    // DOM order.
    expect(log.drawImage).toHaveLength(3);
    expect(log.drawImage[1]).toMatchObject({
      src: "data:image/png;base64,MOSAIC",
      x: 1,
      y: 2,
      w: 10,
      h: 10,
    });
    expect(log.drawImage[2]).toMatchObject({
      src: "data:image/png;base64,BLUR",
      x: 50,
      y: 60,
      w: 20,
      h: 20,
    });
    expect(log.fillRect).toHaveLength(0);
  });

  it("skips elements without a redact-style attribute (mixed-content safety)", async () => {
    const { log, base } = setupMockedCanvas(200, 100);

    // A regular <rect> annotation that snuck into the redact list.
    const stray = document.createElementNS(SVG_NS, "rect");
    stray.setAttribute("x", "5");
    stray.setAttribute("y", "5");
    stray.setAttribute("width", "10");
    stray.setAttribute("height", "10");
    stray.setAttribute("fill", "#ff0000");

    const solid = document.createElementNS(SVG_NS, "rect");
    solid.setAttribute("data-redact-style", "solid");
    solid.setAttribute("x", "10");
    solid.setAttribute("y", "10");
    solid.setAttribute("width", "20");
    solid.setAttribute("height", "20");
    solid.setAttribute("fill", "#00ff00");

    await burnRedactionsIntoBitmap(base, [
      stray as unknown as SVGElement,
      solid as unknown as SVGElement,
    ]);

    expect(log.fillRect).toHaveLength(1);
    expect(log.fillRect[0]?.fill).toBe("#00ff00");
  });

  it("rejects when the base bitmap has zero natural dimensions", async () => {
    const { base } = setupMockedCanvas(0, 0);
    await expect(burnRedactionsIntoBitmap(base, [])).rejects.toThrow(
      /zero dimension/,
    );
  });
});

// ---- Phase 4 — rotation / flip parity ---------------------------------
//
// Phase 1's MVP rendered solid bars as axis-aligned `fillRect` calls.
// Phase 4 extends the renderer to apply the wrapper's transform
// (rotation + flip via `data-rot` / `data-flip-h` / `data-flip-v`)
// to the canvas context before drawing. The math mirrors
// `transform-utils.ts:applyTransformState` for geometry-positioned
// elements: `M = T(cx, cy) * R(rot) * S(sx, sy) * T(-cx, -cy)`,
// where `(cx, cy) = (x + w/2, y + h/2)`.
//
// happy-dom's <canvas> doesn't rasterise, so these tests assert the
// transform-stack call sequence, not pixel output. The plan's
// pixel-level assertion is deferred to a real-canvas integration
// test under Playwright (see Phase 4's "test plan" comment).

describe("burnRedactionsIntoBitmap — rotation + flip (Phase 4)", () => {
  it("axis-aligned (no rotation, no flip) skips translate / rotate / scale", async () => {
    const { log, base } = setupMockedCanvas(200, 100);

    const solid = document.createElementNS(SVG_NS, "rect");
    solid.setAttribute("data-redact-style", "solid");
    solid.setAttribute("x", "10");
    solid.setAttribute("y", "20");
    solid.setAttribute("width", "30");
    solid.setAttribute("height", "40");
    solid.setAttribute("fill", "#000");

    await burnRedactionsIntoBitmap(base, [solid as unknown as SVGElement]);

    // Only save / restore — no transform stack at all.
    const stateKinds = log.state.map((s) => s.kind);
    expect(stateKinds).toEqual(["save", "restore"]);
  });

  it("rotated solid bar emits T(cx,cy) → R(θ) → T(-cx,-cy) before fillRect", async () => {
    const { log, base } = setupMockedCanvas(200, 100);

    // Solid bar at (10, 20) sized 30×40, rotated 45° CW.
    // Center: (10 + 15, 20 + 20) = (25, 40).
    const solid = document.createElementNS(SVG_NS, "rect");
    solid.setAttribute("data-redact-style", "solid");
    solid.setAttribute("x", "10");
    solid.setAttribute("y", "20");
    solid.setAttribute("width", "30");
    solid.setAttribute("height", "40");
    solid.setAttribute("fill", "#000");
    solid.setAttribute("data-rot", "45");

    await burnRedactionsIntoBitmap(base, [solid as unknown as SVGElement]);

    const stateKinds = log.state.map((s) => s.kind);
    // No flip → no scale call (the renderer skips identity scales).
    expect(stateKinds).toEqual(["save", "translate", "rotate", "translate", "restore"]);

    // Translate to center, rotate, translate back.
    const t1 = log.state[1] as { x: number; y: number };
    const r = log.state[2] as { rad: number };
    const t2 = log.state[3] as { x: number; y: number };
    expect(t1).toMatchObject({ x: 25, y: 40 });
    expect(r.rad).toBeCloseTo((45 * Math.PI) / 180, 9);
    expect(t2).toMatchObject({ x: -25, y: -40 });

    // The fillRect coordinates are still the element's local rect
    // — the canvas's transform stack maps them to the rotated
    // bounds at raster time.
    expect(log.fillRect).toEqual([{ fill: "#000", x: 10, y: 20, w: 30, h: 40 }]);
  });

  it("horizontally-flipped redaction emits scale(-1, 1) between the translates", async () => {
    const { log, base } = setupMockedCanvas(200, 100);

    const solid = document.createElementNS(SVG_NS, "rect");
    solid.setAttribute("data-redact-style", "solid");
    solid.setAttribute("x", "0");
    solid.setAttribute("y", "0");
    solid.setAttribute("width", "20");
    solid.setAttribute("height", "20");
    solid.setAttribute("fill", "#fff");
    solid.setAttribute("data-flip-h", "1");

    await burnRedactionsIntoBitmap(base, [solid as unknown as SVGElement]);

    const stateKinds = log.state.map((s) => s.kind);
    expect(stateKinds).toEqual(["save", "translate", "scale", "translate", "restore"]);
    const s = log.state[2] as { sx: number; sy: number };
    expect(s).toMatchObject({ sx: -1, sy: 1 });
  });

  it("vertically-flipped redaction emits scale(1, -1)", async () => {
    const { log, base } = setupMockedCanvas(200, 100);

    const solid = document.createElementNS(SVG_NS, "rect");
    solid.setAttribute("data-redact-style", "solid");
    solid.setAttribute("x", "0");
    solid.setAttribute("y", "0");
    solid.setAttribute("width", "20");
    solid.setAttribute("height", "20");
    solid.setAttribute("data-flip-v", "1");

    await burnRedactionsIntoBitmap(base, [solid as unknown as SVGElement]);

    const s = log.state.find((c) => c.kind === "scale") as { sx: number; sy: number };
    expect(s).toMatchObject({ sx: 1, sy: -1 });
  });

  it("rotated mosaic image gets the same transform stack before drawImage", async () => {
    const { log, base } = setupMockedCanvas(200, 100);

    const mosaic = document.createElementNS(SVG_NS, "image");
    mosaic.setAttribute("data-redact-style", "mosaic");
    mosaic.setAttribute("href", "data:image/png;base64,MOSAIC");
    mosaic.setAttribute("x", "0");
    mosaic.setAttribute("y", "0");
    mosaic.setAttribute("width", "10");
    mosaic.setAttribute("height", "10");
    mosaic.setAttribute("data-rot", "90");

    await burnRedactionsIntoBitmap(base, [mosaic as unknown as SVGElement]);

    const stateKinds = log.state.map((s) => s.kind);
    expect(stateKinds).toEqual(["save", "translate", "rotate", "translate", "restore"]);
    // drawImage call (the second one — the first is the base)
    // still uses the local rect; the matrix above maps it.
    expect(log.drawImage[1]).toMatchObject({
      src: "data:image/png;base64,MOSAIC",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    });
  });

  it("rotation + flip combine: translate(c) → rotate(θ) → scale(sx,sy) → translate(-c)", async () => {
    const { log, base } = setupMockedCanvas(200, 100);

    const solid = document.createElementNS(SVG_NS, "rect");
    solid.setAttribute("data-redact-style", "solid");
    solid.setAttribute("x", "10");
    solid.setAttribute("y", "10");
    solid.setAttribute("width", "20");
    solid.setAttribute("height", "20");
    solid.setAttribute("data-rot", "30");
    solid.setAttribute("data-flip-h", "1");
    solid.setAttribute("data-flip-v", "1");

    await burnRedactionsIntoBitmap(base, [solid as unknown as SVGElement]);

    // Operator order: T, R, S, T (right-to-left composition is
    // canvas's left-to-right call order — same as the SVG matrix
    // operator order in `applyTransformState`).
    const kinds = log.state.map((s) => s.kind);
    expect(kinds).toEqual(["save", "translate", "rotate", "scale", "translate", "restore"]);

    const r = log.state[2] as { rad: number };
    const sc = log.state[3] as { sx: number; sy: number };
    expect(r.rad).toBeCloseTo((30 * Math.PI) / 180, 9);
    expect(sc).toMatchObject({ sx: -1, sy: -1 });
  });
});
