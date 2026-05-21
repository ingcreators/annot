# Sending a PR

## Branch + commit convention

- **Branch off `main`** with a topic name shaped like
  `<type>/<short-kebab-desc>` — e.g.
  `feat/playwright-clip-helper`,
  `fix/annotator-font-resolution`,
  `docs/api-reference-fixes`.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/).
  Look at the recent `git log` to match the tone:

  ```
  feat(playwright): add clipForBoundingBox helper

  ## Why

  The existing rectForBoundingBox draws around the locator…
  ```

- **One PR per phase** if you're working off a `docs/plans/` plan.
  Don't chain feature branches; let each phase land on `main`
  first.

## What CI checks

Every PR runs the `CI` workflow:

- `pnpm lint` — Biome lint + format. Must report 0 errors.
- `pnpm -r typecheck` — TypeScript across every package.
- `pnpm test` — vitest, full suite.
- Builds for `annot-core`, `annot-web`, `annot-extension`,
  `annot-desktop`, `annot-marketing` (the landing site).
- Storybook build — must compile, blocking.
- (Conditional) `verify-wasm` rebuilds the imagequant `.wasm`
  blob and diffs against the committed copy.

A failing check blocks merge.

## Sign-off

We don't require DCO sign-off or CLA. The Apache-2.0 licence
covers contributions automatically.

## Review

Maintainers (currently @ichim) review most PRs within a day.
Drive-by typo fixes usually merge same-day; larger features go
through one or two review rounds.

## After merge

- Squash-merge is the default — `main` history shows one commit
  per PR with the `(#NN)` suffix.
- The branch on your fork is yours to delete or keep.
- Tag a `changeset` if your PR ships a change to one of the
  published packages — see
  [`.changeset/README.md`](https://github.com/ingcreators/annot/blob/main/.changeset/README.md).

## Releases

The three published packages release via npm Trusted Publishing
(OIDC) from `.github/workflows/publish.yml`. Maintainer-only;
contributors don't need to interact with the release flow.
