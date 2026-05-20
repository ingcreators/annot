// `encodeRgba(rgba, w, h, options)` — Node-side orchestration of
// the smart / png / jpeg / saveSize encoding pipeline. Mirrors
// `@ingcreators/annot-core/encode`'s decision tree but runs in
// pure Node via `@napi-rs/canvas` (decoding + resize + JPEG) and
// the optional `@ingcreators/annot-imagequant` WASM (PNG-8
// quantization).
//
// Inputs:
//
//   - `rgba`     Raw RGBA8 pixel data, length `width * height * 4`.
//                Typically the `pixels` field of `resvg.render()`.
//   - `width`    Source bitmap width in pixels.
//   - `height`   Source bitmap height in pixels.
//   - `options`  Subset of the shared `EncodeOptions`. Defaults
//                match the browser-side `DEFAULT_ENCODE_OPTIONS`.

import {
  computeResizeTarget,
  DEFAULT_ENCODE_OPTIONS,
  type EncodeOptions,
} from "@ingcreators/annot-core/encode/options";
import { createCanvas } from "@napi-rs/canvas";

import type { EncodeResult } from "./options.js";
import { isPhotoHeavy, quantizeRgbaToPng8 } from "./quantize.js";

/**
 * Upper bound on images we attempt to PNG-8-quantize. Matches the
 * browser-side cap — libimagequant's Wu algorithm copies the image
 * twice into WASM memory, and a 1920×5200 scroll capture is the
 * largest we want to incur that cost on. Above this we fall back
 * to PNG-32.
 */
const MAX_SMART_PIXELS = 10_000_000;

/**
 * Encode raw RGBA pixels per the requested {@link EncodeOptions}.
 *
 * Algorithm (mirrors the browser-side pipeline):
 *
 *   1. Resize the source via `saveSizePreset` (aspect-preserving;
 *      never upscale).
 *   2. Branch on `format`:
 *        - `"png"`  → PNG-32 encode (lossless).
 *        - `"jpeg"` → JPEG encode at `jpegPercent`.
 *        - `"smart"`:
 *            - If pixel count > `MAX_SMART_PIXELS`, return PNG-32
 *              with `reason: "too-large-for-png8"`.
 *            - Sample unique-colour count via {@link isPhotoHeavy}.
 *              If photo-heavy, emit `smartFallback` (PNG-32 or
 *              JPEG) with reason `"photo-fallback-*"`.
 *            - Otherwise quantize to ≤256 colours via libimagequant
 *              (if installed) and emit PNG-8 with reason `"png-8"`.
 *              When the optional imagequant WASM isn't installed,
 *              fall back to PNG-32 with `reason: "imagequant-missing"`.
 */
export async function encodeRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: EncodeOptions = DEFAULT_ENCODE_OPTIONS,
): Promise<EncodeResult> {
  const saveSizePreset = options.saveSizePreset ?? "original";
  const target = computeResizeTarget(width, height, saveSizePreset);

  const resized = target.scaled
    ? resizeRgba(rgba, width, height, target.width, target.height)
    : rgba;
  const w = target.width;
  const h = target.height;

  if (options.format === "png") {
    return { bytes: encodePng32(resized, w, h), chosen: "png", width: w, height: h };
  }

  if (options.format === "jpeg") {
    return {
      bytes: encodeJpeg(resized, w, h, options.jpegPercent / 100),
      chosen: "jpeg",
      width: w,
      height: h,
    };
  }

  // format === "smart"
  const pixelCount = w * h;
  if (pixelCount > MAX_SMART_PIXELS) {
    return {
      bytes: encodePng32(resized, w, h),
      chosen: "png",
      reason: "too-large-for-png8",
      width: w,
      height: h,
    };
  }

  if (isPhotoHeavy(resized, options.smartColorThreshold)) {
    if (options.smartFallback === "jpeg") {
      return {
        bytes: encodeJpeg(resized, w, h, options.jpegPercent / 100),
        chosen: "jpeg",
        reason: "photo-fallback-jpeg",
        width: w,
        height: h,
      };
    }
    return {
      bytes: encodePng32(resized, w, h),
      chosen: "png",
      reason: "photo-fallback-png",
      width: w,
      height: h,
    };
  }

  // UI-heavy → try PNG-8 via imagequant.
  const png8 = await quantizeRgbaToPng8(resized, w, h);
  if (png8) {
    return { bytes: png8, chosen: "png", reason: "png-8", width: w, height: h };
  }
  // Imagequant not installed — fall back to PNG-32.
  return {
    bytes: encodePng32(resized, w, h),
    chosen: "png",
    reason: "imagequant-missing",
    width: w,
    height: h,
  };
}

// ─── helpers ────────────────────────────────────────────────────

/**
 * Encode raw RGBA pixels as PNG-32 (truecolor + alpha, 8-bit) via
 * `@napi-rs/canvas`. The canvas accepts the RGBA buffer through
 * `putImageData` and `toBuffer("image/png")` does the encode.
 */
function encodePng32(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  const buf = canvas.toBuffer("image/png");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** JPEG encode at the requested quality (0–1). */
function encodeJpeg(rgba: Uint8Array, width: number, height: number, quality: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  const buf = canvas.toBuffer("image/jpeg", quality);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Aspect-preserving bicubic-ish resize via `@napi-rs/canvas`. We
 * draw the source into an `ImageData`-backed canvas, then
 * `drawImage` onto a smaller canvas with `imageSmoothingEnabled =
 * true` + `imageSmoothingQuality = "high"`. Returns the resized
 * RGBA buffer at `(targetW × targetH × 4)` bytes.
 */
function resizeRgba(
  rgba: Uint8Array,
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): Uint8Array {
  const sourceCanvas = createCanvas(sourceW, sourceH);
  const sourceCtx = sourceCanvas.getContext("2d");
  const sourceImage = sourceCtx.createImageData(sourceW, sourceH);
  sourceImage.data.set(rgba);
  sourceCtx.putImageData(sourceImage, 0, 0);

  const targetCanvas = createCanvas(targetW, targetH);
  const targetCtx = targetCanvas.getContext("2d");
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = "high";
  targetCtx.drawImage(sourceCanvas, 0, 0, sourceW, sourceH, 0, 0, targetW, targetH);

  const resizedImage = targetCtx.getImageData(0, 0, targetW, targetH);
  const data = resizedImage.data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
