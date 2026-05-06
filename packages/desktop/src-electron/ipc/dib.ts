/**
 * BGRA → CF_DIB encoder.
 *
 * The Win32 clipboard format `CF_DIB` (numeric id `8`) carries a
 * `BITMAPINFOHEADER` followed by raw pixel rows. Paint, browsers,
 * Google Sheets, and most other paste targets that don't speak
 * GVML pull `CF_DIB` (or its sibling `CF_BITMAP`, which Windows
 * synthesizes from `CF_DIB`) for image paste.
 *
 * Output layout:
 *
 *   - 40-byte `BITMAPINFOHEADER` (`biSize=40`, `biPlanes=1`,
 *     `biBitCount=24`, `biCompression=BI_RGB`, `biHeight` positive
 *     for bottom-up).
 *   - Pixel rows in BGR order (alpha dropped), bottom-up, each
 *     scanline padded to a 4-byte boundary as Win32 expects.
 *
 * Equivalent of the `png_to_dib` helper in the deleted
 * `packages/desktop/src-tauri/src/commands/clipboard.rs`. The
 * Tauri impl took PNG bytes + decoded via the Rust `image` crate;
 * the Electron port splits the responsibility — `nativeImage`
 * decodes PNG → BGRA buffer (host adapter) and this function does
 * the BGRA → DIB packing (pure JS, fully testable).
 *
 * Input format: 4-channel BGRA, one byte per channel, row-major
 * top-down. This matches what Electron's
 * `nativeImage.toBitmap()` returns on Windows (Skia's native
 * layout). The alpha channel is dropped — Annot screenshots are
 * always opaque (the source canvas has a solid background under
 * the annotation overlay), so there's nothing meaningful to
 * preserve in alpha.
 */

/** Output a 24-bit BGR `BITMAPINFOHEADER`-prefixed DIB from
 *  4-channel BGRA pixel data. Throws if the buffer length doesn't
 *  match `width * height * 4`. */
export function bgraToDib(bgra: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`bgraToDib: invalid dimensions ${width}x${height}`);
  }
  const expected = width * height * 4;
  if (bgra.length !== expected) {
    throw new Error(
      `bgraToDib: pixel buffer size ${bgra.length} doesn't match ${width}x${height}x4 = ${expected}`,
    );
  }

  // CF_DIB scanlines are padded to a 4-byte boundary. For 24-bit
  // BGR that means rows of `width * 3` bytes rounded up to the
  // next multiple of 4. The same arithmetic the Tauri impl used.
  const rowBytes = width * 3;
  const rowStride = (rowBytes + 3) & ~3;
  const pixelSize = rowStride * height;

  const out = new Uint8Array(40 + pixelSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // BITMAPINFOHEADER. All multi-byte fields are little-endian.
  view.setUint32(0, 40, true); // biSize
  view.setInt32(4, width, true); // biWidth
  view.setInt32(8, height, true); // biHeight (positive ⇒ bottom-up)
  view.setUint16(12, 1, true); // biPlanes (must be 1)
  view.setUint16(14, 24, true); // biBitCount (24-bit BGR)
  view.setUint32(16, 0, true); // biCompression = BI_RGB
  view.setUint32(20, pixelSize, true); // biSizeImage
  view.setInt32(24, 0, true); // biXPelsPerMeter
  view.setInt32(28, 0, true); // biYPelsPerMeter
  view.setUint32(32, 0, true); // biClrUsed
  view.setUint32(36, 0, true); // biClrImportant

  // Pixel rows: bottom-up. Source row y in BGRA → output row
  // (height-1-y) in BGR with row padding. The padding bytes stay
  // 0 (Uint8Array initialises to zero).
  let dst = 40;
  for (let y = height - 1; y >= 0; y--) {
    const srcRowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = srcRowStart + x * 4;
      out[dst++] = bgra[i]!; // B
      out[dst++] = bgra[i + 1]!; // G
      out[dst++] = bgra[i + 2]!; // R
      // alpha (bgra[i + 3]) intentionally dropped
    }
    dst += rowStride - rowBytes;
  }

  return out;
}

/** Win32 `CF_DIB` clipboard format id. The Win32 header
 *  `<winuser.h>` defines this as `8` since the DOS days; carrying
 *  the literal here keeps the Electron addon's loader code free of
 *  any Win32 header dependency. */
export const CF_DIB = 8;
