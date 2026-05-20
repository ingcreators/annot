// Public surface for `@ingcreators/annot-product-docs`.
//
// Phase 1 of `docs/plans/living-product-docs.md`. PR 2 lands the
// MDX parser, match resolver, project config, and Zod schemas;
// PRs 3–4 add the Playwright `screen` fixture and the
// `annot docs init / sync / lint` CLI on top.

export {
  annotDocsConfigSchema,
  annotFrontmatterSchema,
  defineConfig,
  isScreenRole,
} from "./config.js";
export type { Screen, ScreenCaptureOptions } from "./fixture.js";
export {
  captureScreen,
  collectAttributesYaml,
  DEFAULT_ATTR_WHITELIST,
  test,
} from "./fixture.js";
export type { ParseMdxOptions } from "./mdx.js";
export { parseMdx, parseMdxFile, updateCommentBlocks } from "./mdx.js";
export type {
  ResolveFailureKind,
  ResolveResult,
  SnapshotEntry,
} from "./resolver.js";
export {
  parseSnapshot,
  resolveMatch,
  resolveOverlays,
} from "./resolver.js";

export type {
  AnnotCommentBlocks,
  AnnotFrontmatter,
  AnnotFrontmatterRole,
  AnnotMeta,
  AnnotXlsxConfig,
  HistoryEntrySpec,
  MatchKey,
  OverlayIntent,
  OverlaySpec,
  ParsedMdx,
  ScreenListSpec,
  ScreenSpec,
  TransitionSpec,
} from "./types.js";

export type { AnnotDocsConfig, BookConfig } from "./types-config.js";
