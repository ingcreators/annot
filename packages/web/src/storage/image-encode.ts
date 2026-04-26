/**
 * Single source of truth for the "encode an `ImageRecord` into a
 * re-editable XMP-bearing blob" pipeline. Used by every storage
 * backend that owns its own bytes (Browser / GitHub / Device /
 * Drive). The pipeline is dispatched by {@link pickEncodeStrategy}
 * across four cases:
 *
 *   render-and-encode  SVG present, format=png
 *                      → renderImageRecord(...) → encodeCaptureInWorker(...)
 *                        → fetch().blob() → createEditableImage(...)
 *   render-only        SVG present, format=jpg
 *                      → renderImageRecord(...) → fetch().blob()
 *                        → createEditableImage(...)
 *                      (JPEG is already small at q=92; the worker
 *                       re-encode is PNG-only.)
 *   source-only        No SVG (or trivially-empty SVG), source URL only
 *                      → fetch(originalDataUrl).blob() → createEditableImage(...)
 *   empty              Neither SVG nor source URL
 *                      → new Blob([]) → createEditableImage(...)
 *
 * Lifted out of `github-store.ts` (and its mirror copies in
 * `device-store.ts` / `google-drive-store.ts`) as the closing slice
 * of proposal 4. The four heavy dependencies (`renderImageRecord`,
 * `encodeCaptureInWorker`, `loadEncodeOptions`, `createEditableImage`)
 * are passed via a `BuildEditableImageDeps` object so tests can
 * stub them with `vi.fn()` and assert which branch was taken
 * without standing up the worker pipeline / annot-render canvas.
 *
 * Production callers use {@link DEFAULT_DEPS} which wires the real
 * imports; tests pass an alternative `deps` argument.
 */

import type { EncodeOptions, EncodeResult } from "@ingcreators/annot-core/encode";
import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { createEditableImage } from "@ingcreators/annot-core/xmp";
import { renderImageRecord } from "@ingcreators/annot-render";
import { loadEncodeOptions } from "../encode-options.js";
import { encodeCaptureInWorker } from "../workers/encode-client.js";

/**
 * `record.annotationsSvg` strings shorter than this are treated as
 * empty for encode-strategy purposes. Historical bug: legacy saved
 * records had `"<g/>"` (4 chars) or whitespace as their "no
 * annotations" sentinel; the 10-char floor catches those without
 * an explicit migration. Matches the historical literal in every
 * store's `#buildXmpBlob` body.
 */
export const ANNOTATIONS_SVG_MIN_CHARS = 10;

export type EncodeStrategy = "render-and-encode" | "render-only" | "source-only" | "empty";

/**
 * Pure decision: which of the 4 strategies should run for this
 * record + format combination. Doesn't touch any of the heavy
 * dependencies — easy to drive every branch under unit tests.
 */
export function pickEncodeStrategy(
  record: Partial<ImageRecord>,
  format: "jpg" | "png",
): EncodeStrategy {
  const hasSvg =
    !!record.annotationsSvg && record.annotationsSvg.length > ANNOTATIONS_SVG_MIN_CHARS;
  const hasSource = !!record.originalDataUrl;
  if (hasSvg && hasSource) {
    return format === "png" ? "render-and-encode" : "render-only";
  }
  if (hasSource) return "source-only";
  return "empty";
}

export interface BuildEditableImageDeps {
  /** Render the annotated overlay onto the source image. Mirrors
   *  `renderImageRecord` from `@ingcreators/annot-render`. */
  renderImageRecord: (
    originalDataUrl: string,
    annotationsSvg: string,
    width: number,
    height: number,
  ) => Promise<string>;
  /** Re-encode a rendered image. Mirrors `encodeCaptureInWorker`. */
  encodeCaptureInWorker: (dataUrl: string, opts: EncodeOptions) => Promise<EncodeResult>;
  /** Read encode options from settings storage. */
  loadEncodeOptions: () => EncodeOptions;
  /** Wrap the rendered blob with an XMP envelope. Mirrors
   *  `createEditableImage` from `@ingcreators/annot-core/xmp`. */
  createEditableImage: (opts: {
    renderedBlob: Blob;
    originalDataUrl: string;
    annotationsSvg: string;
    width: number;
    height: number;
    format: "jpg" | "png";
    tags: Record<string, string>;
  }) => Promise<Blob>;
}

/** Production wiring — every store uses this by default. Tests
 *  pass an alternative deps object whose methods are vi.fn()
 *  stubs. */
export const DEFAULT_DEPS: BuildEditableImageDeps = {
  renderImageRecord,
  encodeCaptureInWorker,
  loadEncodeOptions,
  createEditableImage,
};

/**
 * Build an XMP-bearing image Blob from an `ImageRecord`. Dispatches
 * to one of the 4 {@link EncodeStrategy} branches based on what's
 * available on the record.
 *
 * The `render-and-encode` branch swallows worker encode errors and
 * falls back to the un-re-encoded rendered output — same behaviour
 * the per-store `#buildXmpBlob` had. A user with a broken worker
 * still gets a saved file, just not the smallest possible PNG.
 */
export async function buildEditableImageBlob(
  record: Partial<ImageRecord>,
  format: "jpg" | "png",
  deps: BuildEditableImageDeps = DEFAULT_DEPS,
): Promise<Blob> {
  const strategy = pickEncodeStrategy(record, format);
  let renderedBlob: Blob;
  switch (strategy) {
    case "render-and-encode": {
      const renderedDataUrl = await deps.renderImageRecord(
        // pickEncodeStrategy guarantees these are non-null/non-empty.
        record.originalDataUrl as string,
        record.annotationsSvg as string,
        record.width || 0,
        record.height || 0,
      );
      let finalDataUrl = renderedDataUrl;
      try {
        const opts = deps.loadEncodeOptions();
        const encoded = await deps.encodeCaptureInWorker(renderedDataUrl, opts);
        finalDataUrl = encoded.dataUrl;
      } catch (e) {
        console.warn("[image-encode] rendered-image re-encode failed, keeping PNG-24:", e);
      }
      renderedBlob = await (await fetch(finalDataUrl)).blob();
      break;
    }
    case "render-only": {
      const renderedDataUrl = await deps.renderImageRecord(
        record.originalDataUrl as string,
        record.annotationsSvg as string,
        record.width || 0,
        record.height || 0,
      );
      renderedBlob = await (await fetch(renderedDataUrl)).blob();
      break;
    }
    case "source-only":
      renderedBlob = await (await fetch(record.originalDataUrl as string)).blob();
      break;
    case "empty":
      renderedBlob = new Blob([]);
      break;
  }
  return deps.createEditableImage({
    renderedBlob,
    originalDataUrl: record.originalDataUrl || "",
    annotationsSvg: record.annotationsSvg || "",
    width: record.width || 0,
    height: record.height || 0,
    format,
    tags: record.tags || {},
  });
}
