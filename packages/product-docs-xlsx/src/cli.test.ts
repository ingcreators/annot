import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { main } from "./cli.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "annot-docs-xlsx-cli-test-"));
}

async function writeScreenMdx(cwd: string, id: string, book: string): Promise<void> {
  await mkdir(join(cwd, "docs"), { recursive: true });
  await writeFile(
    join(cwd, "docs", `${id}.mdx`),
    `---
annot:
  id: ${id}
  title: ${id}
  xlsx:
    book: ${book}
    sheet: ${id}
    role: screen
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

<Screen id="${id.toLowerCase()}" src="./x.png">

<Overlay match={{ role: "button", name: "OK" }}>OK</Overlay>

</Screen>
`,
    "utf8",
  );
}

describe("annot-docs-xlsx render", () => {
  it("usage when no command is given", async () => {
    const lines: string[] = [];
    const exit = await main(["node", "annot-docs-xlsx"], {
      stdout: (l) => lines.push(l),
      stderr: (l) => lines.push(l),
    });
    expect(exit).toBe(0);
    expect(lines.join("\n")).toMatch(/annot-docs-xlsx <command>/);
  });

  it("exits 0 with friendly message when no MDX has annot frontmatter", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "docs"), { recursive: true });
    await writeFile(join(cwd, "docs", "plain.mdx"), "# plain\n");
    const out: string[] = [];
    const exit = await main(["node", "annot-docs-xlsx", "render"], {
      cwd,
      stdout: (l) => out.push(l),
      stderr: (l) => out.push(l),
    });
    expect(exit).toBe(0);
    expect(out.join("\n")).toMatch(/no MDX files with `annot:` frontmatter/);
  });

  it("emits one .xlsx per book under --out", async () => {
    const cwd = await makeTempDir();
    await writeScreenMdx(cwd, "SC-001", "Spec");
    await writeScreenMdx(cwd, "SC-002", "Spec");
    await writeScreenMdx(cwd, "SU-001", "Manual");
    const out: string[] = [];
    const exit = await main(["node", "annot-docs-xlsx", "render", "--out", "dist/xlsx"], {
      cwd,
      stdout: (l) => out.push(l),
      stderr: (l) => out.push(l),
    });
    expect(exit).toBe(0);
    const entries = await readdir(join(cwd, "dist/xlsx"));
    expect(entries.sort()).toEqual(["Manual.xlsx", "Spec.xlsx"]);
  });

  it("--book restricts output to one book", async () => {
    const cwd = await makeTempDir();
    await writeScreenMdx(cwd, "SC-001", "Spec");
    await writeScreenMdx(cwd, "SU-001", "Manual");
    const exit = await main(["node", "annot-docs-xlsx", "render", "--book", "Spec"], {
      cwd,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exit).toBe(0);
    const entries = await readdir(join(cwd, "dist/xlsx"));
    expect(entries).toEqual(["Spec.xlsx"]);
  });

  it("emitted .xlsx opens as a valid workbook with the expected sheets", async () => {
    const cwd = await makeTempDir();
    await writeScreenMdx(cwd, "SC-001", "Spec");
    await writeScreenMdx(cwd, "SC-002", "Spec");
    const exit = await main(["node", "annot-docs-xlsx", "render"], {
      cwd,
      stdout: () => {},
      stderr: () => {},
    });
    expect(exit).toBe(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(cwd, "dist/xlsx/Spec.xlsx"));
    expect(wb.worksheets.map((s) => s.name).sort()).toEqual(["SC-001", "SC-002"]);
    const sheet = wb.getWorksheet("SC-001")!;
    expect(sheet.getCell("A1").value).toBe("ID");
    expect(sheet.getCell("B1").value).toBe("SC-001");
  });

  it("--book that doesn't exist returns exit 1", async () => {
    const cwd = await makeTempDir();
    await writeScreenMdx(cwd, "SC-001", "Spec");
    const stdout: string[] = [];
    const exit = await main(["node", "annot-docs-xlsx", "render", "--book", "Nope"], {
      cwd,
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(exit).toBe(1);
    expect(stdout.join("\n")).toMatch(/"Nope" not found/);
  });
});
