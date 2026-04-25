# Storybook Introduction

> **Status:** Draft. Authored 2026-04-25 alongside
> [`lit-migration.md`](./lit-migration.md) — the two plans are
> separable but Storybook is the natural showroom + dev harness
> for the Lit migration that follows it. Awaiting sign-off
> before implementation.
>
> **Compatibility:** Adds `.storybook/` config + dev-dependencies
> to `packages/web`. Storybook ships only as a developer tool —
> nothing lands in the production bundle. Existing build / test /
> lint pipelines stay untouched.
>
> **Risk:** Low. The change is additive and reversible. The
> standing risk is "tooling that nobody uses" — mitigated by
> requiring stories for every new Lit component once the
> follow-up Lit migration starts (rule documented in
> `CLAUDE.md`).

## Context

Annot's UI is currently 100 % imperative DOM. Most components
are constructed by their host (FileDetailsDrawer, Sidebar,
Toolbar, drawer-sections, right-panel-sections, etc.) and live
inside the running PWA — there's no isolated way to view a
single component, prototype variants, or run visual diffs.

Two upcoming initiatives benefit from a dedicated component
playground:

1. **Lit Web Component migration.** Sign-off pending in
   [`lit-migration.md`](./lit-migration.md). Lit components are
   designed for isolated rendering with declarative props, and
   Storybook's `web-components-vite` framework treats them as
   first-class. Migrating with stories per component gives:
   instant visual feedback during refactor, regression
   protection, design-review-friendly URLs.
2. **Visual regression discipline.** Even before Lit, the
   existing components have variants (sidebar storage chips
   per backend, drawer with vs without GitHub commit info, etc.)
   that today are validated by hand each release. Storybook
   captures the variants as artifacts the team — and a future
   Chromatic-style service — can diff against.

Storybook's framework-agnostic design means we can write
stories for **today's vanilla DOM components** as the first
batch, then continue adding stories as components move to Lit.
No big-bang rewrite required.

## Goals

- `pnpm storybook` (in `packages/web`) launches a local
  Storybook at a stable URL.
- `pnpm build-storybook` produces a static `storybook-static/`
  bundle suitable for static hosting.
- 5+ initial stories exercise the high-value existing
  components and prove the workflow works end-to-end:
  - `Sidebar` (per-storage-mode states + plugin-tab variants)
  - `FileDetailsDrawer` (each visible section combination)
  - `EditorRightPanel` (Tool / Selection / Empty modes)
  - `SaveStatusIndicator` (idle / pending / saving / saved /
    error)
  - `ErrorBar` (info / warning / error / auth severities)
- Stories live alongside their component
  (`Foo.stories.ts` next to `Foo.ts`) so a refactor that moves
  the component moves the story too.
- A new section in `CLAUDE.md` documents the convention so
  future contributors (human + Claude Code) know to write
  stories for new Lit components.
- CI runs `pnpm build-storybook` to catch story-breakage
  alongside the existing typecheck / lint / test gates. Rolled
  in as a non-blocking job initially so a flaky story doesn't
  stall unrelated work.

## Non-goals

- **Migrating any existing component to Lit** in this plan.
  The Lit migration is its own project ([`lit-migration.md`](./lit-migration.md)).
- **Visual regression / Chromatic integration.** Trackable
  diff history of every story is genuinely useful but adds
  ongoing cost (paid SaaS / self-hosted infra). Land later as a
  follow-up if Storybook proves valuable.
- **Documentation site.** Storybook can render markdown docs
  alongside stories (`*.mdx`), but our doc surface today lives
  in `docs/plans/` and `PRODUCT_DIRECTION.md`. Generating a
  separate component-library doc site is out of scope.
- **Migrating tests to Storybook test-runner.** Vitest stays
  the primary test runner; Storybook stories are visual
  artifacts + interactive playgrounds, not test replacements.
- **Theming / i18n showcases.** Annot has a single theme
  (light/dark via the existing toggle); no story-side theming
  controls beyond what the components already produce.

## Design

### Tooling choice

- **Framework:** `@storybook/web-components-vite` — works for
  both vanilla DOM components (today) and Lit components
  (after the migration). Doesn't lock us into a UI framework.
