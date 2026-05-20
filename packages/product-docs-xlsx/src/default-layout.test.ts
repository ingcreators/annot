import { describe, expect, it } from "vitest";

import { applyDefaultLayout, sanitiseSheetName, sortBundlesForLayout } from "./default-layout.js";
import type { ExcelMdxBundle } from "./extract.js";
import { buildEmptyWorkbook } from "./workbook.js";

function makeBundle(
  fm: ExcelMdxBundle["frontmatter"],
  overlays: ExcelMdxBundle["overlays"] = [],
  screens: ExcelMdxBundle["screens"] = [],
  history: ExcelMdxBundle["history"] = [],
): ExcelMdxBundle {
  return {
    mdxPath: `${fm.id}.mdx`,
    source: "",
    frontmatter: fm,
    screens,
    overlays,
    history,
    snapshotYaml: "",
    attributesYaml: "",
  };
}

describe("sanitiseSheetName", () => {
  it("strips forbidden characters", () => {
    expect(sanitiseSheetName("a/b\\c?d*e[f]g:h")).toBe("a_b_c_d_e_f_g_h");
  });
  it("truncates to 31 chars", () => {
    expect(sanitiseSheetName("x".repeat(40)).length).toBe(31);
  });
  it("falls back to Sheet when empty", () => {
    expect(sanitiseSheetName("")).toBe("Sheet");
  });
});

describe("sortBundlesForLayout", () => {
  it("orders cover before history before list before screen before reference", () => {
    const bundles = [
      makeBundle({ id: "X", xlsx: { role: "reference" } }),
      makeBundle({ id: "S", xlsx: { role: "screen" } }),
      makeBundle({ id: "C", xlsx: { role: "cover" } }),
      makeBundle({ id: "L", xlsx: { role: "list" } }),
      makeBundle({ id: "H", xlsx: { role: "history" } }),
    ];
    const sorted = sortBundlesForLayout(bundles);
    expect(sorted.map((b) => b.frontmatter.id)).toEqual(["C", "H", "L", "S", "X"]);
  });

  it("breaks ties by order field then file path", () => {
    const bundles = [
      makeBundle({ id: "B", xlsx: { role: "screen", order: 100 } }),
      makeBundle({ id: "A", xlsx: { role: "screen", order: 100 } }),
      makeBundle({ id: "C", xlsx: { role: "screen", order: 50 } }),
    ];
    const sorted = sortBundlesForLayout(bundles);
    expect(sorted.map((b) => b.frontmatter.id)).toEqual(["C", "A", "B"]);
  });
});

