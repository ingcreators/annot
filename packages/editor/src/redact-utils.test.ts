/**
 * @vitest-environment happy-dom
 *
 * Tests for `redact-utils.ts`'s mosaic / blur PNG samplers,
 * focused on the regression caught after
 * [`_done/redact-burn-into-image.md`](../../../docs/plans/_done/redact-burn-into-image.md)
 * landed: when the redaction's geometry — after a move or resize —
 * extends past the base bitmap's bounds, `drawImage` clips the
 * source rect to the image, leaving the destination's
 * out-of-source pixels in their initial transparent state. The
 * block-average loop in `sampleBlockAveragePng` then samples
 * `alpha=0` from the center pixel of any such block, and the
 * mosaic becomes a transparent hole that shows whatever sits
 * beneath it (defeating the redact tool's entire purpose).
 *
 * The fix: pre-fill the destination canvas with `REDACT_SOLID_COLOR`
 * BEFORE `drawImage`, so out-of-bounds blocks read as opaque solid
 * fill instead of transparent. These tests pin the call order via
 * a mocked 2D context that records every fill / drawImage call —
 * happy-dom's `<canvas>` doesn't rasterise but the call sequence
 * is what defines correctness.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REDACT_SOLID_COLOR } from "@ingcreators/annot-core/utils";
import type { CanvasManager } from "./canvas-manager.js";
import { renderBlurRedact, renderMosaicRedact } from "./redact-utils.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

interface CallLog {
  /** Every state-change call (fillStyle assignment / fillRect /
   *  drawImage / getImageData / putImageData) in DOM order so the
   *  test can assert the pre-fill happens BEFORE drawImage. */
  ops: Array<
    | { kind: "fillStyle"; value: string }
    | { kind: "fillRect"; x: number; y: number; w: number; h: number }
    | { kind: "drawImage"; src: string }
    | { kind: "getImageData"; w: number; h: number }
    | { kind: "putImageData" }
    | { kind: "filter"; value: string }
  >;
  /** Most-recent imageData returned by getImageData. The block-
   *  average loop walks this; we hand it back in putImageData
   *  so the helper can consume it. */
  lastData: ImageData | null;
}

function setupMockedCanvas(): { log: CallLog; restore: () => void } {
  const log: CallLog = { ops: [], lastData: null };

  const ctxStub = {
    get fillStyle(): string {
      return ctxStub._fillStyle;
    },
    set fillStyle(v: string) {
      ctxStub._fillStyle = v;
      log.ops.push({ kind: "fillStyle", value: v });
    },
    get filter(): string {
      return ctxStub._filter;
    },
    set filter(v: string) {
      ctxStub._filter = v;
      log.ops.push({ kind: "filter", value: v });
    },
    _fillStyle: "" as string,
    _filter: "none" as string,
    fillRect(x: number, y: number, w: number, h: number) {
      log.ops.push({ kind: "fillRect", x, y, w, h });
    },
    drawImage(img: CanvasImageSource) {
      const src = (img as HTMLImageElement).src ?? "(canvas)";
      log.ops.push({ kind: "drawImage", src });
    },
    getImageData(_x: number, _y: number, w: number, h: number): ImageData {
      log.ops.push({ kind: "getImageData", w, h });
      // Build a tiny ImageData. The block-average loop walks the
      // returned `data` array; happy-dom's `ImageData` constructor
      // accepts a Uint8ClampedArray.
      const data = new Uint8ClampedArray(w * h * 4);
      // Fill with an opaque mid-grey so the block-average loop
      // reads non-zero alpha + a sample colour. Real-canvas
      // behaviour: drawImage paints pixels; the fix's pre-fill
      // ensures alpha is non-zero even where drawImage clipped.
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 128; // r
        data[i + 1] = 128; // g
        data[i + 2] = 128; // b
        data[i + 3] = 255; // a (opaque)
      }
      const imageData = { data, width: w, height: h } as ImageData;
      log.lastData = imageData;
      return imageData;
    },
    putImageData() {
      log.ops.push({ kind: "putImageData" });
    },
  };

  const canvasProto = HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
    toDataURL: (type?: string) => string;
  };
  const origGetContext = canvasProto.getContext;
  const origToDataURL = canvasProto.toDataURL;
  canvasProto.getContext = () => ctxStub;
  canvasProto.toDataURL = () => "data:image/png;base64,STUB";

  // Stub HTMLImageElement.src setter so loadImage's onload fires
  // synchronously without needing real network / data-URL decoding.
  const imgProto = HTMLImageElement.prototype;
  const origSrcDesc = Object.getOwnPropertyDescriptor(imgProto, "src");
  Object.defineProperty(imgProto, "src", {
    configurable: true,
    set(this: HTMLImageElement & { _src?: string }, value: string) {
      this._src = value;
      Object.defineProperty(this, "naturalWidth", { value: 100, configurable: true });
      Object.defineProperty(this, "naturalHeight", { value: 100, configurable: true });
      queueMicrotask(() => {
        this.onload?.(new Event("load"));
      });
    },
    get(this: HTMLImageElement & { _src?: string }) {
      return this._src ?? "";
    },
  });

  return {
    log,
    restore: () => {
      canvasProto.getContext = origGetContext;
      canvasProto.toDataURL = origToDataURL;
      if (origSrcDesc) {
        Object.defineProperty(imgProto, "src", origSrcDesc);
      } else {
        delete (imgProto as unknown as { src?: string }).src;
      }
    },
  };
}

