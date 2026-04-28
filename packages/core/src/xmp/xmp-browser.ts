/**
 * Browser-side XMP metadata embedding for re-editable images.
 * Mirrors the Rust implementation in src-tauri/src/commands/xmp.rs
 *
 * JPEG: XMP in APP1 segment, original image in multiple APP2 segments
 * PNG:  XMP in iTXt chunk, original image in custom "svGo" chunk
 */

const XMP_NS = "annot";
const XMP_NS_URI = "https://ingcreators.com/annot/ns/1.0/";
const XMP_APP1_PREFIX = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0");
const ANNOT_APP2_PREFIX = new TextEncoder().encode("annot:OriginalImage\0");
const PNG_XMP_KEYWORD = new TextEncoder().encode("XML:com.adobe.xmp");

// ---- XMP XML ----

function buildXmp(
  annotationsSvg: string,
  width: number,
  height: number,
  tags?: Record<string, string>,
): string {
  const tagsJson = tags && Object.keys(tags).length > 0 ? JSON.stringify(tags) : "";
  const tagsLine = tagsJson ? `\n      <${XMP_NS}:tags>${tagsJson}</${XMP_NS}:tags>` : "";
  return `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
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

// ---- Helpers ----

function u16be(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

function readU16be(data: Uint8Array, offset: number): number {
  // Callers guarantee `offset + 1 < data.length` (bounds are checked
  // in the outer parse loops). `!` matches the contract.
  return (data[offset]! << 8) | data[offset + 1]!;
}

function readU32be(data: Uint8Array, offset: number): number {
  return (
    ((data[offset]! << 24) |
      (data[offset + 1]! << 16) |
      (data[offset + 2]! << 8) |
      data[offset + 3]!) >>>
    0
  );
}

function concat(...arrays: Uint8Array[]): Uint8Array {
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

function startsWith(data: Uint8Array, offset: number, prefix: Uint8Array): boolean {
  if (offset + prefix.length > data.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[offset + i] !== prefix[i]) return false;
  }
  return true;
}

function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] || "";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ---- JPEG writing ----

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

function writeJpegWithMetadata(
  jpegData: Uint8Array,
  xmpBytes: Uint8Array,
  originalData: Uint8Array,
): Uint8Array {
  // Build XMP APP1
  const xmpPayload = concat(XMP_APP1_PREFIX, xmpBytes);
  const xmpSeg = buildJpegSegment(0xe1, xmpPayload);

  // Build APP2 segments for original image
  const app2Segs = buildApp2Segments(originalData);

  // Clean old metadata
  const cleaned = removeJpegMetadata(jpegData);

  // SOI + XMP + APP2s + rest
  return concat(cleaned.slice(0, 2), xmpSeg, app2Segs, cleaned.slice(2));
}

// ---- PNG writing ----

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

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    // `CRC32_TABLE` has 256 entries; `(crc ^ data[i]) & 0xff` is a
    // byte index, so `CRC32_TABLE[...]` is always defined.
    // Loop bound matches `data.length`; `data[i]` is in range.
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPngChunk(chunkType: Uint8Array, data: Uint8Array): Uint8Array {
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

function removePngMetadata(data: Uint8Array): Uint8Array {
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

function writePngWithMetadata(
  pngData: Uint8Array,
  xmpBytes: Uint8Array,
  originalData: Uint8Array,
): Uint8Array {
  const itxtChunk = buildPngItxtChunk(xmpBytes);
  const origChunk = buildPngChunk(new TextEncoder().encode("svGo"), originalData);

  const cleaned = removePngMetadata(pngData);

  // Insert before IEND (last 12 bytes)
  const insertPos = cleaned.length - 12;
  return concat(cleaned.slice(0, insertPos), itxtChunk, origChunk, cleaned.slice(insertPos));
}

// ---- Public API ----

export interface EditableImageOptions {
  /** Rendered image (screenshot + annotations) as Blob */
  renderedBlob: Blob;
  /** Original capture image data URL (without annotations) */
  originalDataUrl: string;
  /** Annotations-only SVG string */
  annotationsSvg: string;
  /** Image dimensions */
  width: number;
  height: number;
  /** Output format */
  format: "jpg" | "png";
  /** Key-value tags */
  tags?: Record<string, string>;
}

/**
 * Create a re-editable image with XMP metadata embedded.
 * Returns a Blob ready for download.
 */
export async function createEditableImage(opts: EditableImageOptions): Promise<Blob> {
  const xmpXml = buildXmp(opts.annotationsSvg, opts.width, opts.height, opts.tags);
  const xmpBytes = new TextEncoder().encode(xmpXml);
  const originalBytes = dataUrlToUint8Array(opts.originalDataUrl);

  if (opts.format === "png") {
    const pngData = await blobToUint8Array(opts.renderedBlob);
    const result = writePngWithMetadata(pngData, xmpBytes, originalBytes);
    return new Blob([result as BlobPart], { type: "image/png" });
  }
  // Convert rendered PNG blob to JPEG first
  const jpegBlob = await pngBlobToJpegBlob(opts.renderedBlob, opts.width, opts.height);
  const jpegData = await blobToUint8Array(jpegBlob);
  const result = writeJpegWithMetadata(jpegData, xmpBytes, originalBytes);
  return new Blob([result as BlobPart], { type: "image/jpeg" });
}

async function pngBlobToJpegBlob(pngBlob: Blob, width: number, height: number): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(pngBlob);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });

  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  return new Promise<Blob>((resolve) => {
    c.toBlob((b) => resolve(b!), "image/jpeg", 0.92);
  });
}

// ---- Reading XMP (for re-editing in browser) ----

export interface AnnotMetadata {
  originalImageDataUrl: string;
  annotationsSvg: string;
  width: number;
  height: number;
  tags: Record<string, string>;
}

/**
 * Read XMP metadata from a re-editable image file (JPEG or PNG).
 * Pass the file as an ArrayBuffer or Uint8Array.
 */
export function readEditableImage(data: Uint8Array): AnnotMetadata | null {
  if (data[0] === 0xff && data[1] === 0xd8) {
    return readJpegMetadata(data);
  }
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return readPngMetadata(data);
  }
  return null;
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

  // Parse tags
  let tags: Record<string, string> = {};
  const tagsStr = extractTag(xmp, "tags");
  if (tagsStr) {
    try {
      tags = JSON.parse(tagsStr);
    } catch {
      /* invalid JSON, ignore */
    }
  }

  return { originalImageDataUrl, annotationsSvg, width, height, tags };
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
  // Use chunked btoa to avoid call stack size exceeded for large arrays
  const CHUNK = 0x8000;
  let result = "";
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.subarray(i, Math.min(i + CHUNK, data.length));
    result += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(result);
}
