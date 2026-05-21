import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { ExcelMdxBundle } from "./extract.js";
import { applyPlaceholdersToSheet, resolvePlaceholders } from "./placeholder.js";

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

describe("resolvePlaceholders", () => {
  it("substitutes {id} / {title} / {purpose}", () => {
    const bundle = makeBundle({
      id: "SC-001",
      title: "Login",
      purpose: "Authenticate",
    });
    expect(resolvePlaceholders("{id}: {title}", bundle)).toBe("SC-001: Login");
    expect(resolvePlaceholders("Goal: {purpose}", bundle)).toBe("Goal: Authenticate");
  });

  it("substitutes {meta.<name>}", () => {
    const bundle = makeBundle({
      id: "X",
      meta: { author: "Alice", revision: "1.2" },
    });
    expect(resolvePlaceholders("Author: {meta.author}", bundle)).toBe("Author: Alice");
    expect(resolvePlaceholders("Rev: {meta.revision}", bundle)).toBe("Rev: 1.2");
  });

  it("falls back to projectMeta for bare {name}", () => {
    const bundle = makeBundle({ id: "X" });
    const out = resolvePlaceholders("Project: {projectName}", bundle, {
      projectMeta: { projectName: "Annot Sample" },
    });
    expect(out).toBe("Project: Annot Sample");
  });

  it("leaves unmatched placeholders verbatim for author visibility", () => {
    const bundle = makeBundle({ id: "X" });
    expect(resolvePlaceholders("Hello {nope}", bundle)).toBe("Hello {nope}");
  });

  it("handles multiple placeholders in one string", () => {
    const bundle = makeBundle({ id: "X", title: "Y" });
    expect(resolvePlaceholders("{id} - {title} - {id}", bundle)).toBe("X - Y - X");
  });

  it("resolves `{annot:date}` against the pinned renderTime", () => {
    const bundle = makeBundle({ id: "X" });
    const out = resolvePlaceholders("{annot:date}", bundle, {
      renderTime: new Date(2026, 4, 21),
    });
    expect(out).toBe("2026-05-21");
  });

  it("formats `{meta.date:yyyy/MM/dd}` from a stored ISO date", () => {
    const bundle = makeBundle({ id: "X", meta: { createdDate: "2026-05-21" } });
    const out = resolvePlaceholders("{meta.createdDate:yyyy/MM/dd}", bundle);
    expect(out).toBe("2026/05/21");
  });

  it("formats `{annot:date:yyyy年MM月dd日}` with literal Japanese tokens", () => {
    const bundle = makeBundle({ id: "X" });
    const out = resolvePlaceholders("{annot:date:yyyy年MM月dd日}", bundle, {
      renderTime: new Date(2026, 4, 21),
    });
    expect(out).toBe("2026年05月21日");
  });

  it("resolves `{annot:sheetIndex}` / `{annot:totalSheets}` from options", () => {
    const bundle = makeBundle({ id: "X" });
    const out = resolvePlaceholders("Page {annot:sheetIndex}/{annot:totalSheets}", bundle, {
      sheetIndex: 3,
      totalSheets: 8,
    });
    expect(out).toBe("Page 3/8");
  });

  it("`{annot:datetime}` returns ISO timestamp", () => {
    const bundle = makeBundle({ id: "X" });
    const dt = new Date(Date.UTC(2026, 4, 21, 12, 34, 56));
    const out = resolvePlaceholders("{annot:datetime}", bundle, { renderTime: dt });
    expect(out).toBe(dt.toISOString());
  });

  it("ignores `:format` when the value isn't a parseable date", () => {
    const bundle = makeBundle({ id: "X", title: "Login" });
    const out = resolvePlaceholders("{title:yyyy/MM/dd}", bundle);
    expect(out).toBe("Login");
  });
});

describe("applyPlaceholdersToSheet", () => {
  it("rewrites string cells in place; non-string cells untouched", () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("S");
    sheet.addRow(["{id}", 42, "Title: {title}"]);
    const bundle = makeBundle({ id: "SC-001", title: "Login" });
    applyPlaceholdersToSheet(sheet, bundle);
    expect(sheet.getCell("A1").value).toBe("SC-001");
    expect(sheet.getCell("B1").value).toBe(42);
    expect(sheet.getCell("C1").value).toBe("Title: Login");
  });
});
