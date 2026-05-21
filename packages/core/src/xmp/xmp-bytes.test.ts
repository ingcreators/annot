import { describe, expect, it } from "vitest";
import {
  type AnnotMetadata,
  createEditablePngBytes,
  readEditableImage,
  readEditablePngBytes,
  WELL_KNOWN_TAG_KEYS,
  writePngWithTagsOnly,
} from "./xmp-bytes.js";

/**
 * Tier-A (pure-bytes) round-trip tests for the XMP encode/decode
 * pipeline. These run under the default Node test environment — no
 * `happy-dom`, no `Blob`, no `canvas`. That's the contract for
 * `xmp-bytes.ts`: it must work for the headless annotator running in
 * a plain Node process.
 *
 * The Blob-input / canvas-JPEG output paths still live in
 * `xmp-browser.test.ts` (which keeps the `@vitest-environment
 * happy-dom` directive).
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

const tinyPng = dataUrlToBytes(TINY_PNG_DATA_URL);

describe("createEditablePngBytes + readEditablePngBytes (PNG round-trip)", () => {
  const annotationsSvg = '<g><rect x="10" y="10" width="30" height="30"/></g>';

  it("emits bytes whose PNG signature is intact", () => {
    const out = createEditablePngBytes({
      renderedPng: tinyPng,
      originalImage: tinyPng,
      annotationsSvg,
      width: 1,
      height: 1,
    });
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(out[0]).toBe(0x89);
    expect(out[1]).toBe(0x50);
    expect(out[2]).toBe(0x4e);
    expect(out[3]).toBe(0x47);
  });

  it("round-trips annotations, dimensions, and tags via Uint8Array original", () => {
    const tags = { host: "example.com", path: "/a/b", session: "xyz" };
    const out = createEditablePngBytes({
      renderedPng: tinyPng,
      originalImage: tinyPng,
      annotationsSvg,
      width: 123,
      height: 456,
      tags,
    });
    const meta = readEditablePngBytes(out);
    expect(meta).not.toBeNull();
    expect(meta!.annotationsSvg).toBe(annotationsSvg);
    expect(meta!.width).toBe(123);
    expect(meta!.height).toBe(456);
    expect(meta!.tags).toEqual(tags);
    expect(meta!.originalImageDataUrl).toMatch(/^data:image\/png;base64,/);
    const readBack = dataUrlToBytes(meta!.originalImageDataUrl);
    expect(readBack).toEqual(tinyPng);
  });

  it("accepts a data: URL for originalImage (string overload)", () => {
    const out = createEditablePngBytes({
      renderedPng: tinyPng,
      originalImage: TINY_PNG_DATA_URL,
      annotationsSvg,
      width: 1,
      height: 1,
    });
    const meta = readEditablePngBytes(out);
    expect(meta).not.toBeNull();
    const readBack = dataUrlToBytes(meta!.originalImageDataUrl);
    expect(readBack).toEqual(tinyPng);
  });

  it("round-trips with an empty tag set", () => {
    const out = createEditablePngBytes({
      renderedPng: tinyPng,
      originalImage: tinyPng,
      annotationsSvg,
      width: 1,
      height: 1,
      tags: {},
    });
    const meta = readEditablePngBytes(out);
    expect(meta!.tags).toEqual({});
  });

  it("round-trips with no tag set at all", () => {
    const out = createEditablePngBytes({
      renderedPng: tinyPng,
      originalImage: tinyPng,
      annotationsSvg,
      width: 1,
      height: 1,
    });
    const meta = readEditablePngBytes(out);
    expect(meta!.tags).toEqual({});
  });

  it("round-trips annotations with XML-ish content (CDATA-safe)", () => {
    const complex = `<g class="layer"><rect fill="#ff0000" opacity="0.5"/><text x="10">hi &amp; bye</text></g>`;
    const out = createEditablePngBytes({
      renderedPng: tinyPng,
      originalImage: tinyPng,
      annotationsSvg: complex,
      width: 1,
      height: 1,
    });
    const meta = readEditablePngBytes(out);
    expect(meta!.annotationsSvg).toBe(complex);
  });

  it("preserves the rendered PNG's visible pixel chunks (IHDR/IDAT/IEND)", () => {
    // The XMP write is metadata-only: rendered pixel chunks must be
    // preserved verbatim from input → output. We check IHDR and IEND
    // chunks survive by scanning for their type bytes.
    const out = createEditablePngBytes({
      renderedPng: tinyPng,
      originalImage: tinyPng,
      annotationsSvg: "<g/>",
      width: 1,
      height: 1,
    });
    // Naive substring check: the output bytes still contain the
    // input bytes (modulo prepended/appended chunks).
    const outStr = Array.from(out)
      .map((b) => String.fromCharCode(b))
      .join("");
    expect(outStr).toContain("IHDR");
    expect(outStr).toContain("IDAT");
    expect(outStr).toContain("IEND");
    // Our custom chunks should also be present.
    expect(outStr).toContain("iTXt");
    expect(outStr).toContain("svGo");
  });

  it("re-writing an already-editable PNG cleans the old custom chunks (no double-insert)", () => {
    const first = createEditablePngBytes({
      renderedPng: tinyPng,
      originalImage: tinyPng,
      annotationsSvg: "<g><rect/></g>",
      width: 1,
      height: 1,
    });
    const second = createEditablePngBytes({
      renderedPng: first,
      originalImage: tinyPng,
      annotationsSvg: "<g><circle r='3'/></g>",
      width: 1,
      height: 1,
    });
    const meta = readEditablePngBytes(second);
    expect(meta!.annotationsSvg).toBe("<g><circle r='3'/></g>");
    // The second pass strips the iTXt+svGo from the input before
    // re-inserting — counting "iTXt" occurrences in the bytes should
    // be exactly 1.
    const outStr = Array.from(second)
      .map((b) => String.fromCharCode(b))
      .join("");
    expect(outStr.match(/iTXt/g)?.length).toBe(1);
    expect(outStr.match(/svGo/g)?.length).toBe(1);
  });
});

describe("readEditablePngBytes — negative / boundary cases", () => {
  it("returns null for random non-image bytes", () => {
    const junk = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(readEditablePngBytes(junk)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(readEditablePngBytes(new Uint8Array(0))).toBeNull();
  });

  it("returns null for a PNG that lacks our custom chunks", () => {
    expect(readEditablePngBytes(tinyPng)).toBeNull();
  });

  it("returns null when JPEG bytes are passed (PNG-only reader)", () => {
    // Reading a JPEG via the PNG-only reader must return null even if
    // the JPEG has valid Annot metadata.
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(readEditablePngBytes(fakeJpeg)).toBeNull();
  });
});

describe("readEditableImage — dual-format dispatch", () => {
  it("dispatches PNG bytes to the PNG reader", () => {
    const out = createEditablePngBytes({
      renderedPng: tinyPng,
      originalImage: tinyPng,
      annotationsSvg: "<g/>",
      width: 1,
      height: 1,
    });
    const meta: AnnotMetadata | null = readEditableImage(out);
    expect(meta).not.toBeNull();
    expect(meta!.annotationsSvg).toBe("<g/>");
  });

  it("returns null for non-PNG, non-JPEG bytes", () => {
    expect(readEditableImage(new Uint8Array([0, 0, 0, 0]))).toBeNull();
  });
});

describe("writePngWithTagsOnly", () => {
  it("returns input bytes unchanged when tags is empty", () => {
    const out = writePngWithTagsOnly(tinyPng, {});
    expect(Array.from(out)).toEqual(Array.from(tinyPng));
  });

  it("writes a PNG that the editable reader rejects (no <annot:annotations>)", () => {
    const out = writePngWithTagsOnly(tinyPng, { source: "vrt", testId: "x" });
    // Plain readEditablePngBytes returns null — the file is NOT a re-editable Annot file.
    expect(readEditablePngBytes(out)).toBeNull();
  });

  it("preserves PNG signature + visible chunks", () => {
    const out = writePngWithTagsOnly(tinyPng, { source: "vrt" });
    expect(out[0]).toBe(0x89);
    expect(out[1]).toBe(0x50);
    expect(out[2]).toBe(0x4e);
    expect(out[3]).toBe(0x47);
    const outStr = Array.from(out)
      .map((b) => String.fromCharCode(b))
      .join("");
    expect(outStr).toContain("IHDR");
    expect(outStr).toContain("IDAT");
    expect(outStr).toContain("IEND");
    expect(outStr).toContain("iTXt");
    // No svGo chunk (no embedded original).
    expect(outStr).not.toContain("svGo");
  });

  it("embeds the tag json into the XMP iTXt chunk", () => {
    const tags = { source: "vrt-failure", testId: "login-flow", commit: "abc123" };
    const out = writePngWithTagsOnly(tinyPng, tags);
    const outStr = Array.from(out)
      .map((b) => String.fromCharCode(b))
      .join("");
    expect(outStr).toContain("annot:tags");
    expect(outStr).toContain('"source":"vrt-failure"');
    expect(outStr).toContain('"testId":"login-flow"');
    expect(outStr).toContain('"commit":"abc123"');
    // Tags-only XMP must NOT include the annotations element — that's
    // what makes the editor treat the file as plain PNG.
    expect(outStr).not.toContain("annot:annotations");
  });

  it("re-writing a tags-only PNG cleans the old iTXt chunk (no double-insert)", () => {
    const first = writePngWithTagsOnly(tinyPng, { source: "first" });
    const second = writePngWithTagsOnly(first, { source: "second" });
    const outStr = Array.from(second)
      .map((b) => String.fromCharCode(b))
      .join("");
    expect(outStr.match(/iTXt/g)?.length).toBe(1);
    expect(outStr).toContain('"source":"second"');
    expect(outStr).not.toContain('"source":"first"');
  });
});

describe("WELL_KNOWN_TAG_KEYS", () => {
  it("exposes the documented soft-convention key names", () => {
    expect(WELL_KNOWN_TAG_KEYS).toEqual(["source", "screen", "capturedAt", "commit"]);
  });
});
