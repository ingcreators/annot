/**
 * Encode option types + defaults — split out of `./index.ts` so callers
 * that only need the data shape (e.g. the web app's preferences
 * loader) can import this leaf without dragging in the WASM
 * imagequant binding that `encodeCapture` requires. Keeps the
 * encoder lazy-loadable as a separate chunk.
 */

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
