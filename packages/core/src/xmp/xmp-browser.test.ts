// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createEditableImage, readEditableImage } from "./xmp-browser.js";

/**
 * End-to-end round-trip tests for the XMP encode/decode pipeline.
 *
 * The PNG path is the primary test surface: we can assemble a tiny
 * valid PNG from its signature + headers without any canvas rendering,
 * feed it through `createEditableImage`, then decode it back via
 * `readEditableImage` and confirm every field survives the trip.
 *
 * JPEG would additionally need an `<img>` / `<canvas>` pipeline to
 * transcode from PNG; that's harder to stub under happy-dom and is
 * less critical since storage backends write PNG by default. We do
 * include a lightweight negative test confirming the reader rejects
 * non-image bytes.
 */

/** Smallest valid 1×1 transparent PNG, 67 bytes. */
const TINY_PNG_DATA_URL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("createEditableImage + readEditableImage (PNG round-trip)", () => {
  const tinyPngBytes = dataUrlToBytes(TINY_PNG_DATA_URL);
  // Cast via `BlobPart` because TS 5.7's Uint8Array is generic on
  // its ArrayBufferLike and doesn't narrow to BlobPart by default.
  // The runtime value is unchanged — this is purely a type assertion.
  const renderedBlob = new Blob([tinyPngBytes as BlobPart], { type: "image/png" });

  const annotationsSvg = '<g><rect x="10" y="10" width="30" height="30"/></g>';
  const width = 1;
  const height = 1;

  it("produces a PNG blob with the magic signature intact", async () => {
    const blob = await createEditableImage({
      renderedBlob,
      originalDataUrl: TINY_PNG_DATA_URL,
      annotationsSvg,
      width,
      height,
      format: "png",
    });
    expect(blob.type).toBe("image/png");
    const bytes = await blobToBytes(blob);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
  });

  it("round-trips annotations, dimensions, and tags", async () => {
    const tags = { host: "example.com", path: "/a/b", session: "xyz" };
    const blob = await createEditableImage({
      renderedBlob,
      originalDataUrl: TINY_PNG_DATA_URL,
      annotationsSvg,
      width: 123,
      height: 456,
      format: "png",
      tags,
    });
    const bytes = await blobToBytes(blob);
    const meta = readEditableImage(bytes);
    expect(meta).not.toBeNull();
    expect(meta!.annotationsSvg).toBe(annotationsSvg);
    expect(meta!.width).toBe(123);
    expect(meta!.height).toBe(456);
    expect(meta!.tags).toEqual(tags);
    // Original image bytes are preserved byte-for-byte in the
    // custom chunk, then re-emitted as a data URL by the reader.
    expect(meta!.originalImageDataUrl).toMatch(/^data:image\/png;base64,/);
    const readBack = dataUrlToBytes(meta!.originalImageDataUrl);
    expect(readBack).toEqual(tinyPngBytes);
  });

  it("round-trips with an empty tag set", async () => {
    const blob = await createEditableImage({
      renderedBlob,
      originalDataUrl: TINY_PNG_DATA_URL,
      annotationsSvg,
      width,
      height,
      format: "png",
      tags: {},
    });
    const bytes = await blobToBytes(blob);
    const meta = readEditableImage(bytes);
    expect(meta).not.toBeNull();
    expect(meta!.tags).toEqual({});
  });

  it("round-trips with annotations containing XML-ish content (CDATA-safe)", async () => {
    // XMP wraps annotationsSvg in CDATA. Make sure nested tags
    // and attributes survive without corruption.
    const complex = `<g class="layer"><rect fill="#ff0000" opacity="0.5"/><text x="10">hi &amp; bye</text></g>`;
    const blob = await createEditableImage({
      renderedBlob,
      originalDataUrl: TINY_PNG_DATA_URL,
      annotationsSvg: complex,
      width,
      height,
      format: "png",
    });
    const bytes = await blobToBytes(blob);
    const meta = readEditableImage(bytes);
    expect(meta!.annotationsSvg).toBe(complex);
  });
});

