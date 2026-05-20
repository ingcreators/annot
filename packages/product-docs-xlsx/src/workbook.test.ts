import { describe, expect, it } from "vitest";

import type { ExcelMdxBundle } from "./extract.js";
import { buildEmptyWorkbook, groupBundlesByBook, writeWorkbookToBytes } from "./workbook.js";

const PK_MAGIC = [0x50, 0x4b]; // ZIP signature — XLSX is a ZIP under the hood.

function makeBundle(book: string | undefined, id: string): ExcelMdxBundle {
  return {
    mdxPath: `${id}.mdx`,
    source: "",
    frontmatter: {
      id,
      xlsx: book ? { book } : undefined,
    },
    screens: [],
    overlays: [],
    history: [],
    snapshotYaml: "",
    attributesYaml: "",
  };
}

describe("buildEmptyWorkbook", () => {
  it("creates an empty workbook with the book name as title", () => {
    const wb = buildEmptyWorkbook({ book: "Screen spec", bundles: [] });
    expect(wb.title).toBe("Screen spec");
    expect(wb.worksheets).toHaveLength(0);
  });

  it("survives writeBuffer — still emits a valid empty xlsx (ZIP)", async () => {
    const wb = buildEmptyWorkbook({ book: "Screen spec", bundles: [] });
    // ExcelJS refuses to write a workbook with zero sheets, so add
    // a stub sheet for the byte-level check.
    wb.addWorksheet("stub");
    const bytes = await writeWorkbookToBytes(wb);
    expect(bytes.length).toBeGreaterThan(100);
    expect(Array.from(bytes.slice(0, 2))).toEqual(PK_MAGIC);
  });
});

describe("groupBundlesByBook", () => {
  it("groups bundles by frontmatter xlsx.book", () => {
    const grouped = groupBundlesByBook([
      makeBundle("A", "1"),
      makeBundle("B", "2"),
      makeBundle("A", "3"),
    ]);
    expect([...grouped.keys()].sort()).toEqual(["A", "B"]);
    expect(grouped.get("A")?.map((b) => b.frontmatter.id)).toEqual(["1", "3"]);
    expect(grouped.get("B")?.map((b) => b.frontmatter.id)).toEqual(["2"]);
  });

  it("uses defaultBook when frontmatter has no xlsx.book", () => {
    const grouped = groupBundlesByBook(
      [makeBundle(undefined, "1"), makeBundle("Z", "2")],
      "Default",
    );
    expect([...grouped.keys()].sort()).toEqual(["Default", "Z"]);
    expect(grouped.get("Default")?.[0]?.frontmatter.id).toBe("1");
  });

  it("drops bundles with no book and no defaultBook", () => {
    const grouped = groupBundlesByBook([makeBundle(undefined, "1")]);
    expect([...grouped.keys()]).toEqual([]);
  });
});
