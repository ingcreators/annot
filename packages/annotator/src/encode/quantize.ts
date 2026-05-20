// Synchronous PNG-8 quantizer that drives `encodeRgba`'s smart-
// mode UI-heavy branch. Wraps the in-tree pure-TS Median Cut +
// Floyd–Steinberg dither (`@ingcreators/annot-core/encode/quantize-median-cut`)
// + the PNG-8 file encoder (`@ingcreators/annot-core/encode/png8`).
//
// Phase 3 of `docs/plans/_done/replace-libimagequant-with-median-cut.md`
// replaced the prior GPL-3.0 libimagequant WASM dependency. The
// previous dynamic-import boundary, the `isImagequantAvailable()`
// gate, and the `reason: "imagequant-missing"` graceful-fallback
// contract are gone — PNG-8 is now unconditionally available
// without GPL exposure.

import { encodePng8 } from "@ingcreators/annot-core/encode/png8";
import { quantizeMedianCut } from "@ingcreators/annot-core/encode/quantize-median-cut";

/**
 * Quantize RGBA pixels to ≤256 colours via Median Cut + Floyd–
 * Steinberg dither and emit a PNG-8 file.
 *
 * Synchronous, deterministic, GPL-free.
 */
export function quantizeRgbaToPng8(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const { palette, indices } = quantizeMedianCut(rgba, width, height, 256);
  return encodePng8(palette, indices, width, height, 9);
}

/**
 * Heuristic: does this image look photo-heavy?
 *
 * Samples ~50,000 pixels from the RGBA buffer (stride-walks rather
 * than reading every pixel — sufficient for the bimodal "UI vs
 * photo" decision). Returns `true` if the unique-color count
 * exceeds `threshold`. Typical UI screenshots return <5,000 unique
 * colours; pages with rich photography return >20,000.
 */
export function isPhotoHeavy(rgba: Uint8Array, threshold: number): boolean {
  // Each pixel is 4 bytes; pack into a uint32 for cheap Set membership.
  const view = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength >>> 2);
  const total = view.length;
  if (total === 0) return false;

  const sampleTarget = 50_000;
  const stride = Math.max(1, Math.floor(total / sampleTarget));
  const seen = new Set<number>();
  for (let i = 0; i < total; i += stride) {
    seen.add(view[i]!);
    if (seen.size > threshold) return true;
  }
  return false;
}
