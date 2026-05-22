import { defineConfig } from "@ingcreators/annot-product-docs";

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

export default defineConfig({
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
});
