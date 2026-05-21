// Shared `annot-docs` config for the workflow-app example.
//
// Two books live side-by-side under `docs/books/`:
//   - `operation-manual/` — user-facing "how to use the app".
//   - `screen-design/` — developer-facing per-element spec.
//
// Per-MDX `annot:` frontmatter sets `xlsx.book` to one of those
// names; this config registers both so future XLSX exports + lint
// + drift detection can dispatch per book. The Playwright tour
// (Phase 6) drives the SPA at `http://localhost:5173/` in English
// and refreshes `annot:snapshot` + `annot:attributes` blocks in
// every MDX.
//
// NOTE: we deliberately avoid importing `defineConfig` from
// `@ingcreators/annot-product-docs` because the npm-published
// `0.1.0` tarball is missing its `dist/` build output (the
// publish-workflow's pre-pack `pnpm build` step was missed).
// Until a fixed version is republished, the config is a plain
// object literal — the CLI parses + validates it at runtime via
// the same Zod schema either way. A follow-up PR
// (`fix(publish): add prepack build step for product-docs
// packages`) will restore the typed import.

const config = {
  meta: {
    author: "Annot example",
    revision: "1.0",
    revisedDate: "2026-05-22",
  },
  xlsx: {
    defaultBook: "Operation Manual",
    books: {
      "Operation Manual": {},
      "Screen Design": {},
    },
  },
};

export default config;