function makeCanvasManager(): CanvasManager {
  const imageEl = document.createElementNS(SVG_NS, "image") as SVGImageElement;
  imageEl.setAttribute("href", TINY_PNG_DATA_URL);
  return { imageEl } as unknown as CanvasManager;
}

let teardown: (() => void) | null = null;

beforeEach(() => {
  teardown = null;
});

afterEach(() => {
  teardown?.();
  teardown = null;
});

describe("renderMosaicRedact — out-of-bounds rebake transparency fix", () => {
  it("pre-fills with REDACT_SOLID_COLOR before drawImage so out-of-bounds blocks stay opaque", async () => {
    const { log, restore } = setupMockedCanvas();
    teardown = restore;
    const cm = makeCanvasManager();

    // Geometry whose source rect (200, 200, 60, 40) extends past
    // the 100x100 base image — typical of a redaction the user
    // dragged off the bottom-right after creating it.
    await renderMosaicRedact({ x: 200, y: 200, width: 60, height: 40 }, cm);

    // Find the indices of the relevant ops.
    const fillStyleIdx = log.ops.findIndex(
      (o) => o.kind === "fillStyle" && o.value === REDACT_SOLID_COLOR,
    );
    const fillRectIdx = log.ops.findIndex(
      (o) => o.kind === "fillRect" && o.x === 0 && o.y === 0 && o.w === 60 && o.h === 40,
    );
    const drawImageIdx = log.ops.findIndex((o) => o.kind === "drawImage");

    expect(fillStyleIdx).toBeGreaterThanOrEqual(0);
    expect(fillRectIdx).toBeGreaterThanOrEqual(0);
    expect(drawImageIdx).toBeGreaterThanOrEqual(0);

    // The pre-fill (fillStyle then fillRect) must precede drawImage.
    expect(fillStyleIdx).toBeLessThan(fillRectIdx);
    expect(fillRectIdx).toBeLessThan(drawImageIdx);
  });

  it("pre-fills covers the FULL destination canvas (not just the in-bounds region)", async () => {
    const { log, restore } = setupMockedCanvas();
    teardown = restore;
    const cm = makeCanvasManager();

    await renderMosaicRedact({ x: -50, y: -50, width: 80, height: 60 }, cm);

    // The pre-fill rect must cover the full destination size so
    // even out-of-bounds blocks have an opaque starting colour.
    // (Geometry like x=-50, y=-50 means the top-left half of the
    // redaction lies outside the base image; drawImage's clipped
    // region would leave those destination pixels transparent
    // without the pre-fill.)
    const preFill = log.ops.find(
      (o) => o.kind === "fillRect" && o.x === 0 && o.y === 0 && o.w === 80 && o.h === 60,
    );
    expect(preFill).toBeDefined();
  });

  it("floors fractional rect dimensions before passing them to the typed-array index math", async () => {
    // Regression test for the user-reported "サイズ拡大は透明になる"
    // bug. SelectionManager's resize path computes width/height as
    // `pt.x - x` where `pt` came from `svgPoint(e)`'s viewport
    // transform — on a high-DPI base image where DOM-pixel-size /
    // viewBox-size isn't exact, IEEE-754 rounding leaves tail bits
    // like `670.0000000000002`. The mosaic block-average loop then
    // computes `(sy * width + sx) * 4` as a typed-array index. For
    // any sy > 0 the trailing bits push the index off-integer, and
    // typed-array integer-indexed slots silently reject non-canonical
    // numeric keys (reads return `undefined`, writes are no-ops).
    // Only the sy=0 row's writes ever land — the rest of the canvas
    // keeps the raw `drawImage`'d pixels (the unredacted base
    // content showing straight through). Floor the dimensions so
    // every index stays integer and the block-average loop pixelates
    // the entire region.
    const { log, restore } = setupMockedCanvas();
    teardown = restore;
    const cm = makeCanvasManager();

    // Fractional dimensions exactly matching the pattern observed in
    // the dev-server reproducer (SelectionManager resize on a
    // 1200×600 base image).
    await renderMosaicRedact(
      { x: 430, y: 60, width: 670.0000000000002, height: 220.00000000000006 },
      cm,
    );

    // The pre-fill rect must be flooring the dimensions, not passing
    // them through verbatim — otherwise downstream getImageData /
    // typed-array math hits the off-by-epsilon trap.
    const preFill = log.ops.find(
      (o) => o.kind === "fillRect" && o.x === 0 && o.y === 0 && o.w === 670 && o.h === 220,
    );
    expect(preFill).toBeDefined();

    // getImageData must also receive integer dimensions so the
    // returned `data.data` length matches what the block-average
    // loop expects.
    const getData = log.ops.find(
      (o) => o.kind === "getImageData" && o.w === 670 && o.h === 220,
    );
    expect(getData).toBeDefined();

    // No fillRect / getImageData call should leak the fractional
    // values through.
    const fractionalLeaks = log.ops.filter((o) => {
      if (o.kind === "fillRect") return !Number.isInteger(o.w) || !Number.isInteger(o.h);
      if (o.kind === "getImageData") return !Number.isInteger(o.w) || !Number.isInteger(o.h);
      return false;
    });
    expect(fractionalLeaks).toHaveLength(0);
  });
});

