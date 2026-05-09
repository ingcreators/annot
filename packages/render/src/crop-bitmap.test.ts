/// <reference lib="dom" />
// @vitest-environment happy-dom
//
// Unit tests for `cropBitmap`. happy-dom's `<canvas>` does no actual
// rasterisation — `getImageData` returns zeros and `toBlob` fires
// asynchronously without producing meaningful pixels — so we cover
// what's testable at this layer:
//
//   1. Output canvas is sized to the requested rect (clamped + floored).
//   2. The 9-arg drawImage form receives the source-rect → dest-rect
//      copy with the correct (sx, sy, sw, sh, dx, dy, dw, dh).
//   3. Out-of-bounds drag clamps into the source dims.
//   4. A degenerate (fully outside) rect throws instead of silently
//      producing an empty bitmap.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cropBitmap } from "./crop-bitmap.js";

interface CallLog {
  drawImage: Array<{
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    dx: number;
    dy: number;
    dw: number;
    dh: number;
  }>;
  canvasW: number;
  canvasH: number;
  toBlobMime: string | undefined;
}

interface MockSetup {
  log: CallLog;
  base: HTMLImageElement;
  blob: Blob;
}

function setupMockedCanvas(naturalWidth = 200, naturalHeight = 100): MockSetup {
  const log: CallLog = { drawImage: [], canvasW: 0, canvasH: 0, toBlobMime: undefined };
  const blob = new Blob(["mock-cropped-png"], { type: "image/png" });

  const ctxStub = {
    drawImage: (
      _img: CanvasImageSource,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => {
      log.drawImage.push({ sx, sy, sw, sh, dx, dy, dw, dh });
    },
  };
  const canvasProto = HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
    toBlob: (cb: (b: Blob | null) => void, type?: string) => void;
  };
  canvasProto.getContext = function (this: HTMLCanvasElement) {
    log.canvasW = this.width;
    log.canvasH = this.height;
    return ctxStub;
  };
  canvasProto.toBlob = (cb, type) => {
    log.toBlobMime = type;
    queueMicrotask(() => cb(blob));
  };

  // Build a base image with the fake natural dimensions.
  const base = new Image() as HTMLImageElement & {
    naturalWidth: number;
    naturalHeight: number;
  };
  Object.defineProperty(base, "naturalWidth", { value: naturalWidth, configurable: true });
  Object.defineProperty(base, "naturalHeight", { value: naturalHeight, configurable: true });
  // src empty → default mime detection lands on PNG.
  Object.defineProperty(base, "src", { value: "", configurable: true });

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

describe("cropBitmap", () => {
  it("emits a 9-arg drawImage with src-rect → 0,0 dest-rect, sized to the requested rect", async () => {
    const { log, base, blob } = setupMockedCanvas(800, 600);
    const result = await cropBitmap(base, 100, 50, 300, 200);
    expect(result).toBe(blob);
    expect(log.canvasW).toBe(300);
    expect(log.canvasH).toBe(200);
    expect(log.drawImage).toHaveLength(1);
    expect(log.drawImage[0]).toMatchObject({
      sx: 100,
      sy: 50,
      sw: 300,
      sh: 200,
      dx: 0,
      dy: 0,
      dw: 300,
      dh: 200,
    });
    expect(log.toBlobMime).toBe("image/png");
  });

  it("clamps an out-of-bounds rect into the source dims", async () => {
    const { log, base } = setupMockedCanvas(400, 300);
    // Drag past the right + bottom edges. Should clamp to 400-50 = 350
    // wide and 300-50 = 250 tall.
    await cropBitmap(base, 50, 50, 600, 600);
    expect(log.canvasW).toBe(350);
    expect(log.canvasH).toBe(250);
    expect(log.drawImage[0]).toMatchObject({
      sx: 50,
      sy: 50,
      sw: 350,
      sh: 250,
    });
  });

  it("floors fractional x/y to integer pixels (avoids subpixel canvas blur)", async () => {
    const { log, base } = setupMockedCanvas(400, 300);
    await cropBitmap(base, 10.7, 20.3, 100.4, 50.9);
    // floor(10.7) = 10, floor(20.3) = 20, ceil(100.4) = 101, ceil(50.9) = 51
    expect(log.drawImage[0]).toMatchObject({ sx: 10, sy: 20, sw: 101, sh: 51 });
    expect(log.canvasW).toBe(101);
    expect(log.canvasH).toBe(51);
  });

  it("throws when the rect is fully outside the source", async () => {
    const { base } = setupMockedCanvas(400, 300);
    await expect(cropBitmap(base, 500, 500, 100, 100)).rejects.toThrow(/fully outside/);
  });

  it("throws when the source bitmap has zero dimension", async () => {
    const { base } = setupMockedCanvas(0, 0);
    await expect(cropBitmap(base, 0, 0, 100, 100)).rejects.toThrow(/zero dimension/);
  });

  it("preserves JPEG mime when the source is a JPEG data URL", async () => {
    const { log, base } = setupMockedCanvas(400, 300);
    Object.defineProperty(base, "src", {
      value: "data:image/jpeg;base64,...",
      configurable: true,
    });
    await cropBitmap(base, 10, 10, 100, 100);
    expect(log.toBlobMime).toBe("image/jpeg");
  });
});
