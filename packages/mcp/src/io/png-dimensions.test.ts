import { describe, expect, test } from "vitest";

import { InvalidPngError, readPngDimensions } from "./png-dimensions.js";

// Smallest valid PNG header: signature + IHDR chunk for a 5×3 image
// with bit depth 8 / colour type 6 (RGBA). The compressed image
// data + IEND aren't included — `readPngDimensions` only looks at
// the IHDR region.
function buildPngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  // Signature
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length (13, big-endian)
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  // Chunk type "IHDR"
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  // Width (big-endian uint32)
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  // Bit depth / colour type / etc. (skipped — not parsed)
  return bytes;
}

describe("readPngDimensions", () => {
  test("reads width and height from a valid PNG header", () => {
    const bytes = buildPngHeader(1920, 1080);
    expect(readPngDimensions(bytes)).toEqual({ width: 1920, height: 1080 });
  });

  test("handles small images", () => {
    const bytes = buildPngHeader(1, 1);
    expect(readPngDimensions(bytes)).toEqual({ width: 1, height: 1 });
  });

  test("handles large images", () => {
    const bytes = buildPngHeader(0x7fffffff, 0x7fffffff);
    expect(readPngDimensions(bytes)).toEqual({
      width: 0x7fffffff,
      height: 0x7fffffff,
    });
  });

  test("rejects inputs shorter than the minimum header", () => {
    const tooShort = new Uint8Array(10);
    expect(() => readPngDimensions(tooShort)).toThrowError(InvalidPngError);
  });

  test("rejects inputs that don't start with the PNG signature", () => {
    const jpegMagic = new Uint8Array(33);
    jpegMagic.set([0xff, 0xd8, 0xff, 0xe0], 0); // JPEG SOI + APP0
    expect(() => readPngDimensions(jpegMagic)).toThrowError(/PNG signature/);
  });

  test("rejects inputs whose chunk type isn't IHDR", () => {
    const bytes = buildPngHeader(10, 10);
    // Clobber the IHDR type with "iCCP" (a valid PNG chunk type,
    // but not allowed as the first chunk).
    bytes.set([0x69, 0x43, 0x43, 0x50], 12);
    expect(() => readPngDimensions(bytes)).toThrowError(/IHDR chunk/);
  });

  test("rejects PNGs with a zero dimension", () => {
    const bytes = buildPngHeader(0, 100);
    expect(() => readPngDimensions(bytes)).toThrowError(/zero axis/);
  });
});
