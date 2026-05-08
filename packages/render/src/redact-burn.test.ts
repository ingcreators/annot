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
}

interface MockSetup {
  log: CanvasCallLog;
  base: HTMLImageElement;
  blob: Blob;
}

function setupMockedCanvas(naturalWidth = 200, naturalHeight = 100): MockSetup {
  const log: CanvasCallLog = { drawImage: [], fillRect: [] };
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
    save: () => {},
    restore: () => {},
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
