# Lit migration completion

> **Status:** Draft. Authored 2026-04-27 in response to the
> 2026-04-27 friction-audit follow-up that produced
> [#236](https://github.com/ingcreators/annot/pull/236) (Storybook
> CI blocking + CLAUDE.md alignment to the de-facto
> 5-stories-/-22-LitElement state). The audit also surfaced **six
> vanilla DOM components in `packages/web/src/` that are
> appropriate Lit candidates and weren't migrated** by the
> original Lit migration ([`_done/lit-migration.md`](./_done/lit-migration.md),
> PRs [#85](https://github.com/ingcreators/annot/pull/85)–[#98](https://github.com/ingcreators/annot/pull/98)) — five missed and one
> deliberately deferred (`toolbar.ts` Phase 5c). This plan is the
> single source of truth for finishing that migration; once it
> lands, the next audit should find no remaining "should be Lit
> but isn't" components in `packages/web/src/`.
>
> **Compatibility:** `packages/web` only. Light DOM throughout
> (existing CSS in `editor.css` / `app.css` keeps applying). No
> shadow-DOM rewrite, no decorator-syntax migration (stays on
> Lit's runtime `static properties` API per CLAUDE.md). Public
> APIs of `@ingcreators/annot-core` / `-editor` / `-render`
> unchanged.
>
> **Risk:** Six phases, each one PR (with phase 6 splitting
> further during implementation). Every phase is independently
> revertable and lands on `main` before the next starts. The
> heaviest phase is 6 (`toolbar.ts` orchestrator), expected to
> land as 3 sub-PRs mirroring the original Phase 5c sub-split.
> No data migration. No SVG schema change.

## Context

The original Lit migration ([`_done/lit-migration.md`](./_done/lit-migration.md))
landed Phases 0 through 5b and Phase 6, shipping 22
`LitElement` subclasses across `packages/web/src/`. Phase 5c
(toolbar variant flyouts + property dropdowns) was scoped but
not landed: the `Toolbar` class at
[`packages/web/src/editor/toolbar.ts`](../../packages/web/src/editor/toolbar.ts)
(1,604 LOC today) still populates `<annot-toolbar>`'s children
imperatively. The shell element
([`packages/web/src/editor/annot-toolbar.ts:9`](../../packages/web/src/editor/annot-toolbar.ts:9))
documents this carve-out: "The complex internals (variant
flyouts, badge population, preset persistence, keyboard
shortcuts) stay imperative within the `Toolbar` class itself —
they're scheduled for Phase 5c."

The 2026-04-27 friction audit additionally identified five
vanilla components that fit Lit's pattern (multiple visible
states, declarative props, manual `innerHTML = ""` + rebuild
loops) but aren't `LitElement`:

| File | LOC | Surface |
|------|-----|---------|
| [`packages/web/src/editor/tag-editor.ts`](../../packages/web/src/editor/tag-editor.ts) | 138 | Compact tag chips for the file-details drawer (add / remove / inline-edit) |
| [`packages/web/src/editor/scratchpad-section.ts`](../../packages/web/src/editor/scratchpad-section.ts) | 158 | Right-panel "Scratchpad" thumbnail grid (insert / save / delete / arm) |
| [`packages/web/src/editor/split-editor.ts`](../../packages/web/src/editor/split-editor.ts) | 585 | Page-break editor for multi-frame captures (drag handles, slice preview) |
| [`packages/web/src/gallery/gallery-page.ts`](../../packages/web/src/gallery/gallery-page.ts) | 760 | File / folder grid (filter, multi-select, context menu, keyboard nav) |
| [`packages/web/src/gallery/context-menu.ts`](../../packages/web/src/gallery/context-menu.ts) | 114 | Floating menu utility (singleton popover) |

Plus the deferred `toolbar.ts` orchestrator. Total: **six
phases**, ~3,360 LOC of vanilla UI to convert.

Why finish this now:
1. **The 5/22 ratio that CLAUDE.md just acknowledged
   ([#236](https://github.com/ingcreators/annot/pull/236)) is
   improvable.** Closing the gap brings the ratio to ~11/27
   (5 existing stories + each migrated component getting at
   least bootstrap stories) and puts `packages/web/src/`'s UI
   surface predominantly in Lit, which is what the original
   migration set out to do.
2. **Toolbar.ts is the largest vanilla UI in the repo.** Its
   1,604 LOC orchestrator is also the largest active
   god-module by a wide margin (god-module discussion is
   deferred from the closed
   [`_done/pre-release-cleanup.md`](./_done/pre-release-cleanup.md)
   Stage 3 — but a Lit conversion forces the natural split
   that the cleanup plan was after).
3. **Cost is bounded and shrinking with each phase.** Phases 1
   and 2 are trivial (~150 LOC each); they establish the
   "vanilla → Lit, light DOM, annot- prefix, static properties"
   pattern definitively before the larger phases land.

## Goals

- Every `packages/web/src/` UI component with multiple visible
  states is a `LitElement` (or has a documented reason it isn't).
- The `Toolbar` class becomes a thin orchestrator over Lit-based
  flyout / save-menu / context-menu / preset-persistence
  collaborators. The 1,604 LOC file shrinks accordingly.
- After the plan lands, [`packages/web/src/editor/annot-toolbar.ts`](../../packages/web/src/editor/annot-toolbar.ts)'s
  "scheduled for Phase 5c" carve-out comment is gone.
- Each migrated component ships with at least one Storybook
  story (the bootstrap "default" variant, plus any
  loading / empty / error variants the component actually
  renders). The 5/22 ratio in
  [`CLAUDE.md`](../../CLAUDE.md)'s Storybook section closes to
  ~11/27 — at which point the "encouraged not required"
  framing in CLAUDE.md is reviewed and possibly tightened.
- Pure-schema / pure-renderer / orchestrator-glue files
  ([`tool-property-renderer.ts`](../../packages/web/src/editor/tool-property-renderer.ts),
  [`file-manager.ts`](../../packages/web/src/gallery/file-manager.ts))
  stay vanilla and CLAUDE.md gains a one-line note explaining why,
  so the next audit doesn't re-flag them.

## Non-goals

- **NOT** migrating Tier C live-editor primitives in
  [`packages/editor/src/`](../../packages/editor/src/)
  (`CanvasManager`, `SelectionManager`, the tool hierarchy,
  `History`). Those are intentionally NOT Lit per the
  three-tier model — live editor sessions need direct DOM
  control for pointer-event throughput and SVG mutation
  efficiency. The headless boundary test pins this.
- **NOT** moving any component to shadow DOM. CLAUDE.md
  documents the "light DOM while migrating" stance; this plan
  honours it. Moving to scoped shadow-DOM CSS is a separate,
  invasive change worth its own plan.
- **NOT** introducing decorator syntax. Stays on Lit 3's
  runtime `static properties` API per CLAUDE.md (Vite 8 oxc /
  Node 24 V8 still can't parse `accessor`).
- **NOT** Lit-ifying [`tool-property-renderer.ts`](../../packages/web/src/editor/tool-property-renderer.ts).
  It's a pure `schema → DOM` function with no state — Lit
  would add ceremony with no win.
- **NOT** Lit-ifying [`file-manager.ts`](../../packages/web/src/gallery/file-manager.ts).
  It's an orchestrator; the actual DOM lives in Lit shells
  ([`<annot-file-manager-shell>`](../../packages/web/src/gallery/file-manager-shell.ts),
  [`<annot-sidebar>`](../../packages/web/src/gallery/sidebar.ts),
  and `GalleryPage` once Phase 4 lands).
- **NOT** retroactively writing Storybook stories for the
  existing 22 LitElements that don't have one. Stories land
  with each new component this plan migrates; the wider
  retroactive-coverage discussion stays out of scope (and the
  CLAUDE.md framing covers it).
- **NOT** introducing Chromatic or any visual-regression
  service. That's Phase 3+ of the original Storybook plan and
  belongs in its own follow-up.

## Design

Each phase follows the same recipe (already established by
[`_done/lit-migration.md`](./_done/lit-migration.md)):

1. New file `packages/web/src/<area>/annot-<name>.ts`
   exporting `class Annot<Name>Element extends LitElement`.
2. Reactive properties via `static properties = { ... }` +
   `declare` typed fields (per CLAUDE.md).
3. Light DOM via `createRenderRoot() { return this; }` so
   existing global CSS keeps applying.
4. `customElements.define("annot-<name>", Annot<Name>Element)`
   guarded with `if (!customElements.get(...))`.
5. Co-located `annot-<name>.test.ts` covering the visible
   states the component can land in.
6. Co-located `annot-<name>.stories.ts` with at minimum a
   "default" variant and one variant per non-trivial state
   (loading / empty / error if applicable).
7. Old vanilla file deleted in the same PR. Importers updated
   to consume the new element via property setters or
   attribute-setting APIs.

Where the vanilla class exposed callbacks (e.g.
`tagEditor.onTagsChange = ...`), the Lit element dispatches a
`CustomEvent` (`annot-tag-change`) and the host listens —
mirrors the existing pattern in already-migrated drawer
sections.

## Phased plan

| Phase | Scope | LOC delta (est.) | Stories added | PRs | Depends on |
|-------|-------|------------------|----------------|-----|------------|
| 1 | `tag-editor.ts` → `<annot-tag-editor>` | ~138 → ~120 | 1 | 1 | — |
| 2 | `scratchpad-section.ts` → `<annot-scratchpad-section>` | ~158 → ~140 | 1 | 1 | 1 done (pattern) |
| 3 | `split-editor.ts` → `<annot-split-editor>` | ~585 → ~480 | 2 | 1 | 2 done |
| 4 | `gallery-page.ts` → `<annot-gallery-page>` | ~760 → ~600 | 3 | 1 | 3 done |
| 5 | `context-menu.ts` → `<annot-context-menu>` (singleton popover semantics preserved via `document.body` mount/unmount) | ~114 → ~120 | 1 | 1 | 4 done |
| 6 | `toolbar.ts` orchestrator → split + Lit | ~1,604 → ~600 (in `toolbar.ts`) + ~1,000 across new Lit elements | 3+ | 3 sub-PRs (6a / 6b / 6c) | 5 done |

Phase ordering rationale:
- Phases 1 → 2 establish the migration recipe with the
  smallest surface area, so reviewers can sign off on the
  pattern once.
- Phases 3 → 4 grow in size; each lets the previous one's
  reviewer feedback inform the next.
- Phase 5 (context menu) lands late because it's a
  cross-cutting singleton — getting the `document.body`-mount
  pattern right after 4 phases of light-DOM Lit elements is
  easier than doing it cold.
- Phase 6 (toolbar) is last because (a) it's the heaviest, (b)
  it benefits from the four prior phases' patterns
  (especially split-editor's drag-handle Lit conversion), and
  (c) by then we have evidence the recipe scales beyond
  ~600 LOC.

### Phase 6 sub-split (toolbar)

Mirroring the original Phase 5b/5c carve-out, but informed by
what's actually in `toolbar.ts` today:

- **6a — Variant flyouts.** The flyout-open / chip-pick state
  machine becomes `<annot-tool-variant-flyout>` (one Lit
  element per `flyoutKind`, or a single element with
  `flyoutKind` as a reactive property — decision deferred to
  the implementation PR's design comment). Removes the
  imperative `#openVariantFlyout` / `#closeVariantFlyout` /
  `#repositionFlyout` cluster from `toolbar.ts`.
- **6b — Save menu.** The `#showSaveMenu` machinery
  (~500 LOC per `_done/pre-release-cleanup.md`'s pre-cleanup
  numbers, smaller after the cleanup landings) becomes
  `<annot-save-menu>` (the existing Lit element of that name
  is currently a thin facade — Phase 6b is the pull-up of the
  imperative side into the element's own template).
- **6c — Preset persistence + keyboard shortcuts + canvas
  context menu integration.** What's left of `Toolbar` after
  6a/6b becomes a thin orchestrator over the Lit
  collaborators, the preset state, and the registry-driven
  `applyStyleToElement` pipeline. `toolbar.ts` shrinks from
  the post-6b state to ~600 LOC of pure orchestration.

Each sub-PR is independently revertable. Inter-sub-phase
dependencies are sequential (6b expects 6a's flyout element
to exist; 6c expects 6b's save menu element to exist).

## Verification

At every phase boundary the `Verified:` paragraph reports:

- `pnpm -r typecheck` clean.
- `pnpm test` total + delta (e.g. `807 → 815`).
- `pnpm lint` exit 0.
- `pnpm --filter @ingcreators/annot-web build` clean.
- `pnpm --filter @ingcreators/annot-web build-storybook` clean
  (now blocking per [#236](https://github.com/ingcreators/annot/pull/236)).
- LOC delta on the touched files (mechanical: `wc -l`
  before / after).
- LitElement count delta (`grep -lr "extends LitElement"
  packages/web/src --include="*.ts" | wc -l` before / after).

For phases that touch user-visible behaviour (3 split editor,
4 gallery page, 5 context menu, all of 6): manual smoke per
the phase's own test plan, called out in the PR description.
The structural toolbar test in
[`packages/web/src/editor/toolbar.test.ts`](../../packages/web/src/editor/toolbar.test.ts)
guards the no-`if (toolId === "...")`-literal invariant
established by [`_done/toolbar-highlight-flyout-kind.md`](./_done/toolbar-highlight-flyout-kind.md);
Phase 6 must not regress it.

## Migration notes

- **No data migration.** SVG schema unchanged.
  `data-annot-version` unchanged. `StorageProvider` unchanged.
- **No CSS rewrite.** Light DOM means existing
  `editor.css` / `app.css` rules apply unchanged. Per-component
  scoped `static styles` blocks may land opportunistically (per
  CLAUDE.md's "hybrid CSS" stance) but are not required.
- **CLAUDE.md update at the end of the plan.** Once Phase 6
  lands, update the "Component stories (Storybook)" section
  to reflect the new ratio and review whether "encouraged" can
  tighten back to "required" given the broader coverage. Same
  edit removes the `annot-toolbar.ts` carve-out comment about
  "scheduled for Phase 5c". Done as part of the Phase 6c PR.
- **Storybook coverage growth.** The 5 → ~11 jump (one new
  story per migrated phase, plus the 3 toolbar sub-phase
  stories) is the largest deliberate change to the story-
  coverage ratio since the Storybook bootstrap. Land each
  story alongside its phase, not as a follow-up — story drift
  is exactly what the per-phase pattern prevents.

## Open questions

- Phase 6a: single `<annot-tool-variant-flyout>` parameterised
  on `flyoutKind`, or separate `<annot-tool-variant-flyout>` /
  `<annot-tool-color-flyout>` elements? Defer to the
  implementation PR; the registry-driven `flyoutKind`
  discriminator from
  [`_done/toolbar-highlight-flyout-kind.md`](./_done/toolbar-highlight-flyout-kind.md)
  argues for one element with two render branches.
- Phase 5: the existing `openContextMenu(opts)` function is
  used from at least 2 call sites (gallery 3-dot button +
  right-click). Migration preserves the function-call API
  (the function instantiates a singleton `<annot-context-menu>`
  on `document.body`, dispatches close events, and removes
  itself) so callers don't change. Confirmable during
  implementation.
- Should `<annot-tag-editor>` (Phase 1) also support a
  read-only mode for places that display tags without
  editing? Today the vanilla class is always editable; the
  Lit conversion is a chance to add a `readonly` attribute if
  there's a non-editor display surface that would benefit.
  Defer until a concrete consumer asks.

## Out of scope (explicitly)

- **Lit-ification of [`packages/editor/src/`](../../packages/editor/src/)**
  — Tier C live editor primitives stay imperative.
- **Shadow DOM migration** — separate plan if ever pursued.
- **Decorator-syntax migration** — gated on Vite oxc / Node
  V8 stable `accessor` support.
- **Chromatic / visual-regression service** — Phase 3+ of the
  original Storybook plan; orthogonal to this work.
- **Retroactive stories for the existing 22 LitElements that
  don't have one** — covered by CLAUDE.md's "encouraged not
  required" framing; this plan only adds stories for the
  components it newly migrates.
- **God-module decomposition of files this plan doesn't
  touch** ([`property-schema.ts`](../../packages/core/src/editor/property-schema.ts),
  [`tool-registry.ts`](../../packages/core/src/editor/tool-registry.ts),
  [`github-store.ts`](../../packages/web/src/storage/github-store.ts),
  [`service-worker.ts`](../../packages/extension/src/background/service-worker.ts),
  [`selection.ts`](../../packages/editor/src/selection.ts)) —
  those belong in the fresh god-module plan promised by
  [`_done/pre-release-cleanup.md`](./_done/pre-release-cleanup.md)'s
  Outcome section.
