/**
 * Streaming-friendly template detection — Phase 8c of
 * `docs/plans/annot-html-document.md`.
 *
 * The picker (`<annot-template-picker>`) needs to narrow a
 * `Templates/` folder listing down to actual templates without
 * paying the full `parseDocument` cost per file. Most files in
 * the folder ARE templates (it's a convention path), but the
 * folder is user-managed, so we tolerate stragglers — partial
 * downloads, draft files, manuals saved by mistake.
 *
 * The format spec (`docs/annot-html-format.md`) declares THREE
 * template markers, all of which a strict `parseTemplateHead`
 * could check:
 *
 *   1. `<html data-annot-doc-template="1">`
 *   2. `<meta name="annot-template" content="1">` in `<head>`
 *   3. `template` sub-object in the JSON sidecar (`<body>`)
 *
 * Marker 2 lives high in the document and is the cheapest to
 * detect. We check it via a single regex so the scan stays linear
 * in the bytes scanned (no allocator pressure from constructing
 * `DOMParser`s, no `<head>` boundary detection — the regex
 * happens to be precise enough that false positives are
 * implausible without intentionally constructing a poison file).
 *
 * `parseDocument` is still authoritative; this helper is a
 * pre-filter only. After this returns `true`, callers MUST run
 * the full parse to extract `meta.template.{description, tags}`
 * before showing the template's full picker card.
 */

/**
 * Quick check: does the document carry the
 * `<meta name="annot-template" content="1">` marker?
 *
 * Returns `true` for files that look like templates without
 * actually parsing them. Returns `false` for files that
 * definitely aren't templates (no marker present), or for byte
 * sequences that don't even look like HTML.
 */
export function isTemplateFromHead(bytes: string): boolean {
  // Single-pass regex over the input bytes. The `<meta>` tag is
  // emitted by `serializeDocument` with a fixed shape — but we
  // accept hand-edited variants too: any quote style, optional
  // self-closing, any whitespace between attributes. The `i`
  // flag tolerates uppercase from minifiers / human edits.
  return TEMPLATE_META_REGEX.test(bytes);
}

const TEMPLATE_META_REGEX = /<meta\s+name=["']annot-template["']\s+content=["']1["']\s*\/?\s*>/i;
