/**
 * Minimal PNG-8 (palette / indexed-color) encoder.
 *
 * Takes the output of a quantizer (palette + per-pixel indices) and emits
 * a valid PNG file using DEFLATE level 9 via Pako. Supports 1-bit alpha
 * via the `tRNS` chunk when any palette color has alpha < 255.
 *
 * Only the subset needed for our screenshot pipeline is implemented:
 *   - 8-bit color depth
 *   - Color type 3 (indexed)
 *   - No interlace
 *   - Filter "None" (filter byte 0) on every scanline — palette images
 *     don't benefit much from non-trivial filters and skipping them keeps
 *     the encoder tiny and fast.
 */
import { deflate } from "pako";

const PNG_MAGIC = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// Precomputed CRC-32 table (IEEE 802.3 polynomial — same as PNG / zip).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  // length (excludes type + crc)
  view.setUint32(0, data.length, false);
  // type (4 ASCII chars)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  // payload
  out.set(data, 8);
  // CRC over (type + data)
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

/**
 * Encode a palette + per-pixel indices buffer as a PNG-8 file.
 *
 * @param palette  RGBA bytes per palette entry, length = 4 * N (1 ≤ N ≤ 256).
 * @param indices  One byte per pixel, length = width * height.
 * @param width    Image width in pixels.
 * @param height   Image height in pixels.
 * @param level    DEFLATE compression level 0–9 (default 9 = smallest file).
 */
export function encodePng8(
  palette: Uint8Array,
  indices: Uint8Array,
  width: number,
  height: number,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 9,
): Uint8Array {
  if (width <= 0 || height <= 0) throw new Error("encodePng8: invalid dimensions");
  if (palette.length % 4 !== 0) throw new Error("encodePng8: palette must be RGBA bytes (multiple of 4)");
  const numColors = palette.length >>> 2;
  if (numColors < 1 || numColors > 256) {
    throw new Error(`encodePng8: palette must have 1–256 colors, got ${numColors}`);
  }
  if (indices.length !== width * height) {
    throw new Error(`encodePng8: indices length ${indices.length} != width*height ${width * height}`);
  }

  // ---- IHDR (13 bytes) ----
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 3;   // color type: indexed
  ihdr[10] = 0;  // compression method (deflate)
  ihdr[11] = 0;  // filter method (standard)
  ihdr[12] = 0;  // interlace method (none)

  // ---- PLTE (3 bytes per color) ----
  const plte = new Uint8Array(numColors * 3);
  let hasAlpha = false;
  let trnsLastIdx = -1; // last palette index with alpha < 255
  for (let i = 0; i < numColors; i++) {
    plte[i * 3]     = palette[i * 4]!;
    plte[i * 3 + 1] = palette[i * 4 + 1]!;
    plte[i * 3 + 2] = palette[i * 4 + 2]!;
    if (palette[i * 4 + 3]! < 255) {
      hasAlpha = true;
      trnsLastIdx = i;
    }
  }

  // ---- tRNS (alpha for indices 0..trnsLastIdx) — only if any color is non-opaque.
  // PNG spec lets us truncate trailing 255 entries.
  let trns: Uint8Array | null = null;
  if (hasAlpha) {
    trns = new Uint8Array(trnsLastIdx + 1);
    for (let i = 0; i <= trnsLastIdx; i++) trns[i] = palette[i * 4 + 3]!;
  }

  // ---- IDAT: filter byte 0 + scanline of indices, per row, then DEFLATE.
  const stride = width + 1; // 1 filter byte + width index bytes
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const dstRow = y * stride;
    raw[dstRow] = 0; // filter: None
    raw.set(indices.subarray(y * width, y * width + width), dstRow + 1);
  }
  const idat = deflate(raw, { level, memLevel: 9, windowBits: 15 });

  // ---- Assemble ----
  const chunks: Uint8Array[] = [
    PNG_MAGIC,
    encodeChunk("IHDR", ihdr),
    encodeChunk("PLTE", plte),
  ];
  if (trns) chunks.push(encodeChunk("tRNS", trns));
  chunks.push(encodeChunk("IDAT", idat));
  chunks.push(encodeChunk("IEND", new Uint8Array(0)));

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
