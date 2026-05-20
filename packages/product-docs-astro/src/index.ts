// Public surface for `@ingcreators/annot-product-docs-astro`.
//
// Phase 2 of `docs/plans/living-product-docs.md`. PR 1 ships the
// scaffold + the `productDocsIntegration()` Astro integration
// boilerplate (no-op hooks). Subsequent PRs fill in the Image
// Service (PR 2) and the seven Astro components (PR 3).

export type { ProductDocsIntegrationOptions } from "./integration.js";
export { productDocsIntegration } from "./integration.js";