describe("readEditableImage — negative / boundary cases", () => {
  it("returns null for random non-image bytes", () => {
    const junk = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(readEditableImage(junk)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(readEditableImage(new Uint8Array(0))).toBeNull();
  });

  it("returns null for a PNG that lacks our custom XMP/original chunks", () => {
    // A plain PNG with no Annot metadata should cleanly return null
    // rather than throwing.
    const plainPng = dataUrlToBytes(
      "data:image/png;base64," +
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    );
    expect(readEditableImage(plainPng)).toBeNull();
  });
});

// ─── JPEG read path ────────────────────────────────────────────────
//
// `pngBlobToJpegBlob` is canvas-bound (Image + canvas.toBlob —
// neither implemented under happy-dom), so we can't exercise the
// JPEG WRITE path through `createEditableImage`. The READ path
// (`readEditableImage` → `readJpegMetadata` → `readJpegXmp` /
// `readJpegOriginal` / `parseXmpToMetadata`) IS pure byte
// manipulation though, so these tests hand-construct minimal
// JPEG byte streams with embedded XMP APP1 + APP2 segments and
// drive `readEditableImage` against them.

const XMP_APP1_PREFIX_BYTES = new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0");
const ANNOT_APP2_PREFIX_BYTES = new TextEncoder().encode("annot:OriginalImage\0");

function u16beBytes(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function buildJpegSegmentBytes(marker: number, payload: Uint8Array): Uint8Array {
  const segLen = payload.length + 2; // +2 for the length field itself
  const header = new Uint8Array([0xff, marker, ...u16beBytes(segLen)]);
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

function buildAnnotApp2Segments(originalBytes: Uint8Array, chunkSize: number): Uint8Array[] {
  // Mirrors the production `buildApp2Segments` chunking logic. Tests
  // pass small chunkSize values so the multi-segment reassembly path
  // gets coverage too.
  const segments: Uint8Array[] = [];
  const total = Math.ceil(originalBytes.length / chunkSize);
  for (let i = 0; i < total; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, originalBytes.length);
    const data = originalBytes.slice(start, end);
    const payload = new Uint8Array(ANNOT_APP2_PREFIX_BYTES.length + 4 + data.length);
    payload.set(ANNOT_APP2_PREFIX_BYTES, 0);
    payload.set(u16beBytes(i), ANNOT_APP2_PREFIX_BYTES.length);
    payload.set(u16beBytes(total), ANNOT_APP2_PREFIX_BYTES.length + 2);
    payload.set(data, ANNOT_APP2_PREFIX_BYTES.length + 4);
    segments.push(buildJpegSegmentBytes(0xe2, payload));
  }
  return segments;
}

interface JpegBuilderOpts {
  xmpXml: string;
  originalBytes: Uint8Array;
  /** Size per APP2 chunk (excluding prefix + seq header). Small values
   *  exercise the reassembly path. Defaults to 65000 (one segment). */
  app2ChunkSize?: number;
  /** Insert XMP APP1 before APP2 chunks (default true). Set false to
   *  test "JPEG with original bytes but no XMP → readEditableImage
   *  bails because XMP is the dispatch trigger". */
  withXmp?: boolean;
}

function buildJpeg(opts: JpegBuilderOpts): Uint8Array {
  const parts: Uint8Array[] = [];
  // SOI
  parts.push(new Uint8Array([0xff, 0xd8]));
  // XMP APP1
  if (opts.withXmp !== false) {
    const xmpBytes = new TextEncoder().encode(opts.xmpXml);
    const payload = new Uint8Array(XMP_APP1_PREFIX_BYTES.length + xmpBytes.length);
    payload.set(XMP_APP1_PREFIX_BYTES, 0);
    payload.set(xmpBytes, XMP_APP1_PREFIX_BYTES.length);
    parts.push(buildJpegSegmentBytes(0xe1, payload));
  }
  // APP2 chunks for the original image bytes
  for (const seg of buildAnnotApp2Segments(opts.originalBytes, opts.app2ChunkSize ?? 65000)) {
    parts.push(seg);
  }
  // EOI marker (0xFFD9) — the parsing loops in readJpegXmp /
  // readJpegOriginal break on EOI / SOS so we just append it directly.
  parts.push(new Uint8Array([0xff, 0xd9]));
  // Concat all parts.
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function buildXmpString(opts: {
  annotationsSvg: string;
  width: number;
  height: number;
  tags?: Record<string, string>;
}): string {
  const tagsLine =
    opts.tags && Object.keys(opts.tags).length > 0
      ? `\n      <annot:tags>${JSON.stringify(opts.tags)}</annot:tags>`
      : "";
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:annot="https://ingcreators.com/annot/ns/1.0/">
      <annot:annotations><![CDATA[${opts.annotationsSvg}]]></annot:annotations>
      <annot:width>${opts.width}</annot:width>
      <annot:height>${opts.height}</annot:height>
      <annot:version>1.0</annot:version>${tagsLine}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

describe("readEditableImage (JPEG path)", () => {
  it("parses a JPEG with XMP + APP2 original image into a complete AnnotMetadata", () => {
    const annotationsSvg = '<g><rect width="50" height="50"/></g>';
    const width = 200;
    const height = 100;
    const tags = { project: "demo", note: "hi" };
    // Original image bytes — embed a tiny PNG inside the JPEG as the
    // "original image", which is the documented Annot pattern (PNG
    // capture re-encoded to JPEG; the unmodified PNG rides along in
    // APP2).
    const tinyPng = dataUrlToBytes(TINY_PNG_DATA_URL);
    const jpeg = buildJpeg({
      xmpXml: buildXmpString({ annotationsSvg, width, height, tags }),
      originalBytes: tinyPng,
    });
    const meta = readEditableImage(jpeg);
    expect(meta).not.toBeNull();
    expect(meta!.annotationsSvg).toBe(annotationsSvg);
    expect(meta!.width).toBe(width);
    expect(meta!.height).toBe(height);
    expect(meta!.tags).toEqual(tags);
    // Original image data URL should reflect PNG magic-byte detection.
    expect(meta!.originalImageDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("reassembles a multi-segment APP2 original image (chunkSize forces 3+ segments)", () => {
    const tinyPng = dataUrlToBytes(TINY_PNG_DATA_URL);
    const jpeg = buildJpeg({
      xmpXml: buildXmpString({
        annotationsSvg: "<g><rect/></g>",
        width: 1,
        height: 1,
      }),
      originalBytes: tinyPng,
      app2ChunkSize: 20, // force ~4 chunks for a 67-byte PNG
    });
    const meta = readEditableImage(jpeg);
    expect(meta).not.toBeNull();
    // Reassembly preserves the original byte sequence.
    const readBack = dataUrlToBytes(meta!.originalImageDataUrl);
    expect(readBack).toEqual(tinyPng);
  });

  it("returns the originalImageDataUrl as a JPEG MIME when the embedded original starts with the JPEG SOI", () => {
    // Some Annot files have a JPEG-original embedded in a JPEG
    // container (re-encode pass). The mime detection looks at the
    // first two bytes — anything that doesn't match PNG's 0x89/0x50
    // signature falls through to image/jpeg.
    const fakeJpegOriginal = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const jpeg = buildJpeg({
      xmpXml: buildXmpString({
        annotationsSvg: "<g><rect/></g>",
        width: 1,
        height: 1,
      }),
      originalBytes: fakeJpegOriginal,
    });
    const meta = readEditableImage(jpeg);
    expect(meta!.originalImageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("empty tags JSON in XMP rounds back to {}", () => {
    const jpeg = buildJpeg({
      xmpXml: buildXmpString({
        annotationsSvg: "<g/>",
        width: 1,
        height: 1,
        // No tags entry in the XMP at all.
      }),
      originalBytes: dataUrlToBytes(TINY_PNG_DATA_URL),
    });
    expect(readEditableImage(jpeg)!.tags).toEqual({});
  });

  it("invalid tags JSON in XMP gracefully falls back to {} (silently swallowed)", () => {
    const malformedXmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:annot="https://ingcreators.com/annot/ns/1.0/">
      <annot:annotations><![CDATA[<g/>]]></annot:annotations>
      <annot:width>1</annot:width>
      <annot:height>1</annot:height>
      <annot:tags>{not-json</annot:tags>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    const jpeg = buildJpeg({
      xmpXml: malformedXmp,
      originalBytes: dataUrlToBytes(TINY_PNG_DATA_URL),
    });
    expect(readEditableImage(jpeg)!.tags).toEqual({});
  });

  it("returns null when JPEG has no Annot XMP segment (ordinary JPEG file)", () => {
    const jpeg = buildJpeg({
      xmpXml: "",
      originalBytes: dataUrlToBytes(TINY_PNG_DATA_URL),
      withXmp: false, // skip the APP1 segment
    });
    expect(readEditableImage(jpeg)).toBeNull();
  });

  it("returns null when XMP is present but the <annot:annotations> tag is missing (treats it as not-an-Annot file)", () => {
    const xmpWithoutAnnotations = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:annot="https://ingcreators.com/annot/ns/1.0/">
      <annot:width>1</annot:width>
      <annot:height>1</annot:height>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    const jpeg = buildJpeg({
      xmpXml: xmpWithoutAnnotations,
      originalBytes: dataUrlToBytes(TINY_PNG_DATA_URL),
    });
    expect(readEditableImage(jpeg)).toBeNull();
  });

  it("width / height default to 0 when the corresponding XMP tags are missing", () => {
    const xmpMissingDims = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:annot="https://ingcreators.com/annot/ns/1.0/">
      <annot:annotations><![CDATA[<g/>]]></annot:annotations>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    const jpeg = buildJpeg({
      xmpXml: xmpMissingDims,
      originalBytes: dataUrlToBytes(TINY_PNG_DATA_URL),
    });
    const meta = readEditableImage(jpeg)!;
    expect(meta.width).toBe(0);
    expect(meta.height).toBe(0);
  });

  it("originalImageDataUrl is empty string when the JPEG has XMP but no APP2 original image", () => {
    // No APP2 chunks — synthesize a JPEG with just SOI + APP1 XMP + EOI.
    const xmpBytes = new TextEncoder().encode(
      buildXmpString({ annotationsSvg: "<g/>", width: 1, height: 1 }),
    );
    const xmpPayload = new Uint8Array(XMP_APP1_PREFIX_BYTES.length + xmpBytes.length);
    xmpPayload.set(XMP_APP1_PREFIX_BYTES, 0);
    xmpPayload.set(xmpBytes, XMP_APP1_PREFIX_BYTES.length);
    const xmpSeg = buildJpegSegmentBytes(0xe1, xmpPayload);
    const jpeg = new Uint8Array(2 + xmpSeg.length + 2);
    jpeg.set([0xff, 0xd8], 0); // SOI
    jpeg.set(xmpSeg, 2);
    jpeg.set([0xff, 0xd9], 2 + xmpSeg.length); // EOI
    const meta = readEditableImage(jpeg)!;
    expect(meta.originalImageDataUrl).toBe("");
  });

  it("APP2 chunks arriving out-of-order are sorted by sequence before reassembly", () => {
    // Hand-build a JPEG whose APP2 segments are in REVERSE sequence
    // order. The reader sorts by `seq` so the final bytes match the
    // original.
    const tinyPng = dataUrlToBytes(TINY_PNG_DATA_URL);
    const segments = buildAnnotApp2Segments(tinyPng, 20);
    // Reverse the order so seq=N..0.
    const reversed = [...segments].reverse();
    const xmpBytes = new TextEncoder().encode(
      buildXmpString({
        annotationsSvg: "<g><rect/></g>",
        width: 1,
        height: 1,
      }),
    );
    const xmpPayload = new Uint8Array(XMP_APP1_PREFIX_BYTES.length + xmpBytes.length);
    xmpPayload.set(XMP_APP1_PREFIX_BYTES, 0);
    xmpPayload.set(xmpBytes, XMP_APP1_PREFIX_BYTES.length);
    const xmpSeg = buildJpegSegmentBytes(0xe1, xmpPayload);
    const totalLen = 2 + xmpSeg.length + reversed.reduce((s, p) => s + p.length, 0) + 2;
    const jpeg = new Uint8Array(totalLen);
    jpeg.set([0xff, 0xd8], 0);
    let off = 2;
    jpeg.set(xmpSeg, off);
    off += xmpSeg.length;
    for (const seg of reversed) {
      jpeg.set(seg, off);
      off += seg.length;
    }
    jpeg.set([0xff, 0xd9], off);
    const meta = readEditableImage(jpeg)!;
    const readBack = dataUrlToBytes(meta.originalImageDataUrl);
    expect(readBack).toEqual(tinyPng);
  });
});
