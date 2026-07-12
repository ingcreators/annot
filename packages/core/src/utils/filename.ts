/**
 * Default filename helpers.
 *
 * All annot-generated files share a single name shape:
 *
 *     annot-YYYYMMDD-HHMMSS-SSS[.annot].<ext>
 *
 * Local-time stamping keeps the filename instantly readable for the
 * user (Drive / GitHub / Finder all show the time the user actually
 * captured the screen). The matching `createdAt` field on
 * `ImageRecord` stores the UTC ms epoch separately, so cross-timezone
 * sync semantics are unaffected.
 *
 * Millisecond precision avoids collisions inside the timed-page
 * capture flow (`pwa-capture` issues frames at 1s+ intervals; even
 * burst capture stays unique). For the cross-device GitHub / Drive
 * sync edge case, the existing `uniquifyFilename(Async)` helper
 * appends a numeric suffix — this format degrades cleanly into
 * `annot-...-001`, etc.
 */

/** Prefix every annot-native default filename with this token. */
export const ANNOT_FILENAME_PREFIX = "annot";

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/**
 * Format a Date as `YYYYMMDD-HHMMSS-SSS` in local time. Lexicographic
 * order matches chronological order.
 */
export function formatLocalTimestamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  return `${y}${mo}${d}-${h}${mi}${s}-${ms}`;
}

/**
 * Default filename stem (no extension) for an annot-native capture,
 * e.g. `annot-20260428-143022-123`.
 */
export function defaultAnnotFilenameStem(date: Date = new Date()): string {
  return `${ANNOT_FILENAME_PREFIX}-${formatLocalTimestamp(date)}`;
}

/**
 * Default filename for an annot-native image capture, e.g.
 * `annot-20260428-143022-123.annot.png`. The extension is inferred
 * from the data URL prefix (`jpg` for `data:image/jpeg`, otherwise
 * `png`). The `.annot.` infix marks the file as carrying embedded
 * annotation metadata (XMP for PNG, EXIF for JPG) — used by every
 * persistent web storage backend (BrowserStore, DeviceStore,
 * GitHubStore, GoogleDriveStore). The transient extension IDB
 * deliberately omits the infix; pre-annotation captures aren't
 * annot-native yet.
 *
 * PNG-default for unknown inputs is intentional: every production
 * caller passes PNG or JPEG, so the fallback only matters for tests
 * and stray callers — and PNG (lossless) is the safer guess.
 */
export function defaultAnnotImageFilename(
  originalDataUrl: string,
  date: Date = new Date(),
): string {
  const ext = originalDataUrl.startsWith("data:image/jpeg") ? "jpg" : "png";
  return `${defaultAnnotFilenameStem(date)}.annot.${ext}`;
}

/**
 * Normalize a caller-supplied image filename to the `.annot.<ext>`
 * double extension — the single identity rule for Annot-managed
 * files (`docs/plans/metadata-unification.md` Phase 4): a file the
 * gallery manages carries BOTH the `.annot.` infix AND the XMP
 * packet, so every host (including the vscode custom editor, which
 * claims `*.annot.{svg,png,jpeg,jpg}` only) recognizes it.
 *
 * `uploaded.png` → `uploaded.annot.png`; already-normalized names
 * pass through unchanged; the extension is lowercased. A name with
 * no recognizable raster/svg extension gets `.annot.png` appended
 * (production callers always pass one — this is the safe fallback).
 *
 * Persistent stores apply this in `saveImage`; the extension's
 * transient IDB staging deliberately does not (see
 * {@link defaultAnnotImageFilename}'s note — pre-annotation
 * captures aren't annot-native yet).
 */
export function normalizeAnnotImageFilename(filename: string): string {
  if (/\.annot\.(png|jpe?g|svg)$/i.test(filename)) return filename;
  const m = filename.match(/\.(png|jpe?g|svg)$/i);
  if (m?.[1]) return `${filename.slice(0, -m[0].length)}.annot.${m[1].toLowerCase()}`;
  return `${filename}.annot.png`;
}
