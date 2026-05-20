// Destructive redaction burn — load a PNG, paint solid / mosaic /
// blur over the listed regions, return a new PNG with the
// original pixels under each region irrecoverably replaced.
//
// Phase 4 of `docs/plans/agent-mcp-integration.md`. Mirrors the
// in-editor `burnRedactionsIntoBitmap` (Tier C-render) but lives
// in pure Node — `@napi-rs/canvas` is the canvas substitute. The
// algorithm is the same:
//
//   solid:  ctx.fillRect with the requested colour
//   mosaic: nearest-neighbour downsample to a low-res offscreen,
//           then drawImage back at original size with smoothing
//           disabled (gives the classic pixelated bar)
//   blur:   `ctx.filter = "blur(Npx)"` + drawImage of the source
//           clipped to the region
//
// Output is encoded as PNG and returned as `Uint8Array`.

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

import type { BBox, RedactStyle } from "../dsl/types.js";

export interface RedactRegion {
  bbox: BBox;
  style?: RedactStyle;
  color?: string;
}

const DEFAULT_STYLE: RedactStyle = "solid";
const DEFAULT_SOLID_COLOR = "#000000";
/** Mosaic block size in pixels. Matches the editor default. */
const MOSAIC_BLOCK_PX = 16;
/** Blur radius in pixels. Matches the editor default. */
const BLUR_RADIUS_PX = 12;

/**
 * Burn redactions into a PNG buffer. Returns a new PNG with the
 * regions painted over the source pixels.
 *
 * Regions are processed in order; later regions overlay earlier
 * ones (no automatic deduplication or alpha-blending).
 */
export async function burnRedactions(
  pngBytes: Uint8Array,
  regions: readonly RedactRegion[],
): Promise<Uint8Array> {
  if (regions.length === 0) {
    // Nothing to burn — return the input bytes verbatim so the
    // caller doesn't pay the encode cost.
    return pngBytes;
  }
  const image = await loadImage(Buffer.from(pngBytes));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  for (const region of regions) {
    if (region.bbox.width <= 0 || region.bbox.height <= 0) continue;
    const style = region.style ?? DEFAULT_STYLE;
    switch (style) {
      case "solid":
        paintSolid(ctx, region.bbox, region.color ?? DEFAULT_SOLID_COLOR);
        break;
      case "mosaic":
        paintMosaic(ctx, image, region.bbox);
        break;
      case "blur":
        paintBlur(ctx, image, region.bbox);
        break;
    }
  }
  const buffer = canvas.toBuffer("image/png");
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function paintSolid(ctx: SKRSContext2D, bbox: BBox, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
  ctx.restore();
}

function paintMosaic(
  ctx: SKRSContext2D,
  source: Awaited<ReturnType<typeof loadImage>>,
  bbox: BBox,
): void {
  // Downsample the region into a tiny offscreen canvas, then
  // upsample it back into the visible canvas with smoothing
  // disabled. This is the classic "pixelate" effect.
  const downW = Math.max(1, Math.round(bbox.width / MOSAIC_BLOCK_PX));
  const downH = Math.max(1, Math.round(bbox.height / MOSAIC_BLOCK_PX));
  const off = createCanvas(downW, downH);
  const offCtx = off.getContext("2d");
  offCtx.imageSmoothingEnabled = false;
  offCtx.drawImage(source, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, downW, downH);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, downW, downH, bbox.x, bbox.y, bbox.width, bbox.height);
  ctx.restore();
}

function paintBlur(
  ctx: SKRSContext2D,
  source: Awaited<ReturnType<typeof loadImage>>,
  bbox: BBox,
): void {
  // Clip to the region and draw the full source with the blur
  // filter on. Restricting via `clip()` keeps the blur from
  // bleeding into adjacent regions.
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.x, bbox.y, bbox.width, bbox.height);
  ctx.clip();
  ctx.filter = `blur(${BLUR_RADIUS_PX}px)`;
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}
