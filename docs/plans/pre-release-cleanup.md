# Pre-release cleanup

> **Status:** Queued
> **Compatibility:** Touches every package. Mostly internal — no
>                    public API breakage in stages 1–2; stages 3–4
>                    rearrange `@ingcreators/annot-core` exports,
>                    handled with deprecation re-exports.
> **Risk:** Phased, four stages, each independently revertable.
>           No data migration. The largest stage (4) only fires
>           after stages 1–3 have settled.

## Context

Annot is pre-release, which is the cheapest possible window to fix
structural choices the team would not make again from scratch. A
senior-engineer audit (April 2026) flagged five categories of issues
that fight the long-term direction in `PRODUCT_DIRECTION.md`:

1. **Hygiene leaks** — silent `catch {}` blocks in the extension
   service worker, `as any` casts in `github-store.ts`, Lit element
   files that don't follow the documented `annot-` prefix rule.
2. **`StorageProvider` capability bloat** — optional methods are
   accumulating on a single interface; `if (store.method)` ladders
   are scattered across feature code.
3. **God-modules** — five files exceed 1,500 lines and mix
   responsibilities (toolbar, property-panel, selection,
   service-worker, github-store).
4. **`core` ↔ `web` boundary leaks** — PWA-only UI (PropertyPanel,
   tooltip) lives inside `packages/core`, defeating the
   "headless core" boundary that the future Playwright /
   GitHub Action integrations need.
5. (Adjacent, separate plan) — build-config DRY (vite/tsconfig)
   and test-coverage targets. Not in scope for this plan.

The audit also noted things that are **not** in scope here because
they are tracked elsewhere:

- Path-based storage migration → [`path-based-storage.md`](./path-based-storage.md)
- GitHubStore feature work → [`github-integration.md`](./github-integration.md)
- OSS / cloud split → [`oss-cloud-split.md`](./oss-cloud-split.md)

## Design

The four stages are ordered by **risk × dependency**: cheap hygiene
first to clear noise, then the interface change that GitHubStore
work depends on, then the file-size refactors that benefit from a
cleaner interface, then the boundary move that benefits from
already-smaller files.

Each stage lands as one or more independent PRs. A later stage's
PR must base on `main` after the previous stage has merged.

### Stage 1 — Hygiene

Three small, independent PRs. None touch public API.

- **1a. Service-worker error visibility.**
  [`packages/extension/src/background/service-worker.ts`](../../packages/extension/src/background/service-worker.ts)
  has 11 empty `catch {}` blocks (lines 58, 67, 76, 85, …). Each
  silently swallows a failure in the capture pipeline, the exact
  class of bug that caused the April 2026 `pageMetadata`-loss
  incident documented in CLAUDE.md.
  Fix: replace with a `logger.warn(...)` (or a one-line throwaway
  if truly intentional, with `// intentional:` prefix explaining
  why). Keeps behaviour identical, makes future regressions visible.

- **1b. `github-store.ts` type-cast cleanup.**
  Two specific lines:
  - [`packages/web/src/storage/github-store.ts:1139`](../../packages/web/src/storage/github-store.ts) — `let self: Promise<void> = undefined as any;`
  - [`packages/web/src/storage/github-store.ts:1806`](../../packages/web/src/storage/github-store.ts) — `String.fromCharCode.apply(null, bytes.subarray(...) as unknown as number[])`

  Replace with structurally-honest constructs (`Promise<void> | undefined` + nullable check; `String.fromCharCode(...Array.from(slice))` or a dedicated `bytesToBinaryString` helper).

- **1c. Lit element naming consistency.**
  CLAUDE.md mandates the `annot-` prefix for built-in custom
  elements. Filenames currently inconsistent:
  - [`packages/web/src/editor/file-details-drawer.ts`](../../packages/web/src/editor/file-details-drawer.ts) → rename to `annot-file-details-drawer.ts`
  - [`packages/web/src/editor/right-panel-sections/page-elements-section.ts`](../../packages/web/src/editor/right-panel-sections/page-elements-section.ts), `selection-properties-section.ts`, `tool-properties-section.ts` → prefix with `annot-`

  Use `git mv` so history follows.

### Stage 2 — `StorageProvider` capability split

Today [`packages/core/src/storage/types.ts:131-205`](../../packages/core/src/storage/types.ts) declares one fat
interface with `resync?`, `setTokenRefresher?`, etc. as optional.
Feature code does `if (store.resync) await store.resync(...)`.

Replace with capability interfaces:

```ts
interface StorageProvider { /* required core */ }
interface StorageWithResync { resync(...): Promise<void> }
interface StorageWithAuth { setTokenRefresher(...): void }
interface StorageWithRename { renamePath(...): Promise<void> }
// ...
```

Capability check pattern:

```ts
if ("resync" in store) await store.resync(...);
```

Existing implementations (`local-store`, `drive-store`, `github-store`,
`extension-store`) declare which capabilities they implement via
intersection types. No runtime change; the lift is purely structural.

This unblocks GitHubStore Phase 4+ work — adding GitHub-specific
capability (e.g. `commitsAsSave`) becomes a new capability
interface rather than another optional on the giant union.

