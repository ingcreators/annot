/**
 * Goldens for the `bgraToDib` encoder.
 *
 * The CF_DIB byte layout is fixed by Win32 — the
 * `BITMAPINFOHEADER` is 40 bytes, scanlines are 4-byte aligned,
 * and rows are bottom-up. Office, Paint, browsers, and Sheets
 * all parse the same layout, so getting these wrong silently
 * breaks paste at the receiving end. The tests pin each piece
 * of the layout by inspection so a regression fails loudly here
 * instead of as a "weird artefact in PowerPoint".
 */

import { describe, expect, it } from "vitest";
import { bgraToDib, CF_DIB } from "./dib.js";

describe("bgraToDib — header", () => {
  it("emits a 40-byte BITMAPINFOHEADER with biBitCount=24, BI_RGB, positive height", () => {
    const w = 4;
    const h = 2;
    // 4×2 solid red BGRA (B=0, G=0, R=255, A=255).
    const bgra = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      bgra[i * 4 + 0] = 0x00;
      bgra[i * 4 + 1] = 0x00;
      bgra[i * 4 + 2] = 0xff;
      bgra[i * 4 + 3] = 0xff;
    }
    const dib = bgraToDib(bgra, w, h);
    const view = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);

    expect(view.getUint32(0, true)).toBe(40); // biSize
    expect(view.getInt32(4, true)).toBe(w); // biWidth
    expect(view.getInt32(8, true)).toBe(h); // biHeight (positive ⇒ bottom-up)
    expect(view.getUint16(12, true)).toBe(1); // biPlanes
    expect(view.getUint16(14, true)).toBe(24); // biBitCount
    expect(view.getUint32(16, true)).toBe(0); // biCompression = BI_RGB
    // 4×2 row stride is `(4*3+3) & ~3 = 12`; pixel size 24.
    expect(view.getUint32(20, true)).toBe(24); // biSizeImage
    expect(view.getInt32(24, true)).toBe(0); // biXPelsPerMeter
    expect(view.getInt32(28, true)).toBe(0); // biYPelsPerMeter
    expect(view.getUint32(32, true)).toBe(0); // biClrUsed
    expect(view.getUint32(36, true)).toBe(0); // biClrImportant
  });

  it("exposes the standard CF_DIB id (8)", () => {
    expect(CF_DIB).toBe(8);
  });
});

