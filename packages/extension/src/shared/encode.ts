/**
 * Extension-side adapter for the shared image encoder.
 *
 * Maps the extension's `Settings.quality` shape to the core encode
 * options. The actual encoder (libimagequant WASM + UPNG.js) lives in
 * `@ingcreators/annot-core/encode` so both the extension and the Annot web
 * app share one canonical implementation.
 */
import { type EncodeResult, encodeCapture as coreEncode } from "@ingcreators/annot-core/encode";
import type { Settings } from "./settings.js";

export type { EncodeResult };

/** Encode per current extension settings. */
export function encodeCapture(pngDataUrl: string, settings: Settings): Promise<EncodeResult> {
  return coreEncode(pngDataUrl, {
    format: settings.quality.format,
    smartFallback: settings.quality.smartFallback,
    smartColorThreshold: settings.quality.smartColorThreshold,
    jpegPercent: settings.quality.jpegPercent,
  });
}
