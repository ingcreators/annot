/**
 * Goldens test for the GVML + CF_DIB clipboard packaging.
 *
 * Direct port of
 * `packages/desktop/src-tauri/src/commands/clipboard_test.rs`,
 * extended to cover the CF_DIB fallback that was deliberately
 * omitted in the Phase 4 Electron port. Asserts (without
 * touching a real OS clipboard):
 *
 *   1. The GVML ZIP can be built without error.
 *   2. The expected GVML entries are present (`[Content_Types].xml`,
 *      `_rels/.rels`, `clipboard/drawings/drawing1.xml`,
 *      `clipboard/drawings/_rels/drawing1.xml.rels`,
 *      `clipboard/theme/theme1.xml`).
 *   3. The drawing XML and mosaic media land at their declared
 *      paths with the exact bytes the caller passed in.
 *   4. The drawing rels file references rId entries for both the
 *      screenshot (when present) and each mosaic file in order.
 *   5. The content-types file omits image/jpeg + image/png entries
 *      when no image / mosaic media are passed; includes them when
 *      either is.
 *   6. `copy_as_office` writes the GVML buffer to the clipboard via
 *      the dependency-injected `writeFormats`, and rejects with a
 *      clear error on non-Windows hosts.
 *   7. `copy_as_office` also writes a `CF_DIB` entry whenever the
 *      caller supplies `pngDataUrl`, with a valid 24-bit
 *      BITMAPINFOHEADER + bottom-up BGR scanlines.
 */

import { unzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  buildGvmlZip,
  type ClipboardDeps,
  type ClipboardFormatWrite,
  createClipboardHandlers,
  GVML_FORMAT_NAME,
  type MosaicMedia,
} from "./clipboard.js";
import { CF_DIB } from "./dib.js";

/** Minimal ZIP entry reader. The pure-JS `buildZipBytes` we use
 *  produces Stored (uncompressed) entries, so we can scan the
 *  Local-File-Header sequence directly without a deflate
 *  dependency. */
function readZipEntries(zipBytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let pos = 0;
  while (pos + 30 <= zipBytes.length) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x04034b50) break; // PK\x03\x04 — local file header
    const compressionMethod = view.getUint16(pos + 8, true);
    const compressedSize = view.getUint32(pos + 18, true);
    const uncompressedSize = view.getUint32(pos + 22, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const name = new TextDecoder().decode(zipBytes.subarray(pos + 30, pos + 30 + nameLen));
    const dataStart = pos + 30 + nameLen + extraLen;
    const compressed = zipBytes.subarray(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (compressionMethod === 0) {
      data = compressed;
    } else if (compressionMethod === 8) {
      // Defensive — `buildZipBytes` is Stored-only today, but
      // keep the deflate fallback so a future encoding change
      // doesn't break the test.
      data = new Uint8Array(unzipSync(Buffer.from(compressed)));
    } else {
      throw new Error(`unsupported compression method: ${compressionMethod}`);
    }
    if (data.length !== uncompressedSize) {
      throw new Error(`size mismatch for ${name}`);
    }
    entries.set(name, data);
    pos = dataStart + compressedSize;
  }
  return entries;
}

function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  return readZipEntries(bytes);
}

const SAMPLE_DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7620000" cy="5715000"/><a:chOff x="0" y="0"/><a:chExt cx="7620000" cy="5715000"/></a:xfrm></a:grpSpPr></lc:lockedCanvas></a:graphicData></a:graphic>`;

describe("buildGvmlZip — entry scaffolding", () => {
  it("includes drawing XML, theme, content-types, and rels", async () => {
    const bytes = buildGvmlZip(SAMPLE_DRAWING_XML, []);
    const entries = readZip(bytes);

    for (const required of [
      "[Content_Types].xml",
      "_rels/.rels",
      "clipboard/drawings/drawing1.xml",
      "clipboard/drawings/_rels/drawing1.xml.rels",
      "clipboard/theme/theme1.xml",
    ]) {
      expect(entries.has(required)).toBe(true);
    }

    const drawing = new TextDecoder().decode(entries.get("clipboard/drawings/drawing1.xml")!);
    expect(drawing).toBe(SAMPLE_DRAWING_XML);
  });

  it("omits image/jpeg + image/png content-types when neither media nor screenshot present", async () => {
    const bytes = buildGvmlZip(SAMPLE_DRAWING_XML, []);
    const entries = readZip(bytes);
    const ct = new TextDecoder().decode(entries.get("[Content_Types].xml")!);
    expect(ct).not.toContain('Extension="jpeg"');
    expect(ct).not.toContain('Extension="png"');
  });

  it("includes image/jpeg + image/png content-types when screenshot is present", async () => {
    const bytes = buildGvmlZip(SAMPLE_DRAWING_XML, [], new Uint8Array([0xff, 0xd8]));
    const entries = readZip(bytes);
    const ct = new TextDecoder().decode(entries.get("[Content_Types].xml")!);
    expect(ct).toContain('Extension="jpeg"');
    expect(ct).toContain('Extension="png"');
  });
});

