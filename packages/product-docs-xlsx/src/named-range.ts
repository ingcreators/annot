// Named-range writers for the Excel adapter.
//
// Phase 3 PR 4 of `docs/plans/living-product-docs.md`. The
// customer template author defines Excel Named Ranges with the
// `annot` prefix; this module walks every cell on every sheet,
// looks at `cell.names`, and writes the matching content into
// the cell range.
//
// Recognised names:
//
//   annotImage                 → annotated PNG for this MDX
//   annotImage_<screenId>      → per-`<Screen>` PNG (multi-screen MDX)
//   annotItemTable             → item-spec table from <Overlay> rows
//   annotTransitions           → transitions table
//   annotHistory               → history entries
//   annotList                  → screen list
//   annotSnapshot              → verbatim aria-snapshot YAML (debug)
//   annotAttributes            → verbatim HTML attribute extraction (debug)
//
// Excel named-range identifiers can't contain `:`, so the
// per-screen variant uses an underscore rather than the
// `annotImage:<screenId>` form the plan's prose uses.
//
// Image embedding uses ExcelJS's `workbook.addImage` +
// `worksheet.addImage` with an A1-style cell-range string —
// the library converts to tl/br rectangles internally so the
// image fills the named range. Table writes start at the
// range's top-left cell and expand downwards.

import type ExcelJS from "exceljs";

import type { ExcelMdxBundle } from "./extract.js";

export interface NamedRangeWriteInput {
  workbook: ExcelJS.Workbook;
  bundle: ExcelMdxBundle;
  /** PNG bytes per `<Screen id>` (Phase 2 PR 2 Image Service). */
  imagesByScreenId?: Record<string, Uint8Array>;
  /** Fallback PNG when an `annotImage` (un-suffixed) range is
   *  used and the MDX has exactly one screen. */
  defaultImage?: Uint8Array;
  /** All bundles in the same book — used by `annotList`. */
  allBundles?: ExcelMdxBundle[];
}

interface NamedCellGroup {
  /** Range name (`annotImage`, `annotImage_login`, …). */
  name: string;
  /** Worksheet the range lives on. */
  sheet: ExcelJS.Worksheet;
  /** Top-left + bottom-right cell, 1-indexed. */
  box: RangeBox;
  /** A1-style address — passed verbatim to `worksheet.addImage`. */
  address: string;
}

const KNOWN_PREFIX = "annot";

/**
 * Apply every recognised `annot*` named range in the workbook
 * for one MDX bundle. Mutates the workbook in place.
 */
export function applyNamedRanges(input: NamedRangeWriteInput): void {
  for (const group of enumerateAnnotRanges(input.workbook)) {
    writeOne(input, group);
  }
}

function writeOne(input: NamedRangeWriteInput, group: NamedCellGroup): void {
  const bare = group.name.replace(/^annot/, "");
  const [head, suffix] = splitVariant(bare);

  switch (head) {
    case "Image":
      writeImage(input, group, suffix);
      return;
    case "ItemTable":
      writeItemTable(group, input.bundle);
      return;
    case "Transitions":
      writeTransitionsTable(group, input.bundle);
      return;
    case "History":
      writeHistoryTable(group, input.bundle);
      return;
    case "List":
      writeListTable(group, input.allBundles ?? [input.bundle]);
      return;
    case "Snapshot":
      writeMultilineCell(group, input.bundle.snapshotYaml);
      return;
    case "Attributes":
      writeMultilineCell(group, input.bundle.attributesYaml);
      return;
  }
}

function splitVariant(bare: string): [string, string | undefined] {
  const idx = bare.indexOf("_");
  if (idx < 0) return [bare, undefined];
  return [bare.slice(0, idx), bare.slice(idx + 1)];
}

// ─── image embedding ───────────────────────────────────────────

function writeImage(
  input: NamedRangeWriteInput,
  group: NamedCellGroup,
  screenSuffix: string | undefined,
): void {
  const bytes = screenSuffix
    ? input.imagesByScreenId?.[screenSuffix]
    : (input.defaultImage ?? input.imagesByScreenId?.[input.bundle.screens[0]?.id ?? ""]);
  if (!bytes) return;

  // ExcelJS's `Buffer` type expects an `ArrayBuffer`-backed
  // buffer; `Buffer.from(Uint8Array)` yields a `Buffer<ArrayBuffer>`
  // in strict mode. Cast at the boundary — the bytes are
  // byte-identical, only the type-system phantom differs.
  const imageId = input.workbook.addImage({
    buffer: Buffer.from(bytes) as unknown as ExcelJS.Buffer,
    extension: "png",
  });
  group.sheet.addImage(imageId, group.address);
}

