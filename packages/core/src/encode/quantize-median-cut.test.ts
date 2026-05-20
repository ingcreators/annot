import { describe, expect, it } from "vitest";
import { quantizeMedianCut } from "./quantize-median-cut.js";

/**
 * Convert (r,g,b,a) pixels to a flat RGBA8 buffer.
 *
 * @example
 *   pixels(2, 1, [[255,0,0,255], [0,255,0,255]])
 *   // → Uint8Array([255,0,0,255, 0,255,0,255])
 */
function pixels(w: number, h: number, perPixel: number[][]): Uint8Array {
  const expected = w * h;
  if (perPixel.length !== expected) {
    throw new Error(`pixels: expected ${expected} entries, got ${perPixel.length}`);
  }
  const buf = new Uint8Array(expected * 4);
  for (let i = 0; i < expected; i++) {
    const [r, g, b, a] = perPixel[i]!;
    buf[i * 4] = r!;
    buf[i * 4 + 1] = g!;
    buf[i * 4 + 2] = b!;
    buf[i * 4 + 3] = a!;
  }
  return buf;
}

/** Fill a w×h buffer with a single colour. */
function solid(w: number, h: number, r: number, g: number, b: number, a = 255): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  }
  return buf;
}

describe("quantizeMedianCut — argument validation", () => {
  it("rejects zero / negative width", () => {
    expect(() => quantizeMedianCut(new Uint8Array(4), 0, 1, 256)).toThrow(/invalid width/);
    expect(() => quantizeMedianCut(new Uint8Array(4), -1, 1, 256)).toThrow(/invalid width/);
  });
  it("rejects zero / negative height", () => {
    expect(() => quantizeMedianCut(new Uint8Array(4), 1, 0, 256)).toThrow(/invalid height/);
  });
  it("rejects mismatched buffer length", () => {
    expect(() => quantizeMedianCut(new Uint8Array(7), 1, 1, 256)).toThrow(/rgba length/);
  });
  it("clamps maxColors into [1, 256]", () => {
    const buf = solid(2, 2, 100, 100, 100);
    expect(() => quantizeMedianCut(buf, 2, 2, 0)).not.toThrow();
    expect(() => quantizeMedianCut(buf, 2, 2, 9999)).not.toThrow();
  });
});

describe("quantizeMedianCut — palette construction", () => {
  it("emits a single palette entry for a single-colour image", () => {
    const buf = solid(4, 4, 200, 100, 50);
    const { palette, indices } = quantizeMedianCut(buf, 4, 4, 256);
    expect(palette.length).toBe(4); // 1 entry × 4 bytes
    expect(Array.from(palette)).toEqual([200, 100, 50, 255]);
    // Every pixel indexes the sole entry.
    expect(indices.length).toBe(16);
    for (const idx of indices) expect(idx).toBe(0);
  });

  it("emits ≤ N palette entries for an N-colour synthetic input", () => {
    // 4 distinct opaque colours, each occupying a 2×2 block of a
    // 4×4 image — no quantization error possible at maxColors=4.
    const C: number[][] = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 0, 255],
    ];
    const perPixel: number[][] = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const block = (y < 2 ? 0 : 2) + (x < 2 ? 0 : 1);
        perPixel.push(C[block]!);
      }
    }
    const buf = pixels(4, 4, perPixel);
    const { palette, indices } = quantizeMedianCut(buf, 4, 4, 4);

    // Up to 4 palette entries.
    expect(palette.length).toBeLessThanOrEqual(4 * 4);
    expect(palette.length).toBeGreaterThanOrEqual(4); // at least 1 entry
    expect(indices.length).toBe(16);

    // Each pixel's palette entry should be near the original colour
    // (FS dither smears slightly across block boundaries, but the
    // dominant colour wins inside each 2×2 block centre).
    for (const idx of indices) {
      expect(idx).toBeLessThan(palette.length / 4);
    }
  });

  it("respects maxColors=1", () => {
    const buf = pixels(2, 2, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 0, 255],
    ]);
    const { palette } = quantizeMedianCut(buf, 2, 2, 1);
    expect(palette.length).toBe(4); // exactly 1 RGBA entry
  });

  it("respects maxColors=256 cap (clamp at upper bound)", () => {
    // 257 distinct colours — must produce ≤ 256 palette entries.
    const w = 257;
    const buf = new Uint8Array(w * 4);
    for (let i = 0; i < w; i++) {
      buf[i * 4] = i % 256;
      buf[i * 4 + 1] = 128;
      buf[i * 4 + 2] = 0;
      buf[i * 4 + 3] = 255;
    }
    const { palette } = quantizeMedianCut(buf, w, 1, 256);
    expect(palette.length).toBeLessThanOrEqual(256 * 4);
  });
});

