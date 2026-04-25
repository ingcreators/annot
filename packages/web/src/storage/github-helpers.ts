/**
 * Pure helpers for `GitHubStore`. Constants, image-filename
 * predicate, error factory, and binary ↔ base64 conversion
 * routines — none of which depend on the store's internal state.
 *
 * Extracted from `github-store.ts` as Stage 3d-1 of
 * `docs/plans/pre-release-cleanup.md`. Same incremental pattern
 * as 3a-5 / 3b-1 / 3c-1: lift the pure surface first, leave the
 * stateful class for later sub-PRs.
 */

/** GitHub REST API root. Used as the base for every `fetch` call
 *  the store makes. */
export const GITHUB_API = "https://api.github.com";

/** Empty-folder marker. Conventional in git-tracked trees; weighs 0 bytes. */
export const GITKEEP = ".gitkeep";

/**
 * Hard ceiling we accept via the Contents API. The documented limit
 * is ~100 MB binary / ~1 MB text, but requests approaching those
 * numbers get rate-limit penalized hard. Annot captures are almost
 * always well under this; scroll captures on retina displays can
 * occasionally exceed. Phase 4 will add Git Data API fallback for
 * oversized blobs.
 */
export const MAX_CONTENTS_BYTES = 40 * 1024 * 1024; // 40 MB rendered size

/**
 * Threshold at which `GitHubStore#setRateLimitListener`'s callback
 * fires. GitHub's authenticated REST API allows 5 000 requests /
 * hour / token; surfacing an advisory when the remaining budget
 * drops to 100 lets the user pause before hitting the hard wall
 * (403 + "rate limit exceeded"). Chosen to give ~a-few-minutes of
 * headroom at Annot's typical save pace (~1 request per save).
 */
export const RATE_LIMIT_WARN_AT = 100;

/**
 * Accepted image extensions. Mirrors `DeviceStore#isImageFile` so
 * the gallery shows the same kinds of files across every storage
 * backend. A repo typically contains far more non-image files than
 * image files (source code, docs, config), and the gallery has no
 * way to render those — so they'd just be noise if we listed them.
 *
 * `.annot.png` / `.annot.jpg` / `.annot.svg` are subsumed by the
 * bare extension checks below.
 */
export function isImageFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".svg")
  );
}

/** Discriminated subclass of `Error` carrying GitHub-specific
 *  fields the rest of the store + the auth UI react to. */
export interface GitHubError extends Error {
  status?: number;
  githubError?: true;
  conflict?: true;
}

/** Factory for `GitHubError` — sets the discriminant flag and
 *  attaches optional `status` / `conflict` extras. */
export function githubError(
  message: string,
  status?: number,
  extra?: Partial<GitHubError>,
): GitHubError {
  const err = new Error(message) as GitHubError;
  err.githubError = true;
  if (status !== undefined) err.status = status;
  if (extra?.conflict) err.conflict = true;
  return err;
}

/** Read a `Blob` and return its body as a base64 string (no data:
 *  prefix). Used when uploading binary blobs to the Contents API,
 *  which requires base64-encoded content. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Read a `Blob` and return its body as a `data:` URL. Used when
 *  serving fetched blobs into `<img>` thumbnails. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Decode a base64 string (with or without GitHub's
 *  column-60-wrapped newlines) into a `Uint8Array`. */
export function base64ToBytes(b64: string): Uint8Array {
  // GitHub's Contents API returns base64 with newlines wrapped at
  // column 60. atob tolerates leading/trailing whitespace but not
  // embedded newlines, so strip them.
  const clean = b64.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode a `Uint8Array` back into a `data:` URL with the given
 *  MIME type. Chunks the conversion so we stay under V8's
 *  argument-count cap when calling `String.fromCharCode`. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  // Chunk to stay well under V8's argument-count cap (~65k); 32k is the
  // long-standing safe size used by the surrounding Web platform code.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Map a path's extension to a MIME type. Used when re-creating
 *  data URLs from raw bytes pulled out of the Contents API. */
export function inferMimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}
