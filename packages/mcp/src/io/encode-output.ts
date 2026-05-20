// Shared helper for the five MCP tools that emit images. Wraps
// `@ingcreators/annot-annotator`'s encode pipeline behind a single
// entry point so every tool's "optional `encode` input" wiring
// looks the same.
//
// The pattern:
//
//   const final = await applyEncodeOptions(
//     pngBytes,                  // image bytes emitted by the tool
//     dimensions,                // tool-known width × height
//     input.encode,              // agent's partial EncodeOptions
//   );
//   // → { bytes, chosen, reason?, width, height, mimeType }
//
// When the agent omits `encode`, this short-circuits and returns
// the input bytes verbatim with `mimeType: "image/png"` and the
// known dimensions. No decode/encode round-trip in the
// fast-passthrough case.

import {
  DEFAULT_ENCODE_OPTIONS,
  decodeAndEncodeImage,
  type EncodeOptions,
  type EncodeResult,
} from "@ingcreators/annot-annotator";

export interface EncodedToolOutput {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  chosen: "png" | "jpeg";
  width: number;
  height: number;
  reason?: string;
}

/**
 * Apply the agent-provided `encode` options to a PNG byte stream
 * the tool just produced. Returns the original bytes verbatim
 * when no options are passed (the fast path for back-compat).
 */
export async function applyEncodeOptions(
  pngBytes: Uint8Array,
  dimensions: { width: number; height: number },
  encode: Partial<EncodeOptions> | undefined,
): Promise<EncodedToolOutput> {
  if (!encode || Object.keys(encode).length === 0) {
    return {
      bytes: pngBytes,
      mimeType: "image/png",
      chosen: "png",
      width: dimensions.width,
      height: dimensions.height,
    };
  }
  const options: EncodeOptions = { ...DEFAULT_ENCODE_OPTIONS, ...encode };
  const result: EncodeResult = await decodeAndEncodeImage(pngBytes, options);
  return {
    bytes: result.bytes,
    mimeType: result.chosen === "jpeg" ? "image/jpeg" : "image/png",
    chosen: result.chosen,
    width: result.width,
    height: result.height,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

/**
 * Apply the agent-provided `encode` options to RGBA bytes (rather
 * than already-encoded PNG bytes). Used by the annotate tools that
 * go through `annotator.toEncoded()` directly — but currently
 * unused because the tools opt for the "encode the PNG output"
 * path via {@link applyEncodeOptions} for code uniformity.
 *
 * Exported for power callers who want to drive the pipeline
 * themselves.
 */
export { decodeAndEncodeImage } from "@ingcreators/annot-annotator";
