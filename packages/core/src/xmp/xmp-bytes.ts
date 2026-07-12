/**
 * Tier-A XMP metadata embedding for re-editable images — pure-bytes
 * primitives that run in Node and the browser alike.
 *
 * This file holds the byte-level XMP build / read / write logic that
 * used to live inside `xmp-browser.ts`. The browser-side
 * `createEditableImage` (Blob in → Blob out) is now a thin wrapper
 * around `createEditablePngBytes` for the PNG path.
 *
 * JPEG WRITE remains browser-only because the rendered PNG → JPEG
 * conversion needs an Image + <canvas> pipeline. The JPEG READ path
 * is pure bytes and lives here.
 *
 * PNG: XMP in iTXt chunk, original image in a custom "svGo" chunk.
 * JPEG: XMP in APP1 segment, original image in one or more APP2
 *       segments (each prefixed with `annot:OriginalImage\0`).
 */

const XMP_NS = "annot";
const XMP_NS_URI = "https://ingcreators.com/annot/ns/1.0/";
const XMP_APP1_PREFIX = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0");
const ANNOT_APP2_PREFIX = new TextEncoder().encode("annot:OriginalImage\0");
const PNG_XMP_KEYWORD = new TextEncoder().encode("XML:com.adobe.xmp");

/** Schema version written into `<annot:version>`. History lives in
 *  `docs/metadata-format.md`. 2.0 added the first-class provenance
 *  fields (`sourceUrl` / `createdAt` / `producer` / `dpr`) per
 *  `docs/plans/metadata-unification.md`. */
export const ANNOT_XMP_VERSION = "2.0";

// ─── XMP XML ────────────────────────────────────────────────────────

/** Escape a free-text value for embedding as XML element text.
 *  The annotations SVG stays CDATA-wrapped; every other text field
 *  (tags JSON, provenance strings) goes through this. */
