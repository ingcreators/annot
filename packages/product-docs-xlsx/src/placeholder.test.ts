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

  it("ignores `:format` suffix tokens (reserved for PR 5)", () => {
    const bundle = makeBundle({ id: "X" });
    expect(resolvePlaceholders("{annot:date}", bundle)).toBe("{annot:date}");
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