describe("bgraToDib — pixel layout", () => {
  it("emits BGR (alpha dropped) in bottom-up scanline order", () => {
    // 2×2 with distinct corners so we can read the layout. BGRA
    // input rows are top-down: row 0 then row 1. DIB output rows
    // are bottom-up: row 1 first, then row 0.
    //   (0,0) = red:    B=0   G=0   R=255 A=255
    //   (1,0) = green:  B=0   G=255 R=0   A=255
    //   (0,1) = blue:   B=255 G=0   R=0   A=255
    //   (1,1) = white:  B=255 G=255 R=255 A=255
    const bgra = new Uint8Array([
      // row 0 (top)
      0x00, 0x00, 0xff, 0xff, 0x00, 0xff, 0x00, 0xff,
      // row 1 (bottom)
      0xff, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
    const dib = bgraToDib(bgra, 2, 2);
    // 2-pixel rows: 6 BGR bytes, padded to 8 bytes (4-byte align).
    const rowStride = 8;
    const pix = dib.subarray(40);

    // First DIB row = bottom row of the input (blue, white).
    expect(Array.from(pix.subarray(0, 6))).toEqual([
      0xff,
      0x00,
      0x00, // (0,1) blue
      0xff,
      0xff,
      0xff, // (1,1) white
    ]);
    expect(Array.from(pix.subarray(6, 8))).toEqual([0x00, 0x00]); // padding

    // Second DIB row = top row of the input (red, green).
    expect(Array.from(pix.subarray(rowStride, rowStride + 6))).toEqual([
      0x00,
      0x00,
      0xff, // (0,0) red
      0x00,
      0xff,
      0x00, // (1,0) green
    ]);
    expect(Array.from(pix.subarray(rowStride + 6, rowStride + 8))).toEqual([0x00, 0x00]);
  });

  it("ignores the alpha channel even when partially transparent", () => {
    // Single pixel BGRA(50, 100, 150, 0). Alpha 0 should NOT
    // multiply the pixel out — alpha is dropped untouched.
    const bgra = new Uint8Array([50, 100, 150, 0]);
    const dib = bgraToDib(bgra, 1, 1);
    const pix = dib.subarray(40);
    expect(Array.from(pix.subarray(0, 3))).toEqual([50, 100, 150]);
  });
});

describe("bgraToDib — row padding", () => {
  it("pads scanlines to a 4-byte boundary for non-multiple-of-4 widths", () => {
    // Width 1 ⇒ 3 BGR bytes ⇒ row stride 4 (1 byte of padding).
    const bgra1 = new Uint8Array([0x10, 0x20, 0x30, 0xff]);
    const dib1 = bgraToDib(bgra1, 1, 1);
    expect(dib1.length).toBe(40 + 4);
    expect(Array.from(dib1.subarray(40))).toEqual([0x10, 0x20, 0x30, 0x00]);

    // Width 3 ⇒ 9 BGR bytes ⇒ row stride 12 (3 bytes of padding).
    const bgra3 = new Uint8Array([
      0x01, 0x02, 0x03, 0xff, 0x04, 0x05, 0x06, 0xff, 0x07, 0x08, 0x09, 0xff,
    ]);
    const dib3 = bgraToDib(bgra3, 3, 1);
    expect(dib3.length).toBe(40 + 12);
    expect(Array.from(dib3.subarray(40))).toEqual([
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x00, 0x00, 0x00,
    ]);

    // Width 5 ⇒ 15 BGR bytes ⇒ row stride 16 (1 byte of padding).
    const bgra5 = new Uint8Array(5 * 4).fill(0xab);
    // Set alpha to 0xff so the synthetic pattern is well-formed.
    for (let i = 3; i < bgra5.length; i += 4) bgra5[i] = 0xff;
    const dib5 = bgraToDib(bgra5, 5, 1);
    expect(dib5.length).toBe(40 + 16);
    // 15 bytes of 0xAB followed by 1 byte of padding.
    const pix5 = dib5.subarray(40);
    for (let i = 0; i < 15; i++) expect(pix5[i]).toBe(0xab);
    expect(pix5[15]).toBe(0x00);

    // Width 4 ⇒ 12 BGR bytes ⇒ row stride 12 (no padding).
    const bgra4 = new Uint8Array(4 * 4).fill(0xcd);
    for (let i = 3; i < bgra4.length; i += 4) bgra4[i] = 0xff;
    const dib4 = bgraToDib(bgra4, 4, 1);
    expect(dib4.length).toBe(40 + 12);
    const pix4 = dib4.subarray(40);
    for (let i = 0; i < 12; i++) expect(pix4[i]).toBe(0xcd);
  });

  it("reports biSizeImage as the padded byte count, not the unpadded one", () => {
    // 3×2 pixels: rowBytes=9, rowStride=12, total padded size 24.
    const bgra = new Uint8Array(3 * 2 * 4);
    for (let i = 3; i < bgra.length; i += 4) bgra[i] = 0xff;
    const dib = bgraToDib(bgra, 3, 2);
    const view = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
    expect(view.getUint32(20, true)).toBe(24);
    expect(dib.length).toBe(40 + 24);
  });
});

describe("bgraToDib — input validation", () => {
  it("throws on mismatched buffer size", () => {
    expect(() => bgraToDib(new Uint8Array(15), 2, 2)).toThrow(/16/);
  });

  it("throws on non-positive dimensions", () => {
    expect(() => bgraToDib(new Uint8Array(0), 0, 0)).toThrow(/dimensions/);
    expect(() => bgraToDib(new Uint8Array(0), -1, 1)).toThrow(/dimensions/);
    expect(() => bgraToDib(new Uint8Array(0), 1, 0)).toThrow(/dimensions/);
  });

  it("throws on non-integer dimensions", () => {
    expect(() => bgraToDib(new Uint8Array(0), 1.5, 1)).toThrow(/dimensions/);
  });
});
