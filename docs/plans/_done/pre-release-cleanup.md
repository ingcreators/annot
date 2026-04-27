# Pre-release cleanup

> **Status:** Done (Stages 1, 2, 4 fully landed; Stage 3 split off — see note below).
> **Compatibility:** Touches every package. Mostly internal — no
>                    public API breakage in stages 1–2; stages 3–4
>                    rearrange `@ingcreators/annot-core` exports,
>                    handled with deprecation re-exports.
> **Risk:** Phased, four stages, each independently revertable.
>           No data migration. The largest stage (4) only fires
>           after stages 1–3 have settled.

## Outcome (2026-04-27)

Most of this plan is in `main`. The remaining god-module
decomposition work (Stage 3) is being re-scoped into a separate
plan because the picture has shifted since this doc was written:

- **Stage 1 — Hygiene:** **Done.** Service-worker `catch {}`
  blocks are gone (0 occurrences in
  [`packages/extension/src/background/service-worker.ts`](../../../packages/extension/src/background/service-worker.ts)),
  the two `as any` casts in `github-store.ts` are gone, and Lit
  element files follow the `annot-` prefix
  (`annot-file-details-drawer.ts`, `annot-page-elements-section.ts`,
  `annot-selection-properties-section.ts`,
  `annot-tool-properties-section.ts`).
- **Stage 2 — `StorageProvider` capability split:** **Done.**
  [`packages/core/src/storage/types.ts`](../../../packages/core/src/storage/types.ts)
  narrows `StorageProvider` to the methods every backend implements;
  `StorageWithResync` / `StorageWithForceRefresh` /
  `StorageWithRename` / `StorageWithAuth` are separate capability
  interfaces; `supportsResync` / `supportsForceRefresh` /
  `supportsTokenRefresher` type predicates ship in the headless
  surface (verified by
  [`packages/core/src/headless.test.ts`](../../../packages/core/src/headless.test.ts)).
- **Stage 4 — `core` ↔ `web` boundary:** **Done.**
  [`packages/core/src/index.ts`](../../../packages/core/src/index.ts)
  is one line (`export * from "./headless.js"`) — headless by
  construction. `property-panel.ts` now lives in
  [`packages/editor/src/`](../../../packages/editor/src/) (Tier C);
  `property-controls.ts` and `tooltip.ts` are gone from
  `packages/core/`. The headless boundary test is in place and
  CI-enforced.
- **Stage 3 — God-module decomposition:** **Re-scoped.** Partial
  progress is on `main` (toolbar.ts dropped from 3,610 → 1,604 LOC
  with `toolbar-canvas-menu.ts` / `toolbar-save-menu.ts` /
  `toolbar-preset-helpers.ts` sidecars; property-panel.ts from
  1,995 → 940 LOC; github-store.ts from 1,818 → 1,426 LOC), but
  two files barely moved (selection.ts at 1,859 LOC,
  service-worker.ts at 1,519 LOC), and the schema-driven refactors
  landed since this plan was written produced two NEW god-modules
  of their own:
  [`property-schema.ts`](../../../packages/core/src/editor/property-schema.ts)
  (1,102 LOC) and
  [`tool-registry.ts`](../../../packages/core/src/editor/tool-registry.ts)
  (1,007 LOC). The remaining decomposition work is being designed
  as a fresh plan rather than continued under this one.

The Stage-3 sub-list below is preserved verbatim for archival
reference; do not treat it as the active task list.

---

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

- **3a.** [`packages/web/src/editor/toolbar.ts`](../../packages/web/src/editor/toolbar.ts) (3,610 lines).
  The `Toolbar` class shares `this.#`-private state across nearly
  every method, so a single all-at-once decomposition would be a
  high-risk megapatch. Split into multiple sub-PRs, each landing
  the next-cheapest carve-out:
    - **3a-1.** Pure data + element-mapping → `toolbar-variants.ts`.
      Also delete the dead `_WIDTH_PRESETS` / `_STYLE_PRESETS`
      constants.
    - **3a-2.** Tool-property panel renderer
      (`#populateToolProperties` + helpers, ~700 lines) →
      `tool-property-renderer.ts`. Likely needs a small "renderer
      context" object so the function can stay private to the
      file while the toolbar passes in the few callbacks it owns.
    - **3a-3.** Save menu (`#showSaveMenu`, ~500 lines) →
      `toolbar-save-menu.ts`. Same context-object pattern.
    - **3a-4.** Canvas context menus (`#openInsertHereMenu`,
      `#openToolboxMenu`, `#openSelectionMenu`, ~400 lines) →
      `toolbar-canvas-menu.ts`.
    - **3a-5.** Preset persistence + variant rotation
      (`savePresets`, `applyElementVariantPreset`,
      `#seedPresetFromElement`, the four `#savePresetsTo*` /
      `#loadPresetsFrom*` methods, the variant-side helpers) →
      `toolbar-presets.ts`. This is the trickiest carve-out
      because preset state is mutated from many call sites; do
      it last so the surrounding shape is settled.
    - **3a-6.** Variant flyouts + badges + keyboard shortcuts.
      Whatever's left at this point goes into focused
      sidecars (`toolbar-flyouts.ts`, `toolbar-keybindings.ts`).
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

