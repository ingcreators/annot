import { describe, expect, it } from "vitest";

import type { ElementTree } from "../element-tree/index.js";
import {
  hasElementTreePng,
  readElementTreePng,
  writeElementTreePng,
} from "./element-tree-payload.js";
import { createEditablePngBytes, readEditablePngBytes } from "./xmp-bytes.js";

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

function sampleTree(): ElementTree {
  return {
    version: 1,
    source: {
      kind: "extension",
      capturedAt: "2026-05-23T12:00:00.000Z",
      url: "https://example.com/login",
    },
    viewport: { width: 1280, height: 800, scale: 1 },
    root: {
      ref: "e0",
      role: "document",
      bbox: { x: 0, y: 0, width: 1280, height: 800 },
      children: [
        {
          ref: "e1",
          role: "heading",
          name: "Sign in",
          bbox: { x: 100, y: 50, width: 200, height: 30 },
          states: ["level=1"],
        },
        {
          ref: "e2",
          role: "textbox",
          name: "Email",
          bbox: { x: 100, y: 100, width: 300, height: 40 },
          attributes: { type: "email", required: "" },
        },
      ],
    },
  };
}

describe("writeElementTreePng + readElementTreePng", () => {
  it("round-trips a populated tree without losing fields", () => {
    const written = writeElementTreePng(tinyPng, sampleTree());
    const back = readElementTreePng(written);
    expect(back).toEqual(sampleTree());
  });

  it("preserves the PNG signature so image viewers still render it", () => {
    const out = writeElementTreePng(tinyPng, sampleTree());
    expect(out[0]).toBe(0x89);
    expect(out[1]).toBe(0x50);
    expect(out[2]).toBe(0x4e);
    expect(out[3]).toBe(0x47);
    // IEND chunk still present at the tail.
    const tail = out.slice(out.length - 12);
    expect(String.fromCharCode(tail[4]!, tail[5]!, tail[6]!, tail[7]!)).toBe("IEND");
  });

  it("returns null on a PNG without the chunk", () => {
    expect(readElementTreePng(tinyPng)).toBeNull();
    expect(hasElementTreePng(tinyPng)).toBe(false);
  });

  it("hasElementTreePng reports true after a write", () => {
    const written = writeElementTreePng(tinyPng, sampleTree());
    expect(hasElementTreePng(written)).toBe(true);
  });

  it("returns null on non-PNG input", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(readElementTreePng(jpeg)).toBeNull();
    expect(hasElementTreePng(jpeg)).toBe(false);
  });

  it("throws on non-PNG input to writeElementTreePng", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(() => writeElementTreePng(jpeg, sampleTree())).toThrow(/not a valid PNG/);
  });

  it("replaces an existing chunk on re-write (no chunk accumulation)", () => {
    const first = writeElementTreePng(tinyPng, sampleTree());
    const second = writeElementTreePng(first, sampleTree());
    // Second should be the same size as first (the existing chunk
    // gets removed before the new one is inserted).
    expect(second.length).toBe(first.length);
    const back = readElementTreePng(second);
    expect(back).toEqual(sampleTree());
  });

  it("coexists with the editor's XMP + svGo chunks (no interference)", () => {
    // First add editor metadata (annotations SVG + embedded original).
    const annotationsSvg = '<g><rect x="0" y="0" width="1" height="1"/></g>';
    const withXmp = createEditablePngBytes({
      renderedPng: tinyPng,
      originalImage: tinyPng,
      annotationsSvg,
      width: 1,
      height: 1,
    });
    // Then layer in the ElementTree chunk.
    const withBoth = writeElementTreePng(withXmp, sampleTree());

    // Both chunks should be readable independently.
    expect(hasElementTreePng(withBoth)).toBe(true);
    const tree = readElementTreePng(withBoth);
    expect(tree).toEqual(sampleTree());

    const editorMeta = readEditablePngBytes(withBoth);
    expect(editorMeta?.annotationsSvg).toBe(annotationsSvg);
    expect(editorMeta?.width).toBe(1);
  });

  it("compresses the YAML payload so large trees fit in reasonable bytes", () => {
    // Build a tree with 100 child nodes to exercise compression.
    const fat: ElementTree = {
      version: 1,
      source: { kind: "extension", capturedAt: "2026-05-23T00:00:00Z" },
      viewport: { width: 1280, height: 800, scale: 1 },
      root: {
        ref: "e0",
        role: "document",
        children: Array.from({ length: 100 }, (_, i) => ({
          ref: `e${i + 1}`,
          role: "button",
          name: `Button ${i + 1}`,
          bbox: { x: i * 10, y: 0, width: 80, height: 30 },
        })),
      },
    };
    const out = writeElementTreePng(tinyPng, fat);
    // Uncompressed payload would be ~7-8 KB of YAML; compressed
    // should be well under 2 KB.
    const overhead = out.length - tinyPng.length;
    expect(overhead).toBeLessThan(2048);
    // Round-trip integrity preserved.
    expect(readElementTreePng(out)).toEqual(fat);
  });
});
