import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { ExcelMdxBundle } from "./extract.js";
import { applyNamedRanges } from "./named-range.js";

function makeBundle(
  fm: ExcelMdxBundle["frontmatter"],
  overlays: ExcelMdxBundle["overlays"] = [],
  history: ExcelMdxBundle["history"] = [],
  screens: ExcelMdxBundle["screens"] = [],
): ExcelMdxBundle {
  return {
    mdxPath: `${fm.id}.mdx`,
    source: "",
    frontmatter: fm,
    screens,
    overlays,
    history,
    snapshotYaml: '- textbox "Email" [ref=e1]',
    attributesYaml: 'textbox "Email":\n  type: email',
  };
}

/** Tiny 1×1 PNG generated offline — base64 of a single white
 *  pixel. The bytes don't matter for these tests; we just need
 *  the embedding pathway to accept them. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Construct a workbook with a sheet that has a named range
 * covering `range` (e.g. "B5:F10"). ExcelJS's defined-names
 * API requires each cell in the range to carry the name in
 * its `names` list — adding the workbook-level definition AND
 * assigning per-cell names is what `worksheet.getCell.names`
 * surfaces during enumeration.
 */
function makeNamedRangeFixture(
  name: string,
  range: string,
): {
  workbook: ExcelJS.Workbook;
  sheet: ExcelJS.Worksheet;
} {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("S");
  const [start, end] = range.split(":") as [string, string | undefined];
  const startBox = parseCellAddress(start);
  const endBox = parseCellAddress(end ?? start);
  for (let r = startBox.row; r <= endBox.row; r++) {
    for (let c = startBox.col; c <= endBox.col; c++) {
      const cell = sheet.getCell(r, c);
      cell.value = "";
      cell.names = [...(cell.names ?? []), name];
    }
  }
  return { workbook: wb, sheet };
}

function parseCellAddress(addr: string): { row: number; col: number } {
  const m = addr.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`bad address: ${addr}`);
  const letters = m[1]!;
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return { row: Number.parseInt(m[2]!, 10), col };
}

describe("applyNamedRanges — annotItemTable", () => {
  it("writes a 5-column overlay table starting at the range's top-left", () => {
    const { workbook, sheet } = makeNamedRangeFixture("annotItemTable", "B5:F10");
    const bundle = makeBundle({ id: "X" }, [
      {
        screenId: "login",
        number: 1,
        intent: "required",
        matchLabel: 'textbox "Email"',
        matchRole: "textbox",
        matchName: "Email",
        body: "Enter email",
      },
      {
        screenId: "login",
        number: 2,
        intent: "action",
        matchLabel: 'button "Sign in"',
        matchRole: "button",
        matchName: "Sign in",
        body: "Submit",
      },
    ]);
    applyNamedRanges({ workbook, bundle });
    // Header at B5
    expect(sheet.getCell("B5").value).toBe("#");
    expect(sheet.getCell("C5").value).toBe("Role");
    // First overlay at row 6
    expect(sheet.getCell("B6").value).toBe(1);
    expect(sheet.getCell("C6").value).toBe("textbox");
    expect(sheet.getCell("D6").value).toBe("Email");
    expect(sheet.getCell("B7").value).toBe(2);
  });
});

describe("applyNamedRanges — annotHistory", () => {
  it("writes Version / Date / Author / Notes columns", () => {
    const { workbook, sheet } = makeNamedRangeFixture("annotHistory", "A1:D10");
    const bundle = makeBundle(
      { id: "HIST" },
      [],
      [
        { version: "1.0", date: "2026-01-01", author: "A", body: "Initial" },
        { version: "1.1", date: "2026-02-01", author: "B", body: "Fixes" },
      ],
    );
    applyNamedRanges({ workbook, bundle });
    expect(sheet.getCell("A1").value).toBe("Version");
    expect(sheet.getCell("A2").value).toBe("1.0");
    expect(sheet.getCell("D3").value).toBe("Fixes");
  });
});

describe("applyNamedRanges — annotList", () => {
  it("writes ID / Title / Screens / Overlays for every screen bundle", () => {
    const { workbook, sheet } = makeNamedRangeFixture("annotList", "A1:D20");
    const bundle = makeBundle({ id: "LIST" });
    const all = [
      makeBundle(
        { id: "SC-001", title: "Login", xlsx: { role: "screen" } },
        [],
        [],
        [{ id: "login", src: "./x.png", overlayCount: 2 }],
      ),
      makeBundle({ id: "SC-002", title: "Dashboard", xlsx: { role: "screen" } }),
    ];
    applyNamedRanges({ workbook, bundle, allBundles: all });
    expect(sheet.getCell("A1").value).toBe("ID");
    expect(sheet.getCell("A2").value).toBe("SC-001");
    expect(sheet.getCell("B2").value).toBe("Login");
    expect(sheet.getCell("A3").value).toBe("SC-002");
  });
});

describe("applyNamedRanges — annotSnapshot / annotAttributes", () => {
  it("writes the verbatim YAML into the top-left cell of the range", () => {
    const { workbook, sheet } = makeNamedRangeFixture("annotSnapshot", "B2:F12");
    const bundle = makeBundle({ id: "X" });
    applyNamedRanges({ workbook, bundle });
    expect(sheet.getCell("B2").value).toBe('- textbox "Email" [ref=e1]');
  });

  it("writes attributes block similarly", () => {
    const { workbook, sheet } = makeNamedRangeFixture("annotAttributes", "B2:F12");
    const bundle = makeBundle({ id: "X" });
    applyNamedRanges({ workbook, bundle });
    expect(sheet.getCell("B2").value).toBe('textbox "Email":\n  type: email');
  });
});

describe("applyNamedRanges — annotImage", () => {
  it("embeds the supplied default PNG into the range without throwing", () => {
    const { workbook } = makeNamedRangeFixture("annotImage", "B2:G15");
    const bundle = makeBundle(
      { id: "X" },
      [],
      [],
      [{ id: "login", src: "./x.png", overlayCount: 0 }],
    );
    applyNamedRanges({
      workbook,
      bundle,
      defaultImage: new Uint8Array(PNG_BYTES),
    });
    // ExcelJS exposes the embedded images via `workbook.model.media`;
    // not all versions surface it via a public API, so the test
    // settles for "didn't throw" + at least one image registered.
    expect(workbook.getImage(0)).toBeTruthy();
  });

  it("looks up imagesByScreenId for `annotImage_<screenId>`", () => {
    const { workbook } = makeNamedRangeFixture("annotImage_login", "B2:G15");
    const bundle = makeBundle({ id: "X" });
    applyNamedRanges({
      workbook,
      bundle,
      imagesByScreenId: { login: new Uint8Array(PNG_BYTES) },
    });
    expect(workbook.getImage(0)).toBeTruthy();
  });
});

describe("applyNamedRanges — non-annot names are ignored", () => {
  it("does not touch cells whose only name is unrelated", () => {
    const { workbook, sheet } = makeNamedRangeFixture("OtherName", "B2:D4");
    const bundle = makeBundle({ id: "X" });
    applyNamedRanges({ workbook, bundle });
    expect(sheet.getCell("B2").value).toBe("");
  });
});