The big one. CLAUDE.md explicitly permits editor UI (selection
handles, text caret, property panel) to use DOM APIs as PWA-only
code. The genuine architectural smell is therefore narrower than
"move everything DOM-touching out": it's that `@ingcreators/annot-core`
exposes ONE root barrel that conflates the headless surface with
the editor UI surface. Future Playwright / GitHub Action
consumers can't distinguish the two.

Multi-step landing — one carve-out per PR so each is reviewable
and revertable:

- **4-1.** Codify the headless boundary as an executable test.
  `packages/core/src/headless.test.ts` imports
  `@ingcreators/annot-core/headless` under a pure `node` vitest
  environment and asserts that:
    1. The import resolves without throwing.
    2. The documented surface is present at runtime.
    3. `globalThis.document` / `globalThis.window` are `undefined`
       (no polyfill leak).
  This catches a regression at the moment a new `headless.ts`
  re-export starts pulling in DOM-side code, before any of the
  more invasive moves below land.

- **4-2.** Move `packages/core/src/editor/property-panel.ts` +
  `property-panel-helpers.ts` to `packages/web/src/editor/`.
  Update importers (`packages/desktop/src/app/app.ts`, the
  selection-properties section, etc.). Touches ~22 files
  workspace-wide; mechanical search-and-replace.

- **4-3.** Move `packages/core/src/editor/property-controls.ts`
  to `packages/web/src/editor/`. Smaller fan-out than 4-2.

- **4-4.** Move `packages/core/src/utils/tooltip.ts` to
  `packages/web/src/ui/tooltip.ts`. Smallest of the moves.

- **4-5.** Now that the explicit DOM-dependent leaves are out
  of `core`, make `packages/core/src/index.ts` the
  headless-by-construction entry. Editor UI exports (selection,
  canvas-manager, tools — still PWA-only per CLAUDE.md) keep
  living in `core/editor/*` but get re-exposed only via a new
  `@ingcreators/annot-core/editor` subpath, never the root.
  `headless.ts` becomes a deprecated alias re-export pointing at
  root, kept for one release for external callers.

- **4-6.** Update CLAUDE.md: replace the "headless.ts second
  entry" rule with "root `index.ts` is headless; browser code
  lives in `core/editor/*` (re-exposed via `/editor` subpath) or
  in `web`."

## Phased plan

| Stage | Scope | PRs | Depends on |
|-------|-------|-----|------------|
| 1a | Service-worker `catch {}` → `logger.warn` | 1 | — |
| 1b | `github-store.ts` cast cleanup | 1 | — |
| 1c | Lit element `annot-` filename rename | 1 | — |
| 2  | `StorageProvider` capability split | 1 | 1 done |
| 3a-1 | `toolbar.ts`: extract pure variants + delete dead presets | 1 | 2 done |
| 3a-2 | `toolbar.ts`: extract `tool-property-renderer.ts` | 1 | 3a-1 |
| 3a-3 | `toolbar.ts`: extract `toolbar-save-menu.ts` | 1 | 3a-2 |
| 3a-4 | `toolbar.ts`: extract `toolbar-canvas-menu.ts` | 1 | 3a-3 |
| 3a-5 | `toolbar.ts`: extract `toolbar-presets.ts` | 1 | 3a-4 |
| 3a-6 | `toolbar.ts`: residual flyouts + keybindings sidecars | 1 | 3a-5 |
| 3b | `property-panel.ts` decomposition | 1 | 3a |
| 3c | `selection.ts` decomposition | 1 | 3b |
| 3d | `github-store.ts` decomposition | 1 | 2 done (sequencing flexible) |
| 3e | `service-worker.ts` decomposition | 1 | 1a done |
| 4-1 | Headless boundary executable test | 1 | 3 done |
| 4-2 | Move `property-panel.ts` core → web | 1 | 4-1 |
| 4-3 | Move `property-controls.ts` core → web | 1 | 4-2 |
| 4-4 | Move `tooltip.ts` core → web | 1 | 4-3 |
| 4-5 | `core/index.ts` becomes headless-by-construction | 1 | 4-4 |
| 4-6 | CLAUDE.md / docs updates for the new boundary | 1 | 4-5 |

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
