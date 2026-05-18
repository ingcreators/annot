// Workspace-relative path validation. Used by every storage
// endpoint that accepts a `path` query parameter or body field.
//
// Constraints:
// - Non-empty
// - Max 1024 chars (D1 column is TEXT; no hard limit, but very
//   long paths suggest abuse)
// - No leading or trailing slash (canonical form is
//   "Folder/file.png" not "/Folder/file.png/" — matches the
//   existing `StorageProvider.path` semantics in
//   `@ingcreators/annot-core/storage`)
// - No `..` segments (path-traversal hardening, defence in
//   depth — R2 doesn't follow paths so traversal is mostly a
//   non-issue, but rejecting it keeps the on-wire shape clean)
// - No `\0` or control chars
//
// Returns null when valid; returns a human-readable reason
// string when invalid. The caller turns that into a 400.

const MAX_PATH_LENGTH = 1024;

export function validatePath(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) {
    return "Path is required.";
  }
  if (path.length > MAX_PATH_LENGTH) {
    return `Path is too long (max ${MAX_PATH_LENGTH} chars).`;
  }
  if (path.startsWith("/")) {
    return "Path must not start with a slash.";
  }
  if (path.endsWith("/")) {
    return "Path must not end with a slash.";
  }
  // ASCII control chars (\x00–\x1f and \x7f) — including \0 NUL.
  // SQLite stores them but they break a lot of downstream code.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberate — we WANT to reject control characters.
  if (/[\x00-\x1f\x7f]/.test(path)) {
    return "Path contains control characters.";
  }
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      return `Path contains an invalid segment: "${segment}".`;
    }
  }
  return null;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Inspect the `Content-Length` header (set by the client) and
 * reject early when the upload exceeds our per-request cap.
 * Returns null when ok, a reason string when too large.
 *
 * **Not** a quota — quota is per-workspace and lands in Phase 4e.
 * This is a per-request defence so a single oversized upload
 * can't tie up the Worker.
 */
export function validateUploadSize(contentLengthHeader: string | null): string | null {
  if (!contentLengthHeader) return null; // No header? Let R2 enforce its own limit.
  const n = Number.parseInt(contentLengthHeader, 10);
  if (!Number.isFinite(n) || n < 0) {
    return "Invalid Content-Length header.";
  }
  if (n > MAX_UPLOAD_BYTES) {
    return `Upload is too large (${n} bytes; max ${MAX_UPLOAD_BYTES}).`;
  }
  return null;
}

/** Public so tests can assert the constant doesn't drift. */
export const MAX_UPLOAD_BYTES_VALUE = MAX_UPLOAD_BYTES;