function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXmlText(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * Capture provenance persisted in the XMP packet since schema 2.0.
 * All optional — omitted fields emit no element, and readers
 * default them to `""` / `0`. See `docs/metadata-format.md`.
 */
export interface XmpProvenance {
  /** URL of the page the capture came from. Empty / omitted for
   *  non-page sources (desktop screen capture, paste, upload). */
  sourceUrl?: string;
  /** ISO timestamp of the capture / import moment. NOT the file
   *  mtime — copies and syncs must not rewrite it. */
  createdAt?: string;
  /** What created the file: `extension` / `desktop` / `web` /
   *  `vscode` / `annotator` / `mcp` / `playwright` / … */
  producer?: string;
  /** `window.devicePixelRatio` (or display scale factor) at capture
   *  time. Maps device-pixel image dimensions back to CSS px for
   *  sources that never produce an ElementTree. */
  dpr?: number;
}

export interface BuildXmpOptions extends XmpProvenance {
  annotationsSvg: string;
  width: number;
  height: number;
  tags?: Record<string, string>;
}

export function buildXmp(opts: BuildXmpOptions): string {
  const lines: string[] = [];
  const push = (tag: string, value: string) =>
    lines.push(`\n      <${XMP_NS}:${tag}>${value}</${XMP_NS}:${tag}>`);
  const tagsJson = opts.tags && Object.keys(opts.tags).length > 0 ? JSON.stringify(opts.tags) : "";
  if (tagsJson) push("tags", escapeXmlText(tagsJson));
  if (opts.sourceUrl) push("sourceUrl", escapeXmlText(opts.sourceUrl));
  if (opts.createdAt) push("createdAt", escapeXmlText(opts.createdAt));
  if (opts.producer) push("producer", escapeXmlText(opts.producer));
  if (opts.dpr && opts.dpr > 0) push("dpr", String(opts.dpr));
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:${XMP_NS}="${XMP_NS_URI}">
      <${XMP_NS}:annotations><![CDATA[${opts.annotationsSvg}]]></${XMP_NS}:annotations>
      <${XMP_NS}:width>${opts.width}</${XMP_NS}:width>
      <${XMP_NS}:height>${opts.height}</${XMP_NS}:height>
      <${XMP_NS}:version>${ANNOT_XMP_VERSION}</${XMP_NS}:version>${lines.join("")}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// ─── Byte helpers ───────────────────────────────────────────────────

// Re-exported as the building blocks for `element-tree-payload.ts`
// (Phase 1d of `docs/plans/living-spec-authoring-roadmap.md`). The
// internal helpers below were lifted to `export` purely so a sibling
// module can reuse them without copy-paste; the function bodies are
// unchanged.

function u16be(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

export function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

function readU16be(data: Uint8Array, offset: number): number {
  // Callers guarantee `offset + 1 < data.length` (bounds are checked
  // in the outer parse loops). `!` matches the contract.
  return (data[offset]! << 8) | data[offset + 1]!;
}

export function readU32be(data: Uint8Array, offset: number): number {
  return (
    ((data[offset]! << 24) |
      (data[offset + 1]! << 16) |
      (data[offset + 2]! << 8) |
      data[offset + 3]!) >>>
    0
  );
}

export function concat(...arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

export function startsWith(data: Uint8Array, offset: number, prefix: Uint8Array): boolean {
  if (offset + prefix.length > data.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[offset + i] !== prefix[i]) return false;
  }
  return true;
}

export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] || "";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ─── JPEG writing ───────────────────────────────────────────────────

function buildJpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const segLen = payload.length + 2;
  return concat(new Uint8Array([0xff, marker]), u16be(segLen), payload);
}

function buildApp2Segments(data: Uint8Array): Uint8Array {
  const prefixLen = ANNOT_APP2_PREFIX.length;
  const maxChunk = 65533 - prefixLen - 4;
  const totalChunks = Math.ceil(data.length / maxChunk);
  const parts: Uint8Array[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * maxChunk;
    const end = Math.min(start + maxChunk, data.length);
    const chunk = data.slice(start, end);

    const payload = concat(ANNOT_APP2_PREFIX, u16be(i), u16be(totalChunks), chunk);
    parts.push(buildJpegSegment(0xe2, payload));
  }

  return concat(...parts);
}

function removeJpegMetadata(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [data.slice(0, 2)]; // SOI
  let pos = 2;
  while (pos + 4 <= data.length) {
    if (data[pos] !== 0xff) break;
    const marker = data[pos + 1];
    if (marker === 0xd9 || marker === 0xda) {
      parts.push(data.slice(pos));
      return concat(...parts);
    }
    const segLen = readU16be(data, pos + 2);
    const segEnd = pos + 2 + segLen;
    if (segEnd > data.length) break;

    const isXmp = marker === 0xe1 && startsWith(data, pos + 4, XMP_APP1_PREFIX);
    const isAnnotApp2 = marker === 0xe2 && startsWith(data, pos + 4, ANNOT_APP2_PREFIX);

    if (!isXmp && !isAnnotApp2) {
      parts.push(data.slice(pos, segEnd));
    }
    pos = segEnd;
  }
  if (pos < data.length) parts.push(data.slice(pos));
  return concat(...parts);
}

export function writeJpegWithMetadata(
  jpegData: Uint8Array,
  xmpBytes: Uint8Array,
  originalData: Uint8Array,
): Uint8Array {
  const xmpPayload = concat(XMP_APP1_PREFIX, xmpBytes);
  const xmpSeg = buildJpegSegment(0xe1, xmpPayload);
  const app2Segs = buildApp2Segments(originalData);
  const cleaned = removeJpegMetadata(jpegData);
  // SOI + XMP + APP2s + rest
  return concat(cleaned.slice(0, 2), xmpSeg, app2Segs, cleaned.slice(2));
}

// ─── PNG writing ────────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    // `CRC32_TABLE` has 256 entries; `(crc ^ data[i]) & 0xff` is a
    // byte index, so `CRC32_TABLE[...]` is always defined.
    // Loop bound matches `data.length`; `data[i]` is in range.
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildPngChunk(chunkType: Uint8Array, data: Uint8Array): Uint8Array {
  const typeAndData = concat(chunkType, data);
  const crc = crc32(typeAndData);
  return concat(u32be(data.length), typeAndData, u32be(crc));
}

function buildPngItxtChunk(xmpBytes: Uint8Array): Uint8Array {
  const itxtData = concat(
    PNG_XMP_KEYWORD,
    new Uint8Array([0, 0, 0, 0, 0]), // null, compression flag, method, lang, translated kw
    xmpBytes,
  );
  return buildPngChunk(new TextEncoder().encode("iTXt"), itxtData);
}

/**
 * Strip the Annot editor's editable-layer metadata from a PNG.
 * Walks the chunk stream, drops the Adobe XMP iTXt chunk (the
 * `<annot:annotations>` / `<annot:tags>` carrier) AND the custom
 * `svGo` chunk (the original un-annotated bitmap), keeps every
 * other chunk verbatim (including all critical chunks IHDR /
 * IDAT / IEND so the result stays a valid PNG with the same
 * visible pixels).
 *
 * Returns the input bytes unchanged when no editable-layer
 * chunks are present.
 *
 * Used internally by `writePngWithMetadata` / `writePngWithTagsOnly`
 * to clear stale metadata before re-injecting new chunks. Exposed
 * since Phase 3j of `docs/plans/living-spec-authoring-roadmap.md`
 * (Phase 3 follow-up #2) so `@ingcreators/annot-annotator` can
 * publish a top-level `flattenEditablePng` primitive against the
 * same logic without duplicating chunk-walking code.
 *
 * No re-rasterization — the visible bytes were already the
 * annotated bitmap; this is metadata removal only.
 */
export function stripPngEditableLayer(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [data.slice(0, 8)]; // PNG signature
  let pos = 8;
  while (pos + 12 <= data.length) {
    const chunkLen = readU32be(data, pos);
    const chunkType = data.slice(pos + 4, pos + 8);
    const chunkDataStart = pos + 8;
    const chunkEnd = chunkDataStart + chunkLen + 4; // +4 for CRC
    if (chunkEnd > data.length) break;

    const typeStr = String.fromCharCode(...chunkType);
    const isXmp = typeStr === "iTXt" && startsWith(data, chunkDataStart, PNG_XMP_KEYWORD);
    const isOrig = typeStr === "svGo";

    if (!isXmp && !isOrig) {
      parts.push(data.slice(pos, chunkEnd));
    }
    pos = chunkEnd;
  }
  return concat(...parts);
}

export function writePngWithMetadata(
  pngData: Uint8Array,
  xmpBytes: Uint8Array,
  originalData: Uint8Array,
): Uint8Array {
  const itxtChunk = buildPngItxtChunk(xmpBytes);
  const origChunk = buildPngChunk(new TextEncoder().encode("svGo"), originalData);

  const cleaned = stripPngEditableLayer(pngData);

  // Insert before IEND (last 12 bytes)
  const insertPos = cleaned.length - 12;
  return concat(cleaned.slice(0, insertPos), itxtChunk, origChunk, cleaned.slice(insertPos));
}

/**
 * Build a tags-only XMP packet — `<annot:tags>` element present,
 * `<annot:annotations>` / `<annot:width>` / `<annot:height>` absent.
 *
 * Used for the "PNG with provenance metadata sidecar" path: image viewers
 * see a normal PNG, the Annot editor reads no `<annot:annotations>` and
 * treats it as an ordinary file, but XMP-aware tools (or this library's
 * own reader) can extract the `tags` for downstream consumption.
 */
export function buildXmpTagsOnly(tags: Record<string, string>): string {
  const tagsJson = escapeXmlText(JSON.stringify(tags));
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:${XMP_NS}="${XMP_NS_URI}">
      <${XMP_NS}:tags>${tagsJson}</${XMP_NS}:tags>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Write `tags` into a PNG's XMP iTXt chunk without embedding an original
 * capture or annotations layer. The resulting bytes are still a valid PNG
 * (image viewers display the rasterised pixels) and the Annot editor
 * treats it as a normal PNG (no `<annot:annotations>` → not editable
 * round-trip).
 *
 * Use this for "I want my CI failure screenshot to carry test-id /
 * commit metadata" style provenance sidecars.
 *
 * Returns the input bytes unchanged if `tags` is empty.
 */
export function writePngWithTagsOnly(
  pngData: Uint8Array,
  tags: Record<string, string>,
): Uint8Array {
  if (!tags || Object.keys(tags).length === 0) return pngData;
  const xmpBytes = new TextEncoder().encode(buildXmpTagsOnly(tags));
  const itxtChunk = buildPngItxtChunk(xmpBytes);
  const cleaned = stripPngEditableLayer(pngData);

  // Insert before IEND (last 12 bytes)
  const insertPos = cleaned.length - 12;
  return concat(cleaned.slice(0, insertPos), itxtChunk, cleaned.slice(insertPos));
}

// ─── Public API (Tier-A bytes) ──────────────────────────────────────

/**
 * Common tag keys written by built-in Annot producers. **Not validated**
 * at write time — `createEditablePngBytes` accepts any string/string
 * pair. Documented as a soft convention so that downstream readers can
 * key off the same names when present.
 *
 * - `source`     — what produced the PNG (e.g. `"docs-tour"`,
 *                  `"playwright-fixture"`, `"annot-mcp"`).
 * - `screen`     — for living-product-docs, the `<Screen id>` value.
 * - `capturedAt` — ISO timestamp.
 * - `commit`     — git SHA when applicable.
 */
export const WELL_KNOWN_TAG_KEYS = ["source", "screen", "capturedAt", "commit"] as const;

export interface CreateEditablePngBytesOptions extends XmpProvenance {
  /** Rasterised PNG bytes — the visible image, with annotations already
   *  baked into the pixels. */
  renderedPng: Uint8Array;
  /** Original un-annotated capture. Pass either the raw PNG/JPEG bytes
   *  or a `data:` URL string. */
  originalImage: Uint8Array | string;
  /** Annotations-only SVG fragment (no `<svg>` wrapper required — this
   *  is what the editor's `readEditableImage` will reconstruct from). */
  annotationsSvg: string;
  /** Image width in pixels. Written into the XMP `<annot:width>` field. */
  width: number;
  /** Image height in pixels. Written into the XMP `<annot:height>` field. */
  height: number;
  /** Optional opaque kv tags. See {@link WELL_KNOWN_TAG_KEYS} for the
   *  soft convention. */
  tags?: Record<string, string>;
}

/**
 * Write a re-editable PNG: takes a rasterised PNG (visible image) and
 * embeds the original capture + annotations SVG in the XMP / custom
 * chunks. The Annot editor reads the metadata back via
 * {@link readEditablePngBytes} / {@link readEditableImage} and
 * reconstructs an editable document.
 *
 * The returned bytes are still a valid PNG — image viewers that don't
 * know about the custom chunks display the rasterised pixels verbatim.
 */
export function createEditablePngBytes(opts: CreateEditablePngBytesOptions): Uint8Array {
  const xmpXml = buildXmp(opts);
  const xmpBytes = new TextEncoder().encode(xmpXml);
  const originalBytes =
    typeof opts.originalImage === "string"
      ? dataUrlToUint8Array(opts.originalImage)
      : opts.originalImage;
  return writePngWithMetadata(opts.renderedPng, xmpBytes, originalBytes);
}

/** Parsed XMP metadata extracted from a re-editable image. */
export interface AnnotMetadata {
  /** Original un-annotated capture re-emitted as a `data:` URL. Empty
   *  string when no original was embedded. MIME is inferred from the
   *  embedded bytes' magic header (PNG vs JPEG). */
  originalImageDataUrl: string;
  /** Annotations-only SVG fragment recovered from the XMP. */
  annotationsSvg: string;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Opaque kv tags. Empty object when the XMP carried no `<annot:tags>`
   *  element or the embedded JSON was malformed. */
  tags: Record<string, string>;
  /** Schema version the packet was written with (`<annot:version>`).
   *  Empty string for packets that predate version emission. */
  version: string;
  /** Capture provenance (schema 2.0). Empty string / 0 when the
   *  packet doesn't carry the field. */
  sourceUrl: string;
  createdAt: string;
  producer: string;
  dpr: number;
}

/**
 * Read XMP metadata from a re-editable PNG.
 *
 * Returns `null` when the bytes aren't a PNG, when the PNG carries no
 * Annot iTXt chunk, or when the XMP is missing the required
 * `<annot:annotations>` field. For format-agnostic reading (PNG OR
 * JPEG), use {@link readEditableImage}.
 */
export function readEditablePngBytes(data: Uint8Array): AnnotMetadata | null {
  if (!isPng(data)) return null;
  return readPngMetadata(data);
}

/**
 * Read XMP metadata from a re-editable image — PNG or JPEG. Returns
 * `null` for any other format, for files without the Annot custom
 * metadata, and for files whose XMP is missing the required
 * `<annot:annotations>` field.
 */
export function readEditableImage(data: Uint8Array): AnnotMetadata | null {
  if (isJpeg(data)) return readJpegMetadata(data);
  if (isPng(data)) return readPngMetadata(data);
  return null;
}

function isJpeg(data: Uint8Array): boolean {
  return data[0] === 0xff && data[1] === 0xd8;
}

function isPng(data: Uint8Array): boolean {
  return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
}

function readJpegMetadata(data: Uint8Array): AnnotMetadata | null {
  const xmpStr = readJpegXmp(data);
  const originalBytes = readJpegOriginal(data);
  if (!xmpStr) return null;
  return parseXmpToMetadata(xmpStr, originalBytes);
}

function readPngMetadata(data: Uint8Array): AnnotMetadata | null {
  const xmpStr = readPngXmp(data);
  const originalBytes = readPngOriginal(data);
  if (!xmpStr) return null;
  return parseXmpToMetadata(xmpStr, originalBytes);
}

function parseXmpToMetadata(xmp: string, originalBytes: Uint8Array | null): AnnotMetadata | null {
  const svg = extractTag(xmp, "annotations");
  if (!svg) return null;
  const annotationsSvg = svg.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
  const width = Number.parseInt(extractTag(xmp, "width") || "0", 10);
  const height = Number.parseInt(extractTag(xmp, "height") || "0", 10);

  let originalImageDataUrl = "";
  if (originalBytes && originalBytes.length > 0) {
    // Detect MIME from magic bytes
    const mime =
      originalBytes[0] === 0x89 && originalBytes[1] === 0x50 ? "image/png" : "image/jpeg";
    const b64 = uint8ArrayToBase64(originalBytes);
    originalImageDataUrl = `data:${mime};base64,${b64}`;
  }

  let tags: Record<string, string> = {};
  const tagsStr = extractTag(xmp, "tags");
  if (tagsStr) {
    try {
      tags = JSON.parse(unescapeXmlText(tagsStr));
    } catch {
      /* invalid JSON, ignore */
    }
  }

  const version = extractTag(xmp, "version") || "";
  const sourceUrl = unescapeXmlText(extractTag(xmp, "sourceUrl") || "");
  const createdAt = unescapeXmlText(extractTag(xmp, "createdAt") || "");
  const producer = unescapeXmlText(extractTag(xmp, "producer") || "");
  const dpr = Number.parseFloat(extractTag(xmp, "dpr") || "0") || 0;

  return {
    originalImageDataUrl,
    annotationsSvg,
    width,
    height,
    tags,
    version,
    sourceUrl,
    createdAt,
    producer,
    dpr,
  };
}

function extractTag(xml: string, tag: string): string | null {
  const open = `<${XMP_NS}:${tag}>`;
  const close = `</${XMP_NS}:${tag}>`;
  const start = xml.indexOf(open);
  if (start < 0) return null;
  const end = xml.indexOf(close, start);
  if (end < 0) return null;
  return xml.substring(start + open.length, end);
}

function readJpegXmp(data: Uint8Array): string | null {
  let pos = 2;
  while (pos + 4 <= data.length) {
    if (data[pos] !== 0xff) break;
    const marker = data[pos + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const segLen = readU16be(data, pos + 2);
    const segEnd = pos + 2 + segLen;
    if (segEnd > data.length) break;

    if (marker === 0xe1 && startsWith(data, pos + 4, XMP_APP1_PREFIX)) {
      const xmpStart = pos + 4 + XMP_APP1_PREFIX.length;
      return new TextDecoder().decode(data.slice(xmpStart, segEnd));
    }
    pos = segEnd;
  }
  return null;
}

function readJpegOriginal(data: Uint8Array): Uint8Array | null {
  const prefixLen = ANNOT_APP2_PREFIX.length;
  const chunks: { seq: number; data: Uint8Array }[] = [];

  let pos = 2;
  while (pos + 4 <= data.length) {
    if (data[pos] !== 0xff) break;
    const marker = data[pos + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const segLen = readU16be(data, pos + 2);
    const segEnd = pos + 2 + segLen;
    if (segEnd > data.length) break;

    if (marker === 0xe2 && startsWith(data, pos + 4, ANNOT_APP2_PREFIX)) {
      const headerEnd = pos + 4 + prefixLen;
      if (headerEnd + 4 <= segEnd) {
        const seq = readU16be(data, headerEnd);
        const chunkData = data.slice(headerEnd + 4, segEnd);
        chunks.push({ seq, data: chunkData });
      }
    }
    pos = segEnd;
  }

  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.seq - b.seq);
  return concat(...chunks.map((c) => c.data));
}

function readPngXmp(data: Uint8Array): string | null {
  let pos = 8;
  while (pos + 12 <= data.length) {
    const chunkLen = readU32be(data, pos);
    // Loop guard `pos + 12 <= data.length` means `pos + 4..7` are
    // always in bounds for the 4-byte chunk-type read.
    const chunkType = String.fromCharCode(
      data[pos + 4]!,
      data[pos + 5]!,
      data[pos + 6]!,
      data[pos + 7]!,
    );
    const chunkDataStart = pos + 8;
    const chunkEnd = chunkDataStart + chunkLen + 4;
    if (chunkEnd > data.length) break;

    if (chunkType === "iTXt" && startsWith(data, chunkDataStart, PNG_XMP_KEYWORD)) {
      const afterKw = chunkDataStart + PNG_XMP_KEYWORD.length;
      // Skip 4 null bytes (null, compression flag, method, lang separator, translated kw separator)
      let nulls = 0;
      let xmpStart = afterKw;
      for (let i = afterKw; i < chunkDataStart + chunkLen; i++) {
        if (data[i] === 0) nulls++;
        if (nulls >= 4) {
          xmpStart = i + 1;
          break;
        }
      }
      return new TextDecoder().decode(data.slice(xmpStart, chunkDataStart + chunkLen));
    }
    pos = chunkEnd;
  }
  return null;
}

function readPngOriginal(data: Uint8Array): Uint8Array | null {
  let pos = 8;
  while (pos + 12 <= data.length) {
    const chunkLen = readU32be(data, pos);
    // Same bounds-guard pattern as `readPngXmp` above.
    const chunkType = String.fromCharCode(
      data[pos + 4]!,
      data[pos + 5]!,
      data[pos + 6]!,
      data[pos + 7]!,
    );
    const chunkDataStart = pos + 8;
    const chunkEnd = chunkDataStart + chunkLen + 4;
    if (chunkEnd > data.length) break;

    if (chunkType === "svGo") {
      return data.slice(chunkDataStart, chunkDataStart + chunkLen);
    }
    pos = chunkEnd;
  }
  return null;
}

function uint8ArrayToBase64(data: Uint8Array): string {
  // Use chunked btoa to avoid call stack size exceeded for large arrays.
  // btoa is available in Node 16+ and all browsers.
  const CHUNK = 0x8000;
  let result = "";
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.subarray(i, Math.min(i + CHUNK, data.length));
    result += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(result);
}
