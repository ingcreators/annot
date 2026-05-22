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

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  type AnnotationsFile,
  type AnnotFrontmatter,
  type HistoryEntrySpec,
  type OverlayEntry,
  type OverlaySpec,
  type ParsedMdx,
  parseAnnotationsYaml,
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
 * Optional context for {@link extractFromParsed}. Phase 3d of
 * `docs/plans/living-spec-authoring-roadmap.md`. When a `<Screen>`
 * carries `annotations="…"`, the row generator wants the resolved
 * yaml content — but we don't want `extractFromParsed` to do file
 * I/O. The caller (`extractMdxFile`) pre-loads + parses each yaml
 * keyed by the `annotations` path (relative to the MDX) and passes
 * the map here. When the map is missing an entry (or this context
 * isn't supplied), the extractor falls back to the legacy inline
 * `<Overlay>` rows for that screen.
 *
 * `annotations[]` entries in the yaml are deliberately NOT
 * surfaced as rows — they're image-only visual marking. The
 * Astro Image Service composes them onto the PNG; the Excel
 * adapter renders the resulting image in the spreadsheet's
 * picture column and the items table stays scoped to overlays.
 */
export interface ExtractFromParsedOptions {
  /** Pre-loaded annotation yaml content keyed by the screen's `annotations` value. */
  annotationsYamlByPath?: ReadonlyMap<string, AnnotationsFile>;
}

/**
 * Extract a normalised bundle from a parsed MDX. Used directly
 * by `extractMdxFile` and re-exposed so tests can drive it
 * without filesystem I/O.
 */
export function extractFromParsed(
  parsed: ParsedMdx,
  mdxPath: string,
  options: ExtractFromParsedOptions = {},
): ExcelMdxBundle {
  const yamlByPath = options.annotationsYamlByPath;

  const screens: NormalisedScreen[] = parsed.screens.map((s: ScreenSpec) => ({
    id: s.id,
    src: s.src,
    overlayCount: countOverlaysFor(s, yamlByPath),
  }));

  const overlays: NormalisedOverlay[] = [];
  for (const screen of parsed.screens) {
    const yamlOverlays = yamlOverlaysFor(screen, yamlByPath);
    if (yamlOverlays) {
      // Phase 3d: yaml-driven row generation. Body is sourced from
      // the matching <AnnotCallout for="id"> in screen.callouts;
      // missing callouts emit an empty body so the row still
      // shows the match metadata.
      for (const overlay of yamlOverlays) {
        const callout = screen.callouts.find((c) => c.for === overlay.id);
        overlays.push({
          screenId: screen.id,
          number: overlay.number,
          intent: overlay.intent,
          matchLabel: formatMatchLabelKey(overlay),
          matchRole: overlay.match.role,
          matchName: overlay.match.name,
          body: callout?.body ?? "",
        });
      }
    } else {
      // Legacy inline <Overlay> path. Each entry's body comes
      // straight from the JSX; numbers auto-assign when omitted.
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
 *
 * Phase 3d: when the MDX contains `<Screen annotations="…">`
 * blocks, the matching yaml files are loaded + parsed from disk
 * before {@link extractFromParsed} runs. Missing yaml files are
 * a loud failure (`throw`) — the same behaviour the Astro Image
 * Service uses, on the same "explicit reference, but file gone"
 * reasoning.
 */
export async function extractMdxFile(mdxPath: string): Promise<ExcelMdxBundle | null> {
  const parsed = await parseMdxFile(mdxPath);
  if (!parsed) return null;
  const yamlByPath = await loadAnnotationYamls(parsed, mdxPath);
  return extractFromParsed(parsed, mdxPath, { annotationsYamlByPath: yamlByPath });
}

function countOverlaysFor(
  screen: ScreenSpec,
  yamlByPath: ReadonlyMap<string, AnnotationsFile> | undefined,
): number {
  const yamlOverlays = yamlOverlaysFor(screen, yamlByPath);
  if (yamlOverlays) return yamlOverlays.length;
  return screen.overlays.length;
}

function yamlOverlaysFor(
  screen: ScreenSpec,
  yamlByPath: ReadonlyMap<string, AnnotationsFile> | undefined,
): readonly OverlayEntry[] | null {
  if (!yamlByPath || !screen.annotations) return null;
  const file = yamlByPath.get(screen.annotations);
  return file?.overlays ?? null;
}

async function loadAnnotationYamls(
  parsed: ParsedMdx,
  mdxPath: string,
): Promise<Map<string, AnnotationsFile>> {
  const out = new Map<string, AnnotationsFile>();
  const mdxDir = dirname(mdxPath);
  for (const screen of parsed.screens) {
    if (!screen.annotations) continue;
    if (out.has(screen.annotations)) continue;
    const abs = isAbsolute(screen.annotations)
      ? screen.annotations
      : resolve(mdxDir, screen.annotations);
    let source: string;
    try {
      source = await readFile(abs, "utf8");
    } catch (err) {
      throw new Error(
        `extractMdxFile: <Screen annotations="${screen.annotations}"> — failed to read ${abs}: ${(err as Error).message}`,
      );
    }
    out.set(screen.annotations, parseAnnotationsYaml(source));
  }
  return out;
}

function formatMatchLabel(overlay: OverlaySpec): string {
  const base = `${overlay.match.role} "${overlay.match.name}"`;
  if (!overlay.match.under) return base;
  return `${base} under ${overlay.match.under.role} "${overlay.match.under.name}"`;
}

function formatMatchLabelKey(overlay: OverlayEntry): string {
  const base = `${overlay.match.role} "${overlay.match.name}"`;
  if (!overlay.match.under) return base;
  return `${base} under ${overlay.match.under.role} "${overlay.match.under.name}"`;
}
