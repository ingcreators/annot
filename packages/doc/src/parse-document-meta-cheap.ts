/**
 * Regex-only metadata probe for `.annot.html` documents.
 *
 * Tier A — no DOM access, no `parseDocument` round-trip. Callers
 * use this when they need title / block / image counts to populate
 * a `DocumentRecord` cache entry without paying for a full parse:
 * desktop / device storage backends on listing, the file-manager
 * import path on upload. The regex matches accept malformed
 * documents (returns zeros) rather than throwing — callers treat a
 * `0 / 0` result as "uncountable", not "invalid file".
 *
 * The block / image counts are derived from `data-annot-block`
 * markers emitted by `serializeDocument`; the title comes from the
 * `<title>` tag the serializer always writes.
 */

export interface CheapDocumentMeta {
  title: string;
  blockCount: number;
  imageCount: number;
}

export function parseDocumentMetaCheap(text: string): CheapDocumentMeta {
  // The inner group is a linear-time "atomic-ish" walk: chunks of
  // non-`<` chars optionally separated by a `<` whose lookahead
  // confirms it's not the closing `</title>`. The original
  // `<title>([\s\S]*?)</title>` was polynomial on inputs that
  // contained many `<title>` substrings without a close (CodeQL
  // `js/polynomial-redos`).
  const titleMatch = text.match(/<title>([^<]*(?:<(?!\/title>)[^<]*)*)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? "";
  const blockMatches = text.match(/data-annot-block="[^"]+"/g);
  const imageMatches = text.match(/data-annot-block="image"/g);
  return {
    title,
    blockCount: blockMatches?.length ?? 0,
    imageCount: imageMatches?.length ?? 0,
  };
}
