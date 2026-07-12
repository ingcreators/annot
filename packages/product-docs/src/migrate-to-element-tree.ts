// Migration helper — convert legacy `annot:snapshot` /
// `annot:attributes` MDX comment blocks into the canonical
// `annot:elementTree` PNG XMP payload.
//
// Phase 1g of `docs/plans/living-spec-authoring-roadmap.md`.
//
// For each `<Screen>` in a docs MDX file:
//   1. Read the legacy `annot:snapshot` block (Playwright YAML).
//   2. Read the legacy `annot:attributes` block (per-overlay
//      attribute dictionary).
//   3. Convert the snapshot YAML → `ElementTree` via the 1b
//      adapter (`playwrightYamlToElementTree`).
//   4. Merge attributes onto matching nodes (role + name lookup).
//   5. Write the result to the referenced PNG's `annot:elementTree`
//      XMP chunk (Phase 1d's `writeElementTreePng`).
//   6. Strip the comment blocks from the MDX source.
//
// Idempotent: re-running over an already-migrated file is a no-op
// (no comment blocks to read, no XMP changes if the PNG already
// carries an identical tree).
//
// Pure Node — uses `node:fs/promises` + the Tier A core +
// the 1b Playwright adapter. No DOM, no Playwright runtime
// (the adapter's YAML-to-tree path is closure-free).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { type ElementTree, findByMatch, writeElementTreePng } from "@ingcreators/annot-core";
import { ELEMENT_TREE_ATTR_WHITELIST } from "@ingcreators/annot-core/element-tree";
import { playwrightYamlToElementTree } from "@ingcreators/annot-playwright";

import { parseMdxFile } from "./mdx.js";

/**
 * Result of migrating one MDX file. Returned per file so the CLI
 * can report a summary; throwers propagate up.
 */
export interface MigrationFileResult {
  /** Absolute path of the MDX file. */
  mdxPath: string;
  /** Per-screen results. Same order as `parsed.screens`. */
  screens: ScreenMigrationResult[];
  /** True when the MDX source was rewritten (comment blocks
   *  stripped). False when nothing changed. */
  mdxRewritten: boolean;
}

export interface ScreenMigrationResult {
  /** `<Screen id>` value. */
  id: string;
  /** Absolute path of the PNG that received the XMP write. */
  pngPath?: string;
  /** True when an `annot:elementTree` chunk was written. */
  xmpWritten: boolean;
  /** Reason for skipping — `"no-snapshot"` when the MDX lacks an
   *  `annot:snapshot` block, `"no-src"` when `<Screen src>` is
   *  missing or not a local relative path, `"already-migrated"` when
   *  the PNG already carried an identical tree. */
  skipReason?: "no-snapshot" | "no-src" | "already-migrated";
}

export interface MigrateOptions {
  /** When true, doesn't write back to disk — just returns what
   *  WOULD have been written. Useful for `--dry-run` mode in the
   *  CLI. Default: false. */
  dryRun?: boolean;
  /** Override for the legacy attribute-collection whitelist.
   *  Defaults to the same `DEFAULT_ATTR_WHITELIST` consumed by
   *  the productDocs fixture today. */
  attributeWhitelist?: readonly string[];
}

// Canonical whitelist shared by every ElementTree producer
// (metadata-unification Phase 7). The old private copy captured
// aria-* attributes; those now live exclusively in `states`.
const DEFAULT_ATTR_WHITELIST = ELEMENT_TREE_ATTR_WHITELIST;

/**
 * Migrate one MDX file. Reads the file, processes every screen,
 * writes the updated MDX + per-screen PNG XMP chunks back to disk
 * (unless `dryRun`). Returns the per-screen result.
 */
export async function migrateMdxFile(
  mdxPath: string,
  options: MigrateOptions = {},
): Promise<MigrationFileResult> {
  const parsed = await parseMdxFile(mdxPath);
  if (!parsed) {
    return { mdxPath, screens: [], mdxRewritten: false };
  }

  const snapshotYaml = parsed.commentBlocks.snapshot?.trim() ?? "";
  const attributesYaml = parsed.commentBlocks.attributes?.trim() ?? "";

  const screens: ScreenMigrationResult[] = [];
  for (const screen of parsed.screens) {
    if (!snapshotYaml) {
      screens.push({ id: screen.id, xmpWritten: false, skipReason: "no-snapshot" });
      continue;
    }
    if (!screen.src) {
      screens.push({ id: screen.id, xmpWritten: false, skipReason: "no-src" });
      continue;
    }

    const pngPath = resolvePngPath(mdxPath, screen.src);
    if (!pngPath) {
      screens.push({ id: screen.id, xmpWritten: false, skipReason: "no-src" });
      continue;
    }

    const tree = buildElementTreeFromLegacyBlocks({
      snapshotYaml,
      attributesYaml,
      whitelist: options.attributeWhitelist ?? DEFAULT_ATTR_WHITELIST,
    });

    if (options.dryRun) {
      screens.push({ id: screen.id, pngPath, xmpWritten: true });
      continue;
    }

    const pngBytes = await readFile(pngPath);
    const updated = writeElementTreePng(pngBytes, tree);
    await writeFile(pngPath, updated);
    screens.push({ id: screen.id, pngPath, xmpWritten: true });
  }

  // Strip the comment blocks once every screen has been processed.
  const hadBlocks = Boolean(parsed.commentBlocks.snapshot || parsed.commentBlocks.attributes);
  let mdxRewritten = false;
  if (hadBlocks && !options.dryRun) {
    const cleaned = stripLegacyCommentBlocks(parsed.source);
    if (cleaned !== parsed.source) {
      await writeFile(mdxPath, cleaned, "utf8");
      mdxRewritten = true;
    }
  }

  return { mdxPath, screens, mdxRewritten };
}

