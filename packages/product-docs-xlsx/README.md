# `@ingcreators/annot-product-docs-xlsx`

[![npm](https://img.shields.io/npm/v/@ingcreators/annot-product-docs-xlsx.svg)](https://www.npmjs.com/package/@ingcreators/annot-product-docs-xlsx)
[![license](https://img.shields.io/npm/l/@ingcreators/annot-product-docs-xlsx.svg)](https://github.com/ingcreators/annot/blob/main/LICENSE)

Excel adapter for
[`@ingcreators/annot-product-docs`](../product-docs). Walks MDX
files with `annot:` frontmatter, fills customer-supplied Excel
templates via `{var}` placeholders + Excel Named Ranges, and
emits one `.xlsx` per book.

Targets the Japanese SI 画面設計書 use case where customers
expect a specific corporate Excel template, populated from a
code-driven source of truth.

Phase 3 of
[`docs/plans/living-product-docs.md`](https://github.com/ingcreators/annot/blob/main/docs/plans/living-product-docs.md).

## Install

```sh
pnpm add @ingcreators/annot-product-docs-xlsx
```

## CLI

```sh
annot-docs-xlsx render --root docs --out dist/xlsx
annot-docs-xlsx render --book "Screen spec"
```

Reads `annot-docs.config.ts` from the project root; uses a
customer template when configured else applies the OSS
default layout.

## Config

```ts
// annot-docs.config.ts
import { defineConfig } from "@ingcreators/annot-product-docs";

export default defineConfig({
  meta: {
    projectName: "顧客管理システム",
    customerName: "株式会社XYZ",
  },
  xlsx: {
    defaultBook: "画面設計書",
    books: {
      "画面設計書": {
        template: "./templates/customer-screen-spec.xlsx",
        templateSheets: {
          cover: "表紙テンプレ",
          history: "改訂履歴テンプレ",
          list: "画面一覧テンプレ",
          screen: "個別画面テンプレ",
        },
      },
    },
  },
});
```

## Placeholders

In template cells:

```
{id}                                  → annot.id
{title}                               → annot.title
{meta.author}                         → frontmatter meta.author
{projectName}                         → project meta.projectName
{annot:date}                          → "2026-05-21"
{annot:date:yyyy年MM月dd日}           → "2026年05月21日"
{meta.createdDate:yyyy/MM/dd}         → "2026/05/21"
{annot:sheetIndex}/{annot:totalSheets} → "3/12"
```

Unmatched placeholders pass through verbatim so authoring
typos are visible at review time.

## Named ranges

Define Excel Named Ranges with the `annot` prefix in the
template; the adapter populates each one:

| Range | Content |
|---|---|
| `annotImage` | annotated PNG for the MDX (single-screen) |
| `annotImage_<screenId>` | per-screen PNG (multi-screen MDX) |
| `annotItemTable` | overlay table (# / Role / Name / Intent / Notes) |
| `annotHistory` | revision history rows |
| `annotList` | screen index across the book |
| `annotSnapshot` | verbatim aria-snapshot YAML |
| `annotAttributes` | verbatim HTML attribute extraction |

Excel named-range identifiers can't contain `:`, so the
per-screen variant uses an underscore.

## Tier

Tier A — Node-only, no DOM. Depends on
[`exceljs`](https://github.com/exceljs/exceljs).

## License

Apache-2.0.
