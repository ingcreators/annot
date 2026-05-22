// Migration helper — convert legacy inline `<Overlay>` JSX into
// the Phase 2b `<Screen annotations>` + `<AnnotCallout>` form.
//
// Phase 2d of `docs/plans/living-spec-authoring-roadmap.md`.
//
// For each `<Screen>` with `<Overlay>` children:
//   1. Compute the yaml path (next to `<Screen src>`, named
//      `<src basename>.annotations.yaml`).
//   2. Generate an `AnnotationsFile` from the overlays — each
//      `<Overlay match intent number>` becomes one
//      `overlays[]` entry, id-numbered `o1` / `o2` / … in MDX
//      document order.
//   3. Write the yaml to disk (skip in dry-run).
//   4. Rewrite the MDX: add `annotations="…"` to the `<Screen>`
//      opening tag (when absent), replace each `<Overlay …>body</Overlay>`
//      with `<AnnotCallout for="oN">body</AnnotCallout>`.
//
// Idempotent: re-running over an already-migrated MDX is a no-op
// (the screen already carries the `annotations` prop, the
// `<Overlay>` children are gone — there's nothing left to do).
//
// Pure Node — uses `node:fs/promises` + Phase 2a's yaml
// serializer. No DOM, no Playwright runtime.

import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, posix, relative, resolve } from "node:path";

import {
  ANNOTATIONS_YAML_VERSION,
  type AnnotationsFile,
  type OverlayEntry,
  serializeAnnotationsYaml,
} from "./annotations-yaml.js";
import { parseMdxFile } from "./mdx.js";
import type { OverlayIntent, OverlaySpec } from "./types.js";

/** Per-file result. The CLI prints a summary across these. */
export interface OverlayMigrationFileResult {
  /** Absolute MDX path. */
  mdxPath: string;
  /** Per-screen results, in MDX document order. */
  screens: ScreenOverlayMigrationResult[];
  /** True when the MDX source was rewritten. */
  mdxRewritten: boolean;
}

export interface ScreenOverlayMigrationResult {
  /** `<Screen id>` value. */
  id: string;
  /** Absolute path of the yaml file (set even on dry-run). */
  yamlPath?: string;
  /** True when the yaml was written to disk. */
  yamlWritten: boolean;
  /** Number of overlays migrated for this screen. */
  overlayCount: number;
  /** Reason for skipping — `"no-overlays"` when the screen has
   *  zero inline `<Overlay>` children, `"already-migrated"` when
   *  the `<Screen>` opening tag already carries `annotations`,
   *  `"no-src"` when `<Screen src>` is missing. */
  skipReason?: "no-overlays" | "already-migrated" | "no-src";
}

export interface MigrateOverlaysOptions {
  /** When true, doesn't write back to disk — just returns what
   *  WOULD have been written. Default: false. */
  dryRun?: boolean;
  /** Override the function that picks the yaml path. Defaults to
   *  `<dirname(src)>/<basename(src, '.png')>.annotations.yaml`. */
  yamlPathFor?: (args: { mdxPath: string; screenId: string; src: string }) => string;
}

/**
 * Migrate one MDX file. See module-level doc for the
 * step-by-step.
 */
