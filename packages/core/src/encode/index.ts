/**
 * Post-capture image encoder — shared between `@ingcreators/annot-extension`
 * and `@ingcreators/annot-web`.
 *
 * Given a PNG data URL, produce a final encoded image per `EncodeOptions`:
 *
 *   - "png"  : pass through (already lossless PNG-24).
 *   - "jpeg" : re-encode via OffscreenCanvas → JPEG.
 *   - "smart":
 *       - Sample unique-color count. If photo-heavy, apply `smartFallback`.
 *       - Otherwise quantize to 256 colors via libimagequant (WASM port,
 *         same core as `pngquant`) and emit a true PNG-8 palette file.
 *
 * libimagequant (Wu + NeuQuant + Floyd-Steinberg) gives much better
 * quantization than pure-JS libraries. Its palette + per-pixel indices
 * are written directly into a PNG-8 file via a small in-house encoder
 * (Pako DEFLATE level 9) — no re-quantization, no RGBA round-trip.
 */
import init, { quantize_image } from "@panda-ai/imagequant";
import { encodePng8 } from "./png8.js";

export type EncodeFormat = "smart" | "png" | "jpeg";

export interface EncodeOptions {
  /** "smart" | "png" | "jpeg" */
  format: EncodeFormat;
  /** Fallback format used by "smart" mode when the image is photo-heavy. */
  smartFallback: "png" | "jpeg";
  /**
   * Heuristic: if a sampled pixel pass finds more unique RGBA colors than
   * this threshold, treat the image as photo-heavy and skip PNG-8.
   * Typical UI screenshots return <5000; photo-heavy pages return >20000.
   */
  smartColorThreshold: number;
  /** JPEG quality 60–100 (%). Used for "jpeg" and smart's JPEG fallback. */
  jpegPercent: number;
}

export const DEFAULT_ENCODE_OPTIONS: EncodeOptions = {
  format: "smart",
  smartFallback: "png",
  smartColorThreshold: 15000,
  jpegPercent: 92,
};

export interface EncodeResult {
  dataUrl: string;
  /** Actual format chosen (may differ from requested in "smart" mode). */
  chosen: "png" | "jpeg";
  /** Human-readable note (e.g. "png-8", "photo-fallback") — useful for logs. */
  reason?: string;
}

/**
 * Upper bound on images we attempt to PNG-8-quantize. libimagequant's
 * Wu algorithm copies the image into WASM memory, so very tall scroll
 * captures (e.g. 1920×15000 = 28.8M) would allocate >115 MB *twice* and
 * dominate the capture time. Above this we fall back to lossless PNG.
 */
const MAX_SMART_PIXELS = 10_000_000; // ~4K display or a 1920×5200 scrollshot

