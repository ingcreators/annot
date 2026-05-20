// Stage 5b: Render the MDX to a minimal Excel sheet.
//
// The PoC's Excel is the minimum-viable layout (no templates,
// no named ranges, just hard-coded cells) — proves the AST →
// Excel path works. Phase 3 will add template support,
// placeholders, and named ranges.

import { readFile, writeFile } from "node:fs/promises";

import ExcelJS from "exceljs";

import type { ParsedMdx } from "./parse-mdx.ts";

export async function renderXlsx(opts: {
  parsed: ParsedMdx;
  annotatedPngPath: string;
  outPath: string;
}): Promise<void> {
  const { frontmatter, screens, transitions } = opts.parsed;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = String(frontmatter.meta?.author ?? "annot-product-docs-poc");
  workbook.created = new Date();

  // ─── Cover sheet ─────────────────────────────────────────
  const cover = workbook.addWorksheet("表紙");
  cover.addRow([]);
  cover.addRow(["", "画面設計書"]);
  cover.addRow([]);
  cover.addRow(["", "画面ID", frontmatter.id]);
  cover.addRow(["", "画面名", frontmatter.title ?? ""]);
  cover.addRow(["", "用途", frontmatter.purpose ?? ""]);
  cover.addRow([]);
  if (frontmatter.meta) {
    cover.addRow(["", "メタ情報"]);
    for (const [k, v] of Object.entries(frontmatter.meta)) {
      cover.addRow(["", "", k, String(v)]);
    }
  }

  cover.getCell("B2").font = { size: 20, bold: true };
  cover.getColumn(2).width = 14;
  cover.getColumn(3).width = 40;
  cover.getColumn(4).width = 40;

  // ─── Per-screen sheet (one sheet per <Screen>) ───────────
  for (const screen of screens) {
    const sheetName = truncateSheetName(
      frontmatter.xlsx?.sheet ?? `${frontmatter.id} ${screen.id || ""}`.trim(),
    );
    const sheet = workbook.addWorksheet(sheetName);

    sheet.addRow([frontmatter.title ?? frontmatter.id]);
    sheet.getCell("A1").font = { size: 16, bold: true };
    sheet.addRow([]);

    sheet.addRow(["画面ID", frontmatter.id]);
    sheet.addRow(["画面名", frontmatter.title ?? ""]);
    sheet.addRow(["用途", frontmatter.purpose ?? ""]);

    if (frontmatter.meta?.author) {
      sheet.addRow(["作成者", String(frontmatter.meta.author)]);
    }
    if (frontmatter.meta?.createdDate) {
      sheet.addRow(["作成日", String(frontmatter.meta.createdDate)]);
    }
    if (frontmatter.meta?.revision) {
      sheet.addRow(["Rev", String(frontmatter.meta.revision)]);
    }

    sheet.addRow([]);

    // Embed annotated PNG
    const pngBytes = await readFile(opts.annotatedPngPath);
    const imageId = workbook.addImage({
      buffer: pngBytes as unknown as ExcelJS.Buffer,
      extension: "png",
    });
    const imgRowStart = sheet.rowCount;
    // Reserve ~30 rows for the image area; ExcelJS positions images
    // by cell coordinates with optional offsets.
    sheet.addImage(imageId, {
      tl: { col: 0, row: imgRowStart },
      ext: { width: 600, height: 480 },
      editAs: "oneCell",
    });
    // Push rows past the image so the table below isn't covered.
    for (let i = 0; i < 26; i++) sheet.addRow([]);

    // Item table header
    sheet.addRow(["番号", "項目名", "種別", "必須", "説明"]);
    const headerRow = sheet.lastRow;
    if (headerRow) {
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
      };
    }

    // Item table rows from overlays
    const sortedOverlays = [...screen.overlays].sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0),
    );
    for (const o of sortedOverlays) {
      const number = o.number ?? "";
      const name = o.match.name;
      const role = o.match.role;
      const required = o.intent === "required" ? "○" : "";
      const description = stripMarkdown(o.body);
      sheet.addRow([number, name, role, required, description]);
    }

    sheet.addRow([]);

    // Transitions section
    if (transitions.length > 0) {
      sheet.addRow(["画面遷移"]);
      const transitionHeader = sheet.lastRow;
      if (transitionHeader) {
        transitionHeader.font = { bold: true, size: 14 };
      }
      sheet.addRow(["トリガー", "条件", "遷移先", "備考"]);
      const tHeaderRow = sheet.lastRow;
      if (tHeaderRow) {
        tHeaderRow.font = { bold: true };
        tHeaderRow.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE5E7EB" },
        };
      }
      for (const t of transitions) {
        sheet.addRow([
          `${t.trigger.name} (${t.trigger.role})`,
          t.on ?? "",
          t.to ?? "",
          stripMarkdown(t.body),
        ]);
      }
    }

    sheet.getColumn(1).width = 8;
    sheet.getColumn(2).width = 24;
    sheet.getColumn(3).width = 12;
    sheet.getColumn(4).width = 8;
    sheet.getColumn(5).width = 60;
  }

  // ─── Drift report sheet (Phase 0 PoC only) ────────────────
  // Included to show the drift output landing in the workbook
  // itself for review. Real Phase 4 will keep drift out of the
  // deliverable (it's a CI signal, not a docs artefact).

  // Write
  const buf = await workbook.xlsx.writeBuffer();
  await writeFile(opts.outPath, Buffer.from(buf as ArrayBuffer));
}

function truncateSheetName(name: string): string {
  // Excel sheet names are limited to 31 characters.
  if (name.length <= 31) return name;
  return name.slice(0, 28) + "…";
}

function stripMarkdown(md: string): string {
  if (!md) return "";
  // Strip simple Markdown for plain-text Excel cells. Phase 3
  // will use ExcelJS rich-text instead.
  return md
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^> /gm, "")
    .replace(/^- /gm, "・")
    .replace(/\r?\n+/g, " / ")
    .trim();
}
