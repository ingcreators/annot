// Default no-template layout for the Excel adapter.
//
// Phase 3 PR 2 of `docs/plans/living-product-docs.md`. Given a
// list of `ExcelMdxBundle`s for one book, populate an
// `ExcelJS.Workbook` with one sheet per MDX file using a
// hard-coded layout per role.
//
// This is the OSS default — users without a customer-supplied
// template still get a usable `.xlsx` out of the pipeline. The
// custom-template path (PR 3) replaces the per-role builder
// dispatch with a "clone the template sheet, run placeholder
// substitution" flow.

import type ExcelJS from "exceljs";

import type { ExcelMdxBundle } from "./extract.js";

/** Sort key per `role` so cover always appears first, then
 *  history, then list, then screens, then misc references. */
const ROLE_ORDER: Record<string, number> = {
  cover: 1,
  history: 2,
  list: 3,
  screen: 4,
  reference: 5,
};

export interface ApplyDefaultLayoutInput {
  workbook: ExcelJS.Workbook;
  bundles: ExcelMdxBundle[];
}

/**
 * Apply the default no-template layout. The workbook is
 * mutated in place — every bundle contributes one sheet,
 * ordered by role then by `xlsx.order` then by file path.
 */
export function applyDefaultLayout(input: ApplyDefaultLayoutInput): void {
  const sorted = sortBundlesForLayout(input.bundles);
  for (const bundle of sorted) {
    const role = bundle.frontmatter.xlsx?.role ?? "screen";
    const sheetName = pickSheetName(bundle, role);
    const sheet = input.workbook.addWorksheet(sheetName);
    switch (role) {
      case "cover":
        renderCoverSheet(sheet, bundle);
        break;
      case "history":
        renderHistorySheet(sheet, bundle);
        break;
      case "list":
        renderListSheet(sheet, input.bundles);
        break;
      case "reference":
        renderReferenceSheet(sheet, bundle);
        break;
      default:
        renderScreenSheet(sheet, bundle);
    }
  }
}

/**
 * Sort bundles in the order they appear in the workbook.
 * Documented in plan section "Open question 7":
 *   1. Role-default order (cover → history → list → screen → reference)
 *   2. Within same role: `order` field (default 100)
 *   3. Tie-break: alphabetical by MDX file path.
 *
 * Exported so the template-path branch (PR 3) can reuse the
 * same sort.
 */
export function sortBundlesForLayout(bundles: ExcelMdxBundle[]): ExcelMdxBundle[] {
  return [...bundles].sort((a, b) => {
    const ra = ROLE_ORDER[a.frontmatter.xlsx?.role ?? "screen"] ?? 99;
    const rb = ROLE_ORDER[b.frontmatter.xlsx?.role ?? "screen"] ?? 99;
    if (ra !== rb) return ra - rb;
    const oa = a.frontmatter.xlsx?.order ?? 100;
    const ob = b.frontmatter.xlsx?.order ?? 100;
    if (oa !== ob) return oa - ob;
    return a.mdxPath.localeCompare(b.mdxPath);
  });
}

// ─── sheet renderers ──────────────────────────────────────────

function renderCoverSheet(sheet: ExcelJS.Worksheet, bundle: ExcelMdxBundle): void {
  const fm = bundle.frontmatter;
  sheet.columns = [
    { key: "label", width: 24 },
    { key: "value", width: 60 },
  ];
  sheet.addRow({ label: "Title", value: fm.title ?? fm.id });
  sheet.addRow({ label: "Document ID", value: fm.id });
  if (fm.purpose) sheet.addRow({ label: "Purpose", value: fm.purpose });
  if (fm.meta) {
    for (const [k, v] of Object.entries(fm.meta)) {
      sheet.addRow({ label: `meta.${k}`, value: String(v) });
    }
  }
  // Bold the first column.
  sheet.getColumn(1).font = { bold: true };
}

function renderHistorySheet(sheet: ExcelJS.Worksheet, bundle: ExcelMdxBundle): void {
  sheet.columns = [
    { header: "Version", key: "version", width: 12 },
    { header: "Date", key: "date", width: 14 },
    { header: "Author", key: "author", width: 18 },
    { header: "Notes", key: "body", width: 60 },
  ];
  for (const entry of bundle.history) {
    sheet.addRow({
      version: entry.version,
      date: entry.date,
      author: entry.author,
      body: entry.body,
    });
  }
  sheet.getRow(1).font = { bold: true };
}

function renderListSheet(sheet: ExcelJS.Worksheet, allBundles: ExcelMdxBundle[]): void {
  sheet.columns = [
    { header: "ID", key: "id", width: 14 },
    { header: "Title", key: "title", width: 36 },
    { header: "Screens", key: "screens", width: 10 },
    { header: "Overlays", key: "overlays", width: 10 },
  ];
  for (const bundle of allBundles) {
    if ((bundle.frontmatter.xlsx?.role ?? "screen") !== "screen") continue;
    sheet.addRow({
      id: bundle.frontmatter.id,
      title: bundle.frontmatter.title ?? bundle.frontmatter.id,
      screens: bundle.screens.length,
      overlays: bundle.overlays.length,
    });
  }
  sheet.getRow(1).font = { bold: true };
}

function renderScreenSheet(sheet: ExcelJS.Worksheet, bundle: ExcelMdxBundle): void {
  const fm = bundle.frontmatter;
  // Header block: id / title / purpose
  sheet.addRow(["ID", fm.id]);
  sheet.addRow(["Title", fm.title ?? ""]);
  if (fm.purpose) sheet.addRow(["Purpose", fm.purpose]);
  sheet.addRow([]); // separator

  // Overlay table.
  sheet.addRow(["#", "Role", "Name", "Intent", "Notes"]);
  const headerRow = sheet.lastRow!;
  headerRow.font = { bold: true };
  for (const overlay of bundle.overlays) {
    sheet.addRow([
      overlay.number,
      overlay.matchRole,
      overlay.matchName,
      overlay.intent ?? "",
      overlay.body,
    ]);
  }
  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 24;
  sheet.getColumn(4).width = 12;
  sheet.getColumn(5).width = 60;
  sheet.getColumn(1).font = { bold: true };
}

function renderReferenceSheet(sheet: ExcelJS.Worksheet, bundle: ExcelMdxBundle): void {
  sheet.addRow(["ID", bundle.frontmatter.id]);
  sheet.addRow(["Title", bundle.frontmatter.title ?? ""]);
  if (bundle.frontmatter.purpose) sheet.addRow(["Purpose", bundle.frontmatter.purpose]);
}

// ─── sheet name picking ───────────────────────────────────────

function pickSheetName(bundle: ExcelMdxBundle, role: string): string {
  const xlsx = bundle.frontmatter.xlsx;
  if (typeof xlsx?.sheet === "string" && xlsx.sheet.length > 0) {
    return sanitiseSheetName(xlsx.sheet);
  }
  // Fallback by role. English defaults until i18n support
  // lands — until then locale-specific labels are caller-driven
  // via `templateSheets[role]` in the project config.
  if (role === "cover") return "Cover";
  if (role === "history") return "Revision history";
  if (role === "list") return "Screen list";
  if (role === "reference") return sanitiseSheetName(bundle.frontmatter.id);
  // screen default
  return sanitiseSheetName(bundle.frontmatter.title ?? bundle.frontmatter.id);
}

/**
 * Excel limits sheet names to 31 chars and forbids `: \ / ? * [ ]`.
 * This is shared with the future template-path branch.
 */
export function sanitiseSheetName(name: string): string {
  const trimmed = name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
  return trimmed.length > 0 ? trimmed : "Sheet";
}
