---
"@ingcreators/annot-product-docs": minor
"@ingcreators/annot-product-docs-astro": minor
"@ingcreators/annot-product-docs-xlsx": minor
---

First publish of the living-product-docs package family. Phases
1-5 + 7 of `docs/plans/living-product-docs.md` landed across
PRs 876-899; this entry flips the three packages from
`private: true` to publishable and stamps `0.1.0`.

### `@ingcreators/annot-product-docs`

- MDX parser (`parseMdx` / `parseMdxFile`) — Remark / unified
  pipeline that walks `.mdx` files with `annot:` frontmatter
  and extracts `<Screen>` / `<Overlay>` / `<Transition>` /
  `<HistoryEntry>` / `<ScreenList>` JSX components.
- Match resolver (`parseSnapshot` / `resolveMatch` /
  `resolveOverlays`) for the Playwright `aria-snapshot`
  YAML, honouring `match.under` disambiguation and emitting
  `not-found` / `ambiguous` / `renamed` / `role-changed` /
  `live-mismatch` diagnostics.
- `screen` fixture extending `@ingcreators/annot-playwright`
  with `screen.capture({ id, mdxPath })` that re-syncs
  `annot:snapshot` + `annot:attributes` MDX comment blocks
  in place.
- Drift detector (`detectDrift` / `detectDriftFromYaml`) — six
  finding kinds (added / removed / renamed / role-changed /
  duplicated / attribute-drift) with severity buckets.
- `annot-docs` CLI (`init` / `sync` / `lint`) with `--json`
  / `--ci` / `--fix` flags + a sample GitHub Actions workflow
  emitting GitHub annotations on PR diff views.

### `@ingcreators/annot-product-docs-astro`

- `productDocsIntegration()` Astro 5.x integration factory.
- 7 docs components: `<Screen>`, `<Overlay>`, `<Transition>`,
  `<TransitionTable>`, `<HistoryEntry>`, `<ScreenList>`,
  `<TransitionGraph>`. Shipped as `.astro` source under
  `./components/*.astro` exports.
- Image Service (`renderAnnotatedScreen` + SHA-keyed
  `createFileCache` / `createMemoryCache`) that composes the
  base screenshot with overlay callouts at build time.

### `@ingcreators/annot-product-docs-xlsx`

- MDX → normalised bundle extractor; per-role default layout
  (cover / history / list / screen / reference); customer-
  template support with `{var}` placeholder substitution
  (including `{annot:date}` special vars + `{name:format}`
  date formatting); Excel Named Range writers
  (`annotImage` / `annotItemTable` / `annotHistory` /
  `annotList` / `annotSnapshot` / `annotAttributes`).
- `annot-docs-xlsx render` CLI with multi-book emit + per-book
  template config.