Single PR. Compiles into a typecheck-only diff for callers — Biome
lint should catch any `if (store.method)` we miss.

### Stage 3 — God-module decomposition

Five files, five independent PRs. Each splits one file responsibility-
by-responsibility, no behaviour change, no import-path change for
external callers (use barrel re-exports in the original location).

Order chosen so the most painful file lands first while reviewer
attention is fresh:

- **3a.** [`packages/web/src/editor/toolbar.ts`](../../packages/web/src/editor/toolbar.ts) (3,610 lines)
  → `toolbar.ts` (Lit shell), `toolbar-state.ts` (preset + active-
  tool state), `toolbar-keybindings.ts`, `tool-property-renderer.ts`.
- **3b.** [`packages/core/src/editor/property-panel.ts`](../../packages/core/src/editor/property-panel.ts) (1,995 lines)
  → `property-panel.ts` (panel), `property-panel-rows.ts`
  (per-tool row factories), `property-panel-helpers.ts` (shared).
- **3c.** [`packages/core/src/editor/selection.ts`](../../packages/core/src/editor/selection.ts) (1,994 lines)
  → `selection.ts` (bounding-box + transform), `selection-arrow.ts`
  (arrow endpoint logic), `selection-callout.ts` (tail rebuild).
- **3d.** [`packages/web/src/storage/github-store.ts`](../../packages/web/src/storage/github-store.ts) (1,818 lines)
  → `github-store.ts` (StorageProvider impl), `github-api.ts`
  (REST), `github-auth.ts` already exists — keep, narrow.
- **3e.** [`packages/extension/src/background/service-worker.ts`](../../packages/extension/src/background/service-worker.ts) (1,574 lines)
  → `service-worker.ts` (event router), `capture-orchestrator.ts`,
  `window-manager.ts`, `idb-schema.ts`.

Each PR's `Verified:` paragraph notes line-count delta and confirms
typecheck + build + Storybook pass.

### Stage 4 — `core` ↔ `web` boundary

The big one. Move PWA-only UI out of `packages/core`:

- `packages/core/src/editor/property-panel.ts` → `packages/web/src/editor/property-panel.ts`
- `packages/core/src/editor/property-controls.ts` → `packages/web/src/editor/property-controls.ts`
- `packages/core/src/utils/tooltip.ts` → `packages/web/src/ui/tooltip.ts`
- Toolbar already moved to web in an earlier phase — verify residue cleaned.

After the move:

- `packages/core/src/index.ts` becomes the **headless-by-construction**
  entry. The separate `headless.ts` becomes a deprecated alias re-
  export pointing at root, kept for one release for external callers.
- A CI grep guard added to `packages/core/`: `document\.|window\.|navigator\.`
  must produce zero matches outside an explicit allowlist (the editor
  UI parts being moved out, by then empty).
- A note added to CLAUDE.md: the old "headless.ts second entry" rule
  is replaced with "everything in `core` is headless; browser code
  lives in `web` or in a dedicated `annot-editor` package."

This stage may itself want sub-phases (one file per PR) depending
on how much downstream code imports from the moved files. Decide
the slicing during Stage 4 kickoff.

## Phased plan

| Stage | Scope | PRs | Depends on |
|-------|-------|-----|------------|
| 1a | Service-worker `catch {}` → `logger.warn` | 1 | — |
| 1b | `github-store.ts` cast cleanup | 1 | — |
| 1c | Lit element `annot-` filename rename | 1 | — |
| 2  | `StorageProvider` capability split | 1 | 1 done |
| 3a | `toolbar.ts` decomposition | 1 | 2 done |
| 3b | `property-panel.ts` decomposition | 1 | 3a |
| 3c | `selection.ts` decomposition | 1 | 3b |
| 3d | `github-store.ts` decomposition | 1 | 2 done (sequencing flexible) |
| 3e | `service-worker.ts` decomposition | 1 | 1a done |
| 4  | `core` ↔ `web` boundary move | 1+ | 3 done |

Stages run sequentially. PRs within a stage may overlap if
they touch disjoint files (e.g. 1a + 1b + 1c can be three concurrent
branches).

## Verification

Each PR must pass the standard pre-landing checklist from CLAUDE.md.
Stage-specific extras:

- **Stage 1a:** manual smoke — capture a screenshot in the extension,
  confirm the new `logger.warn` lines do not fire on the happy path.
- **Stage 2:** add one Vitest case per existing `if (store.method)`
  call site to confirm `"method" in store` returns the same boolean.
- **Stage 3a–3e:** screenshot diff via Storybook for any UI-touching
  refactor; for non-UI files, line-count delta noted in the commit.
- **Stage 4:** CI grep guard active; `pnpm --filter @ingcreators/annot-core build`
  produces a bundle with zero browser-only globals (verified by a
  one-off `node -e "import('./dist/index.js')"` smoke).

## Migration notes

- No data migration. SVG schema unchanged. `data-annot-version`
  unchanged.
- `headless.ts` kept as deprecated alias for one release after
  Stage 4; remove in a follow-up cleanup once external callers
  (annot-cloud) have migrated.
- If a stage stalls, the plan can be paused indefinitely between
  stages — no half-landed state is left behind.
