# Headless annotator — npm publish (Phase 3)

> **Status:** Draft — gated on
>   [`pre-release-final-pieces.md`](./pre-release-final-pieces.md)
>   Stage 2 (Changesets bootstrap).
> **Compatibility:** Flips `@ingcreators/annot-annotator`,
>   `@ingcreators/annot-playwright`, AND `@ingcreators/annot-core`
>   from `private: true` to a published state on npm. Once
>   landed, the annotator's public API enters semantic versioning;
>   breaking changes require a major bump.
> **Risk:** High — first public npm publish from this org. Mistakes
>   here are public. Reviewers should pre-verify `npm pack`
>   output (`files` allowlist + entry-point resolution +
>   `peerDependencies` shape) before flipping.

## Context

Phase 3 of the headless-annotator track. Phase 0 (spike), Phase 1
(`@ingcreators/annot-annotator`), and Phase 2
(`@ingcreators/annot-playwright`) all landed without external
exposure — both packages are `private: true` in the workspace.
Phase 3 is the publish itself.

The publish is gated on **Changesets** (Stage 2 of
[`pre-release-final-pieces.md`](./pre-release-final-pieces.md))
because:

- Multi-package version coordination is one of the things Changesets
  solves. Hand-rolling it for the first publish risks divergent
  versions across `annot-core` / `annot-annotator` / `annot-playwright`.
- The team committed to Changesets in the roadmap (P1.4) AND in
  the `pre-release-final-pieces` plan. Doing the first publish
  manually sets a precedent we'd then need to undo.

## What this phase changes

### Package flips

Four packages move from `"private": true` to the published state:

| Package | Why it must publish | Notes |
|---|---|---|
| `@ingcreators/annot-core` | Transitively pulled in by `annot-annotator` (Tier A imports — `editor/svg-format` constants) | Becomes the de-facto OSS SDK surface; many downstream things assume it stable |
| `@ingcreators/annot-annotator` | The headline package — the public API users install | |
| `@ingcreators/annot-playwright` | The Playwright fixture package | Peer-deps `@playwright/test` |
| `@ingcreators/annot-mcp` | MCP server for AI-agent tooling (Phase 8 of [`agent-mcp-integration.md`](./agent-mcp-integration.md) piggy-backs on this pipeline). | Deps: `@modelcontextprotocol/sdk`, `@napi-rs/canvas`, `playwright-core`, `pixelmatch`. Ships `bin: { "annot-mcp": "./bin/annot-mcp.mjs" }`. |

`@ingcreators/annot-render` does NOT publish in Phase 3 — it's
Tier C-render (browser `<canvas>` + jsdom-friendly OOXML builder),
neither needed by the annotator nor cleanly browser-only.
Publishing it later is additive.

### Per-package work

For each of the three published packages:

1. Flip `"private": false`.
2. Add `"files": [...]` allowlist — exclude tests, source maps,
   etc.
3. Add an explicit `"version"` (start at `0.1.0` for the new
   ones; `annot-core`'s first published version is a discussion
   — it may want `1.0.0` since it's the most mature surface
   despite being the youngest npm package).
4. **Build TS → JS**. Today, the workspace packages export
   `.ts` directly via `"main": "./src/index.ts"`. For npm
   consumers this won't work — they need pre-built `.js` +
   `.d.ts`. Vite can do this (existing pattern in
   `packages/render`); we just need to wire `build` scripts on
   the annotator + playwright packages and switch their
   `"main"` / `"types"` / `"exports"` to point at `dist/`.
5. Update package metadata: `homepage`, `bugs`, `keywords`,
   `license` (Apache-2.0 to match root).
6. Verify dependency hygiene: workspace deps (`workspace:*`)
   must be hoisted to real version ranges before publish — pnpm
   handles this via `pnpm publish` but we should add it to the
   release CI flow.

### Build pipeline work

7. **`build` script per package**. The annotator's source is
   pure TypeScript; a small Vite library config (mirroring
   `packages/render/vite.config.ts` if one exists, otherwise
   minimal `vite.config.ts`) emits `dist/index.js` +
   `dist/index.d.ts`.
8. **CI publish workflow** (`.github/workflows/publish.yml`).
   Manual `workflow_dispatch` trigger initially — full Changesets
   auto-publish on PR merge can come later. Workflow steps:
   `pnpm install` → `pnpm -r build` → `pnpm changeset publish`
   (or equivalent). Requires `NPM_TOKEN` secret.
9. **`prepack` / `postpack` sanity test**: run `npm pack` on each
   package and inspect the resulting tarball before publish.
   Catches `files` allowlist mistakes.

### Documentation

10. The annotator + playwright READMEs already document usage.
    Update each to remove the "post-publish" caveat once they
    are actually installable.
11. Add a "What's published" section to `PRODUCT_DIRECTION.md`
    listing the three OSS npm packages and their stability
    commitments.
12. Optional but recommended: write an announcement blog post
    or README banner for the first publish — sets expectations
    for early adopters.

## Phased plan (post-Changesets)

Each step its own PR. **Estimated 4–5 PRs total**, none of them
risky but all of them visible.

- **Stage 1** — Build script wiring. Vite library config for
  `annot-annotator` + `annot-playwright`. `pnpm -r build` emits
  `dist/` for each. CI confirmation that the existing `pnpm test`
  still resolves source-side (vitest finds `src/`).
- **Stage 2** — Package metadata cleanup. `private: false`,
  `files`, version, exports map pointing at `dist/`, keywords,
  homepage. Verified via `npm pack --dry-run` printed in the PR
  description.
- **Stage 3** — Publish CI workflow. `workflow_dispatch`-gated.
  Requires `NPM_TOKEN` secret to be set; this PR adds the
  workflow but the first publish run happens after merge.
- **Stage 4** — First publish. Trigger the workflow manually for
  `annot-core` v?. Then `annot-annotator` v0.1.0. Then
  `annot-playwright` v0.1.0. Verify each install on a fresh
  machine before publishing the next.
- **Stage 5** — README cleanup + announcement. Update READMEs to
  drop the "post-publish" caveats; add `PRODUCT_DIRECTION.md` note.

## Verification

- `npm install @ingcreators/annot-annotator` from a fresh Node
  18+ project resolves and runs the README's quickstart example
  without modification.
- `npm install @ingcreators/annot-playwright @playwright/test`
  from a fresh Playwright project resolves and runs the README's
  fixture example.
- Both `.d.ts` files surface the documented public types.
- Tarball size for each published package is reasonable (under
  a few hundred KB for the JS packages; `annot-annotator` carries
  a native-addon dep — `@resvg/resvg-js` — that lives as a
  separate npm dep, not bundled).

## Migration notes

After Phase 3 lands, breaking changes to the public API of
`annot-core` / `annot-annotator` / `annot-playwright` require:

- A Changeset entry (`changeset add` in the PR).
- A major version bump.
- A migration note in `CHANGELOG.md`.

This is qualitatively new — until now, every workspace package
could be refactored freely. Phase 3 trades that freedom for the
publish.

## Out of scope for Phase 3

- **JPEG output / sharp peer dep** — Phase 1.5; orthogonal.
- **CJK font bundling** — Phase 1.5+; product decision.
- **Auto-publish on every PR merge** — Stage 3 lands manual-
  trigger publish only.
- **`@ingcreators/annot-render` publish** — additive future
  decision; not blocking.
- **GitHub Action** — `@ingcreators/annot-action` is a separate
  track in `PRODUCT_DIRECTION.md`.
