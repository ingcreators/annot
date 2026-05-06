/**
 * XMP-bearing image read/write IPC — Phase 2 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Direct port of `packages/desktop/src-tauri/src/commands/xmp.rs`.
 * Two channels:
 *
 *   - `save_with_xmp`  → writes a re-editable image (PNG or JPEG)
 *     with annotations + dimensions + tags in XMP, original capture
 *     image embedded in a custom chunk / segment.
 *   - `read_xmp`       → reverse: extracts the same metadata.
 *
 * Wire format matches the Rust impl byte-for-byte for the
 * iTXt / svGo / APP1 / APP2 layer:
 *
 *   - PNG: XMP in `iTXt` chunk (keyword `XML:com.adobe.xmp`),
 *     original image in custom ancillary chunk `svGo`.
 *   - JPEG: XMP in APP1 with the standard
 *     `http://ns.adobe.com/xap/1.0/\0` prefix; original image
 *     split across multiple APP2 segments with the custom prefix
 *     `annot:OriginalImage\0` plus a 4-byte (seq, total) header.
 *
 * Behaviour gaps from the Rust impl (deliberately deferred to a
 * follow-up):
 *
 *   - The Rust `image_to_progressive_jpeg` step that compresses
 *     the embedded original (PNG → progressive JPEG Q90) is NOT
 *     ported. Reason: pure-JS progressive-JPEG encoding pulls in
 *     a large native dep (`sharp`) that's overkill for Phase 2,
 *     and the user-facing impact is "files saved fresh under
 *     Electron embed slightly larger originals when the source
 *     was PNG." Round-trip equivalence still holds: a Tauri-saved
 *     file's already-progressive-JPEG original round-trips
 *     verbatim through Electron read+write because the bytes are
 *     embedded as-is on both sides.
 *   - When `file_path` ends with `.jpg`/`.jpeg` and the rendered
 *     image is a PNG, the Rust impl uses `image_to_progressive_jpeg`
 *     to convert. The Electron port falls back to Electron's
 *     `nativeImage.toJPEG(90)` (baseline JPEG, not progressive)
 *     via the host-supplied `pngToJpeg` callback. Tests can pass
 *     a stub.
 */

import { promises as fs } from "node:fs";

const XMP_NS = "annot";
const XMP_NS_URI = "https://ingcreators.com/annot/ns/1.0/";
const XMP_APP1_PREFIX = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0");
const ANNOT_APP2_PREFIX = new TextEncoder().encode("annot:OriginalImage\0");
const PNG_XMP_KEYWORD = new TextEncoder().encode("XML:com.adobe.xmp");

export interface AnnotMetadata {
  original_image_b64: string;
  annotations_svg: string;
  width: number;
  height: number;
  tags?: string;
}

export interface SaveWithXmpInput {
  renderedImageB64: string;
  originalImageB64: string;
  annotationsSvg: string;
  width: number;
  height: number;
  filePath: string;
  tags?: string;
}

export interface XmpHandlers {
  saveWithXmp(input: SaveWithXmpInput): Promise<void>;
  readXmp(input: { filePath: string }): Promise<AnnotMetadata | null>;
}

export interface XmpHandlerOptions {
  /** Convert PNG bytes → JPEG bytes. The Rust impl uses
   *  `image_to_progressive_jpeg` (Q90 progressive). The Electron
   *  default in `main.ts` uses `nativeImage.toJPEG(90)` (baseline).
   *  Tests pass a stub that returns the input unchanged or
   *  throws to cover the error path. */
  pngToJpeg(png: Uint8Array): Promise<Uint8Array>;
}

export function createXmpHandlers(opts: XmpHandlerOptions): XmpHandlers {
  return {
    async saveWithXmp(input) {
      const xmpXml = buildXmp(
        input.annotationsSvg,
        input.width,
        input.height,
        input.tags ?? "",
      );
      const xmpBytes = new TextEncoder().encode(xmpXml);
      const imgBytes = base64ToBytes(input.renderedImageB64);
      // The Rust impl runs the original through
      // `image_to_progressive_jpeg` to compress it. The TS port
      // embeds the bytes as-is — see file-level comment for the
      // behaviour-gap rationale.
      const originalBytes = base64ToBytes(input.originalImageB64);

      const lower = input.filePath.toLowerCase();
      if (lower.endsWith(".png")) {
        const out = writePngWithMetadata(imgBytes, xmpBytes, originalBytes);
        await fs.writeFile(input.filePath, out);
        return;
      }
      // JPEG output. If the rendered image came in as a PNG
      // (typical — `getPngDataUrl(canvas)`), convert first via
      // the host-supplied callback.
      let jpegBytes: Uint8Array = imgBytes;
      if (startsWithPngSignature(imgBytes)) {
        jpegBytes = await opts.pngToJpeg(imgBytes);
      }
      const out = writeJpegWithMetadata(jpegBytes, xmpBytes, originalBytes);
      await fs.writeFile(input.filePath, out);
    },

    async readXmp({ filePath }) {
      const data = await fs.readFile(filePath);
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (filePath.toLowerCase().endsWith(".png")) {
        const xmp = readPngXmp(bytes);
        if (!xmp) return null;
        const original = readPngOriginal(bytes);
        return parseXmp(xmp, original);
      }
      const xmp = readJpegXmp(bytes);
      if (!xmp) return null;
      const original = readJpegOriginal(bytes);
      return parseXmp(xmp, original);
    },
  };
}