describe("buildImageRedact — preserveAspectRatio for race-window resilience", () => {
  // Regression test for the user-reported "blurも連続してサイズ変更
  // していると、オブジェクトとblurのエリアに差異が発生します。" bug.
  //
  // SVG `<image>` defaults to `preserveAspectRatio="xMidYMid meet"`,
  // which fits the embedded raster inside the wrapper without
  // distortion — leaving transparent padding when the wrapper's
  // aspect ratio diverges from the embedded PNG's. During rapid
  // continuous resize the wrapper is updated faster than the rebake
  // PNG can be regenerated; the aspect ratios diverge for the
  // duration of the in-flight rebake plus the queued follow-up,
  // and `meet`-mode padding shows the underlying screenshot
  // through the gap — a privacy violation.
  //
  // Setting `preserveAspectRatio="none"` makes the embedded raster
  // ALWAYS stretch to fill the wrapper, eliminating the gap. The
  // worst transient effect is a subtly stretched blur instead of a
  // hole — privacy contract holds throughout the race.

  it("renderMosaicRedact's resulting <image> carries preserveAspectRatio=\"none\"", async () => {
    const { restore } = setupMockedCanvas();
    teardown = restore;
    const cm = makeCanvasManager();

    const el = await renderMosaicRedact({ x: 10, y: 20, width: 100, height: 60 }, cm);
    expect(el.tagName).toBe("image");
    expect(el.getAttribute("preserveAspectRatio")).toBe("none");
  });

  it("renderBlurRedact's resulting <image> carries preserveAspectRatio=\"none\"", async () => {
    const { restore } = setupMockedCanvas();
    teardown = restore;
    const cm = makeCanvasManager();

    const el = await renderBlurRedact({ x: 10, y: 20, width: 100, height: 60 }, cm);
    expect(el.tagName).toBe("image");
    expect(el.getAttribute("preserveAspectRatio")).toBe("none");
  });
});

describe("renderBlurRedact — out-of-bounds rebake transparency fix", () => {
  it("pre-fills the padded canvas with REDACT_SOLID_COLOR before setting blur filter", async () => {
    const { log, restore } = setupMockedCanvas();
    teardown = restore;
    const cm = makeCanvasManager();

    // Geometry whose source rect extends past the base image —
    // mosaic + blur paths share the same clipping symptom and
    // the same pre-fill remedy.
    await renderBlurRedact({ x: 200, y: 200, width: 60, height: 40 }, cm);

    const fillStyleIdx = log.ops.findIndex(
      (o) => o.kind === "fillStyle" && o.value === REDACT_SOLID_COLOR,
    );
    const fillRectIdx = log.ops.findIndex((o) => o.kind === "fillRect");
    const filterIdx = log.ops.findIndex(
      (o) => o.kind === "filter" && o.value !== "none",
    );
    const drawImageIdx = log.ops.findIndex((o) => o.kind === "drawImage");

    expect(fillStyleIdx).toBeGreaterThanOrEqual(0);
    expect(fillRectIdx).toBeGreaterThanOrEqual(0);
    expect(filterIdx).toBeGreaterThanOrEqual(0);
    expect(drawImageIdx).toBeGreaterThanOrEqual(0);

    // Order: pre-fill (fillStyle + fillRect) → set blur filter →
    // drawImage. The pre-fill MUST precede the filter so the
    // sentinel itself isn't blurred (the blur filter only applies
    // to subsequent draws).
    expect(fillStyleIdx).toBeLessThan(fillRectIdx);
    expect(fillRectIdx).toBeLessThan(filterIdx);
    expect(filterIdx).toBeLessThan(drawImageIdx);
  });
});
