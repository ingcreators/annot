// Public surface for `@ingcreators/annot-product-docs`.
//
// Phase 1 of `docs/plans/living-product-docs.md`. PR 2 lands the
// MDX parser, match resolver, project config, and Zod schemas;
// PRs 3–4 add the Playwright `screen` fixture and the
// `annot docs init / sync / lint` CLI on top.

// Side-effect import: belt-and-braces registration of the MDX
// resolver into `@ingcreators/annot-playwright`'s
// `annotSourceResolvers` registry. Loaded so callers who reach
// for ANY symbol on the package root (not just `test` / `screen`
// from `./fixture.js`) still get the resolver active before they
// `page.screenshot({ annot: { mdx } })`. The Symbol-keyed
// sentinel on the resolver reference makes re-import a no-op.
import "./playwright-screenshot-hook.js";

export type { AnnotationsFile, OverlayEntry } from "./annotations-yaml.js";
export {
  ANNOTATIONS_YAML_VERSION,
  AnnotationsYamlError,
  parseAnnotationsYaml,
  serializeAnnotationsYaml,
} from "./annotations-yaml.js";
export {
  filterAnnotMdxFiles,
  main,
  walkMdx,
} from "./cli.js";
export {
  annotDocsConfigSchema,
  annotFrontmatterSchema,
  defineConfig,
  isScreenRole,
} from "./config.js";
export type { LegacyOverlayUsage } from "./deprecation.js";
export {
  _resetLegacyOverlayDedupForTests,
  formatLegacyOverlayWarning,
  warnLegacyOverlay,
} from "./deprecation.js";
export type {
  DetectDriftOptions,
  DriftFinding,
  DriftKind,
  DriftSeverity,
} from "./drift.js";
export {
  detectDrift,
  detectDriftFromElementTree,
  detectDriftFromYaml,
  elementTreeToSnapshotEntries,
  isLintableScreen,
  lintableScreens,
  summariseDrift,
} from "./drift.js";
export type {
  ProductDocs,
  ProductDocsSyncOptions,
  // Deprecated back-compat aliases (Phase 3 of the relayer plan):
  // re-exported by the same names that shipped in 0.2.x. Removal
  // is scheduled for the deprecation window noted in
  // `living-spec-authoring-roadmap.md` OQ-08.
  Screen,
  ScreenCaptureOptions,
} from "./fixture.js";
export {
  captureScreen,
  collectAttributesYaml,
  DEFAULT_ATTR_WHITELIST,
  syncProductDocs,
  test,
} from "./fixture.js";
export type { ParseMdxOptions } from "./mdx.js";
export { parseMdx, parseMdxFile, updateCommentBlocks } from "./mdx.js";
export type { BoxedEntry } from "./mdx-annotations.js";
export {
  buildBadgeAnnotations,
  buildBadgeAnnotationsFromYaml,
  elementTreeToBoxedEntries,
  emptyAnnotationsSvg,
  parseSnapshotBoxes,
  resolveMdxAnnotations,
  svgFromBadges,
  svgFromBboxAnnotations,
} from "./mdx-annotations.js";
export type {
  MigrateOverlaysOptions,
  OverlayMigrationFileResult,
  ScreenOverlayMigrationResult,
} from "./migrate-overlays-to-annotations.js";
export {
  buildAnnotationsFile,
  migrateOverlaysToAnnotationsFile,
} from "./migrate-overlays-to-annotations.js";
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
  AnnotCalloutSpec,
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