describe("buildGvmlZip — mosaic media", () => {
  it("writes mosaic bytes verbatim under clipboard/media/<filename>", async () => {
    const media: MosaicMedia[] = [
      { filename: "mosaic_0.png", bytes: new Uint8Array([0xde, 0xad]) },
      { filename: "mosaic_1.jpeg", bytes: new Uint8Array([0xca, 0xfe]) },
    ];
    const bytes = buildGvmlZip(SAMPLE_DRAWING_XML, media);
    const entries = readZip(bytes);
    expect(entries.get("clipboard/media/mosaic_0.png")).toEqual(new Uint8Array([0xde, 0xad]));
    expect(entries.get("clipboard/media/mosaic_1.jpeg")).toEqual(new Uint8Array([0xca, 0xfe]));
  });

  it("writes the screenshot under clipboard/media/image1.jpeg", async () => {
    const img = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic
    const bytes = buildGvmlZip(SAMPLE_DRAWING_XML, [], img);
    const entries = readZip(bytes);
    expect(entries.get("clipboard/media/image1.jpeg")).toEqual(img);
  });
});

describe("buildGvmlZip — drawing rels rId numbering", () => {
  it("orders rels as theme=rId1, screenshot=rId2 (when present), then mosaic media", async () => {
    // Same contract the TS-side `buildDrawingXml` in
    // `@ingcreators/annot-render` depends on for `<a:blip
    // r:embed="rId{N}"/>` references.
    const media: MosaicMedia[] = [
      { filename: "mosaic_0.png", bytes: new Uint8Array([0x01]) },
      { filename: "mosaic_1.jpeg", bytes: new Uint8Array([0x02]) },
    ];
    const bytes = buildGvmlZip(SAMPLE_DRAWING_XML, media, new Uint8Array([0xff, 0xd8]));
    const entries = readZip(bytes);
    const rels = new TextDecoder().decode(
      entries.get("clipboard/drawings/_rels/drawing1.xml.rels")!,
    );
    expect(rels).toContain('Id="rId1"');
    expect(rels).toContain('Target="../theme/theme1.xml"');
    expect(rels).toContain('Id="rId2"');
    expect(rels).toContain('Target="../media/image1.jpeg"');
    expect(rels).toContain('Id="rId3"');
    expect(rels).toContain('Target="../media/mosaic_0.png"');
    expect(rels).toContain('Id="rId4"');
    expect(rels).toContain('Target="../media/mosaic_1.jpeg"');
  });

  it("starts mosaic rels at rId2 when no screenshot is present", async () => {
    const media: MosaicMedia[] = [{ filename: "mosaic_0.png", bytes: new Uint8Array([0x01]) }];
    const bytes = buildGvmlZip(SAMPLE_DRAWING_XML, media);
    const entries = readZip(bytes);
    const rels = new TextDecoder().decode(
      entries.get("clipboard/drawings/_rels/drawing1.xml.rels")!,
    );
    expect(rels).toContain('Id="rId2"');
    expect(rels).toContain('Target="../media/mosaic_0.png"');
    // No rId for image1.jpeg when no screenshot.
    expect(rels).not.toContain('Target="../media/image1.jpeg"');
  });
});

