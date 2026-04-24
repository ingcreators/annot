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