- **Vite-based:** matches the existing `packages/web` build
  toolchain, which already runs Vite 8. No new bundler in the
  stack.
- **TypeScript:** stories written in `*.stories.ts`, typed
  against the component's public API.
- **Storybook 8.x:** the current stable line, with mature
  Vite + Web Components support.

### Story location: co-located

```
packages/web/src/editor/
  file-details-drawer.ts
  file-details-drawer.test.ts          ← existing
  file-details-drawer.stories.ts       ← NEW
  drawer-sections/
    file-section.ts
    file-section.stories.ts            ← NEW
    ...
```

Co-location keeps the story discoverable next to the
component it documents and makes "move the file → move the
story" mechanical. It also matches the existing
co-located-test convention (`foo.test.ts` next to `foo.ts`).

The alternative — a top-level `stories/` directory — was
considered and rejected for two reasons:

1. Long-term, stories drift away from their components when
   they live in a separate tree. The first refactor that
   moves a component but forgets the story leaves a
   dangling reference.
2. The CLAUDE.md plan-first rule explicitly prefers
   "tests live next to their sources" (vitest config
   comment). Stories follow the same convention.

### Initial stories — five landmarks

| Story file | Component | What variants? |
|------------|-----------|----------------|
| `editor/save-status-indicator.stories.ts` | `SaveStatusIndicator` | idle / pending / saving / saved / error |
| `ui/error-bar.stories.ts` | `ErrorBar` | info / warning / error / auth-prompt |
| `editor/drawer-sections/file-section.stories.ts` | `drawer.file` | minimal / with-source-url / extra-long-filename |
| `editor/file-details-drawer.stories.ts` | `FileDetailsDrawer` | every-section / no-commit / no-links / disabled-tags |
| `gallery/sidebar.stories.ts` | `Sidebar` | each-built-in-mode-active / device-supported-vs-not / plugin-storage-chip |

These pick mostly leaf or near-leaf components for the first
pass. Heavier compositional ones (`Toolbar`, `EditorRightPanel`)
land in the Lit migration when they become more
story-friendly.

### Storybook config — minimal

`packages/web/.storybook/main.ts`:

```ts
import type { StorybookConfig } from "@storybook/web-components-vite";
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.ts"],
  framework: "@storybook/web-components-vite",
  addons: [
    "@storybook/addon-essentials",   // toolbar / actions / controls / docs
    "@storybook/addon-a11y",         // axe-core in-story
  ],
};
export default config;
```

`packages/web/.storybook/preview.ts`:

```ts
// Pull in the same CSS the PWA boots with so stories render
// against the production design tokens. Component-scoped CSS
// (Lit's `static styles`) doesn't need this — but the existing
// vanilla components rely on global stylesheets.
import "@ingcreators/annot-core/styles/material-symbols.css";
import "@ingcreators/annot-core/styles/editor.css";
import "@ingcreators/annot-core/styles/toolbar.css";
import "@ingcreators/annot-core/styles/property-panel.css";
import "../src/styles/app.css";
import "../src/styles/file-manager.css";
```

### CLAUDE.md addition

```markdown
## Component stories

- New Lit components ship with a `*.stories.ts` file next to
  their `*.ts` source. Story variants cover every visible
  state the component can land in (loading / error / empty /
  populated / etc.).
- Stories are not test replacements. Vitest stays the unit-
  test home; Storybook is the visual + interactive surface.
- Run `pnpm storybook` from `packages/web` to launch the
  local server; `pnpm build-storybook` produces the static
  bundle CI verifies.
```

The rule applies to **new Lit components**, not retroactive
backfill of every existing vanilla component. This keeps the
overhead proportional to actual ongoing work.

## Phased plan

Single small PR for the bootstrap; further phases stay narrow.

### Phase 1 — bootstrap

- Add `@storybook/web-components-vite`,
  `@storybook/addon-essentials`,
  `@storybook/addon-a11y`,
  `storybook` (CLI) to `packages/web` dev-deps.
