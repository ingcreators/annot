# `@ingcreators/annot-product-docs`

Living product docs core — parse `.mdx` files with an `annot:`
frontmatter block, resolve `<Overlay match>` keys against live
Playwright `aria-snapshot` trees, run drift detection against the
rendered UI, and ship a Playwright `screen` fixture that
re-captures + re-syncs MDX snapshot blocks on every CI run.

Phase 1 of [`docs/plans/living-product-docs.md`](../../docs/plans/living-product-docs.md).
This PR (Phase 1 PR 1) ships the package scaffold only — the
public API lands across PRs 2–4 (MDX parser + resolver + config →
Playwright fixture → CLI + drift detection).

The package stays `private: true` in the workspace until Phase 7
flips it for publication through the existing Trusted Publishing
pipeline. Until then it's a workspace-only dep consumed by future
`@ingcreators/annot-product-docs-astro` /
`@ingcreators/annot-product-docs-xlsx` packages.

## Tier

Tier A — Node-only, no DOM. Loads Playwright at runtime but does
not depend on a live browser session of its own.

## License

Apache-2.0.
