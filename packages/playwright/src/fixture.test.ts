// Unit tests for the fixture. We don't run a Playwright runner
// in CI — testing the fixture's runtime is a separate concern
// (a future E2E integration plan). What we CAN verify with
// vitest: the `annotateScreenshot` helper behaves correctly
// when handed a stub `Page` that mimics the screenshot API
// surface we depend on.

import { createAnnotator } from "@ingcreators/annot-annotator";
import { describe, expect, it } from "vitest";
import { annotateScreenshot, type PageLike } from "./fixture.js";
import { rectForBoundingBox } from "./helpers.js";

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Generate a real PNG of the given size — uses the annotator's
 *  own public API to rasterise a simple SVG. Drives the fixture
 *  with a realistic byte stream the IHDR parser accepts, AND
 *  exercises the same code path real callers use. */
function makePng(width: number, height: number): Buffer {
  // Empty 1×1 transparent base bitmap — irrelevant content;
  // we just need a PNG of the right pixel dimensions.
  const dataUrl =
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Buffer.from(
    createAnnotator().toPng({
      originalDataUrl: dataUrl,
      annotationsSvg:
        `<svg xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="${width}" height="${height}" fill="white"/>` +
        "</svg>",
      width,
      height,
    }),
  );
}

function makeStubPage(png: Buffer): PageLike {
  return {
    screenshot: async (_opts?: { fullPage?: boolean }) => png,
  };
}

describe("annotateScreenshot", () => {
  it("composes a screenshot + annotations into a valid PNG", async () => {
    const annotator = createAnnotator();
    const screenshot = makePng(200, 150);
    const page = makeStubPage(screenshot);

    const result = await annotateScreenshot(annotator, page, {
      annotationsSvg: rectForBoundingBox(
        { x: 10, y: 10, width: 50, height: 50 },
        { stroke: "red" },
      ),
    });

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(100);
    expect(Array.from(result.slice(0, 8))).toEqual(Array.from(PNG_MAGIC));
  });

  it("reads dimensions from the screenshot bytes (not viewport)", async () => {
    const annotator = createAnnotator();
    const annotations = `<rect x="0" y="0" width="100" height="100" fill="red"/>`;

    // Construct two stub pages with different-sized screenshots;
    // assert the output is sized correctly (not from a fixed
    // viewport).
    const small = await annotateScreenshot(annotator, makeStubPage(makePng(100, 100)), {
      annotationsSvg: annotations,
    });
    const large = await annotateScreenshot(annotator, makeStubPage(makePng(400, 300)), {
      annotationsSvg: annotations,
    });

    // Re-parse the output PNG IHDRs to confirm sizes propagated.
    const smallW = readIHDRWidth(small);
    const largeW = readIHDRWidth(large);
    expect(smallW).toBe(100);
    expect(largeW).toBe(400);
  });

  it("passes fullPage option through to page.screenshot", async () => {
    const annotator = createAnnotator();
    const captured: Array<{ fullPage?: boolean } | undefined> = [];
    const png = makePng(50, 50);
    const page: PageLike = {
      screenshot: async (opts?: { fullPage?: boolean }) => {
        captured.push(opts);
        return png;
      },
    };

    await annotateScreenshot(annotator, page, {
      annotationsSvg: "",
      fullPage: true,
    });
    expect(captured).toEqual([{ fullPage: true }]);

    await annotateScreenshot(annotator, page, { annotationsSvg: "" });
    expect(captured[1]).toEqual({ fullPage: undefined });
  });

  it("accepts the DSL flavour (annotations: BboxAnnotation[])", async () => {
    const annotator = createAnnotator();
    const page = makeStubPage(makePng(300, 200));
    const result = await annotateScreenshot(annotator, page, {
      annotations: [
        { type: "rect", bbox: { x: 10, y: 10, width: 80, height: 60 }, intent: "error" },
        {
          type: "callout",
          at: { x: 100, y: 100 },
          targetBbox: { x: 10, y: 10, width: 80, height: 60 },
          content: "Failing here",
        },
      ],
    });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.slice(0, 8))).toEqual(Array.from(PNG_MAGIC));
    expect(readIHDRWidth(result)).toBe(300);
  });

  it("empty DSL annotations[] renders the screenshot unchanged-ish", async () => {
    const annotator = createAnnotator();
    const page = makeStubPage(makePng(100, 80));
    const result = await annotateScreenshot(annotator, page, {
      annotations: [],
    });
    expect(result.length).toBeGreaterThan(100);
    expect(readIHDRWidth(result)).toBe(100);
  });

  it("throws on too-small input (sub-IHDR-length bytes)", async () => {
    const annotator = createAnnotator();
    const bogus = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // 4 bytes
    const page: PageLike = {
      screenshot: async () => bogus,
    };
    await expect(annotateScreenshot(annotator, page, { annotationsSvg: "" })).rejects.toThrow(
      /IHDR/,
    );
  });
});

function readIHDRWidth(png: Uint8Array): number {
  return new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(16, false);
}