- Add `.storybook/main.ts` + `.storybook/preview.ts`.
- Add `pnpm storybook` and `pnpm build-storybook` scripts.
- Add the five initial stories listed above.
- Add a CI step (`pnpm --filter @ingcreators/annot-web build-storybook`)
  to `.github/workflows/ci.yml`. Initially `continue-on-error:
  true` so flaky stories don't block unrelated PRs while the
  team gets used to the workflow.
- Update `CLAUDE.md` with the "Component stories" section.
- README mention: a one-line "see Storybook for component
  examples" pointer.

Expected delta: ~600 lines net (config + 5 stories + a few
CLAUDE.md / README lines). One PR.

### Phase 2 — make CI blocking

After Phase 1 has been live for a couple weeks and the team
has fixed any teething issues, flip the CI step to be
blocking. Lands as a tiny PR (one-line CI config change +
note to CLAUDE.md). Optional — only land when Phase 1 has
proven stable.

### Phase 3 _(optional)_ — visual regression / Chromatic

Once Lit migration is in flight, more stories accumulate.
That's the right moment to bolt on visual regression. Sign-off
required again — Chromatic is a paid service and has
implications for build times + image storage. Tracked as a
follow-up plan, not in this one.

### Phase 4 _(optional)_ — static deployment

If a hosted Storybook URL becomes useful (design review,
external contributors), deploy `storybook-static/` to
Cloudflare Pages or GitHub Pages. Cheap to add later; not in
the bootstrap.

## Verification

- `pnpm --filter @ingcreators/annot-web storybook` starts the
  local server without errors.
- Each of the five initial stories renders without console
  errors and without missing assets.
- `pnpm --filter @ingcreators/annot-web build-storybook`
  succeeds locally and in CI.
- `pnpm -r typecheck` / `pnpm test` / `pnpm lint` keep their
  current pass status — Storybook config files are scoped to
  `.storybook/` so the existing TS project includes only the
  story files via `**/*.stories.ts` glob.
- Bundle size: zero impact on the production PWA build —
  Storybook's deps are dev-only.

## Migration notes

- **No data migration.** Pure tooling addition.
- **No existing component changes.** Stories import the
  current component classes / functions and exercise their
  public API; no code under `src/` changes.
- **Plugin authors unaffected** by Phase 1. Phase 3+ might
  make Storybook a recommended development environment for
  plugin authors building UI sections, but that's a separate
  conversation.

## Open questions (sign-off requested)

1. **Story location** — co-located (`foo.stories.ts` next to
   `foo.ts`) vs centralized (`stories/` directory). Lean:
   co-located, matching the existing test convention.
   ✅ co-located / centralized

2. **Storybook target** — `@storybook/web-components-vite`
   (works for both vanilla DOM + Lit). Alternative: separate
   targets (`html-vite` for vanilla, `web-components-vite`
   later for Lit). Lean: single target now, since the Lit
   migration is the next initiative.
   ✅ web-components-vite / separate-targets

3. **CI blocking timing** — non-blocking for the first few
   weeks (Phase 1 default), then flipped to blocking
   (Phase 2). Alternative: blocking from day 1. Lean: ramp
   up — gives the team time to fix flakiness without
   stalling unrelated PRs.
   ✅ ramp-up / blocking-day-1

4. **Initial story coverage** — the five listed above. Want
   to add or swap any? (PropertyPanel is missing, deliberately
   — it's complex and slated for Lit migration; storying it
   pre-Lit would be redundant work.)
   ✅ as-listed / propose-changes

5. **CLAUDE.md rule scope** — applies to "new Lit components"
   only (no retroactive backfill). Alternative: every new
   component, vanilla or Lit. Lean: Lit-only — vanilla
   components rarely need stories beyond what the PWA already
   exercises end-to-end.
   ✅ lit-only / all-new-components

## References

- [`lit-migration.md`](./lit-migration.md) — sister plan; the
  Lit migration is the primary motivation for landing
  Storybook now.
- Storybook 8 docs:
  https://storybook.js.org/docs/web-components/get-started/install
- Existing `vitest.config.ts` — confirms the "tests next to
  sources" convention this plan inherits for stories.
