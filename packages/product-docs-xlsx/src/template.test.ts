// Tests for the customer-template path. ExcelJS doesn't ship a
// built-in "deep-clone a sheet" — `cloneSheet` is a small
// helper inside `template.ts` that this test exercises against
// a fixture workbook constructed in memory.

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { ExcelMdxBundle } from "./extract.js";
import { applyTemplateLayout } from "./template.js";

function makeBundle(fm: ExcelMdxBundle["frontmatter"]): ExcelMdxBundle {
  return {
    mdxPath: `${fm.id}.mdx`,
    source: "",
    frontmatter: fm,
    screens: [],
    overlays: [],
    history: [],
    snapshotYaml: "",
    attributesYaml: "",
  };
}

function makeTemplateWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const screen = wb.addWorksheet("個別画面テンプレ");
  screen.columns = [{ width: 18 }, { width: 60 }];
  screen.addRow(["ID", "{id}"]);
  screen.addRow(["Title", "{title}"]);
  screen.addRow(["Author", "{meta.author}"]);
  screen.addRow(["Reviewer", "{meta.reviewedBy}"]);

  const cover = wb.addWorksheet("表紙テンプレ");
  cover.addRow(["Project", "{projectName}"]);
  cover.addRow(["Customer", "{customerName}"]);
  return wb;
}

describe("applyTemplateLayout", () => {
  it("clones the template sheet per matching bundle, renames it, substitutes placeholders", () => {
    const target = new ExcelJS.Workbook();
    const template = makeTemplateWorkbook();
    applyTemplateLayout({
      workbook: target,
      template,
      bookConfig: {
        templateSheets: {
          screen: "個別画面テンプレ",
          cover: "表紙テンプレ",
        },
      },
      bundles: [
        makeBundle({
          id: "SC-001",
          title: "Login",
          xlsx: { sheet: "SC-001 Login", role: "screen" },
          meta: { author: "Alice", reviewedBy: "Bob" },
        }),
        makeBundle({
          id: "COVER",
          xlsx: { sheet: "Cover", role: "cover" },
        }),
      ],
      substitute: {
        projectMeta: { projectName: "Annot Sample", customerName: "XYZ" },
      },
    });

    expect(target.worksheets.map((s) => s.name)).toEqual(["Cover", "SC-001 Login"]);
    const screen = target.getWorksheet("SC-001 Login")!;
    expect(screen.getCell("B1").value).toBe("SC-001");
    expect(screen.getCell("B2").value).toBe("Login");
    expect(screen.getCell("B3").value).toBe("Alice");
    expect(screen.getCell("B4").value).toBe("Bob");

    const cover = target.getWorksheet("Cover")!;
    expect(cover.getCell("B1").value).toBe("Annot Sample");
    expect(cover.getCell("B2").value).toBe("XYZ");
  });

  it("skips bundles whose role has no template configured", () => {
    const target = new ExcelJS.Workbook();
    const template = makeTemplateWorkbook();
    applyTemplateLayout({
      workbook: target,
      template,
      bookConfig: { templateSheets: { screen: "個別画面テンプレ" } },
      bundles: [
        makeBundle({ id: "COVER", xlsx: { sheet: "Cover", role: "cover" } }),
        makeBundle({ id: "SC-001", xlsx: { sheet: "Login", role: "screen" } }),
      ],
    });
    expect(target.worksheets.map((s) => s.name)).toEqual(["Login"]);
  });

  it("clones once per entry in `xlsx.sheets` for multi-screen MDXs", () => {
    const target = new ExcelJS.Workbook();
    const template = makeTemplateWorkbook();
    applyTemplateLayout({
      workbook: target,
      template,
      bookConfig: { templateSheets: { screen: "個別画面テンプレ" } },
      bundles: [
        makeBundle({
          id: "SC-001",
          title: "Login",
          xlsx: {
            role: "screen",
            sheets: { default: "Login (default)", error: "Login (error)" },
          },
        }),
      ],
    });
    expect(target.worksheets.map((s) => s.name).sort()).toEqual([
      "Login (default)",
      "Login (error)",
    ]);
  });

  it("throws when the configured template sheet is missing", () => {
    const target = new ExcelJS.Workbook();
    const template = makeTemplateWorkbook();
    expect(() =>
      applyTemplateLayout({
        workbook: target,
        template,
        bookConfig: { templateSheets: { screen: "DoesNotExist" } },
        bundles: [makeBundle({ id: "X", xlsx: { role: "screen" } })],
      }),
    ).toThrow(/"DoesNotExist" not found/);
  });
});
