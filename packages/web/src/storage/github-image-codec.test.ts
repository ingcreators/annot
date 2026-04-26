// Pure-Node tests for `decodeImageRecord`. Uses real
// `createEditableImage` (round-trip) for the XMP-bearing case, and
// raw bytes for the plain-image fallback. happy-dom is needed
// because `createEditableImage` round-trips through `Blob` /
// `FileReader`; everything else is pure.

/// <reference lib="dom" />
// @vitest-environment happy-dom

import { createEditableImage } from "@ingcreators/annot-core/xmp";
import { describe, expect, it } from "vitest";
import { decodeImageRecord } from "./github-image-codec.js";

/** Smallest valid 1×1 transparent PNG (matches the fixture used by
 *  `xmp-browser.test.ts`). 67 bytes including signature + IHDR +
 *  IDAT + IEND, hand-verified against a real PNG decoder. */
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

/** Build a real XMP-bearing PNG via `createEditableImage` so the
 *  test exercises the production decode pipeline byte-for-byte. */
async function buildXmpPng(opts: {
  annotationsSvg: string;
  tags?: Record<string, string>;
  width?: number;
  height?: number;
}): Promise<Uint8Array> {
  const pngBytes = dataUrlToBytes(TINY_PNG_DATA_URL);
  const renderedBlob = new Blob([pngBytes as BlobPart], { type: "image/png" });
  const out = await createEditableImage({
    renderedBlob,
    originalDataUrl: TINY_PNG_DATA_URL,
    annotationsSvg: opts.annotationsSvg,
    width: opts.width ?? 100,
    height: opts.height ?? 80,
    format: "png",
    tags: opts.tags ?? {},
  });
  return new Uint8Array(await out.arrayBuffer());
}

describe("decodeImageRecord — XMP-bearing image (round trip)", () => {
  it("populates annotationsSvg / width / height / tags from the XMP envelope", async () => {
    const bytes = await buildXmpPng({
      annotationsSvg: '<svg><rect width="10" height="10"/></svg>',
      tags: { author: "alice", host: "example.com" },
      width: 200,
      height: 150,
    });

    const rec = decodeImageRecord("folder/sub/file.png", bytes);

    expect(rec.path).toBe("folder/sub/file.png");
    expect(rec.folderPath).toBe("folder/sub");
    expect(rec.annotationsSvg).toBe('<svg><rect width="10" height="10"/></svg>');
    expect(rec.width).toBe(200);
    expect(rec.height).toBe(150);
    expect(rec.tags).toEqual({ author: "alice", host: "example.com" });
    // The XMP envelope embeds the original bytes — originalDataUrl
    // should resolve to a data URL pointing at PNG content, not the
    // raw fetched bytes.
    expect(rec.originalDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("derives folderPath from the relPath", () => {
    const rec = decodeImageRecord("a.png", new Uint8Array());
    expect(rec.folderPath).toBe("");

    const nested = decodeImageRecord("deeply/nested/file.png", new Uint8Array());
    expect(nested.folderPath).toBe("deeply/nested");
  });
});

describe("decodeImageRecord — non-XMP fallback", () => {
  it("falls through to inferred-MIME data URL for a plain PNG header", () => {
    // 8-byte PNG magic header (no IDAT, no IEND — but readEditableImage
    // tolerates the truncation; the XMP probe will return null and the
    // decoder falls through to the bytesToDataUrl branch).
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const rec = decodeImageRecord("photo.png", pngBytes);

    // No XMP fields populated.
    expect(rec.annotationsSvg).toBe("");
    expect(rec.width).toBe(0);
    expect(rec.height).toBe(0);
    expect(rec.tags).toEqual({});
    // Original data URL is the raw bytes encoded with MIME inferred
    // from the path extension.
    expect(rec.originalDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("infers MIME from the path extension for unknown bytes", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(decodeImageRecord("a.png", bytes).originalDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(decodeImageRecord("a.jpg", bytes).originalDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(decodeImageRecord("a.svg", bytes).originalDataUrl).toMatch(
      /^data:application\/octet-stream;base64,/,
    );
  });
});

describe("decodeImageRecord — meta passthrough", () => {
  it("populates createdAt / updatedAt from the supplied meta", () => {
    const bytes = new Uint8Array();
    const rec = decodeImageRecord("a.png", bytes, {
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-04-26T12:00:00.000Z",
    });
    expect(rec.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(rec.updatedAt).toBe("2026-04-26T12:00:00.000Z");
  });

  it("defaults to empty strings when meta is omitted", () => {
    const rec = decodeImageRecord("a.png", new Uint8Array());
    expect(rec.createdAt).toBe("");
    expect(rec.updatedAt).toBe("");
  });

  it("defaults to empty strings when meta has the keys but values undefined", () => {
    const rec = decodeImageRecord("a.png", new Uint8Array(), {});
    expect(rec.createdAt).toBe("");
    expect(rec.updatedAt).toBe("");
  });
});

describe("decodeImageRecord — record shape", () => {
  it("returns a fresh object — does not memoise", () => {
    const bytes = new Uint8Array();
    const a = decodeImageRecord("x.png", bytes);
    const b = decodeImageRecord("x.png", bytes);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("always returns thumbnailDataUrl='' (caller is responsible for filling)", () => {
    const rec = decodeImageRecord("x.png", new Uint8Array());
    expect(rec.thumbnailDataUrl).toBe("");
  });

  it("always returns sourceUrl='' (GitHub doesn't track the source URL)", () => {
    const rec = decodeImageRecord("x.png", new Uint8Array());
    expect(rec.sourceUrl).toBe("");
  });
});
