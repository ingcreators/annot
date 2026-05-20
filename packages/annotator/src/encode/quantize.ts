// Dynamic-import boundary for the optional
// `@ingcreators/annot-imagequant` WASM. Because imagequant is
// GPL-3.0-licensed it ships as an `optionalDependencies` entry —
// users who want PNG-8 smart-mode encoding install it explicitly
// and accept the GPL obligations. Users who don't get a graceful
// fallback through this module's `quantizeRgbaToPng8` returning
// `null`, which the orchestrator handles by falling back to
// PNG-32 (or JPEG when `smartFallback === "jpeg"`).

import { encodePng8 } from "@ingcreators/annot-core/encode/png8";

/** Module-level singleton — cache the WASM init across calls. */
let wasmPromise: Promise<{
  quantize_image: (
    pixels: Uint8Array,
    width: number,
    height: number,
    maxColors: number,
  ) => { palette: Uint8Array; indices: Uint8Array };
} | null> | null = null;

async function ensureImagequant(): Promise<{
  quantize_image: (
    pixels: Uint8Array,
    width: number,
    height: number,
    maxColors: number,
  ) => { palette: Uint8Array; indices: Uint8Array };
} | null> {
  if (wasmPromise) return wasmPromise;
  wasmPromise = (async () => {
    try {
      const mod = (await import("@ingcreators/annot-imagequant")) as {
        default: () => Promise<unknown>;
        quantize_image: (
          pixels: Uint8Array,
          width: number,
          height: number,
          maxColors: number,
        ) => { palette: Uint8Array; indices: Uint8Array };
      };
      await mod.default();
      return { quantize_image: mod.quantize_image };
    } catch {
      // Optional dep not installed (or failed to load) — caller
      // falls back to a non-quantized path.
      return null;
    }
  })();
  return wasmPromise;
}

/**
 * Quantize RGBA pixels to ≤256 colours via libimagequant and emit
 * a PNG-8 file. Returns the encoded bytes, OR `null` if the
 * optional imagequant module isn't installed.
 *
 * The caller is responsible for falling back to a non-PNG-8 path
 * (PNG-32 or JPEG) when this returns `null`.
 */
export async function quantizeRgbaToPng8(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const mod = await ensureImagequant();
  if (!mod) return null;
  const result = mod.quantize_image(rgba, width, height, 256);
  if (!(result?.palette instanceof Uint8Array) || !(result?.indices instanceof Uint8Array)) {
    throw new Error("quantize_image returned an unexpected shape");
  }
  return encodePng8(result.palette, result.indices, width, height, 9);
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

/** Whether the optional imagequant WASM is available at runtime.
 *  Useful for callers that want to decide ahead of time whether to
 *  request `format: "smart"`. */
export async function isImagequantAvailable(): Promise<boolean> {
  return (await ensureImagequant()) !== null;
}
