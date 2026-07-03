# @ingcreators/annot-product-docs-xlsx

## 0.2.2

### Patch Changes

- Updated dependencies [b5d52f6]
- Updated dependencies [fa712fd]
- Updated dependencies [f09a6b1]
- Updated dependencies [0d19345]
  - @ingcreators/annot-product-docs@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [5778902]
- Updated dependencies [96e7625]
- Updated dependencies [85d40e6]
  - @ingcreators/annot-product-docs@0.3.0

## 0.2.0

### Minor Changes

- 2e92c97: First publish of the living-product-docs package family. Phases
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

### Patch Changes

- 657a685: **Republish with `dist/` included.** The `0.1.0` tarballs of all
  three packages shipped to npm without their `dist/` directory —
  the `publish.yml` workflow's pre-pack `pnpm build` step had only
  filtered four other packages, so `pnpm pack` packed the three
  `product-docs*` packages against empty `dist/`s. The
  `publishConfig.main` (`./dist/index.js`) consequently pointed at
  a missing file, breaking `npm install` for every consumer.

  The source fix landed in
  [#947](https://github.com/ingcreators/annot/pull/947) with two
  defences:
  1. Three new `--filter` lines in the workflow's build step so
     all seven publishable packages get built before pack.
  2. A per-package `prepack` script (`pnpm run build`) so even a
     misconfigured workflow (or a manual `pnpm pack` / `pnpm
publish`) refreshes `dist/` before packing.

  No source-code changes in any of the three packages — only the
  packaging is fixed. This patch publish exists solely to deliver
  working tarballs to the registry; the public API surface is
  byte-identical to `0.1.0`.

  Verified locally:

  ```
  $ pnpm --filter @ingcreators/annot-product-docs pack --dry-run
  Tarball Contents
    bin/annot-docs.mjs
    dist/cli.d.ts
    dist/config.d.ts
    dist/drift.d.ts
    dist/fixture.d.ts
    dist/index.d.ts
    dist/index.js
    dist/mdx.d.ts
    dist/resolver.d.ts
    dist/types-config.d.ts
    dist/types.d.ts
    LICENSE
    package.json
    README.md
  ```

  Before the fix the same command produced 4 files (LICENSE +
  README + package.json + bin/annot-docs.mjs), no compiled code.

- Updated dependencies [2e92c97]
- Updated dependencies [657a685]
  - @ingcreators/annot-product-docs@0.2.0
