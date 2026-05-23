// Phase 3j of `docs/plans/living-spec-authoring-roadmap.md`
// (Phase 3 follow-up #2). Tests for `flattenEditablePng` — the
// editable-PNG → flat-PNG primitive that strips the editor's
// editable layer (Adobe XMP iTXt + custom `svGo` chunk) without
// re-rasterizing.
//
// We use `Annotator.toEditablePng` to build the editable input
// + `readEditablePngBytes` from `@ingcreators/annot-core/xmp-bytes`
// to assert the layer is gone after the flatten.

import { readEditablePngBytes } from "@ingcreators/annot-core/xmp-bytes";
import { describe, expect, test } from "vitest";

import { createAnnotator } from "./annotator.js";
import { flattenEditablePng } from "./flatten-editable-png.js";

const TINY_PNG_DATA_URL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function buildEditablePng(opts: { tags?: Record<string, string> } = {}): Uint8Array {
  return createAnnotator().toEditablePng({
    originalDataUrl: TINY_PNG_DATA_URL,
    annotationsSvg:
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="40" height="20" fill="white"/>' +
      "</svg>",
    width: 40,
    height: 20,
    ...(opts.tags ? { tags: opts.tags } : {}),
  });
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("flattenEditablePng", () => {
  test("editable PNG → flat PNG: readEditablePngBytes returns null after flatten", () => {
    const editable = buildEditablePng({ tags: { source: "test" } });
    // Sanity: editable round-trips through the reader.
    expect(readEditablePngBytes(editable)).not.toBeNull();

    const flat = flattenEditablePng(editable);
    expect(readEditablePngBytes(flat)).toBeNull();
  });

  test("output is a valid PNG (magic bytes preserved)", () => {
    const editable = buildEditablePng();
    const flat = flattenEditablePng(editable);
    expect(Array.from(flat.slice(0, 8))).toEqual(PNG_MAGIC);
  });

  test("flat PNG is strictly smaller than the editable input", () => {
    const editable = buildEditablePng({
      tags: { source: "test", commit: "abc1234567890" },
    });
    const flat = flattenEditablePng(editable);
    // Editable layer adds ~original-bitmap-bytes + ~SVG-bytes +
    // chunk overhead; flat should drop hundreds of bytes
    // minimum even for a 1px synthetic capture.
    expect(flat.length).toBeLessThan(editable.length);
  });

  test("idempotent on a flat PNG (no editable layer)", () => {
    // The TINY_PNG_DATA_URL bytes themselves are a flat PNG
    // with no editable layer. Passing them through
    // flattenEditablePng twice should yield byte-identical
    // output.
    const flat = Uint8Array.from(Buffer.from(TINY_PNG_DATA_URL.split(",")[1] ?? "", "base64"));
    const onceFlattened = flattenEditablePng(flat);
    const twiceFlattened = flattenEditablePng(onceFlattened);
    expect(Array.from(onceFlattened)).toEqual(Array.from(twiceFlattened));
    // And the visible PNG bytes survived unchanged.
    expect(onceFlattened.length).toBe(flat.length);
  });

  test("strips tags too — flattenEditablePng drops all annot:* metadata", () => {
    const editable = buildEditablePng({
      tags: { source: "test-source", capturedAt: "2026-05-23T00:00:00Z" },
    });
    // Pre-flatten the tags round-trip:
    const meta = readEditablePngBytes(editable);
    expect(meta?.tags).toEqual({
      source: "test-source",
      capturedAt: "2026-05-23T00:00:00Z",
    });

    const flat = flattenEditablePng(editable);
    expect(readEditablePngBytes(flat)).toBeNull();
  });
});