/** Encode a PNG data URL per the given options. */
export async function encodeCapture(
  pngDataUrl: string,
  options: EncodeOptions = DEFAULT_ENCODE_OPTIONS,
): Promise<EncodeResult> {
  const { format, jpegPercent, smartFallback, smartColorThreshold } = options;

  if (format === "png") {
    return { dataUrl: pngDataUrl, chosen: "png" };
  }

  const bmp = await dataUrlToBitmap(pngDataUrl);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);

  const w = bmp.width;
  const h = bmp.height;

  if (format === "jpeg") {
    const dataUrl = await canvasToDataUrl(canvas, "image/jpeg", jpegPercent / 100);
    bmp.close();
    console.log(`[encode] JPEG ${w}x${h} q=${jpegPercent}% → ${(dataUrl.length * 0.75 / 1024).toFixed(1)} KB (~)`);
    return { dataUrl, chosen: "jpeg" };
  }

  // format === "smart"
  const pixelCount = w * h;
  if (pixelCount > MAX_SMART_PIXELS) {
    bmp.close();
    return { dataUrl: pngDataUrl, chosen: "png", reason: "too-large-for-png8" };
  }

  const imageData = ctx.getImageData(0, 0, w, h);
  const photoHeavy = isPhotoHeavy(imageData.data, smartColorThreshold);
  if (photoHeavy) {
    if (smartFallback === "jpeg") {
      const dataUrl = await canvasToDataUrl(canvas, "image/jpeg", jpegPercent / 100);
      bmp.close();
      console.log(`[encode] photo-fallback JPEG ${w}x${h} → ${(dataUrl.length * 0.75 / 1024).toFixed(1)} KB`);
      return { dataUrl, chosen: "jpeg", reason: "photo-fallback-jpeg" };
    }
    bmp.close();
    console.log(`[encode] photo-fallback PNG-24 ${w}x${h} → ${(pngDataUrl.length * 0.75 / 1024).toFixed(1)} KB`);
    return { dataUrl: pngDataUrl, chosen: "png", reason: "photo-fallback-png" };
  }

  // UI-heavy → quantize with libimagequant (WASM) → emit PNG-8.
  try {
    const png8Bytes = await quantizeToPng8(imageData);
    bmp.close();
    const dataUrl = await blobToDataUrl(
      new Blob([png8Bytes as BlobPart], { type: "image/png" }),
    );
    console.log(`[encode] PNG-8 ${w}x${h} → ${(png8Bytes.byteLength / 1024).toFixed(1)} KB`);
    return { dataUrl, chosen: "png", reason: "png-8" };
  } catch (e) {
    console.warn("[encode] PNG-8 quantization failed, falling back to PNG-24:", e);
    bmp.close();
    return { dataUrl: pngDataUrl, chosen: "png", reason: "quantize-failed" };
  }
}

// ---- libimagequant (WASM) ----

interface WasmExports {
  memory: WebAssembly.Memory;
}
let wasmPromise: Promise<WasmExports> | null = null;
function ensureWasm(): Promise<WasmExports> {
  if (!wasmPromise) {
    wasmPromise = (init() as Promise<WasmExports>).catch((e) => {
      wasmPromise = null;
      throw e;
    });
  }
  return wasmPromise;
}

/**
 * Quantize an RGBA ImageData to ≤256 colors with libimagequant, then
 * write the palette + per-pixel indices straight into a PNG-8 file via
 * our minimal encoder (Pako DEFLATE level 9). No re-quantization or
 * RGBA round-trip — libimagequant's palette is preserved 1:1 and the
 * file is compressed with the strongest setting available.
 */
async function quantizeToPng8(imageData: ImageData): Promise<Uint8Array> {
  await ensureWasm();
  const w = imageData.width;
  const h = imageData.height;

  const pixels = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  );
  const result: any = quantize_image(pixels, w, h, 256);

  // The `@panda-ai/imagequant` wasm-bindgen binding returns a plain object
  // `{ palette: Uint8Array, indices: Uint8Array }` (NOT the QuantResult
  // class shown in the .d.ts — that class is never instantiated by the
  // generated JS). The arrays are already standalone copies of the
  // WASM-allocated buffers, so no extra slice() is needed.
  const palette: Uint8Array = result?.palette;
  const indices: Uint8Array = result?.indices;

  if (!(palette instanceof Uint8Array) || !(indices instanceof Uint8Array)) {
    throw new Error(
      `quantize_image returned unexpected shape: keys=${Object.keys(result || {}).join(",")} ` +
      `palette=${typeof palette} indices=${typeof indices}`,
    );
  }

  return encodePng8(palette, indices, w, h, 9);
}

// ---- Heuristic: is this image photo-heavy? ----

function isPhotoHeavy(data: Uint8ClampedArray, threshold: number): boolean {
  const view = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >>> 2);
  const total = view.length;
  if (total === 0) return false;

  const sampleTarget = 50000;
  const stride = Math.max(1, Math.floor(total / sampleTarget));
  const seen = new Set<number>();
  for (let i = 0; i < total; i += stride) {
    seen.add(view[i]!);
    if (seen.size > threshold) return true;
  }
  return false;
}

// ---- Helpers ----

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

async function canvasToDataUrl(
  canvas: OffscreenCanvas,
  type: string,
  quality: number,
): Promise<string> {
  const blob = await canvas.convertToBlob({ type, quality });
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
