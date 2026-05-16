// @vitest-environment happy-dom

/**
 * Synthetic-fixture tests for the diff-detection helpers.
 *
 * happy-dom doesn't paint into `<canvas>`, but the helpers operate
 * on raw `ImageData` so we can build fixtures by hand. The shapes
 * we exercise:
 *
 *   - identical buffers → 0 score
 *   - full-frame repaint → high score
 *   - single small region → bounding-box flagged as cursor-only
 *   - single large region → bounding-box not cursor-only
 */

import { describe, expect, it } from "vitest";
import {
  CURSOR_ONLY_MAX_BOUNDS_HEIGHT,
  CURSOR_ONLY_MAX_BOUNDS_WIDTH,
  computeDiffScore,
  isCursorOnly,
  isMeaningfulChange,
  PIXEL_DELTA_THRESHOLD,
} from "./diff-detection.js";

function makeImageData(width: number, height: number, fill: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill;
    data[i + 1] = fill;
    data[i + 2] = fill;
    data[i + 3] = 255;
  }
  // happy-dom doesn't expose `ImageData` as a constructible global,
  // but `computeDiffScore` only reads the `width` / `height` /
  // `data` properties — a structural shim is sufficient.
  return { data, width, height, colorSpace: "srgb" } as unknown as ImageData;
}

/** Stamp a filled rectangle into an existing ImageData buffer. */
function stampRect(img: ImageData, x: number, y: number, w: number, h: number, fill: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = ((y + dy) * img.width + (x + dx)) * 4;
      img.data[idx] = fill;
      img.data[idx + 1] = fill;
      img.data[idx + 2] = fill;
      img.data[idx + 3] = 255;
    }
  }
}

describe("computeDiffScore", () => {
  it("returns 0 for identical buffers", () => {
    const a = makeImageData(20, 20, 128);
    const b = makeImageData(20, 20, 128);
    const r = computeDiffScore(a, b);
    expect(r.changedPixels).toBe(0);
    expect(r.changedRatio).toBe(0);
    expect(r.averageDelta).toBe(0);
    expect(r.boundingBox).toBeNull();
  });

  it("flags every pixel for a full-frame repaint", () => {
    const a = makeImageData(20, 20, 0);
    const b = makeImageData(20, 20, 200);
    const r = computeDiffScore(a, b);
    expect(r.changedPixels).toBe(20 * 20);
    expect(r.changedRatio).toBe(1);
    expect(r.boundingBox).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });

  it("computes a tight bounding box around a localized change", () => {
    const a = makeImageData(40, 40, 0);
    const b = makeImageData(40, 40, 0);
    stampRect(b, 10, 12, 5, 4, 250); // 5×4 change at (10, 12)
    const r = computeDiffScore(a, b);
    expect(r.changedPixels).toBe(20);
    expect(r.boundingBox).toEqual({ x: 10, y: 12, width: 5, height: 4 });
  });

  it("ignores deltas below PIXEL_DELTA_THRESHOLD", () => {
    const a = makeImageData(10, 10, 100);
    const b = makeImageData(10, 10, 100);
    // dr + dg + db must be < PIXEL_DELTA_THRESHOLD per pixel.
    // A single +5 channel bump = delta 5 → not changed.
    stampRect(b, 0, 0, 10, 10, 105);
    const r = computeDiffScore(a, b);
    // Each pixel: |5| + |5| + |5| = 15 < 30 → not changed.
    expect(PIXEL_DELTA_THRESHOLD).toBe(30);
    expect(r.changedPixels).toBe(0);
  });

  it("throws when dimensions disagree", () => {
    const a = makeImageData(10, 10, 0);
    const b = makeImageData(20, 10, 0);
    expect(() => computeDiffScore(a, b)).toThrow(/dimension mismatch/);
  });
});

describe("isCursorOnly", () => {
  it("flags a small localized change as cursor-only", () => {
    const a = makeImageData(320, 180, 0);
    const b = makeImageData(320, 180, 0);
    stampRect(b, 100, 100, 12, 16, 255); // way smaller than 48x48 cap
    const r = computeDiffScore(a, b);
    expect(isCursorOnly(r)).toBe(true);
  });

  it("does NOT flag a wide bounding box as cursor-only", () => {
    const a = makeImageData(320, 180, 0);
    const b = makeImageData(320, 180, 0);
    stampRect(b, 0, 0, CURSOR_ONLY_MAX_BOUNDS_WIDTH + 1, 1, 255);
    const r = computeDiffScore(a, b);
    expect(isCursorOnly(r)).toBe(false);
  });

  it("does NOT flag a tall bounding box as cursor-only", () => {
    const a = makeImageData(320, 180, 0);
    const b = makeImageData(320, 180, 0);
    stampRect(b, 0, 0, 1, CURSOR_ONLY_MAX_BOUNDS_HEIGHT + 1, 255);
    const r = computeDiffScore(a, b);
    expect(isCursorOnly(r)).toBe(false);
  });

  it("does NOT flag identical frames as cursor-only", () => {
    const a = makeImageData(320, 180, 0);
    const b = makeImageData(320, 180, 0);
    const r = computeDiffScore(a, b);
    expect(isCursorOnly(r)).toBe(false);
  });

  it("rejects high-change-ratio frames even if the bbox fits", () => {
    // Hypothetical: tiny 10×10 frame where every pixel changes —
    // ratio is 1.0, far above the cursor cap.
    const a = makeImageData(10, 10, 0);
    const b = makeImageData(10, 10, 200);
    const r = computeDiffScore(a, b);
    expect(isCursorOnly(r)).toBe(false);
  });
});

describe("isMeaningfulChange", () => {
  it("returns true once the changed ratio crosses the threshold", () => {
    const a = makeImageData(10, 10, 0);
    const b = makeImageData(10, 10, 200); // 100% changed
    const r = computeDiffScore(a, b);
    expect(isMeaningfulChange(r)).toBe(true);
  });

  it("returns false when the changed ratio stays below the threshold", () => {
    const a = makeImageData(20, 20, 0);
    const b = makeImageData(20, 20, 0);
    stampRect(b, 0, 0, 1, 1, 200); // 1 pixel = ratio 0.0025
    const r = computeDiffScore(a, b);
    expect(isMeaningfulChange(r)).toBe(false);
  });
});