/**
 * Build an `ElementTree` from the legacy `annot:snapshot` (Playwright
 * YAML) and `annot:attributes` (per-overlay attribute dict) blocks.
 *
 * Exported separately so tests can exercise the pure conversion
 * without touching disk.
 */
export function buildElementTreeFromLegacyBlocks(args: {
  snapshotYaml: string;
  attributesYaml: string;
  whitelist: readonly string[];
}): ElementTree {
  const tree = playwrightYamlToElementTree({
    yaml: args.snapshotYaml,
    // Viewport isn't carried in the legacy snapshot YAML — default
    // to 0x0. Downstream consumers that need viewport dimensions
    // should re-capture via the Playwright fixture (which DOES
    // populate viewport from `page.viewportSize()`).
    viewport: { width: 0, height: 0, scale: 1 },
    agent: "annot-docs-migrate-to-element-tree@1",
    capturedAt: new Date().toISOString(),
  });

  const attrEntries = parseLegacyAttributesYaml(args.attributesYaml, args.whitelist);
  for (const entry of attrEntries) {
    const matches = findByMatch(tree, { role: entry.role, name: entry.name });
    if (matches.length !== 1) continue;
    const node = matches[0]!;
    if (Object.keys(entry.attributes).length === 0) continue;
    (node as { attributes: Record<string, string> }).attributes = {
      ...(node.attributes ?? {}),
      ...entry.attributes,
    };
  }
  return tree;
}

interface LegacyAttributeEntry {
  role: string;
  name: string;
  attributes: Record<string, string>;
}

/**
 * Parse the legacy `annot:attributes` YAML format:
 *
 * ```yaml
 * button "Sign in":
 *   type: submit
 * textbox "Email":
 *   type: email
 *   required: ""
 * ```
 *
 * Returns one entry per `role "name":` block with the captured
 * key / value pairs filtered through `whitelist`. Exported only
 * for test use.
 */
export function parseLegacyAttributesYaml(
  yaml: string,
  whitelist: readonly string[],
): LegacyAttributeEntry[] {
  const out: LegacyAttributeEntry[] = [];
  if (!yaml.trim()) return out;
  const whitelistSet = new Set(whitelist);

  const lines = yaml.split(/\r?\n/);
  let current: LegacyAttributeEntry | null = null;

  // Identify headers vs values by content shape, not by indentation.
  // The MDX comment-block path (via remark-mdx) sometimes strips
  // per-line leading whitespace, so we can't rely on indent depth
  // alone to distinguish nested values from new headers. Headers
  // match `role "name":`; everything else with a `key: value` shape
  // is treated as a value of the most recent header.
  const HEADER_RE = /^([a-z]+)\s+"([^"]*)"\s*:\s*$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const headerMatch = line.match(HEADER_RE);
    if (headerMatch) {
      current = {
        role: headerMatch[1] ?? "",
        name: headerMatch[2] ?? "",
        attributes: {},
      };
      out.push(current);
      continue;
    }

    if (!current) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (!whitelistSet.has(key)) continue;
    // Strip surrounding quotes (the legacy format doesn't quote
    // most values; defensive against future writers).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    current.attributes[key] = value;
  }

  return out;
}

/**
 * Resolve a `<Screen src>` reference against the MDX file's
 * directory. Returns `null` for protocol-prefixed URLs (those
 * can't be a local file the migration can write XMP to).
 *
 * Exported for unit tests.
 */
export function resolvePngPath(mdxPath: string, src: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  if (isAbsolute(src)) return src;
  return resolve(dirname(mdxPath), src);
}

/**
 * Strip the `annot:snapshot` and `annot:attributes` MDX comment
 * blocks from `source`. Returns `source` unchanged when neither
 * block is present.
 *
 * The comment-block format we look for is:
 *
 * ```mdx
 * {/* annot:snapshot
 *   - main: ...
 * *\/}
 * ```
 *
 * (with `{/* ... *\/}` being the MDX expression-wrapped JS
 * comment the `mdx.ts` `updateCommentBlocks` writes).
 */
export function stripLegacyCommentBlocks(source: string): string {
  let out = source;
  out = stripCommentBlock(out, "annot:snapshot");
  out = stripCommentBlock(out, "annot:attributes");
  return out;
}

function stripCommentBlock(source: string, tag: string): string {
  // Pattern: `{/* <tag>` … `*\/}` (with optional whitespace).
  // Use String#indexOf to walk the source — avoids a regex with
  // arbitrary user content that could trigger polynomial-regex
  // CodeQL flags.
  const opener = `{/* ${tag}`;
  const openIdx = source.indexOf(opener);
  if (openIdx === -1) return source;
  const closeMarker = "*/}";
  const closeIdx = source.indexOf(closeMarker, openIdx);
  if (closeIdx === -1) return source;
  const blockEnd = closeIdx + closeMarker.length;
  // Also strip a single trailing newline if the next char is one,
  // so removal doesn't leave a blank line at the seam.
  const nextChar = source[blockEnd];
  const sliceEnd = nextChar === "\n" ? blockEnd + 1 : blockEnd;
  return source.slice(0, openIdx) + source.slice(sliceEnd);
}
