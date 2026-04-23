/**
 * Annot SVG format version — the lever for evolving the annotation
 * format while keeping old files readable.
 *
 * Every SVG Annot writes carries a `data-annot-version="N"` attribute
 * on its root. Readers can inspect that attribute to know which schema
 * a given document was written with and (eventually) run migrations.
 *
 * See `docs/svg-format.md` for the full format specification.
 *
 * Current version: 1 (initial versioned format — April 2026).
 *
 * ## Why a string, not a number
 *
 * Treating the version as a string leaves room for "1.1" / "2-rc1" /
 * "next" style pre-release identifiers if we ever need them, without
 * requiring consumers to juggle number-vs-string comparisons later.
 * The value is still compared as an exact string — no implicit
 * semver parsing — so there's no surprise ordering.
 *
 * ## Migration policy
 *
 * New writes ALWAYS stamp the CURRENT version. Old writes with
 * missing attributes are treated as version "0" (the pre-versioning
 * era) and read best-effort. When / if a breaking change lands, the
 * reader gains a `migrateFromV0` / `migrateFromV1` branch; until
 * then we simply stamp + read-through.
 */

/** Current Annot SVG format version. Bump only with a migration. */
export const ANNOT_SVG_VERSION = "1";

/** The pseudo-version returned for documents written before Annot
 *  started stamping — i.e. any SVG without the
 *  `data-annot-version` attribute. Readers treat this as "legacy,
 *  parse leniently". */
export const ANNOT_SVG_VERSION_UNSTAMPED = "0";

/** DOM attribute name used to carry the version on the SVG root. */
export const ANNOT_SVG_VERSION_ATTR = "data-annot-version";

/**
 * Stamp the current Annot format version onto an SVG root element.
 * Call right before serializing so every written document carries
 * the version.
 *
 * Idempotent — calling twice leaves the attribute with the same
 * value. Safe to call on an SVG that already has a stamp (e.g. a
 * clone of the live editor root, which carries the stamp from
 * `CanvasManager`'s constructor).
 */
export function stampAnnotVersion(svgRoot: Element): void {
  svgRoot.setAttribute(ANNOT_SVG_VERSION_ATTR, ANNOT_SVG_VERSION);
}

/**
 * Read the format version from a parsed SVG root. Returns the
 * unstamped sentinel (`"0"`) when the attribute is absent — this is
 * the signal to a reader that the document predates versioning and
 * should be parsed with legacy tolerance.
 */
export function readAnnotVersion(svgRoot: Element): string {
  return svgRoot.getAttribute(ANNOT_SVG_VERSION_ATTR) || ANNOT_SVG_VERSION_UNSTAMPED;
}

/**
 * Cheap string-level version probe — reads the first
 * `data-annot-version="…"` occurrence in the raw SVG text without
 * instantiating a DOMParser. Useful at storage-layer boundaries
 * where parsing is expensive and callers only want a quick
 * "do I need to upgrade this?" check.
 *
 * Returns the unstamped sentinel when no match is found; not
 * defensive against the attribute appearing mid-string in a CDATA
 * or attribute value (extremely unlikely in practice, since Annot
 * emits the attribute on the root well before any content).
 */
export function getAnnotVersionFromString(svgString: string): string {
  const m = /\sdata-annot-version="([^"]*)"/.exec(svgString);
  return m ? m[1] : ANNOT_SVG_VERSION_UNSTAMPED;
}
