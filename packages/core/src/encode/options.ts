/**
 * Encode option types + defaults — split out of `./index.ts` so
 * callers that only need the data shape (e.g. the web app's
 * preferences loader) can import this leaf without dragging in
 * the heavier encoder + quantizer module that `encodeCapture`
 * requires. Keeps the encoder lazy-loadable as a separate chunk.
 */

export type EncodeFormat = "smart" | "png" | "jpeg";

/**
 * Save size presets — apply a max-width cap to the image before
 * encoding so 4K screenshots don't end up as 5–10 MB files.
 * Values match the spec in
 * `docs/plans/_done/web-capture-redesign.md`'s "Deferred" item.
 *
 * Aspect ratio is preserved; height scales proportionally. Images
 * narrower than the preset's max-width pass through unscaled (we
 * never upscale).
 */
export type SaveSizePreset = "light" | "standard" | "highQuality" | "original";

/** Mapping from preset → max-width in pixels (`null` = no resize). */
export const SAVE_SIZE_MAX_WIDTH: Record<SaveSizePreset, number | null> = {
  light: 1280,
  standard: 1920,
  highQuality: 2560,
  original: null,
};

/** Human-readable label for the preset, used by the dialog selector
 *  + the (future) extension settings UI. Shared so both surfaces
 *  speak the same language. */
export const SAVE_SIZE_LABEL: Record<SaveSizePreset, string> = {
  light: "Light (1280px)",
  standard: "Standard (1920px)",
  highQuality: "High Quality (2560px)",
  original: "Original",
};

/**
 * Quantizer backend for PNG-8 smart-mode encoding.
 *
 * Both values currently resolve to the in-tree pure-TS Median Cut
 * + Floyd–Steinberg dither at
 * [`quantize-median-cut.ts`](./quantize-median-cut.ts). The
 * `"wasm"` value is retained for back-compat with the Phase 1
 * feature flag so consumers that persisted `quantizer: "wasm"` to
 * localStorage keep working unchanged.
 *
 * Phase 2 of
 * [`docs/plans/_done/replace-libimagequant-with-median-cut.md`](../../../../docs/plans/_done/replace-libimagequant-with-median-cut.md)
 * flipped the default to Median Cut and removed the WASM init
 * path. Phase 4 deletes the `@ingcreators/annot-imagequant`
 * workspace package and removes this field entirely.
 */
export type Quantizer = "wasm" | "median-cut";

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
  /**
   * Cap the encoded image's max width per
   * {@link SAVE_SIZE_MAX_WIDTH}. Aspect-preserving down-scale; no
   * upscale when the source is already narrower.
   *
   * Optional on the interface so existing callers that don't
   * surface this knob (today: the Browser Extension's capture
   * pipeline at `@ingcreators/annot-capture/shared/encode`) keep
   * compiling without changes — `encodeCapture` treats `undefined`
   * as `"original"` (no resize, identical pre-feature behaviour).
   *
   * `DEFAULT_ENCODE_OPTIONS` sets it to `"standard"` (1920px),
   * which the Annot Web app's encode-options loader uses by
   * default. Future extension settings UI work will wire its own
   * `Settings.quality.saveSizePreset` field here.
   */
  saveSizePreset?: SaveSizePreset;
  /**
   * Quantizer backend used by smart-mode PNG-8 output. Optional;
   * both values resolve to the same Median Cut implementation
   * post-Phase 2. See {@link Quantizer}.
   */
  quantizer?: Quantizer;
}

export const DEFAULT_ENCODE_OPTIONS: EncodeOptions = {
  format: "smart",
  smartFallback: "png",
  smartColorThreshold: 15000,
  jpegPercent: 92,
  saveSizePreset: "standard",
  quantizer: "median-cut",
};

/** Compute the resize target for a given source size + preset.
 *  Returns the source dimensions unchanged when the preset is
 *  `"original"` or the source is already narrower than the cap.
 *  Pure helper — usable by both the encoder (during the
 *  re-encode pass) and the (future) extension settings UI for
 *  preview labels. */
export function computeResizeTarget(
  sourceWidth: number,
  sourceHeight: number,
  preset: SaveSizePreset,
): { width: number; height: number; scaled: boolean } {
  const maxWidth = SAVE_SIZE_MAX_WIDTH[preset];
  if (maxWidth === null || sourceWidth <= maxWidth) {
    return { width: sourceWidth, height: sourceHeight, scaled: false };
  }
  const scale = maxWidth / sourceWidth;
  return {
    width: maxWidth,
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scaled: true,
  };
}

export interface EncodeResult {
  dataUrl: string;
  /** Actual format chosen (may differ from requested in "smart" mode). */
  chosen: "png" | "jpeg";
  /** Human-readable note (e.g. "png-8", "photo-fallback") — useful for logs. */
  reason?: string;
  /** Final pixel dimensions of the encoded image. May differ from
   *  the input when `saveSizePreset` triggered a down-scale. */
  width?: number;
  height?: number;
}
