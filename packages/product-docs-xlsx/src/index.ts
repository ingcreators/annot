// Public surface for `@ingcreators/annot-product-docs-xlsx`.
//
// Phase 3 of `docs/plans/living-product-docs.md`. PR 1 (this
// commit) ships the scaffold + `extract.ts` (MDX → normalised
// bundle) + `workbook.ts` (empty workbook emitter + book
// grouping). Subsequent PRs fill in:
//
//   PR 2 — default no-template layout (cover / list / per-screen).
//   PR 3 — custom template loading + `{var}` placeholders.
//   PR 4 — named-range image / table / list inserts.
//   PR 5 — `{annot:date}` special vars + multi-screen `sheets` map.
//   PR 6 — multi-book CLI integration + Mermaid → PNG embed.

export type { CliOptions } from "./cli.js";
export { main, main as cliMain } from "./cli.js";

export type { ApplyDefaultLayoutInput } from "./default-layout.js";
export {
  applyDefaultLayout,
  sanitiseSheetName,
  sortBundlesForLayout,
} from "./default-layout.js";

export type {
  ExcelMdxBundle,
  ExtractFromParsedOptions,
  NormalisedOverlay,
  NormalisedScreen,
} from "./extract.js";
export { extractFromParsed, extractMdxFile } from "./extract.js";

export type { NamedRangeWriteInput } from "./named-range.js";
export { applyNamedRanges } from "./named-range.js";

export type { SubstituteOptions } from "./placeholder.js";
export {
  applyPlaceholders,
  applyPlaceholdersToSheet,
  resolvePlaceholders,
} from "./placeholder.js";

export type { ApplyTemplateInput } from "./template.js";
export { applyTemplateLayout, loadTemplateWorkbook } from "./template.js";

export type { BuildWorkbookInput } from "./workbook.js";
export {
  buildEmptyWorkbook,
  groupBundlesByBook,
  writeWorkbookToBytes,
} from "./workbook.js";
