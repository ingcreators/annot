/**
 * Decode helper for `GitHubStore`. Turns a freshly-fetched blob
 * (raw bytes + repo-relative path) into the `ImageRecord` shape the
 * editor consumes.
 *
 * Lifted out of `github-store.ts` (proposal 4 follow-up after #142
 * / #143 / #144) so the decode pipeline can be unit-tested with
 * synthetic XMP / non-XMP byte sequences without standing up the
 * stateful HTTP layer + caches.
 *
 * Encode (the `#buildXmpBlob` side) lives in `./image-encode.ts`
 * — shared across Browser / Device / Drive / GitHub now that the
 * 4 stores all use the same strategy + DI seam.
 */

import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { getParentPath } from "@ingcreators/annot-core/storage";
import { readEditableImage } from "@ingcreators/annot-core/xmp";
import type { GitHubFileMeta } from "./github-blob-cache.js";
import { bytesToDataUrl, inferMimeFromPath } from "./github-helpers.js";

/**
 * Decode a fetched blob into an `ImageRecord`. Pure: no cache
 * writes, no `this`. Caller is responsible for stashing the result
 * in `GitHubBlobCache.setRecord(...)` if appropriate.
 *
 * Decoding strategy:
 *
 *   1. Try `readEditableImage(bytes)` — if the blob carries an
 *      Annot XMP envelope, every editable field comes directly from
 *      it (annotationsSvg, width / height, tags, original-bytes
 *      data URL).
 *   2. Fall back to a raw `bytes → data URL` conversion when no
 *      XMP envelope is present (a plain JPEG / PNG committed to
 *      the repo outside Annot). The image still renders in the
 *      gallery; it just has no annotations layer.
 *
 * `meta` is the optional last-known commit info (`createdAt` /
 *  `updatedAt`) the store maintains in `GitHubBlobCache.getMeta`.
 *  Decoding doesn't need it but the editor header surface does, so
 *  the store typically passes it through.
 */
export function decodeImageRecord(
  relPath: string,
  bytes: Uint8Array,
  meta?: GitHubFileMeta,
): ImageRecord {
  const folderPath = getParentPath(relPath);
  const xmp = readEditableImage(bytes);
  const originalDataUrl =
    xmp?.originalImageDataUrl || bytesToDataUrl(bytes, inferMimeFromPath(relPath));
  return {
    path: relPath,
    folderPath,
    originalDataUrl,
    thumbnailDataUrl: "",
    annotationsSvg: xmp?.annotationsSvg || "",
    width: xmp?.width || 0,
    height: xmp?.height || 0,
    sourceUrl: "",
    tags: xmp?.tags || {},
    createdAt: meta?.createdAt || "",
    updatedAt: meta?.updatedAt || "",
  };
}
