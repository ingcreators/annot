// `{var}` placeholder substitution for template cells.
//
// Phase 3 PR 5 of `docs/plans/living-product-docs.md`. Extends
// PR 3's `{var}` substitution with two new behaviours:
//
//   - `{annot:<name>}` — special variables resolved by the
//     pipeline at render time. Currently:
//       annot:date           → render-time YYYY-MM-DD
//       annot:datetime       → render-time ISO timestamp
//       annot:sheetIndex     → 1-based sheet index in workbook
//       annot:totalSheets    → total sheet count in workbook
//   - `{<var>:<format>}` — format suffix applied to date-like
//     values. Examples:
//       {meta.createdDate:yyyy/MM/dd}     → "2026/05/21"
//       {annot:date:yyyy年MM月dd日}        → "2026年05月21日"
//     Supported format tokens: `yyyy` / `MM` / `dd` / `HH` /
//     `mm` / `ss`. Anything else passes through literally.

import type ExcelJS from "exceljs";

import type { ExcelMdxBundle } from "./extract.js";

const PLACEHOLDER_RE = /\{([^{}]+)\}/g;
const ANNOT_PREFIX = "annot:";

export interface SubstituteOptions {
  /** Project-level `meta` from `annot-docs.config.ts`. */
  projectMeta?: Record<string, unknown>;
  /** Used by `{annot:date}` / `{annot:datetime}`. Defaults to
   *  `new Date()` per call but the pipeline can pin a single
   *  `renderTime` across all substitutions so the workbook
   *  has consistent timestamps. */
  renderTime?: Date;
  /** Used by `{annot:sheetIndex}` / `{annot:totalSheets}`. The
   *  per-sheet wrapper passes the index of the sheet being
   *  rendered + the total. */
  sheetIndex?: number;
  totalSheets?: number;
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
  const totalSheets = options.totalSheets ?? workbook.worksheets.length;
  workbook.worksheets.forEach((sheet, idx) => {
    applyPlaceholdersToSheet(sheet, bundle, {
      ...options,
      sheetIndex: options.sheetIndex ?? idx + 1,
      totalSheets,
    });
  });
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
 * Pure string transform — replace every `{name}` or
 * `{name:format}` token in a source string with its resolved
 * value. Exposed for unit tests and for callers (sheet-name
 * substitution, log messages, …).
 */
export function resolvePlaceholders(
  source: string,
  bundle: ExcelMdxBundle,
  options: SubstituteOptions = {},
): string {
  return source.replace(PLACEHOLDER_RE, (whole, inner: string) => {
    const { key, format } = splitFormatSuffix(inner);
    const value = resolveOne(key, bundle, options);
    if (value === undefined) return whole;
    return format ? applyFormat(value, format) : value;
  });
}

function splitFormatSuffix(inner: string): { key: string; format: string | undefined } {
  // The first `:` separates key from format, EXCEPT when the
  // key starts with `annot:` (the special-variable prefix
  // already contains a colon). Find the second `:` for
  // annot-prefixed keys, first otherwise.
  const trimmed = inner.trim();
  if (trimmed.startsWith(ANNOT_PREFIX)) {
    const rest = trimmed.slice(ANNOT_PREFIX.length);
    const idx = rest.indexOf(":");
    if (idx < 0) return { key: trimmed, format: undefined };
    return {
      key: ANNOT_PREFIX + rest.slice(0, idx),
      format: rest.slice(idx + 1),
    };
  }
  const idx = trimmed.indexOf(":");
  if (idx < 0) return { key: trimmed, format: undefined };
  return {
    key: trimmed.slice(0, idx),
    format: trimmed.slice(idx + 1),
  };
}

function resolveOne(
  key: string,
  bundle: ExcelMdxBundle,
  options: SubstituteOptions,
): string | undefined {
  // `annot:<name>` — pipeline-time special variables.
  if (key.startsWith(ANNOT_PREFIX)) {
    const name = key.slice(ANNOT_PREFIX.length);
    const now = options.renderTime ?? new Date();
    switch (name) {
      case "date":
        return formatDateParts(now, "yyyy-MM-dd");
      case "datetime":
        return now.toISOString();
      case "sheetIndex":
        return options.sheetIndex !== undefined ? String(options.sheetIndex) : undefined;
      case "totalSheets":
        return options.totalSheets !== undefined ? String(options.totalSheets) : undefined;
    }
    return undefined;
  }

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

/**
 * Apply a format suffix to a string value. We accept date-like
 * inputs (ISO `yyyy-MM-dd`, ISO `yyyy-MM-ddTHH:mm:ss`, raw
 * `Date.toISOString()`); other values pass through verbatim
 * when the format doesn't apply.
 *
 * Token table:
 *   yyyy → 4-digit year
 *   MM   → 2-digit month (zero-padded)
 *   dd   → 2-digit day
 *   HH   → 2-digit hours (24h)
 *   mm   → 2-digit minutes
 *   ss   → 2-digit seconds
 */
function applyFormat(value: string, format: string): string {
  const parsed = tryParseDate(value);
  if (!parsed) return value;
  return formatDateParts(parsed, format);
}

function tryParseDate(value: string): Date | null {
  const trimmed = value.trim();
  // Date-only `yyyy-MM-dd` — Date() parses in UTC, which would
  // shift the day in non-UTC zones. Parse manually.
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(
      Number.parseInt(dateOnly[1]!, 10),
      Number.parseInt(dateOnly[2]!, 10) - 1,
      Number.parseInt(dateOnly[3]!, 10),
    );
  }
  // ISO with time — let `Date` handle it.
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateParts(date: Date, format: string): string {
  const yyyy = String(date.getFullYear()).padStart(4, "0");
  const MM = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const HH = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return format
    .replace(/yyyy/g, yyyy)
    .replace(/MM/g, MM)
    .replace(/dd/g, dd)
    .replace(/HH/g, HH)
    .replace(/mm/g, mm)
    .replace(/ss/g, ss);
}
