// Public surface for `@ingcreators/annot-product-docs`.
//
// Phase 1 of `docs/plans/living-product-docs.md`. PR 1 ships the
// package scaffold only; PRs 2–4 fill it with the MDX parser,
// match resolver, project config, Playwright `screen` fixture,
// and the `annot docs init / sync / lint` CLI. Until then this
// module intentionally re-exports nothing — the file exists so
// `vite build` has an entry point and `tsc --noEmit` has
// something to typecheck.
export {};
