// Empty-workbook emitter — Phase 3 PR 1 of
// `docs/plans/living-product-docs.md`.
//
// PR 1 ships only the skeleton: a function that produces an
// `ExcelJS.Workbook` with no sheets yet. The default-layout
// fill lands in PR 2 (cover / list / per-screen sheets); the
// custom-template branch lands in PR 3; named-range writes
// land in PR 4. This file is the seam: everything downstream
// hangs off `buildEmptyWorkbook` so subsequent PRs only need
// to add per-role builders.

import ExcelJS from "exceljs";

import type { ExcelMdxBundle } from "./extract.js";

export interface BuildWorkbookInput {
  /** Book name from MDX frontmatter (`xlsx.book`). All MDXs for
   *  this book end up in the same workbook. */
  book: string;
  /** All MDX bundles assigned to this book. */
  bundles: ExcelMdxBundle[];
}

/**
 * Produce an `ExcelJS.Workbook` with the book name set as the
 * workbook title but no sheets yet. PR 2 of Phase 3 fills it
 * with the default layout; PR 3 adds template support.
 */
export function buildEmptyWorkbook(input: BuildWorkbookInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "@ingcreators/annot-product-docs-xlsx";
  wb.created = new Date();
  wb.title = input.book;
  return wb;
}

/**
 * Serialise a workbook to PNG bytes. Wrapper around ExcelJS's
 * `xlsx.writeBuffer` that normalises the return type to
 * `Uint8Array` — ExcelJS uses Node `Buffer` natively.
 */
export async function writeWorkbookToBytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer | Buffer;
  if (buf instanceof Buffer) {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return new Uint8Array(buf);
}

/**
 * Group a list of `ExcelMdxBundle`s by their `xlsx.book` value.
 * MDXs without a book fall under the optional `defaultBook`
 * key (typically wired from the project config); MDXs without
 * either get filtered out.
 */
export function groupBundlesByBook(
  bundles: ExcelMdxBundle[],
  defaultBook?: string,
): Map<string, ExcelMdxBundle[]> {
  const out = new Map<string, ExcelMdxBundle[]>();
  for (const bundle of bundles) {
    const book = bundle.frontmatter.xlsx?.book ?? defaultBook;
    if (!book) continue;
    let list = out.get(book);
    if (!list) {
      list = [];
      out.set(book, list);
    }
    list.push(bundle);
  }
  return out;
}
