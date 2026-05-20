# `@ingcreators/annot-product-docs-xlsx`

Excel adapter for the
[`@ingcreators/annot-product-docs`](../product-docs) core.
Walks MDX files with `annot:` frontmatter, fills customer-supplied
Excel templates via `{var}` placeholders + named ranges, and
emits one `.xlsx` per book.

Phase 3 of [`docs/plans/living-product-docs.md`](../../docs/plans/living-product-docs.md).
This PR (Phase 3 PR 1) ships the scaffold + `extract.ts`
(MDX → normalised bundle) + `workbook.ts` (empty workbook
emitter + book grouping). Subsequent PRs (2–6) fill in default
layout, template support, named ranges, special vars,
multi-screen sheets, and CLI integration.

## Tier

Tier A — Node-only, no DOM. Depends on
[`exceljs`](https://github.com/exceljs/exceljs) for workbook
authoring.

## Status

`private: true` in the workspace until Phase 7 flips it for
publication via the existing Trusted Publishing pipeline.

## License

Apache-2.0.
