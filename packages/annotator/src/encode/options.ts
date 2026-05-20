// Re-export the shared encode option types from
// `@ingcreators/annot-core/encode/options` so the annotator's
// public API uses the same vocabulary as the rest of the Annot
// ecosystem (Chrome extension, web app capture pipeline).
//
// The Node-side implementation lives in this package
// (`packages/annotator/src/encode/`); the BROWSER-side
// implementation lives in `@ingcreators/annot-core/encode`.

export type {
  EncodeFormat,
  EncodeOptions,
  EncodeResult as BrowserEncodeResult,
  SaveSizePreset,
} from "@ingcreators/annot-core/encode/options";

export {
  computeResizeTarget,
  DEFAULT_ENCODE_OPTIONS,
  SAVE_SIZE_LABEL,
  SAVE_SIZE_MAX_WIDTH,
} from "@ingcreators/annot-core/encode/options";

/**
 * Node-side encode result. Returns raw bytes (vs the browser-side
 * counterpart returning a `data:` URL string) — agents and test
 * runtimes typically want bytes to attach to GitHub issues / test
 * reports / write to disk.
 */
export interface EncodeResult {
  /** Encoded image bytes (PNG-8 / PNG-32 / JPEG depending on `chosen`). */
  bytes: Uint8Array;
  /** Actual format chosen (may differ from requested in smart mode). */
  chosen: "png" | "jpeg";
  /** Human-readable note (`"png-8"` / `"photo-fallback-jpeg"` / …). */
  reason?: string;
  /** Final pixel dimensions after `saveSizePreset` resize. */
  width: number;
  height: number;
}