describe("applyDefaultLayout", () => {
  it("creates one sheet per bundle, named per xlsx.sheet when supplied", () => {
    const wb = buildEmptyWorkbook({ book: "X", bundles: [] });
    applyDefaultLayout({
      workbook: wb,
      bundles: [
        makeBundle({ id: "SC-001", xlsx: { role: "screen", sheet: "Login" } }, [
          {
            screenId: "login",
            number: 1,
            intent: "required",
            matchLabel: 'textbox "Email"',
            matchRole: "textbox",
            matchName: "Email",
            body: "**Email** body",
          },
        ]),
      ],
    });
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Login"]);
    const sheet = wb.worksheets[0]!;
    // Row 1 = ID / SC-001
    expect(sheet.getCell("A1").value).toBe("ID");
    expect(sheet.getCell("B1").value).toBe("SC-001");
  });

  it("falls back to role-default names when no xlsx.sheet", () => {
    const wb = buildEmptyWorkbook({ book: "X", bundles: [] });
    applyDefaultLayout({
      workbook: wb,
      bundles: [
        makeBundle({ id: "COVER", xlsx: { role: "cover" } }),
        makeBundle(
          { id: "HIST", xlsx: { role: "history" } },
          [],
          [],
          [{ version: "1.0", date: "2026-01-01", author: "A", body: "Initial" }],
        ),
        makeBundle({ id: "LIST", xlsx: { role: "list" } }),
        makeBundle(
          { id: "SC-001", xlsx: { role: "screen" }, title: "Login" },
          [],
          [{ id: "login", src: "./x.png", overlayCount: 0 }],
        ),
      ],
    });
    expect(wb.worksheets.map((s) => s.name)).toEqual(["表紙", "改訂履歴", "画面一覧", "Login"]);
  });

  it("renders a history sheet with one row per entry", () => {
    const wb = buildEmptyWorkbook({ book: "X", bundles: [] });
    applyDefaultLayout({
      workbook: wb,
      bundles: [
        makeBundle(
          { id: "HIST", xlsx: { role: "history" } },
          [],
          [],
          [
            { version: "1.0", date: "2026-01-01", author: "Alice", body: "Initial draft" },
            { version: "1.1", date: "2026-02-01", author: "Bob", body: "Review fixes" },
          ],
        ),
      ],
    });
    const sheet = wb.worksheets[0]!;
    expect(sheet.getCell("A1").value).toBe("Version");
    expect(sheet.getCell("A2").value).toBe("1.0");
    expect(sheet.getCell("D2").value).toBe("Initial draft");
    expect(sheet.getCell("A3").value).toBe("1.1");
  });

  it("renders a list sheet from all screen-role bundles", () => {
    const wb = buildEmptyWorkbook({ book: "X", bundles: [] });
    const bundles = [
      makeBundle({ id: "LIST", xlsx: { role: "list" } }),
      makeBundle(
        { id: "SC-001", xlsx: { role: "screen" }, title: "Login" },
        [],
        [{ id: "login", src: "./x.png", overlayCount: 1 }],
      ),
      makeBundle(
        { id: "SC-002", xlsx: { role: "screen" }, title: "Dashboard" },
        [],
        [{ id: "dashboard", src: "./y.png", overlayCount: 0 }],
      ),
    ];
    applyDefaultLayout({ workbook: wb, bundles });
    const list = wb.worksheets.find((s) => s.name === "画面一覧")!;
    expect(list.getCell("A1").value).toBe("ID");
    expect(list.getCell("A2").value).toBe("SC-001");
    expect(list.getCell("B2").value).toBe("Login");
    expect(list.getCell("A3").value).toBe("SC-002");
  });

  it("emits a screen sheet with header rows + overlay table", () => {
    const wb = buildEmptyWorkbook({ book: "X", bundles: [] });
    applyDefaultLayout({
      workbook: wb,
      bundles: [
        makeBundle(
          {
            id: "SC-001",
            xlsx: { role: "screen", sheet: "Login" },
            title: "Login screen",
            purpose: "Enter credentials",
          },
          [
            {
              screenId: "login",
              number: 1,
              intent: "required",
              matchLabel: 'textbox "Email"',
              matchRole: "textbox",
              matchName: "Email",
              body: "**Email** body",
            },
            {
              screenId: "login",
              number: 2,
              intent: "action",
              matchLabel: 'button "Sign in"',
              matchRole: "button",
              matchName: "Sign in",
              body: "Click to submit",
            },
          ],
        ),
      ],
    });
    const sheet = wb.worksheets[0]!;
    expect(sheet.getCell("B1").value).toBe("SC-001");
    expect(sheet.getCell("B2").value).toBe("Login screen");
    expect(sheet.getCell("B3").value).toBe("Enter credentials");
    // Header row 5
    expect(sheet.getCell("A5").value).toBe("#");
    expect(sheet.getCell("B5").value).toBe("Role");
    // First overlay row 6
    expect(sheet.getCell("A6").value).toBe(1);
    expect(sheet.getCell("B6").value).toBe("textbox");
    expect(sheet.getCell("C6").value).toBe("Email");
    expect(sheet.getCell("A7").value).toBe(2);
  });
});
