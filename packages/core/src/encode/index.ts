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
import init, { quantize_image } from "@ingcreators/annot-imagequant";
import {
  computeResizeTarget,
  DEFAULT_ENCODE_OPTIONS,
  type EncodeOptions,
  type EncodeResult,
} from "./options.js";
import { encodePng8 } from "./png8.js";

export {
  computeResizeTarget,
  DEFAULT_ENCODE_OPTIONS,
  type EncodeFormat,
  type EncodeOptions,
  type EncodeResult,
  SAVE_SIZE_LABEL,
  SAVE_SIZE_MAX_WIDTH,
  type SaveSizePreset,
} from "./options.js";

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
  // `saveSizePreset` is optional on the interface (backward-compat
  // for callers that don't surface the knob yet, e.g. the Browser
  // Extension); `undefined` means "no resize". Web app's
  // `loadEncodeOptions()` always populates it from
  // `DEFAULT_ENCODE_OPTIONS.saveSizePreset` ("standard").
  const saveSizePreset = options.saveSizePreset ?? "original";

  // Fast path: lossless PNG passthrough only when we don't need a
  // resize. With `saveSizePreset` set, we always have to decode +
  // redraw onto the smaller canvas to actually shrink the bytes.
  if (format === "png" && saveSizePreset === "original") {
    return { dataUrl: pngDataUrl, chosen: "png" };
  }

  const bmp = await dataUrlToBitmap(pngDataUrl);
  const target = computeResizeTarget(bmp.width, bmp.height, saveSizePreset);
  const w = target.width;
  const h = target.height;

  // Same fast path again, post-decode: PNG with no actual scale needed
  // (source narrower than the preset cap) — we can hand back the
  // original bytes instead of re-encoding via canvas.
  if (format === "png" && !target.scaled) {
    bmp.close();
    return { dataUrl: pngDataUrl, chosen: "png", width: w, height: h };
  }

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  // High-quality down-scale — `image-rendering: smooth` equivalent.
  // Default `imageSmoothingEnabled` is true; we explicitly bump
  // quality to "high" so the bicubic-ish path is preferred over the
  // browser's bilinear default.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);

  if (format === "jpeg") {
    const dataUrl = await canvasToDataUrl(canvas, "image/jpeg", jpegPercent / 100);
    bmp.close();
    return { dataUrl, chosen: "jpeg", width: w, height: h };
  }

  if (format === "png") {
    // PNG explicit + we hit the resize path → re-encode at the new
    // dimensions as PNG-24 (no smart logic by definition).
    const dataUrl = await canvasToDataUrl(canvas, "image/png", 1);
    bmp.close();
    return { dataUrl, chosen: "png", width: w, height: h };
  }

  // format === "smart"
  const pixelCount = w * h;
  if (pixelCount > MAX_SMART_PIXELS) {
    // Resize-then-fall-through: if the resize knocked us under the
    // cap, we'd already have a smaller canvas; if not, encode the
    // resized canvas as PNG-24 instead of returning the unscaled
    // input.
    const dataUrl = target.scaled ? await canvasToDataUrl(canvas, "image/png", 1) : pngDataUrl;
    bmp.close();
    return { dataUrl, chosen: "png", reason: "too-large-for-png8", width: w, height: h };
  }

  const imageData = ctx.getImageData(0, 0, w, h);
  const photoHeavy = isPhotoHeavy(imageData.data, smartColorThreshold);
  if (photoHeavy) {
    if (smartFallback === "jpeg") {
      const dataUrl = await canvasToDataUrl(canvas, "image/jpeg", jpegPercent / 100);
      bmp.close();
      return { dataUrl, chosen: "jpeg", reason: "photo-fallback-jpeg", width: w, height: h };
    }
    // PNG fallback: hand back the resized canvas as PNG-24, OR the
    // original bytes when no resize happened.
    const dataUrl = target.scaled ? await canvasToDataUrl(canvas, "image/png", 1) : pngDataUrl;
    bmp.close();
    return { dataUrl, chosen: "png", reason: "photo-fallback-png", width: w, height: h };
  }

  // UI-heavy → quantize with libimagequant (WASM) → emit PNG-8.
  try {
    const png8Bytes = await quantizeToPng8(imageData);
    bmp.close();
    const dataUrl = await blobToDataUrl(new Blob([png8Bytes as BlobPart], { type: "image/png" }));
    return { dataUrl, chosen: "png", reason: "png-8", width: w, height: h };
  } catch (e) {
    console.warn("[encode] PNG-8 quantization failed, falling back to PNG-24:", e);
    const dataUrl = target.scaled ? await canvasToDataUrl(canvas, "image/png", 1) : pngDataUrl;
    bmp.close();
    return { dataUrl, chosen: "png", reason: "quantize-failed", width: w, height: h };
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

  // The `@ingcreators/annot-imagequant` wasm-bindgen binding returns
  // `{ palette: Uint8Array, indices: Uint8Array }` — palette is
  // flattened RGBA bytes, indices is one byte per pixel. Arrays are
  // already standalone copies of the WASM-allocated buffers (the
  // wrapper does the `Uint8Array::copy_from` itself), so no extra
  // slice() is needed at the call site.
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
