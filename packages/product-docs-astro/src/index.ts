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

export type { ProductDocsIntegrationOptions } from "./integration.js";
export { productDocsIntegration } from "./integration.js";
export type {
  RenderAnnotatedScreenOptions,
  RenderResult,
} from "./render.js";
export {
  parseSnapshotBoxes,
  renderAnnotatedScreen,
} from "./render.js";
