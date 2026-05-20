/**
 * Capture-side adapter for the shared image encoder.
 *
 * Maps the `Settings.quality` shape to the core encode options. The
 * actual encoder (pure-TS Median Cut quantizer + Pako-DEFLATE PNG-8
 * writer) lives in `@ingcreators/annot-core/encode` so every host
 * shares one canonical implementation.
 */
import { encodeCapture as coreEncode, type EncodeResult } from "@ingcreators/annot-core/encode";
import type { Settings } from "./settings.js";

export type { EncodeResult };

/** Encode per current settings. */
export function encodeCapture(pngDataUrl: string, settings: Settings): Promise<EncodeResult> {
  return coreEncode(pngDataUrl, {
    format: settings.quality.format,
    smartFallback: settings.quality.smartFallback,
    smartColorThreshold: settings.quality.smartColorThreshold,
    jpegPercent: settings.quality.jpegPercent,
    saveSizePreset: settings.quality.saveSizePreset,
  });
}
