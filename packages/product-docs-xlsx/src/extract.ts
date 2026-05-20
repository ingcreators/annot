// MDX → normalised data shape for the Excel adapter.
//
// Phase 3 PR 1 of `docs/plans/living-product-docs.md`. The
// Astro adapter consumes the live `ParsedMdx` shape directly;
// the Excel adapter wants something slightly flatter (one
// "row" per overlay, with the parent screen + frontmatter
// metadata denormalised onto each row) so a row-oriented
// `<table>` / Excel range insert is mechanical.
//
// The normalised shape is intentionally NOT just `ParsedMdx`:
// downstream consumers (placeholder substitution, named-range
// writers, the cover/history/list role variants) all want
// "what fits in one cell" semantics that don't care which
// `<Screen>` the overlay came from.

import {
  type AnnotFrontmatter,
  type HistoryEntrySpec,
  type OverlaySpec,
  type ParsedMdx,
  parseMdxFile,
  type ScreenSpec,
} from "@ingcreators/annot-product-docs";

export interface ExcelMdxBundle {
  /** Absolute or cwd-relative path to the source `.mdx` file. */
  mdxPath: string;
  /** Verbatim source bytes — kept so downstream tools can hash. */
  source: string;
  /** The `annot:` frontmatter block. */
  frontmatter: AnnotFrontmatter;
  /** Flat per-screen rows (one entry per `<Screen>`). */
  screens: NormalisedScreen[];
  /** Flat per-overlay rows (one entry per `<Overlay>`, including its
   *  parent screen's id + screen-relative number). */
  overlays: NormalisedOverlay[];
  /** Flat per-history-entry rows (only populated for `role: history` MDXs). */
  history: HistoryEntrySpec[];
  /** Verbatim aria-snapshot block as captured by the fixture. */
  snapshotYaml: string;
  /** Verbatim attributes block as captured by the fixture. */
  attributesYaml: string;
}

export interface NormalisedScreen {
  id: string;
  src: string | undefined;
  overlayCount: number;
}

export interface NormalisedOverlay {
  screenId: string;
  number: number;
  intent: OverlaySpec["intent"];
  /** `role + name` joined for one-cell rendering. */
  matchLabel: string;
  matchRole: string;
  matchName: string;
  /** Markdown body — caller renders to rich text. */
  body: string;
}

/**
 * Extract a normalised bundle from a parsed MDX. Used directly
 * by `extractMdxFile` and re-exposed so tests can drive it
 * without filesystem I/O.
 */
export function extractFromParsed(parsed: ParsedMdx, mdxPath: string): ExcelMdxBundle {
  const screens: NormalisedScreen[] = parsed.screens.map((s: ScreenSpec) => ({
    id: s.id,
    src: s.src,
    overlayCount: s.overlays.length,
  }));

  const overlays: NormalisedOverlay[] = [];
  for (const screen of parsed.screens) {
    let auto = 1;
    for (const overlay of screen.overlays) {
      const number = overlay.number ?? auto++;
      overlays.push({
        screenId: screen.id,
        number,
        intent: overlay.intent,
        matchLabel: formatMatchLabel(overlay),
        matchRole: overlay.match.role,
        matchName: overlay.match.name,
        body: overlay.body,
      });
    }
  }

  return {
    mdxPath,
    source: parsed.source,
    frontmatter: parsed.frontmatter,
    screens,
    overlays,
    history: parsed.history,
    snapshotYaml: parsed.commentBlocks.snapshot ?? "",
    attributesYaml: parsed.commentBlocks.attributes ?? "",
  };
}

/**
 * Convenience: parse the MDX file and normalise. Returns `null`
 * for files without `annot:` frontmatter so the bulk-extract
 * caller can keep its glob noise-free.
 */
export async function extractMdxFile(mdxPath: string): Promise<ExcelMdxBundle | null> {
  const parsed = await parseMdxFile(mdxPath);
  if (!parsed) return null;
  return extractFromParsed(parsed, mdxPath);
}

function formatMatchLabel(overlay: OverlaySpec): string {
  const base = `${overlay.match.role} "${overlay.match.name}"`;
  if (!overlay.match.under) return base;
  return `${base} under ${overlay.match.under.role} "${overlay.match.under.name}"`;
}