describe("quantizeMedianCut — transparent-pixel handling", () => {
  it("reserves palette index 0 for transparent pixels when present", () => {
    const buf = pixels(2, 1, [
      [255, 0, 0, 255], // opaque red
      [0, 0, 0, 0], // fully transparent
    ]);
    const { palette, indices } = quantizeMedianCut(buf, 2, 1, 256);
    // Index 0 is the transparent entry (alpha=0).
    expect(palette[3]).toBe(0);
    // Index 1 onward is the opaque red.
    expect(palette[4]).toBe(255);
    expect(palette[7]).toBe(255); // opaque alpha
    // Pixel 1 (transparent) → index 0.
    expect(indices[1]).toBe(0);
    // Pixel 0 (opaque red) → index 1.
    expect(indices[0]).toBe(1);
  });

  it("treats alpha < 16 as transparent (matches encodePng8 tRNS handling)", () => {
    const buf = pixels(2, 1, [
      [255, 0, 0, 255],
      [10, 20, 30, 15], // alpha 15 → treated as transparent
    ]);
    const { palette, indices } = quantizeMedianCut(buf, 2, 1, 256);
    expect(palette[3]).toBe(0); // transparent entry alpha
    expect(indices[1]).toBe(0);
  });

  it("does NOT add a transparent entry for fully-opaque input", () => {
    const buf = solid(2, 2, 100, 100, 100);
    const { palette } = quantizeMedianCut(buf, 2, 2, 256);
    // Only one entry, and it's opaque.
    expect(palette.length).toBe(4);
    expect(palette[3]).toBe(255);
  });
});

describe("quantizeMedianCut — determinism", () => {
  it("produces byte-identical output for identical input on repeated runs", () => {
    // 8×8 gradient-ish patch with mixed colours.
    const w = 8;
    const h = 8;
    const buf = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        buf[i] = (x * 32) & 0xff;
        buf[i + 1] = (y * 32) & 0xff;
        buf[i + 2] = ((x + y) * 16) & 0xff;
        buf[i + 3] = 255;
      }
    }
    const a = quantizeMedianCut(buf, w, h, 16);
    const b = quantizeMedianCut(buf, w, h, 16);
    expect(Array.from(a.palette)).toEqual(Array.from(b.palette));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });
});

describe("quantizeMedianCut — Floyd–Steinberg remap basics", () => {
  it("produces every index < palette size", () => {
    // 16-colour palette × 16×16 image → indices ∈ [0, 16).
    const w = 16;
    const h = 16;
    const buf = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      buf[i * 4] = (i * 7) % 256;
      buf[i * 4 + 1] = (i * 11) % 256;
      buf[i * 4 + 2] = (i * 13) % 256;
      buf[i * 4 + 3] = 255;
    }
    const { palette, indices } = quantizeMedianCut(buf, w, h, 16);
    const maxIdx = palette.length / 4;
    for (const idx of indices) expect(idx).toBeLessThan(maxIdx);
  });

  it("never emits a transparent-entry index for an opaque pixel", () => {
    const buf = pixels(2, 1, [
      [200, 0, 0, 255],
      [0, 0, 0, 0],
    ]);
    const { indices } = quantizeMedianCut(buf, 2, 1, 256);
    // Pixel 0 is fully opaque → must NOT map to index 0 (the
    // transparent slot).
    expect(indices[0]).not.toBe(0);
  });
});

describe("quantizeMedianCut — quality smoke-test on a UI-ish gradient", () => {
  // A 64×8 horizontal gradient from black to white. Quantized to
  // 8 colours with FS dither, the result should preserve the
  // overall gradient direction — sampling the leftmost column
  // should map to a "dark" palette entry, the rightmost to a
  // "light" one.
  it("a black→white gradient at maxColors=8 stays monotonic", () => {
    const w = 64;
    const h = 8;
    const buf = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.round((x / (w - 1)) * 255);
        const i = (y * w + x) * 4;
        buf[i] = v;
        buf[i + 1] = v;
        buf[i + 2] = v;
        buf[i + 3] = 255;
      }
    }
    const { palette, indices } = quantizeMedianCut(buf, w, h, 8);
    // Map each palette entry to its grayscale luminance for
    // monotonicity checks.
    const numEntries = palette.length / 4;
    const lum = new Array<number>(numEntries);
    for (let i = 0; i < numEntries; i++) {
      lum[i] = (palette[i * 4]! + palette[i * 4 + 1]! + palette[i * 4 + 2]!) / 3;
    }

    // Sample columns near the left and right edges; average
    // luminance across all rows.
    function avgLumAtCol(col: number): number {
      let sum = 0;
      for (let y = 0; y < h; y++) {
        sum += lum[indices[y * w + col]!]!;
      }
      return sum / h;
    }
    const left = avgLumAtCol(2);
    const right = avgLumAtCol(w - 3);
    // Left should be visibly darker than right.
    expect(right - left).toBeGreaterThan(180);
  });
});