// ---- XMP XML build / parse ──────────────────────────────────────

function buildXmp(annotationsSvg: string, width: number, height: number, tags: string): string {
  const tagsLine =
    !tags || tags === "{}"
      ? ""
      : `\n      <${XMP_NS}:tags>${tags}</${XMP_NS}:tags>`;
  return `<?xpacket begin="\\u{feff}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:${XMP_NS}="${XMP_NS_URI}">
      <${XMP_NS}:annotations><![CDATA[${annotationsSvg}]]></${XMP_NS}:annotations>
      <${XMP_NS}:width>${width}</${XMP_NS}:width>
      <${XMP_NS}:height>${height}</${XMP_NS}:height>
      <${XMP_NS}:version>1.0</${XMP_NS}:version>${tagsLine}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function parseXmp(xmp: string, originalBytes: Uint8Array | null): AnnotMetadata | null {
  const svgRaw = extractTag(xmp, "annotations");
  if (svgRaw === null) return null;
  const svg = svgRaw.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
  const widthStr = extractTag(xmp, "width");
  const heightStr = extractTag(xmp, "height");
  const width = widthStr ? Number.parseInt(widthStr, 10) || 0 : 0;
  const height = heightStr ? Number.parseInt(heightStr, 10) || 0 : 0;
  const tags = extractTag(xmp, "tags") ?? "";
  return {
    original_image_b64: originalBytes ? bytesToBase64(originalBytes) : "",
    annotations_svg: svg,
    width,
    height,
    tags,
  };
}

function extractTag(xml: string, tag: string): string | null {
  const open = `<${XMP_NS}:${tag}>`;
  const close = `</${XMP_NS}:${tag}>`;
  const start = xml.indexOf(open);
  if (start < 0) return null;
  const end = xml.indexOf(close, start);
  if (end < 0) return null;
  return xml.slice(start + open.length, end);
}

// ---- Endian / signature helpers ─────────────────────────────────

function u16be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ]);
}

function readU16be(data: Uint8Array, offset: number): number {
  return ((data[offset] as number) << 8) | (data[offset + 1] as number);
}

function readU32be(data: Uint8Array, offset: number): number {
  return (
    (((data[offset] as number) << 24) |
      ((data[offset + 1] as number) << 16) |
      ((data[offset + 2] as number) << 8) |
      (data[offset + 3] as number)) >>>
    0
  );
}

function startsWithPngSignature(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  );
}

function startsWith(data: Uint8Array, offset: number, prefix: Uint8Array): boolean {
  if (offset + prefix.length > data.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[offset + i] !== prefix[i]) return false;
  }
  return true;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  // Buffer is universally available in the Electron main process
  // (Node), and far faster than the atob loop xmp-browser uses.
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

// ---- JPEG read / write ──────────────────────────────────────────

function buildJpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  // Length includes the 2 length bytes themselves (per JPEG spec).
  const segLen = payload.length + 2;
  return concat(new Uint8Array([0xff, marker]), u16be(segLen), payload);
}

function buildApp2Segments(data: Uint8Array): Uint8Array {
  // Each APP2 segment: FF E2 [len] "annot:OriginalImage\0" [seq:2] [total:2] [chunk]
  // Max payload per segment: 65533 - prefix(20) - seq(2) - total(2) = 65509
  const prefixLen = ANNOT_APP2_PREFIX.length;
  const maxChunk = 65533 - prefixLen - 4;
  const totalChunks = Math.max(1, Math.ceil(data.length / maxChunk));
  const parts: Uint8Array[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * maxChunk;
    const end = Math.min(start + maxChunk, data.length);
    const chunk = data.subarray(start, end);
    const payload = concat(
      ANNOT_APP2_PREFIX,
      u16be(i),
      u16be(totalChunks),
      chunk,
    );
    parts.push(buildJpegSegment(0xe2, payload));
  }
  return concat(...parts);
}

function removeJpegMetadata(data: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [];
  out.push(data.subarray(0, 2)); // SOI
  let pos = 2;
  while (pos + 4 <= data.length) {
    if (data[pos] !== 0xff) break;
    const marker = data[pos + 1] as number;
    if (marker === 0xd9 || marker === 0xda) {
      out.push(data.subarray(pos));
      return concat(...out);
    }
    const segLen = readU16be(data, pos + 2);
    const segEnd = pos + 2 + segLen;
    if (segEnd > data.length) break;

    const isXmp = marker === 0xe1 && startsWith(data, pos + 4, XMP_APP1_PREFIX);
    const isAnnot = marker === 0xe2 && startsWith(data, pos + 4, ANNOT_APP2_PREFIX);
    if (!isXmp && !isAnnot) {
      out.push(data.subarray(pos, segEnd));
    }
    pos = segEnd;
  }
  if (pos < data.length) out.push(data.subarray(pos));
  return concat(...out);
}

function writeJpegWithMetadata(
  jpegData: Uint8Array,
  xmp: Uint8Array,
  original: Uint8Array,
): Uint8Array {
  if (jpegData.length < 2 || jpegData[0] !== 0xff || jpegData[1] !== 0xd8) {
    throw new Error("Not a valid JPEG");
  }
  const xmpPayload = concat(XMP_APP1_PREFIX, xmp);
  const xmpSeg = buildJpegSegment(0xe1, xmpPayload);
  const app2Segments = buildApp2Segments(original);
  const cleaned = removeJpegMetadata(jpegData);
  return concat(cleaned.subarray(0, 2), xmpSeg, app2Segments, cleaned.subarray(2));
}

function readJpegXmp(data: Uint8Array): string | null {
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 4 <= data.length) {
    if (data[pos] !== 0xff) break;
    const marker = data[pos + 1] as number;
    if (marker === 0xd9 || marker === 0xda) break;
    const segLen = readU16be(data, pos + 2);
    const segEnd = pos + 2 + segLen;
    if (segEnd > data.length) break;

    if (marker === 0xe1 && startsWith(data, pos + 4, XMP_APP1_PREFIX)) {
      const xmpStart = pos + 4 + XMP_APP1_PREFIX.length;
      return new TextDecoder("utf-8").decode(data.subarray(xmpStart, segEnd));
    }
    pos = segEnd;
  }
  return null;
}

function readJpegOriginal(data: Uint8Array): Uint8Array | null {
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const prefixLen = ANNOT_APP2_PREFIX.length;
  const chunks: Array<{ seq: number; bytes: Uint8Array }> = [];
  let pos = 2;
  while (pos + 4 <= data.length) {
    if (data[pos] !== 0xff) break;
    const marker = data[pos + 1] as number;
    if (marker === 0xd9 || marker === 0xda) break;
    const segLen = readU16be(data, pos + 2);
    const segEnd = pos + 2 + segLen;
    if (segEnd > data.length) break;

    if (marker === 0xe2 && startsWith(data, pos + 4, ANNOT_APP2_PREFIX)) {
      const headerEnd = pos + 4 + prefixLen;
      if (headerEnd + 4 <= segEnd) {
        const seq = readU16be(data, headerEnd);
        chunks.push({ seq, bytes: data.subarray(headerEnd + 4, segEnd) });
      }
    }
    pos = segEnd;
  }
  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.seq - b.seq);
  return concat(...chunks.map((c) => c.bytes));
}

// ---- PNG read / write ───────────────────────────────────────────

function buildPngChunk(chunkType: Uint8Array, data: Uint8Array): Uint8Array {
  const lenBytes = u32be(data.length);
  // CRC covers chunk type + chunk data, NOT the length.
  const crcSeed = concat(chunkType, data);
  const crc = u32be(crc32(crcSeed));
  return concat(lenBytes, chunkType, data, crc);
}

function buildPngItxtChunk(xmp: Uint8Array): Uint8Array {
  const itxt = concat(
    PNG_XMP_KEYWORD,
    new Uint8Array([0, 0, 0, 0, 0]), // null + compressionFlag + compressionMethod + language + translatedKeyword nulls
    xmp,
  );
  return buildPngChunk(new TextEncoder().encode("iTXt"), itxt);
}

function removePngMetadata(data: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [data.subarray(0, 8)];
  let pos = 8;
  while (pos + 12 <= data.length) {
    const chunkLen = readU32be(data, pos);
    const chunkType = data.subarray(pos + 4, pos + 8);
    const chunkDataStart = pos + 8;
    const chunkEnd = chunkDataStart + chunkLen + 4; // +4 for CRC
    if (chunkEnd > data.length) break;

    const isXmp =
      bytesEqual(chunkType, new TextEncoder().encode("iTXt")) &&
      startsWith(data, chunkDataStart, PNG_XMP_KEYWORD);
    const isOrig = bytesEqual(chunkType, new TextEncoder().encode("svGo"));

    if (!isXmp && !isOrig) {
      out.push(data.subarray(pos, chunkEnd));
    }
    pos = chunkEnd;
  }
  return concat(...out);
}

function writePngWithMetadata(
  pngData: Uint8Array,
  xmp: Uint8Array,
  original: Uint8Array,
): Uint8Array {
  if (
    pngData.length < 8 ||
    pngData[0] !== 0x89 ||
    pngData[1] !== 0x50 ||
    pngData[2] !== 0x4e ||
    pngData[3] !== 0x47
  ) {
    throw new Error("Not a valid PNG");
  }
  const itxtChunk = buildPngItxtChunk(xmp);
  const origChunk = buildPngChunk(new TextEncoder().encode("svGo"), original);
  const cleaned = removePngMetadata(pngData);
  // IEND is the last 12 bytes (length(4) + type(4) + zero data + crc(4)).
  const insertPos = cleaned.length - 12;
  return concat(
    cleaned.subarray(0, insertPos),
    itxtChunk,
    origChunk,
    cleaned.subarray(insertPos),
  );
}

function readPngXmp(data: Uint8Array): string | null {
  if (
    data.length < 8 ||
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47
  ) {
    return null;
  }
  const iTXt = new TextEncoder().encode("iTXt");
  let pos = 8;
  while (pos + 12 <= data.length) {
    const chunkLen = readU32be(data, pos);
    const chunkType = data.subarray(pos + 4, pos + 8);
    const chunkDataStart = pos + 8;
    const chunkEnd = chunkDataStart + chunkLen + 4;
    if (chunkEnd > data.length) break;

    if (bytesEqual(chunkType, iTXt) && startsWith(data, chunkDataStart, PNG_XMP_KEYWORD)) {
      const after = data.subarray(chunkDataStart + PNG_XMP_KEYWORD.length, chunkDataStart + chunkLen);
      // Skip the four nulls (keyword-terminator + compressionFlag +
      // compressionMethod + language + translatedKeyword) — total
      // 5 nulls; the loop counts the FIRST four and starts the XMP
      // body after the fifth. Matches the Rust skip-4-nulls walk.
      let nulls = 0;
      let xmpStart = 0;
      for (let i = 0; i < after.length; i++) {
        if (after[i] === 0) nulls++;
        if (nulls >= 4) {
          xmpStart = i + 1;
          break;
        }
      }
      return new TextDecoder("utf-8").decode(after.subarray(xmpStart));
    }
    pos = chunkEnd;
  }
  return null;
}

function readPngOriginal(data: Uint8Array): Uint8Array | null {
  if (
    data.length < 8 ||
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47
  ) {
    return null;
  }
  const svGo = new TextEncoder().encode("svGo");
  let pos = 8;
  while (pos + 12 <= data.length) {
    const chunkLen = readU32be(data, pos);
    const chunkType = data.subarray(pos + 4, pos + 8);
    const chunkDataStart = pos + 8;
    const chunkEnd = chunkDataStart + chunkLen + 4;
    if (chunkEnd > data.length) break;

    if (bytesEqual(chunkType, svGo)) {
      return data.subarray(chunkDataStart, chunkDataStart + chunkLen);
    }
    pos = chunkEnd;
  }
  return null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---- CRC32 (PNG polynomial, RFC 1952) ──────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = ((CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- IPC channel inventory ──────────────────────────────────────

export const XMP_CHANNELS = {
  saveWithXmp: "save_with_xmp",
  readXmp: "read_xmp",
} as const;

export type XmpChannel = (typeof XMP_CHANNELS)[keyof typeof XMP_CHANNELS];

export const XMP_CHANNEL_TO_HANDLER: Record<XmpChannel, keyof XmpHandlers> = {
  [XMP_CHANNELS.saveWithXmp]: "saveWithXmp",
  [XMP_CHANNELS.readXmp]: "readXmp",
};
