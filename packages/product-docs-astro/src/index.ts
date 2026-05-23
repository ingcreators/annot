// Public surface for `@ingcreators/annot-product-docs-astro`.
//
// Phase 2 of `docs/plans/living-product-docs.md`. PR 1 ships the
// scaffold + the `productDocsIntegration()` Astro integration
// boilerplate (no-op hooks). Subsequent PRs fill in the Image
// Service (PR 2) and the seven Astro components (PR 3).

export type { CacheKeyInput, FileCache } from "./cache.js";
export {
  cacheKey,
  createFileCache,
  createMemoryCache,
  RENDER_PIPELINE_VERSION,
} from "./cache.js";
export type {
  GraphDirection,
  GraphEdge,
  Match,
  OverlayIntent,
  ScreenListEntry,
  TransitionEntry,
} from "./components/types.js";
export type { ResolvedEditorConfig } from "./editor-config-virtual.js";
export { ANNOT_EDITOR_CONFIG } from "./editor-config-virtual.js";
export type {
  ProductDocsEditorOptions,
  ProductDocsIntegrationOptions,
} from "./integration.js";
export {
  editorConfigVirtualPlugin,
  productDocsIntegration,
  resolveEditorConfig,
} from "./integration.js";
export type {
  RenderAnnotatedScreenOptions,
  RenderResult,
} from "./render.js";
// `parseSnapshotBoxes`, `resolveMdxAnnotations`,
// `svgFromBboxAnnotations` (and other MDX helpers) moved to
// `@ingcreators/annot-product-docs` in Phase 4 of
// `docs/plans/playwright-screenshot-fixture-relayer.md`.
// `render.ts` re-exports `resolveMdxAnnotations` +
// `svgFromBboxAnnotations` for one deprecation cycle; new code
// should import them from `@ingcreators/annot-product-docs`
// directly. `parseSnapshotBoxes` and other helpers (buildBadgeAnnotations,
// svgFromBadges, emptyAnnotationsSvg, BoxedEntry) are likewise
// available from product-docs.
export { renderAnnotatedScreen, resolveMdxAnnotations, svgFromBboxAnnotations } from "./render.js";
