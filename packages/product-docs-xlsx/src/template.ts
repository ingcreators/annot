// Customer-supplied template loading + per-MDX sheet cloning.
//
// Phase 3 PR 3 of `docs/plans/living-product-docs.md`. The
// template is an `.xlsx` the customer provides (e.g. their
// corporate screen-specifications template). Each `xlsx.role`
// may map to a named template sheet (`templateSheets[role]`);
// for each MDX in the project, we:
//
//   1. Clone the template sheet by name (via
//      `worksheet.workbook.addWorksheet({ ... model })`).
//   2. Rename the clone to the MDX's chosen sheet name.
//   3. Substitute `{var}` placeholders across the clone.
//   4. (PR 4) Insert content into named ranges.
//
// The template's "stub" sheets stay in the workbook so the
// template author can see the original alongside the populated
// clones; downstream consumers can remove them with a
// `keepTemplateSheets: false` option (added if anyone asks).

import type { BookConfig } from "@ingcreators/annot-product-docs";
import ExcelJS from "exceljs";

import { sanitiseSheetName, sortBundlesForLayout } from "./default-layout.js";
import type { ExcelMdxBundle } from "./extract.js";
import { applyPlaceholdersToSheet, type SubstituteOptions } from "./placeholder.js";

export interface ApplyTemplateInput {
  /** The empty workbook to populate. */
  workbook: ExcelJS.Workbook;
  /** Pre-loaded ExcelJS workbook from the customer template. */
  template: ExcelJS.Workbook;
  /** Per-book config from `annot-docs.config.ts`. */
  bookConfig: BookConfig;
  /** All bundles assigned to this book. */
  bundles: ExcelMdxBundle[];
  /** Substitution options forwarded to `applyPlaceholdersToSheet`. */
  substitute?: SubstituteOptions;
}

/**
 * Apply the customer template path. Mutates `workbook` in
 * place: clones the configured template sheet for each role
 * once per matching bundle, renames each clone, and runs
 * placeholder substitution on every cloned cell.
 */
export function applyTemplateLayout(input: ApplyTemplateInput): void {
  const sorted = sortBundlesForLayout(input.bundles);
  for (const bundle of sorted) {
    const role = bundle.frontmatter.xlsx?.role ?? "screen";
    const templateName = input.bookConfig.templateSheets?.[role];
    if (!templateName) continue;
    const templateSheet = input.template.getWorksheet(templateName);
    if (!templateSheet) {
      throw new Error(
        `Template sheet "${templateName}" not found for role "${role}" in book template.`,
      );
    }
    // Multi-screen MDXs use `xlsx.sheets: { <key>: <sheetName>, ... }`
    // to declare one sheet per `<Screen>` (or per "state").
    // Each entry clones the template once.
    const sheetsMap = bundle.frontmatter.xlsx?.sheets;
    if (sheetsMap) {
      const entries = Object.entries(sheetsMap);
      for (const [, sheetName] of entries) {
        const clone = cloneSheet(input.workbook, templateSheet, sanitiseSheetName(sheetName));
        applyPlaceholdersToSheet(clone, bundle, input.substitute ?? {});
      }
      continue;
    }
    const sheetName = sanitiseSheetName(
      bundle.frontmatter.xlsx?.sheet ?? bundle.frontmatter.title ?? bundle.frontmatter.id,
    );
    const clone = cloneSheet(input.workbook, templateSheet, sheetName);
    applyPlaceholdersToSheet(clone, bundle, input.substitute ?? {});
  }
}

/**
 * Load a template workbook from disk. Thin wrapper around
 * ExcelJS so the caller doesn't have to import it directly.
 */
export async function loadTemplateWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

/**
 * Clone an ExcelJS worksheet (row values + columns + named
 * ranges scoped to that sheet) into a destination workbook.
 * ExcelJS doesn't ship a built-in deep-clone for sheets; this
 * helper handles the subset we care about: cell values, cell
 * formatting (numFmt + alignment + font + fill), column widths,
 * row heights, and named ranges on the sheet.
 */
function cloneSheet(
  target: ExcelJS.Workbook,
  source: ExcelJS.Worksheet,
  newName: string,
): ExcelJS.Worksheet {
  const clone = target.addWorksheet(newName);
  // Columns (widths + headers).
  clone.columns = source.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style: c.style,
  }));
  // Rows.
  source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const newRow = clone.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const newCell = newRow.getCell(colNumber);
      newCell.value = cell.value;
      if (cell.style) {
        newCell.style = cell.style;
      }
    });
    if (row.height !== undefined) newRow.height = row.height;
    newRow.commit();
  });
  // Merged ranges.
  for (const merge of Object.values(getMergedRanges(source))) {
    clone.mergeCells(merge);
  }
  return clone;
}

interface SheetWithMerges {
  _merges?: Record<string, string>;
}

/**
 * Extract the merged-cell ranges from an ExcelJS worksheet.
 * The library exposes `_merges` internally as
 * `{ "A1:B2": "A1:B2", ... }`; we surface them safely so the
 * cloned sheet preserves merges.
 */
function getMergedRanges(sheet: ExcelJS.Worksheet): Record<string, string> {
  const internal = sheet as unknown as SheetWithMerges;
  return internal._merges ?? {};
}
