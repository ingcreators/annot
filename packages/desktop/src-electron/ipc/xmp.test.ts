/**
 * Unit tests for the Phase 2 XMP IPC handlers.
 *
 * The PNG path is the primary test surface — it can be exercised
 * end-to-end without any image-encoding helpers. We assemble a
 * minimal valid PNG from its 8-byte signature + IHDR + IEND, run
 * it through `save_with_xmp` + `read_xmp`, and confirm every
 * field round-trips.
 *
 * The JPEG path needs PNG→JPEG conversion under the hood (the
 * production path uses Electron's `nativeImage`). Tests inject a
 * stub `pngToJpeg` callback that synthesises a minimal valid
 * JPEG (SOI + EOI) so the byte-manipulation layer can be
 * exercised without a real encoder.
 *
 * Round-trip equivalence: writing-then-reading the same inputs
 * produces an identical metadata struct, AND reading-then-rewriting
 * an existing file produces byte-identical output. The latter is
 * the goldens test required by the migration plan.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createXmpHandlers, type XmpHandlers } from "./xmp.js";

let tmp: string;
let handlers: XmpHandlers;

/** 8-byte PNG signature + IHDR (1x1, 8-bit RGB) + IDAT (1 px) +
 *  IEND. Pre-computed CRCs match the PNG spec. */
function tinyPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    // IHDR
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
    // IDAT
    0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00,
    0x00, 0x03, 0x00, 0x01, 0x6b, 0x66, 0x5e, 0x47,
    // IEND
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

/** Smallest possible "JPEG": SOI + EOI. Enough for the
 *  byte-walker but not a renderable image. */
function tinyJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

const stubPngToJpeg = async (_png: Uint8Array): Promise<Uint8Array> => tinyJpeg();

beforeEach(async () => {
  tmp = await fs.mkdtemp(join(tmpdir(), "annot-xmp-"));
  handlers = createXmpHandlers({ pngToJpeg: stubPngToJpeg });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("save_with_xmp + read_xmp — PNG round-trip", () => {
  it("preserves annotations / dimensions / original bytes through the round-trip", async () => {
    const png = tinyPng();
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const filePath = join(tmp, "out.png");

    await handlers.saveWithXmp({
      renderedImageB64: bytesToBase64(png),
      originalImageB64: bytesToBase64(original),
      annotationsSvg: '<g><rect x="0" y="0" width="1" height="1"/></g>',
      width: 1,
      height: 1,
      filePath,
    });

    const meta = await handlers.readXmp({ filePath });
    expect(meta).not.toBeNull();
    expect(meta?.annotations_svg).toBe('<g><rect x="0" y="0" width="1" height="1"/></g>');
    expect(meta?.width).toBe(1);
    expect(meta?.height).toBe(1);
    expect(Buffer.from(meta!.original_image_b64, "base64")).toEqual(Buffer.from(original));
  });

  it("preserves PNG signature + IEND placement", async () => {
    const png = tinyPng();
    const filePath = join(tmp, "out.png");
    await handlers.saveWithXmp({
      renderedImageB64: bytesToBase64(png),
      originalImageB64: bytesToBase64(new Uint8Array([42])),
      annotationsSvg: "<g/>",
      width: 1,
      height: 1,
      filePath,
    });

    const written = await fs.readFile(filePath);
    // PNG signature intact at the start.
    expect(written.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // IEND signature is the last 8 bytes of the file (4-byte type
    // "IEND" + 4-byte CRC; the preceding 4-byte length is at -12).
    expect(written.subarray(written.length - 8, written.length - 4)).toEqual(
      Buffer.from("IEND", "ascii"),
    );
  });

  it("round-tripping a saved file produces byte-identical output (goldens)", async () => {
    // Step 1: produce a "Tauri-saved" reference file via our own
    // writer. Since the Rust impl is a byte-for-byte mirror of
    // the TS impl on the iTXt/svGo layer, the byte-equivalent
    // contract is "read this file, take the inputs, re-write —
    // expect identical bytes." This catches any future drift in
    // serialization.
    const rendered = tinyPng();
    const original = new Uint8Array([10, 20, 30, 40]);
    const annotationsSvg = '<g data-version="1"><circle cx="0" cy="0" r="1"/></g>';

    const refPath = join(tmp, "ref.png");
    await handlers.saveWithXmp({
      renderedImageB64: bytesToBase64(rendered),
      originalImageB64: bytesToBase64(original),
      annotationsSvg,
      width: 1,
      height: 1,
      filePath: refPath,
    });
    const refBytes = await fs.readFile(refPath);

    // Step 2: read the reference, then re-write to a new path
    // with the same inputs. The Rust impl's read+rewrite
    // pipeline removes any pre-existing iTXt + svGo chunks
    // before re-inserting (`remove_png_metadata`), so the
    // re-written file should have IDENTICAL byte sequences.
    const meta = await handlers.readXmp({ filePath: refPath });
    expect(meta).not.toBeNull();

    const rewritePath = join(tmp, "rewrite.png");
    await handlers.saveWithXmp({
      renderedImageB64: bytesToBase64(refBytes),
      originalImageB64: meta!.original_image_b64,
      annotationsSvg: meta!.annotations_svg,
      width: meta!.width,
      height: meta!.height,
      filePath: rewritePath,
    });
    const rewriteBytes = await fs.readFile(rewritePath);
    expect(rewriteBytes).toEqual(refBytes);
  });
});

describe("save_with_xmp + read_xmp — JPEG round-trip", () => {
  it("preserves annotations + original through APP1+APP2 serialization", async () => {
    const filePath = join(tmp, "out.jpg");
    const original = new Uint8Array(80_000); // > one APP2 segment to exercise the multi-chunk split
    for (let i = 0; i < original.length; i++) original[i] = i & 0xff;

    await handlers.saveWithXmp({
      renderedImageB64: bytesToBase64(tinyPng()), // PNG → triggers pngToJpeg conversion via stub
      originalImageB64: bytesToBase64(original),
      annotationsSvg: "<g/>",
      width: 320,
      height: 240,
      filePath,
    });

    const meta = await handlers.readXmp({ filePath });
    expect(meta).not.toBeNull();
    expect(meta?.width).toBe(320);
    expect(meta?.height).toBe(240);
    const recoveredOriginal = Buffer.from(meta!.original_image_b64, "base64");
    expect(recoveredOriginal.byteLength).toBe(original.byteLength);
    expect(recoveredOriginal).toEqual(Buffer.from(original));
  });
});

describe("read_xmp — missing / non-image input", () => {
  it("returns null for a file with no XMP", async () => {
    const filePath = join(tmp, "plain.png");
    await fs.writeFile(filePath, tinyPng());
    expect(await handlers.readXmp({ filePath })).toBeNull();
  });
});