// ─── tables ────────────────────────────────────────────────────

interface RangeBox {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

function writeTableRows(
  group: NamedCellGroup,
  headers: readonly string[],
  rows: ReadonlyArray<readonly (string | number)[]>,
): void {
  const { sheet, box } = group;
  for (let i = 0; i < headers.length; i++) {
    const cell = sheet.getCell(box.startRow, box.startCol + i);
    cell.value = headers[i] ?? "";
    cell.font = { bold: true };
  }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const targetRow = box.startRow + 1 + r;
    if (targetRow > box.endRow) break;
    for (let c = 0; c < row.length; c++) {
      sheet.getCell(targetRow, box.startCol + c).value = row[c] ?? "";
    }
  }
}

function writeItemTable(group: NamedCellGroup, bundle: ExcelMdxBundle): void {
  writeTableRows(
    group,
    ["#", "Role", "Name", "Intent", "Notes"],
    bundle.overlays.map((o) => [o.number, o.matchRole, o.matchName, o.intent ?? "", o.body]),
  );
}

function writeTransitionsTable(group: NamedCellGroup, bundle: ExcelMdxBundle): void {
  // The MDX parser exposes transitions at file level via
  // `ParsedMdx.transitions`; the bundle dropped them in PR 1
  // because the placeholder + default-layout flow didn't need
  // them yet. Phase 3 PR 5 lifts them into the bundle so this
  // table populates; in the meantime we still emit the header
  // so a template's named range doesn't look broken.
  writeTableRows(group, ["Trigger", "Event", "Target", "Notes"], []);
  void bundle;
}

function writeHistoryTable(group: NamedCellGroup, bundle: ExcelMdxBundle): void {
  writeTableRows(
    group,
    ["Version", "Date", "Author", "Notes"],
    bundle.history.map((h) => [h.version, h.date, h.author, h.body]),
  );
}

function writeListTable(group: NamedCellGroup, allBundles: ExcelMdxBundle[]): void {
  const rows = allBundles
    .filter((b) => (b.frontmatter.xlsx?.role ?? "screen") === "screen")
    .map((b) => [
      b.frontmatter.id,
      b.frontmatter.title ?? b.frontmatter.id,
      b.screens.length,
      b.overlays.length,
    ]);
  writeTableRows(group, ["ID", "Title", "Screens", "Overlays"], rows);
}

function writeMultilineCell(group: NamedCellGroup, content: string): void {
  const cell = group.sheet.getCell(group.box.startRow, group.box.startCol);
  cell.value = content;
  cell.alignment = { wrapText: true, vertical: "top" };
}

// ─── range enumeration ────────────────────────────────────────

/**
 * Walk every cell on every sheet looking for cells with
 * `cell.names` referencing an `annot*` named range. Groups
 * matching cells by name + sheet, returning each group's
 * bounding box + A1 address.
 */
function enumerateAnnotRanges(workbook: ExcelJS.Workbook): NamedCellGroup[] {
  const byKey = new Map<
    string,
    { sheet: ExcelJS.Worksheet; name: string; cells: { row: number; col: number }[] }
  >();
  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const cellNames = readCellNames(cell);
        for (const name of cellNames) {
          if (!name.startsWith(KNOWN_PREFIX)) continue;
          const key = `${sheet.name}|${name}`;
          let group = byKey.get(key);
          if (!group) {
            group = { sheet, name, cells: [] };
            byKey.set(key, group);
          }
          group.cells.push({ row: rowNumber, col: colNumber });
        }
      });
    });
  }
  return [...byKey.values()].map((g) => {
    const rows = g.cells.map((c) => c.row);
    const cols = g.cells.map((c) => c.col);
    const box: RangeBox = {
      startRow: Math.min(...rows),
      startCol: Math.min(...cols),
      endRow: Math.max(...rows),
      endCol: Math.max(...cols),
    };
    return {
      name: g.name,
      sheet: g.sheet,
      box,
      address: `${colLetter(box.startCol)}${box.startRow}:${colLetter(box.endCol)}${box.endRow}`,
    };
  });
}

interface CellWithNames {
  names?: string[];
}

function readCellNames(cell: ExcelJS.Cell): string[] {
  const c = cell as unknown as CellWithNames;
  return c.names ?? [];
}

function colLetter(col: number): string {
  let n = col;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
