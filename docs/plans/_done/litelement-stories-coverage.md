# LitElement stories coverage

> **Status:** Done (2026-04-27). All four phases landed:
> [#253](https://github.com/ingcreators/annot/pull/253) (Phase
> 1 drawer-sections, +3 stories),
> [#254](https://github.com/ingcreators/annot/pull/254) (Phase
> 2 editor-header / status / filename / file-manager-shell,
> +4), [#255](https://github.com/ingcreators/annot/pull/255)
> (Phase 3 right-panel host + sections, +4), and
> [#256](https://github.com/ingcreators/annot/pull/256) (Phase
> 4 capture / dialog / tool-flyout / toolbar + CLAUDE.md
> framing edit, +5). Storybook story count rose from 11 to
> 27, matching the LitElement count one-for-one. CLAUDE.md's
> Storybook section now requires stories for ALL built-in Lit
> components, with the next audit check reduced to a symmetry
> assertion.
>
> Originally authored 2026-04-27 immediately after
> [`_done/lit-migration-completion.md`](./_done/lit-migration-completion.md)
> closed (PRs [#244](https://github.com/ingcreators/annot/pull/244)–[#251](https://github.com/ingcreators/annot/pull/251)).
> That plan tightened the CLAUDE.md Storybook stance to
> "required for new built-in Lit components" while leaving
> existing pre-Phase-6 elements without stories as
> "opportunistic, not retroactive". This plan reverses that
> for the gap that already exists, taking the ratio from
> ~12/27 to **27/27** so the Storybook surface mirrors the
> LitElement registry one-for-one.
>
> **Compatibility:** `packages/web` only. No source changes
> outside `*.stories.ts` additions and the CLAUDE.md framing
> update in the final phase. No SVG schema change. No public
> API change. Risk is bounded: a story that fails to build
> fails CI under the existing blocking-Storybook-build rule
> ([#236](https://github.com/ingcreators/annot/pull/236)).
>
> **Risk:** Four phases, one PR each. Each phase covers a
> coherent surface area (drawer sections / header / right
> panel / misc). All four PRs are independently revertable
> and can land in any order — none depend on another.

## Context

The `lit-migration-completion` follow-up grew the LitElement
count in `packages/web/src/` from 22 to 27 and brought the
story ratio from 5/22 to ~12/27 by adding stories alongside
each newly-migrated component. The CLAUDE.md framing at the
end of that plan said:

> Existing pre-Phase-6 LitElements without a story aren't a
> TODO. Some of the original 22 from `_done/lit-migration.md`'s
> Phases 0–5b still don't ship stories. Add one only if you're
> about to make a non-trivial visual change to the component,
> not as a retroactive cleanup pass.

This plan is the deliberate retroactive cleanup pass, run as a
single, scoped piece of work rather than as drive-by additions
on unrelated PRs. After it lands, **every** `LitElement`
subclass under `packages/web/src/` ships at least one
co-located `*.stories.ts`, and CLAUDE.md tightens the
"required for new" stance to "required for **all** built-in
Lit components" so the next audit can't reopen the gap.

## Component inventory (16 missing stories)

Grouped by surface area for the four-phase split. LOC counts
are the source files at the start of this plan, not stories.

### Group A — Drawer sections (3, ~349 LOC)
- `editor/drawer-sections/last-commit-section.ts` (129 LOC)
- `editor/drawer-sections/external-links-section.ts` (119 LOC)
- `editor/drawer-sections/tags-section.ts` (101 LOC, thin
  wrapper around `<annot-tag-editor>` whose own story already
  exists — the wrapper still gets its own minimal story)

### Group B — Editor header / status / filename (4, ~902 LOC)
- `editor/editor-header.ts` (274 LOC)
- `editor/editable-filename.ts` (164 LOC)
- `editor/editor-statusbar.ts` (227 LOC)
- `gallery/file-manager-shell.ts` (237 LOC)

### Group C — Right panel host + sections (4, ~1,267 LOC)
- `editor/right-panel.ts` (726 LOC)
- `editor/right-panel-sections/annot-page-elements-section.ts` (277 LOC)
- `editor/right-panel-sections/annot-selection-properties-section.ts` (149 LOC)
- `editor/right-panel-sections/annot-tool-properties-section.ts` (115 LOC)

### Group D — Misc surfaces + framing update (5, ~704 LOC)
- `capture/annot-capture-progress-toast.ts` (74 LOC)
- `capture/annot-interval-capture-dialog.ts` (206 LOC)
- `ui/annot-dialog.ts` (172 LOC)
- `editor/annot-tool-flyout.ts` (112 LOC)
- `editor/annot-toolbar.ts` (140 LOC)

Plus the CLAUDE.md framing edit (see "Phase 4" below) so the
audit is closed in the same PR that lands the last batch of
stories.

## Goals

- Every `LitElement` subclass under `packages/web/src/` ships
  at least one co-located `*.stories.ts`. The 27/27 ratio is
  documented in CLAUDE.md.
- Each story exercises the visible-state variants the
  component renders. "Default" alone is acceptable for trivial
  shells (e.g. `<annot-toolbar>` is just an orientation flag);
  components with multi-state surfaces (toasts, dialogs, the
  right panel) ship one variant per state.
- The Storybook static build stays under the existing CI
  blocking budget. No new chunks > 500 KB, no new console
  errors, no story that fails to compile.
- CLAUDE.md's Storybook section tightens from "required for
  new" to "required for all built-in Lit components" once the
  ratio is 27/27. The "5/22 gap is documented as a known
  state, not a TODO" carve-out is removed.

## Non-goals

- **NOT** introducing visual regression / Chromatic / image
  diffing. That's still Phase 3+ of the original Storybook
  plan; orthogonal to coverage.
- **NOT** adding stories for vanilla (non-Lit) components.
  CLAUDE.md's "opportunistic, not obligatory" stance on those
  is unchanged.
- **NOT** rewriting any component. Stories observe components
  as they currently exist; visual changes belong in their own
  PRs.
- **NOT** adding stories for `packages/editor/src/` Tier C
  primitives (`CanvasManager`, `SelectionManager`, the tool
  hierarchy). They aren't `LitElement`; their lifecycle is
  too coupled to a live editor session for Storybook to
  render meaningfully.
- **NOT** changing the existing 11 stories. If a story exists,
  this plan leaves it alone.

## Design

Each new `*.stories.ts` follows the conventions established by
the existing 11 stories, summarised here:

1. **Filename matches the element:**
   `path/to/component.ts` → `path/to/component.stories.ts`.
2. **`title:` mirrors the directory:** `Editor / FooBar`,
   `Gallery / FooBar`, `UI / FooBar`, `Capture / FooBar`.
   Drawer sections keep `Editor / DrawerSections / drawer.<id>`.
3. **`Args` interface declares only the props the story
   exposes** to controls; everything else is hard-coded in
   the render function so the story compiles without depending
   on internal state types.
4. **`render`** builds a wrapper around the element so
   Storybook frames render the in-app context (panel
   background, fixed-width drawer panel, viewport for floating
   surfaces). The wrapper class names mirror what the host
   applies in production (e.g. `.file-details-drawer` around
   drawer sections).
5. **Props are set imperatively** via `el.foo = …` after
   `document.createElement(...)` — matches the plugin author
   API and avoids the attribute-vs-property mismatch on
   `attribute: false` props.
6. **Event listeners are stubs** that `console.log("[story]
   <event>", …)` for arg-flow tracing. Lit-side intent in the
   action-on-event surface remains visible to story reviewers.
7. **Variants** export named stories with `args:` overrides.
   Default / Empty / Populated / Loading / Error / Many
   are the canonical vocabulary; pick the subset that
   describes real states the component can land in.

Where a component depends on a `StorageProvider`, a fake one
is built inline (in-memory `listImages` / `listFolders` /
`getBreadcrumb`). The pattern is already proven in
`annot-gallery-page.stories.ts` (Phase 4 of the lit-migration
plan).

Where a component depends on a `CanvasManager`, the right
panel and editor-header stories use a minimal stub that
returns sensible empties (`annotations: []`, `imageWidth: 0`,
`imageEl: <img>`); for surfaces where the canvas is the
core of what they render, the story declares the
limitation up front and falls back to an interaction-only
variant rather than trying to fake a live editor session.

## Phased plan

| Phase | Scope | Stories added | PRs | Depends on |
|-------|-------|----------------|-----|------------|
| 1 | Group A (drawer sections) | 3 | 1 | — |
| 2 | Group B (editor header / status / filename / file-manager-shell) | 4 | 1 | — |
| 3 | Group C (right-panel host + sections) | 4 | 1 | — |
| 4 | Group D (capture / dialog / tool-flyout / toolbar) + CLAUDE.md framing edit | 5 + docs | 1 | 1 + 2 + 3 done (so the framing edit can claim the 27/27 ratio) |

Phases 1–3 are independent — they can land in parallel or in
any order. Phase 4 includes the CLAUDE.md edit that flips the
Storybook stance to "required for all built-in Lit
components", which only makes sense once 1–3 have closed the
gap on the bigger surfaces.

## Per-phase test plan

Every phase reports the same `Verified:` paragraph:

- `pnpm -r typecheck` clean
- `pnpm -w run test` count unchanged (stories don't add tests)
- `pnpm -w run lint` exit 0
- `pnpm --filter @ingcreators/annot-web build` clean
- `pnpm --filter @ingcreators/annot-web build-storybook` clean
- Manual: each new story renders (Default + at least one
  variant), no console errors during interaction, key
  arg-flow events fire as expected.

Story count delta (`find packages/web -name "*.stories.ts" | wc -l`)
is reported in each PR description: 11 → 14 (Phase 1), 14 → 18
(Phase 2), 18 → 22 (Phase 3), 22 → 27 (Phase 4).

## CLAUDE.md update (Phase 4 only)

The Storybook section currently reads (post-`lit-migration-
completion` Phase 6c):

> Stories are required for new built-in Lit components, and
> strongly encouraged for changes to existing ones. The
> `lit-migration-completion.md` follow-up …

Phase 4 of this plan tightens the surrounding paragraphs to:

- Drop the "existing pre-Phase-6 LitElements without a story
  aren't a TODO" carve-out — the 27/27 ratio means there's
  no carve-out left to claim.
- Replace "required for new built-in Lit components" with
  "required for **all** built-in Lit components". The next
  audit's check is then a simple `wc -l`-style symmetry
  test: stories count == LitElement count (with the optional
  exception of the per-component split-out stories, which
  always stay >= LitElement count).
- Reference this plan in the History line so the rationale
  is reachable from the section.

## Migration notes

- **No data migration.** No SVG schema change. No
  `StorageProvider` change.
- **No CSS change.** Stories render against the existing
  global CSS the elements already match.
- **Storybook build size watch.** Each phase's
  `build-storybook` output is monitored; if the bundle gains
  > 50 KB gzipped over the prior baseline, the offending
  story (likely an oversize fixture) is trimmed before the PR
  lands.
- **Plugin author signal.** A 27/27 ratio gives plugin
  authors a complete in-tree reference for "what does an
  Annot Lit element look like and how do I drive its
  reactive properties from a host?" — the user-facing
  payoff for the retroactive coverage pass.

## Open questions

- Phase 3's right-panel host story: the panel's full
  behaviour depends on a live `CanvasManager` + selection
  state. We don't reconstruct one in Storybook; the story
  exercises the empty / one-section / many-sections layout
  shapes only. Acceptable per "describe real states" —
  closing this (full live-editor mock) is its own follow-up
  if it ever becomes valuable.
- Phase 4's `<annot-toolbar>` story: the host element is
  populated imperatively by the `Toolbar` class, so the story
  either (a) wires up a partial `Toolbar` instance (heavy) or
  (b) renders a hand-built children list mirroring the
  imperative output (light, fragile if the imperative path
  changes). Defer to the implementation PR; (b) is the
  default unless reviewers prefer (a).

## Out of scope (explicitly)

- **Lit-ifying any vanilla component** — `lit-migration-
  completion` covered the gap that existed; this plan is
  about stories on already-migrated elements.
- **Plugin-side LitElements** — stories are for built-in
  components in `packages/web/src/` only.
- **Visual regression infrastructure** — Phase 3+ of the
  original Storybook plan; orthogonal.
- **Story-driven testing (interaction tests via play
  functions)** — possible in Storybook 8+, but Vitest stays
  the unit-test home; this plan doesn't introduce a parallel
  test surface.
