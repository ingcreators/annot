// `{var}` placeholder substitution for template cells.
//
// Phase 3 PR 3 of `docs/plans/living-product-docs.md`. The
// template author drops literal `{var}` text into Excel cells.
// We walk every populated cell, replace each `{name}` with the
// resolved value, and write the result back. No-op for cells
// without `{...}` markers — so existing customer templates
// don't need adjustment for non-placeholder cells.
//
// Resolution policy:
//   - `{id}` / `{title}` / `{purpose}`         → frontmatter root
//   - `{meta.author}` / `{meta.createdDate}`   → frontmatter meta
//   - `{<key>}` not in either              → project-level meta
//   - Unmatched placeholder is left verbatim so a typo is
//     visible to the docs author at review time rather than
//     silently disappearing.
//
// `{annot:date}` style and `{var:format}` suffixes land in PR 5.

import type ExcelJS from "exceljs";

import type { ExcelMdxBundle } from "./extract.js";

const PLACEHOLDER_RE = /\{([^{}:]+)\}/g;

export interface SubstituteOptions {
  /** Project-level `meta` from `annot-docs.config.ts`. */
  projectMeta?: Record<string, unknown>;
}

/**
 * Walk every cell on every worksheet in the workbook and
 * substitute `{var}` placeholders. Mutates in place.
 */
export function applyPlaceholders(
  workbook: ExcelJS.Workbook,
  bundle: ExcelMdxBundle,
  options: SubstituteOptions = {},
): void {
  for (const sheet of workbook.worksheets) {
    applyPlaceholdersToSheet(sheet, bundle, options);
  }
}

/**
 * Single-sheet version — exposed so the template-driven path
 * (which clones one template sheet per `<Screen>`) can call it
 * after the clone.
 */
export function applyPlaceholdersToSheet(
  sheet: ExcelJS.Worksheet,
  bundle: ExcelMdxBundle,
  options: SubstituteOptions = {},
): void {
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const original = cell.value;
      if (typeof original !== "string") return;
      const replaced = resolvePlaceholders(original, bundle, options);
      if (replaced !== original) {
        cell.value = replaced;
      }
    });
  });
}

/**
 * Pure string transform — replace every `{name}` token in a
 * source string with its resolved value. Exposed for unit
 * tests and for callers (e.g. the per-screen template renderer)
 * that want to substitute non-cell strings like sheet names.
 */
export function resolvePlaceholders(
  source: string,
  bundle: ExcelMdxBundle,
  options: SubstituteOptions = {},
): string {
  return source.replace(PLACEHOLDER_RE, (whole, key: string) => {
    const value = resolveOne(key, bundle, options);
    return value === undefined ? whole : value;
  });
}

function resolveOne(
  rawKey: string,
  bundle: ExcelMdxBundle,
  options: SubstituteOptions,
): string | undefined {
  const key = rawKey.trim();

  // `meta.<name>` → per-MDX meta first, then project meta.
  if (key.startsWith("meta.")) {
    const sub = key.slice("meta.".length);
    const value = bundle.frontmatter.meta?.[sub] ?? options.projectMeta?.[sub];
    return value === undefined ? undefined : String(value);
  }

  // Frontmatter root.
  if (key === "id") return bundle.frontmatter.id;
  if (key === "title") return bundle.frontmatter.title;
  if (key === "purpose") return bundle.frontmatter.purpose;

  // Project meta fallback for bare `{name}`.
  const projectValue = options.projectMeta?.[key];
  if (projectValue !== undefined) return String(projectValue);

  return undefined;
}
