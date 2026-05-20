// Tests for the encode pipeline. Real `@napi-rs/canvas` roundtrips
// for the PNG / JPEG paths; PNG-8 routes through the pure-TS
// Median Cut quantizer in `@ingcreators/annot-core/encode/quantize-median-cut`
// (post-Phase 3 of
// `docs/plans/replace-libimagequant-with-median-cut.md`).

import { describe, expect, test } from "vitest";

import { encodeRgba } from "./encode.js";
import { isPhotoHeavy } from "./quantize.js";

/** Build a synthetic RGBA buffer of solid colour. */
function solidRgba(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  }
  return rgba;
}

/** Synthetic photo-like RGBA — gradient + per-pixel jitter so the
 *  unique-colour count is high enough to trigger `isPhotoHeavy`. */
function photoLikeRgba(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  let seed = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Simple LCG for deterministic per-pixel noise.
      seed = (seed * 1664525 + 1013904223) | 0;
      rgba[i] = (x + (seed & 0xff)) & 0xff;
      rgba[i + 1] = (y + ((seed >> 8) & 0xff)) & 0xff;
      rgba[i + 2] = (x + y + ((seed >> 16) & 0xff)) & 0xff;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function readPngWidth(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16, false);
}

function isPngSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

describe("encodeRgba", () => {
  test("format: 'png' emits PNG-32 at the source dimensions", async () => {
    const rgba = solidRgba(64, 48, 255, 128, 0);
    const result = await encodeRgba(rgba, 64, 48, {
      format: "png",
      smartFallback: "png",
      smartColorThreshold: 15000,
      jpegPercent: 92,
    });
    expect(result.chosen).toBe("png");
    expect(result.width).toBe(64);
    expect(result.height).toBe(48);
    expect(isPngSignature(result.bytes)).toBe(true);
    expect(readPngWidth(result.bytes)).toBe(64);
  });

  test("format: 'jpeg' emits a JPEG with the SOI marker", async () => {
    const rgba = solidRgba(80, 60, 0, 200, 100);
    const result = await encodeRgba(rgba, 80, 60, {
      format: "jpeg",
      smartFallback: "png",
      smartColorThreshold: 15000,
      jpegPercent: 80,
    });
    expect(result.chosen).toBe("jpeg");
    expect(isJpegSignature(result.bytes)).toBe(true);
  });

  test("saveSizePreset: 'light' resizes a 2000px-wide source down to 1280", async () => {
    const rgba = solidRgba(2000, 1500, 64, 64, 64);
    const result = await encodeRgba(rgba, 2000, 1500, {
      format: "png",
      smartFallback: "png",
      smartColorThreshold: 15000,
      jpegPercent: 92,
      saveSizePreset: "light",
    });
    expect(result.width).toBe(1280);
    expect(result.height).toBe(960); // aspect-preserved (1500 * 1280 / 2000)
    expect(readPngWidth(result.bytes)).toBe(1280);
  });

  test("saveSizePreset: 'standard' is a no-op when source is narrower", async () => {
    const rgba = solidRgba(800, 600, 200, 200, 200);
    const result = await encodeRgba(rgba, 800, 600, {
      format: "png",
      smartFallback: "png",
      smartColorThreshold: 15000,
      jpegPercent: 92,
      saveSizePreset: "standard",
    });
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  test("smart mode falls back to JPEG when photo-heavy + smartFallback='jpeg'", async () => {
    const rgba = photoLikeRgba(200, 150);
    const result = await encodeRgba(rgba, 200, 150, {
      format: "smart",
      smartFallback: "jpeg",
      smartColorThreshold: 5000, // intentionally low to trip photo-heavy
      jpegPercent: 85,
    });
    expect(result.chosen).toBe("jpeg");
    expect(result.reason).toBe("photo-fallback-jpeg");
    expect(isJpegSignature(result.bytes)).toBe(true);
  });

  test("smart mode falls back to PNG-32 when photo-heavy + smartFallback='png'", async () => {
    const rgba = photoLikeRgba(200, 150);
    const result = await encodeRgba(rgba, 200, 150, {
      format: "smart",
      smartFallback: "png",
      smartColorThreshold: 5000,
      jpegPercent: 85,
    });
    expect(result.chosen).toBe("png");
    expect(result.reason).toBe("photo-fallback-png");
    expect(isPngSignature(result.bytes)).toBe(true);
  });

  test("smart mode quantizes to PNG-8 for UI-heavy content", async () => {
    // Solid colour = 1 unique colour. Definitely not photo-heavy.
    const rgba = solidRgba(100, 80, 32, 64, 128);
    const result = await encodeRgba(rgba, 100, 80, {
      format: "smart",
      smartFallback: "png",
      smartColorThreshold: 15000,
      jpegPercent: 92,
    });
    expect(result.chosen).toBe("png");
    expect(result.reason).toBe("png-8");
    expect(isPngSignature(result.bytes)).toBe(true);
  });
});

describe("isPhotoHeavy", () => {
  test("solid-colour buffer is not photo-heavy", () => {
    const rgba = solidRgba(100, 100, 128, 128, 128);
    expect(isPhotoHeavy(rgba, 1000)).toBe(false);
  });

  test("noisy buffer crosses the threshold", () => {
    const rgba = photoLikeRgba(100, 100);
    expect(isPhotoHeavy(rgba, 1000)).toBe(true);
  });

  test("empty buffer returns false", () => {
    expect(isPhotoHeavy(new Uint8Array(0), 100)).toBe(false);
  });
});