export async function migrateOverlaysToAnnotationsFile(
  mdxPath: string,
  options: MigrateOverlaysOptions = {},
): Promise<OverlayMigrationFileResult> {
  const parsed = await parseMdxFile(mdxPath);
  if (!parsed) {
    return { mdxPath, screens: [], mdxRewritten: false };
  }

  // We collect the MDX edits as `(startOffset, endOffset, replacement)`
  // tuples and apply them in REVERSE position order so each edit
  // doesn't shift the offsets of the ones still to apply.
  const edits: SourceEdit[] = [];
  const screens: ScreenOverlayMigrationResult[] = [];

  for (const screen of parsed.screens) {
    if (screen.annotations !== undefined) {
      screens.push({
        id: screen.id,
        overlayCount: 0,
        yamlWritten: false,
        skipReason: "already-migrated",
      });
      continue;
    }
    if (screen.overlays.length === 0) {
      screens.push({
        id: screen.id,
        overlayCount: 0,
        yamlWritten: false,
        skipReason: "no-overlays",
      });
      continue;
    }
    if (!screen.src) {
      screens.push({
        id: screen.id,
        overlayCount: screen.overlays.length,
        yamlWritten: false,
        skipReason: "no-src",
      });
      continue;
    }

    const yamlAbsPath = resolveYamlPath({
      mdxPath,
      screenId: screen.id,
      src: screen.src,
      override: options.yamlPathFor,
    });
    // The MDX reference is mdx-relative + POSIX (relative paths
    // in `<Screen src>` use forward slashes; we match that
    // convention so the output looks the same on Windows / macOS
    // / Linux migration runs).
    const yamlRelRef = posixRelative(dirname(mdxPath), yamlAbsPath);

    const overlayEdits = computeOverlayEdits(parsed.source, screen);
    // We need the matching opening-tag edit to add the
    // `annotations` prop.
    const screenOpenEdit = computeScreenOpeningEdit(parsed.source, screen, yamlRelRef);
    if (!screenOpenEdit || overlayEdits.length !== screen.overlays.length) {
      // Position data missing — refuse to mutate. Surface as an
      // error so the CLI exits non-zero on inconsistent input.
      throw new Error(
        `migrateOverlaysToAnnotationsFile: ${mdxPath} screen "${screen.id}" position data incomplete — cannot rewrite safely.`,
      );
    }
    edits.push(screenOpenEdit, ...overlayEdits.map((e) => e.edit));

    // Build the yaml content. Overlay ids are author-supplied in
    // post-migration land; here we assign `o1` / `o2` / … in
    // document order.
    const file = buildAnnotationsFile(screen.overlays);

    screens.push({
      id: screen.id,
      yamlPath: yamlAbsPath,
      yamlWritten: false,
      overlayCount: screen.overlays.length,
    });

    if (!options.dryRun) {
      // Create the parent dir if missing — yamlPathFor overrides
      // may point outside the existing tree (e.g. a sibling
      // `annotations/` folder).
      await mkdir(dirname(yamlAbsPath), { recursive: true });
      await writeFile(yamlAbsPath, serializeAnnotationsYaml(file), "utf8");
      screens[screens.length - 1]!.yamlWritten = true;
    }
  }

  let mdxRewritten = false;
  if (edits.length > 0 && !options.dryRun) {
    const rewritten = applyEditsInReverseOrder(parsed.source, edits);
    if (rewritten !== parsed.source) {
      await writeFile(mdxPath, rewritten, "utf8");
      mdxRewritten = true;
    }
  }

  return { mdxPath, screens, mdxRewritten };
}

/**
 * Build the in-memory `AnnotationsFile` for one screen's worth
 * of inline `<Overlay>` blocks. Exported for unit testing. Pure
 * data; no IO.
 */
export function buildAnnotationsFile(overlays: readonly OverlaySpec[]): AnnotationsFile {
  const entries: OverlayEntry[] = overlays.map((o, i) => {
    const entry: OverlayEntry = {
      id: `o${i + 1}`,
      kind: "numberedBadge",
      match: o.match,
      number: o.number ?? i + 1,
    };
    if (o.intent) {
      entry.intent = o.intent as OverlayIntent;
    }
    return entry;
  });
  return {
    version: ANNOTATIONS_YAML_VERSION,
    overlays: entries,
    meta: { generator: "annot-docs migrate-overlays-to-annotations@1" },
  };
}