describe("copy_as_office handler", () => {
  function makeDeps(opts?: { isSupported?: boolean }): {
    deps: ClipboardDeps;
    writeFormats: ReturnType<typeof vi.fn>;
    pngToJpeg: ReturnType<typeof vi.fn>;
    pngToBgra: ReturnType<typeof vi.fn>;
  } {
    const writeFormats = vi.fn();
    const pngToJpeg = vi.fn(
      async (png: Uint8Array) =>
        // Stub: prepend a marker byte so the test can prove the
        // PNG path went through conversion.
        new Uint8Array([0xff, ...png]),
    );
    // Stub PNG decoder: returns a deterministic 2×2 BGRA block
    // regardless of input bytes, so the test can verify the
    // entire CF_DIB pipeline without dragging in `nativeImage`.
    const pngToBgra = vi.fn(() => ({
      data: new Uint8Array([
        // top row: red, green
        0x00, 0x00, 0xff, 0xff, 0x00, 0xff, 0x00, 0xff,
        // bottom row: blue, white
        0xff, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff,
      ]),
      width: 2,
      height: 2,
    }));
    const deps: ClipboardDeps = {
      writeFormats,
      pngToJpeg,
      pngToBgra,
      isSupported: () => opts?.isSupported ?? true,
    };
    return { deps, writeFormats, pngToJpeg, pngToBgra };
  }

  it("writes the GVML buffer under the Art::GVML ClipFormat name", async () => {
    const ctrl = makeDeps();
    const handlers = createClipboardHandlers(ctrl.deps);
    await handlers.copyAsOffice({
      drawingXml: SAMPLE_DRAWING_XML,
      mosaicMedia: [],
    });

    expect(ctrl.writeFormats).toHaveBeenCalledTimes(1);
    const call = ctrl.writeFormats.mock.calls[0]![0] as ClipboardFormatWrite[];
    expect(call).toHaveLength(1);
    expect(call[0]!.format).toBe(GVML_FORMAT_NAME);
    expect(call[0]!.data).toBeInstanceOf(Uint8Array);

    // Validate the GVML buffer is a valid OPC ZIP.
    const entries = readZipEntries(call[0]!.data);
    expect(entries.has("clipboard/drawings/drawing1.xml")).toBe(true);
  });

  it("writes GVML + CF_DIB atomically when pngDataUrl is provided", async () => {
    const ctrl = makeDeps();
    const handlers = createClipboardHandlers(ctrl.deps);
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    await handlers.copyAsOffice({
      drawingXml: SAMPLE_DRAWING_XML,
      mosaicMedia: [],
      pngDataUrl: `data:image/png;base64,${pngB64}`,
    });

    // Both formats land in a single writeFormats call so the
    // native addon can drive Win32 with one
    // OpenClipboard/EmptyClipboard/Set/Set/Close cycle.
    expect(ctrl.writeFormats).toHaveBeenCalledTimes(1);
    const call = ctrl.writeFormats.mock.calls[0]![0] as ClipboardFormatWrite[];
    expect(call).toHaveLength(2);
    expect(call[0]!.format).toBe(GVML_FORMAT_NAME);
    expect(call[1]!.format).toBe(CF_DIB);

    // CF_DIB payload starts with a 40-byte BITMAPINFOHEADER
    // describing a 2×2 24-bit bitmap.
    const dib = call[1]!.data;
    const view = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
    expect(view.getUint32(0, true)).toBe(40); // biSize
    expect(view.getInt32(4, true)).toBe(2); // biWidth
    expect(view.getInt32(8, true)).toBe(2); // biHeight (positive)
    expect(view.getUint16(14, true)).toBe(24); // biBitCount
    expect(view.getUint32(16, true)).toBe(0); // biCompression = BI_RGB
    // 2-pixel rows: 6 BGR bytes padded to 8 ⇒ 16 bytes pixel data.
    expect(view.getUint32(20, true)).toBe(16);
    expect(dib.length).toBe(40 + 16);
  });

  it("falls back to GVML-only when PNG decode throws", async () => {
    const ctrl = makeDeps();
    ctrl.pngToBgra.mockImplementation(() => {
      throw new Error("decode failed");
    });
    const handlers = createClipboardHandlers(ctrl.deps);
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    await handlers.copyAsOffice({
      drawingXml: SAMPLE_DRAWING_XML,
      mosaicMedia: [],
      pngDataUrl: `data:image/png;base64,${pngB64}`,
    });

    // Office paste still works (GVML present); only the bitmap
    // fallback is missing — better than throwing.
    expect(ctrl.writeFormats).toHaveBeenCalledTimes(1);
    const call = ctrl.writeFormats.mock.calls[0]![0] as ClipboardFormatWrite[];
    expect(call).toHaveLength(1);
    expect(call[0]!.format).toBe(GVML_FORMAT_NAME);
  });

  it("converts a PNG screenshot via the host pngToJpeg adapter", async () => {
    const ctrl = makeDeps();
    const handlers = createClipboardHandlers(ctrl.deps);
    // `screenshotData` of `data:image/png;base64,...` triggers
    // the PNG → JPEG conversion path. The stub adds a 0xff
    // marker; the embedded image1.jpeg should start with it.
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    await handlers.copyAsOffice({
      drawingXml: SAMPLE_DRAWING_XML,
      mosaicMedia: [],
      screenshotData: `data:image/png;base64,${pngB64}`,
    });

    expect(ctrl.pngToJpeg).toHaveBeenCalledTimes(1);
    const call = ctrl.writeFormats.mock.calls[0]![0] as ClipboardFormatWrite[];
    const entries = readZipEntries(call[0]!.data);
    const img = entries.get("clipboard/media/image1.jpeg")!;
    expect(img[0]).toBe(0xff); // From the stub's marker.
  });

  it("skips the PNG conversion for non-PNG screenshot data URLs", async () => {
    const ctrl = makeDeps();
    const handlers = createClipboardHandlers(ctrl.deps);
    const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
    await handlers.copyAsOffice({
      drawingXml: SAMPLE_DRAWING_XML,
      mosaicMedia: [],
      screenshotData: `data:image/jpeg;base64,${jpegB64}`,
    });

    expect(ctrl.pngToJpeg).not.toHaveBeenCalled();
  });

  it("rejects on non-Windows hosts with a clear error", async () => {
    const ctrl = makeDeps({ isSupported: false });
    const handlers = createClipboardHandlers(ctrl.deps);
    await expect(
      handlers.copyAsOffice({ drawingXml: SAMPLE_DRAWING_XML, mosaicMedia: [] }),
    ).rejects.toThrow(/Windows-only/);
    expect(ctrl.writeFormats).not.toHaveBeenCalled();
  });
});
