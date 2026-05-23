// PNG diff via `pixelmatch`. Produces a mask buffer of per-pixel
// differences AND a list of contiguous changed-region bboxes the
// caller can hand straight to the SVG-conversion path.
//
// Phase 3i of `docs/plans/living-spec-authoring-roadmap.md`
// (Phase 3 follow-up #2). Relocated from
// `packages/mcp/src/compare/diff.ts` — the function is pure
// (`pngBytes + pngBytes → DiffResult`) with no MCP-specific
// surface, so it lives in `@ingcreators/annot-annotator` (the
// canonical Node-side raster home, alongside the relocated
// `burnRedactions` from 3e and the encode pipeline). MCP keeps
// its existing public API via a re-export from this module.
//
// Originally Phase 5 of `docs/plans/_done/agent-mcp-integration.md`.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import pixelmatch from "pixelmatch";

import { aggregateDiffRegions } from "./diff-aggregate.js";
import type { BBox } from "./dsl/types.js";

export interface DiffResult {
  /** Number of mismatched pixels. */
  mismatchedPixels: number;
  /** Bounding boxes of contiguous changed regions. */
  regions: BBox[];
  /** Dimensions of the input pair. */
  width: number;
  height: number;
}

export interface DiffOptions {
  /** Matching threshold (0 to 1); smaller is more sensitive. */
  threshold?: number;
}

export class DimensionMismatchError extends Error {
  constructor(a: { width: number; height: number }, b: { width: number; height: number }) {
    super(
      "Cannot compare screenshots of different dimensions: " +
        `before is ${a.width}×${a.height}, after is ${b.width}×${b.height}.`,
    );
    this.name = "DimensionMismatchError";
  }
}

/**
 * Compare two PNGs pixel-by-pixel and return the changed-region
 * bboxes. Throws `DimensionMismatchError` when the inputs have
 * different sizes — the caller has to capture both at the same
 * viewport for the comparison to make sense.
 */
export async function diffScreenshots(
  before: Uint8Array,
  after: Uint8Array,
  options: DiffOptions = {},
): Promise<DiffResult> {
  const [beforeImage, afterImage] = await Promise.all([
    loadImage(Buffer.from(before)),
    loadImage(Buffer.from(after)),
  ]);
  if (beforeImage.width !== afterImage.width || beforeImage.height !== afterImage.height) {
    throw new DimensionMismatchError(
      { width: beforeImage.width, height: beforeImage.height },
      { width: afterImage.width, height: afterImage.height },
    );
  }
  const { width, height } = beforeImage;
  const beforePixels = imageToRgba(beforeImage, width, height);
  const afterPixels = imageToRgba(afterImage, width, height);
  const diffPixels = new Uint8Array(width * height * 4);
  const mismatchedPixels = pixelmatch(beforePixels, afterPixels, diffPixels, width, height, {
    threshold: options.threshold ?? 0.1,
    includeAA: false,
    diffMask: true,
  });
  const regions = aggregateDiffRegions(diffPixels, width, height);
  return { mismatchedPixels, regions, width, height };
}

function imageToRgba(
  image: Awaited<ReturnType<typeof loadImage>>,
  width: number,
  height: number,
): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