interface SourceEdit {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Apply edits in REVERSE position order so earlier edits don't
 * shift the offsets of later ones. Edits must not overlap.
 */
function applyEditsInReverseOrder(source: string, edits: readonly SourceEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}

function resolveYamlPath(args: {
  mdxPath: string;
  screenId: string;
  src: string;
  override?: MigrateOverlaysOptions["yamlPathFor"];
}): string {
  if (args.override) {
    return args.override({ mdxPath: args.mdxPath, screenId: args.screenId, src: args.src });
  }
  const srcAbs = isAbsolute(args.src) ? args.src : resolve(dirname(args.mdxPath), args.src);
  const stem = basename(srcAbs).replace(/\.(png|jpe?g|webp|gif|svg)$/i, "");
  return resolve(dirname(srcAbs), `${stem}.annotations.yaml`);
}

function posixRelative(fromDir: string, toFile: string): string {
  const rel = relative(fromDir, toFile).split(/[\\/]/).join("/");
  // Local references must start with `./` so Astro / Vite resolve
  // them as relative; sibling files would otherwise be ambiguous.
  if (rel.startsWith(".") || rel.startsWith("/")) return rel;
  return `./${rel}`;
}

/**
 * Compute the byte-range edit that adds the `annotations="…"` prop
 * to a `<Screen>` opening tag.
 *
 * mdast positions are line/column-based; we convert them through
 * the source's newline offsets. The opening tag is the byte range
 * from `screen.position.start.offset` through the first `>` (or
 * `/>`) — locate that by counting forward from the start.
 *
 * Returns null when position data is missing (we refuse to mutate
 * blind — the caller throws).
 */
function computeScreenOpeningEdit(
  source: string,
  screen: { id: string },
  yamlRelRef: string,
): SourceEdit | null {
  // Find the opening tag by scanning the source. The MDX parser
  // doesn't surface offsets on a per-prop basis, so we search for
  // the literal `<Screen` followed by `id="<screenId>"` (matching
  // both the unquoted-attribute and curly-braces variants).
  const screenRegex = new RegExp(
    String.raw`<Screen\b[^>]*\bid=(?:"${escapeRegex(screen.id)}"|'${escapeRegex(screen.id)}'|\{["']${escapeRegex(screen.id)}["']\})[^>]*?(/?)>`,
    "m",
  );
  const match = screenRegex.exec(source);
  if (!match || match.index === undefined) return null;

  const tagStart = match.index;
  const tagEnd = tagStart + match[0].length;
  // Insert the new prop immediately before the closing `>` (or `/>`).
  const closeOffset = match[1] === "/" ? tagEnd - 2 : tagEnd - 1;
  const before = source.slice(tagStart, closeOffset);
  // Add a leading space if the previous char isn't already
  // whitespace.
  const needsSpace = !/\s$/.test(before);
  const insertion = `${needsSpace ? " " : ""}annotations="${yamlRelRef}"`;
  return { start: closeOffset, end: closeOffset, replacement: insertion };
}

/**
 * Compute the per-`<Overlay>` byte-range edits. Each overlay is
 * located by searching the source for its `<Overlay match=…>`
 * opening tag followed by the closing `</Overlay>`. The
 * replacement is `<AnnotCallout for="oN">body</AnnotCallout>`.
 *
 * Order of returned edits matches the input `overlays[]` order, so
 * the id assignment lines up with the `buildAnnotationsFile`
 * output.
 */
function computeOverlayEdits(
  source: string,
  screen: { id: string; overlays: OverlaySpec[] },
): { overlay: OverlaySpec; edit: SourceEdit }[] {
  // Restrict the search to the screen's body to avoid overlays
  // from sibling screens leaking in. We locate the screen body by
  // matching `<Screen … id="<id>" … >` opening and the matching
  // `</Screen>`.
  const screenRegex = new RegExp(
    String.raw`<Screen\b[^>]*\bid=(?:"${escapeRegex(screen.id)}"|'${escapeRegex(screen.id)}'|\{["']${escapeRegex(screen.id)}["']\})[^>]*?>`,
    "m",
  );
  const open = screenRegex.exec(source);
  if (!open || open.index === undefined) return [];
  const bodyStart = open.index + open[0].length;
  const close = source.indexOf("</Screen>", bodyStart);
  if (close === -1) return [];
  const bodyEnd = close;

  const out: { overlay: OverlaySpec; edit: SourceEdit }[] = [];
  let cursor = bodyStart;
  for (let i = 0; i < screen.overlays.length; i++) {
    const overlay = screen.overlays[i]!;
    const overlayOpen = source.indexOf("<Overlay", cursor);
    if (overlayOpen === -1 || overlayOpen >= bodyEnd) return out;
    // Find the matching `</Overlay>`. We assume no nested
    // `<Overlay>` blocks (the JSX walker doesn't recurse into
    // them).
    const overlayClose = source.indexOf("</Overlay>", overlayOpen);
    if (overlayClose === -1 || overlayClose >= bodyEnd) return out;
    const overlayEnd = overlayClose + "</Overlay>".length;

    // Extract the body — the text between the closing `>` of the
    // opening tag and the `<` of the closing tag. Preserves
    // newlines / indentation verbatim.
    const openTagEnd = source.indexOf(">", overlayOpen);
    if (openTagEnd === -1 || openTagEnd >= overlayClose) return out;
    const body = source.slice(openTagEnd + 1, overlayClose);

    const id = `o${i + 1}`;
    const replacement = `<AnnotCallout for="${id}">${body}</AnnotCallout>`;
    out.push({
      overlay,
      edit: { start: overlayOpen, end: overlayEnd, replacement },
    });
    cursor = overlayEnd;
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
