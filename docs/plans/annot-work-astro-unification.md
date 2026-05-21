# annot.work — unify on Astro, refresh content end-to-end

> **Status:** In progress — Phase 1 underway. Open Questions
>   resolved (see "Open questions / risks" below — every default
>   carried, with one user-modified pick in Q1, Q2, plus a new
>   resolution for the `/docs/pwa/*` → `/docs/app/*` URL rename
>   surfaced during Phase 1 kick-off).
> **Compatibility:** No user-visible URL changes during the
>   migration. `annot.work/` (marketing) stays the same origin;
>   `annot.work/docs/*` (VitePress → Astro Starlight) keeps every
>   existing pathname so external links / OG previews / Show HN
>   thread links don't break. The PWA at `annot.work/app/*` is
>   untouched.
> **Risk:** Medium. The content refresh is the riskier half (lots
>   of new prose covering newly-published packages); the toolchain
>   migration is well-trodden (VitePress → Starlight is a documented
>   path). Worst case: the docs site is offline for an hour during
>   the Cloudflare cutover if the static-asset binding swap is
>   misordered. Mitigated by deploying the new docs to a preview
>   subdomain first and flipping only after smoke-tests pass.

## TL;DR

`annot.work` consists of three first-party static surfaces:

| URL | Today | After this plan |
|---|---|---|
| `annot.work/` | `packages/marketing/` (Astro 6) | Same package, redesigned + refreshed content |
| `annot.work/docs/*` | `packages/docs-site/` (VitePress) | Same `dist` URL, rebuilt on Astro Starlight |
| `annot.work/app/*` | `packages/web/` (PWA) | Untouched |

Two motivations to do this now:

1. **The published OSS surface has tripled.** `annot-product-docs`,
   `annot-product-docs-astro`, `annot-product-docs-xlsx`, plus three
   new `annot-mcp` tools (`annot_draft_screen_spec`,
   `annot_propose_drift_fixes`, `annot_translate_screen_spec`)
   landed on npm 2026-05-21 and have zero coverage in the live
   docs site or the landing page. The landing's hero still pitches
   "annotated screenshots for Playwright" only — the "living
   product docs platform" positioning from `PRODUCT_DIRECTION.md`'s
   third growth vector isn't on the marketing surface at all.

2. **Open Question #1 of `living-product-docs.md` is unresolved.**
   That plan explicitly deferred the VitePress → Astro migration
   to "a separate plan, ideally landing as a deliberate positioning
   move ('annot.work/docs is built with annot')." This plan IS that
   separate plan, and it closes the question.

The unification also enables a high-leverage dogfooding move:
once the docs site is Astro, the `living-product-docs` page(s)
that explain the new packages can use those very packages
(`@ingcreators/annot-product-docs-astro`'s `<Screen>` / `<Overlay>`
components against a Playwright tour of the PWA). "annot.work/docs
is built with annot" goes from a tagline to a verifiable claim.

Eight phases:

| Phase | Output | Estimated work |
|---|---|---|
| 0. Plan + content audit | This doc + per-page disposition matrix | ~0.5 day |
| 1. Astro Starlight scaffold (parallel) | `packages/docs-site-astro/` builds + serves on a preview Cloudflare Workers URL, same `/docs/*` URL shape | 1 day |
| 2. Content port — verbatim | Every VitePress `.md` → Starlight `.mdx` preserving URLs + frontmatter | 1.5 days |
| 3. New content — living product docs | Coverage for the three new packages + three new MCP tools | 2 days |
| 4. Landing redesign | `packages/marketing` hero + features + nav refresh | 1.5 days |
| 5. Dogfood — annot-built docs section | One docs page that uses `@ingcreators/annot-product-docs-astro` against a real Playwright tour | 1 day |
| 6. Cloudflare cutover + redirects | Swap the `annot.work/docs/*` static-asset binding; verify | 0.5 day |
| 7. Retire VitePress + update plans / READMEs | Move `packages/docs-site` → `_done/`, update `launch-prep.md`, close open question | 0.5 day |

Total: ~8.5 working days. Each phase is one PR (Phase 2 + 3 may
split into a per-section PR cluster depending on review load).

## Strategic context

### Why a unified Astro stack

The marketing site is on Astro 6; the docs site is on VitePress
4.x. The split made sense in `launch-prep.md` Phase 8c (timeline
pressure, VitePress was the fastest documented "docs deploy in an
afternoon" option). Now that pressure is gone and the cost of
maintaining two static-site frameworks is visible:

- **Theme drift.** Marketing has bespoke CSS; VitePress carries
  its own theme. Cross-linking from `/` to `/docs/foo` is a
  visual seam.
- **MDX support.** `living-product-docs` ships an MDX-first
  authoring story. The docs site couldn't dogfood it without
  a renderer that speaks MDX; VitePress does Markdown +
  Vue SFCs, not MDX. Astro speaks MDX natively.
- **Component reuse.** Astro components from `marketing` (CTA
  buttons, code blocks, banner) can be reused inside the docs
  shell without re-implementing.
- **Single deploy story.** Wrangler / Cloudflare Workers
  static-assets bindings still target the same three workers
  (marketing / docs / api / app), but the build artefacts come
  from a uniform toolchain. Future "single-build / two-binding"
  consolidation becomes possible without another rewrite.

### Why Starlight (not raw Astro)

Astro's docs-template ecosystem is mature; Starlight is the
official one. It ships sidebar / search / dark mode /
left-right nav out of the box. Going custom would mean
re-implementing those, which is a week of yak-shave that adds
nothing to annot's differentiation. The trade-off is design
flexibility — Starlight enforces a sidebar-left / content-right
layout. That's the layout the existing VitePress docs already
have, so the constraint is invisible.

### Why now, not later

Three forcing functions converge:

1. The `living-product-docs` packages are 0.1.0 on npm. New
   adopters land on a docs site that doesn't mention them.
2. The PRODUCT_DIRECTION third vector is published but
   undocumented; the gap between "what we say we do" and "what
   the docs cover" widens with every release.
3. Astro 6 (current major) is stable; Starlight tracks it. The
   migration cost is purely the content port + new content
   write-up; the toolchain transition is mechanical.

## Technical design

### Project layout (locked-in)

Add a NEW workspace package alongside the existing two:

```
packages/
  marketing/      ← annot.work/ (existing Astro 6)
  docs-site/      ← annot.work/docs/ (VitePress; RETIRED in Phase 7)
  docs-site-astro/← annot.work/docs/ (Astro Starlight; NEW in Phase 1)
```

The new package builds in parallel during Phases 1–5. Phase 6
swaps the Cloudflare static-asset binding from `docs-site/dist/`
to `docs-site-astro/dist/`; Phase 7 retires `packages/docs-site`.

**Why not in-place rewrite of `packages/docs-site`?** Two reasons:

1. The Cloudflare deploy needs the existing `docs-site/dist/`
   intact until the new one is verified. Side-by-side keeps
   rollback trivial (revert the wrangler.jsonc).
2. The build commands diverge (`vitepress build docs` vs
   `astro build`). Side-by-side avoids package.json churn until
   the cutover.

After cutover, the old package directory is renamed to
`packages/docs-site-vitepress` for one release cycle, then
deleted in Phase 7's archival PR. (Same dance the desktop
package did during the Electron migration — see
`_done/desktop-electron-migration.md`.)

### Starlight choice points

| Choice | Decision | Reason |
|---|---|---|
| Astro version | Astro 6.x (track marketing) | Avoid two majors of Astro in one repo |
| Starlight version | latest stable | No version-pin tracking; Renovate handles updates |
| MDX | `.mdx` everywhere | Enables dogfood (Phase 5) + matches `living-product-docs` |
| Theme | Starlight default + brand override | Match the marketing site's accent colours via Starlight's `customCss` hook |
| Search | Starlight's built-in (Pagefind) | Free, client-side, no Algolia dependency |
| Dark mode | Starlight's default toggle | Matches the marketing site's existing dark-mode UX |
| i18n | English-only at launch | Punt — `launch-prep.md` already locked this in |
| Pagefind index | Build-time | No server-side; static-asset binding serves the index |

### URL preservation contract

Every existing `annot.work/docs/<path>` MUST resolve to the same
content (or better content at that path) after cutover. The
content port in Phase 2 is a 1:1 mapping for every section
EXCEPT `/docs/pwa/*`, which is renamed to `/docs/app/*` with
permanent 301 redirects installed in `worker.js` (see Open
Question #7 for the rationale — the web app is no longer a
PWA, so the URL segment was misleading).

| VitePress path | Starlight path | Notes |
|---|---|---|
| `/docs/` | `/docs/` | Home / hero |
| `/docs/getting-started/` | same | Overview |
| `/docs/getting-started/playwright` | same | Pre-existing install pages stay |
| `/docs/getting-started/mcp` | same | |
| `/docs/getting-started/annotator` | same | |
| `/docs/getting-started/core` | same | |
| `/docs/api/` | same | API overview |
| `/docs/api/create-annotator` | same | |
| `/docs/api/dsl` | same | |
| `/docs/api/encode` | same | |
| `/docs/api/playwright-fixture` | same | |
| `/docs/api/svg-helpers` | same | |
| `/docs/recipes/` | same | Recipes index |
| `/docs/recipes/*` | same | All 6 existing recipes |
| `/docs/ai-agents/` | same | AI agents overview |
| `/docs/ai-agents/install` | same | |
| `/docs/ai-agents/tools` | same | MCP tools reference |
| `/docs/pwa/` | `/docs/app/` | Web-app overview — renamed (see Open Question #7); 301 redirect installed |
| `/docs/pwa/*` | `/docs/app/*` | All 3 existing pages — renamed + redirected |
| `/docs/contributing/` | same | |
| `/docs/contributing/*` | same | |

Phase 3 ADDS the following without disturbing existing paths:

| New path | Content |
|---|---|
| `/docs/getting-started/product-docs` | Quickstart for `annot-product-docs` + `-astro` + `-xlsx` |
| `/docs/product-docs/` | Section landing — "Living product docs" |
| `/docs/product-docs/concepts` | MDX format, screens, overlays, snapshot blocks |
| `/docs/product-docs/playwright-tour` | Writing the `tests/docs/*.spec.ts` tour file |
| `/docs/product-docs/astro-integration` | Wiring `productDocsIntegration()` |
| `/docs/product-docs/xlsx-templates` | Customer-template authoring guide (named ranges + placeholders) |
| `/docs/product-docs/drift-detection` | `annot docs lint --ci --json --fix` + GitHub Actions |
| `/docs/api/product-docs` | API ref: `parseMdx`, `captureScreen`, `detectDrift`, … |
| `/docs/api/product-docs-astro` | API ref: `productDocsIntegration`, `renderAnnotatedScreen`, … |
| `/docs/api/product-docs-xlsx` | API ref: `applyDefaultLayout`, `applyTemplateLayout`, `applyNamedRanges`, … |
| `/docs/ai-agents/tools` | EXISTING page, UPDATED to add the 3 new tools |
| `/docs/recipes/living-product-docs` | "Build a 画面設計書 from a Playwright tour" recipe |

Phase 4 (landing redesign) URLs stay at `/`, `/press`,
`/privacy`, `/terms` — no new top-level pages. The hero +
features + nav are rewritten in place.

### Landing redesign principles

The current hero positions annot as "annotated screenshots for
Playwright." The redesign reframes around the three-vector
strategy from `PRODUCT_DIRECTION.md`:

| Section | Today | After |
|---|---|---|
| Hero | "Annotated screenshots, from a Playwright fixture" | "Living product docs from your Playwright tests" — Playwright-first messaging stays primary, "living docs" positioning is the headline |
| Hero code snippet | `annotator.annotateScreenshot(...)` one-liner | Same as today (Playwright fixture is still the clearest 5-second pitch) |
| Features row | 4 cards: Playwright / Annotator / Core / OSS | 5 cards: Playwright fixture / Living product docs / MCP tools / Headless annotator / OSS — re-ranked by which delivers the most "ah-ha" to a fresh visitor |
| Second hero | None | "Generate the docs site, AND the 画面設計書, from the same MDX." — two-vertical positioning visible on the landing |
| Code snippet 2 | None | `<Screen>` + `<Overlay match>` MDX example |
| Trust row | npm install + GitHub stars | + Add MCP-server-in-Claude-Desktop screenshot |

The visual style stays the existing dark-navy / accent-purple
palette (no rebrand). Brand assets in `packages/marketing/public/brand/`
are unchanged.

### Dogfood section (Phase 5)

One docs section is rendered with `@ingcreators/annot-product-docs-astro`:

```
packages/docs-site-astro/
  src/
    content/
      product-docs-screens/
        SC-001-app-landing.mdx     ← annot: frontmatter
        SC-002-share-dialog.mdx
    pages/
      docs/
        annot-itself/
          [...slug].astro          ← reads content collection
  tests/
    docs/
      annot-pwa.spec.ts            ← Playwright tour against annot.work/app
```

Captures live screens of the PWA at `annot.work/app/`, annotates
them via Playwright + the published packages, renders them as
docs pages. The page byline reads "this section is generated by
annot, from a Playwright tour of annot.work/app — view source."

This is the **single most defensible piece of content** on
annot.work: the docs site demonstrates the product the docs
explain. Trade-off: this section needs the PWA to be stable
enough that the Playwright tour doesn't drift on every PR. Phase
5 includes a `docs/` Playwright project added to CI so the tour
runs nightly + on PRs touching `packages/web/`.

## Phased plan

### Phase 0 — Plan + content audit (~0.5 day, 1 PR)

This PR. Locks the scope and ships a per-page disposition
matrix. Subsequent phases reference this matrix instead of
re-deriving the URL → content mapping.

### Phase 1 — Astro Starlight scaffold (~1 day, 1 PR)

`packages/docs-site-astro/` scaffold:

- `package.json` with `astro`, `@astrojs/starlight`, `@astrojs/mdx`
- `astro.config.mjs` with `base: "/docs/"` and the brand customCss
- `wrangler.jsonc` targeting a preview-only Workers URL
  (`docs-astro-preview.annot.work` or similar) — production
  binding doesn't move until Phase 6
- `src/content/docs/index.mdx` with a placeholder
- `tsconfig.json`, `.astro/` types ignore
- README documenting the parallel-build approach

Acceptance: `pnpm --filter @ingcreators/annot-docs-site-astro build`
succeeds; the preview URL serves a Starlight default home page.

### Phase 2 — Content port verbatim (~1.5 days, 1 PR or 3 PRs)

Move every `.md` from `packages/docs-site/` into the new
Starlight content collection. Conversion is mostly mechanical
but two adjustments per file:

- VitePress `:::tip` containers → Starlight `<Aside type="tip">`
  components (find/replace + one `import` per file).
- VitePress internal links of the form `[foo](./bar)` work as-is
  in Starlight; absolute `/api/foo` paths also work.
- The home `index.md` is rewritten as a Starlight splash hero
  (different YAML schema; per-file edit).
- Frontmatter `layout: home` removed; Starlight's home layout
  is inferred from the splash component.

For review-load reasons, the port may split into three PRs along
the existing sidebar boundaries:

- PR 2a: `getting-started/` + `api/` + `index.mdx`
- PR 2b: `recipes/` + `ai-agents/`
- PR 2c: `pwa/` + `contributing/`

A side-by-side diff between the VitePress `dist/` and Starlight
`dist/` for each migrated page is the smoke test (text content
should be byte-identical modulo HTML tag differences).

### Phase 3 — New content for living product docs (~2 days, 2-3 PRs)

The content the existing docs site is missing. Three buckets,
landing in this order:

- **PR 3a**: Update `/docs/ai-agents/tools` to add
  `annot_draft_screen_spec`, `annot_propose_drift_fixes`,
  `annot_translate_screen_spec`. Update `/docs/ai-agents/index`
  to mention the docs flow.
- **PR 3b**: New section `/docs/product-docs/` with
  concepts / playwright-tour / astro-integration /
  xlsx-templates / drift-detection pages. New
  `/docs/getting-started/product-docs` quickstart.
- **PR 3c**: New API reference pages under `/docs/api/product-docs`,
  `/docs/api/product-docs-astro`, `/docs/api/product-docs-xlsx`.
  New recipe `/docs/recipes/living-product-docs`.

### Phase 4 — Landing redesign (~1.5 days, 1 PR)

Rewrites `packages/marketing/src/pages/index.astro` per the
"Landing redesign principles" section above. Reuses existing
brand tokens; no CSS rewrite. Adds one new section (the
second hero with the MDX snippet). Updates the hero copy to
match the three-vector positioning.

Press / privacy / terms pages untouched (they're up to date).

### Phase 5 — Annot-built docs section (~1 day, 1 PR)

Adds the dogfooded section. This is the lowest-priority phase in
that the docs site works without it; promote to early-Phase if
the visual impact case for Show HN re-pitch becomes acute.

- Adds `@ingcreators/annot-product-docs` +
  `@ingcreators/annot-product-docs-astro` as workspace deps of
  `packages/docs-site-astro`.
- Adds a Playwright tour file under `packages/docs-site-astro/tests/docs/`
  that captures 2-3 PWA screens.
- Adds the rendered MDX section under `src/content/docs/annot-itself/`.
- CI: a new GitHub Actions workflow runs the tour nightly +
  on PRs touching `packages/web/`. Tour failures are advisory
  initially (warning, not error) until the screens are stable.

### Phase 6 — Cloudflare cutover (~0.5 day, 1 PR)

The atomic switchover. Three steps inside one PR:

1. `packages/docs-site-astro/wrangler.jsonc` claims
   `annot.work/docs/*`.
2. `packages/docs-site/wrangler.jsonc` is updated to claim a
   non-production route (or removed entirely; tracked in
   Phase 7 archival).
3. Both wrangler configs deploy on merge via the existing
   `.github/workflows/deploy.yml`. Cloudflare's longest-prefix
   matching ensures only the new docs worker fires.

A 24-hour observation window after cutover. If anything blows
up, revert this single PR to swap back.

### Phase 7 — Retire VitePress + close open questions (~0.5 day, 1 PR)

- Move `packages/docs-site/` → renamed `packages/docs-site-vitepress/`
  with `private: true` and excluded from `pnpm-workspace.yaml`.
  (One release cycle of grace before full deletion in a follow-up
  PR.)
- `packages/docs-site-astro/` renamed `packages/docs-site/` to
  reclaim the conventional name.
- Update `launch-prep.md` to mark Phase 8c (VitePress) as
  superseded.
- Update `docs/plans/living-product-docs.md` Open Question #1
  with the resolution.
- Move both `living-product-docs.md` and this plan to
  `docs/plans/_done/`.
- Update `docs/plans/README.md` index.
- Update root `README.md` to list the new packages + reflect
  the unified Astro stack.

## Content audit (per-page disposition)

The matrix below is the authoritative reference for Phase 2-3
PR scopes. "Disposition" is one of:

- **Keep** — port verbatim with VitePress → Starlight tweaks only.
- **Update** — port, then revise content for accuracy /
  recency / new packages.
- **Replace** — content is stale; rewrite from scratch.
- **New** — net-new page, doesn't exist today.

### `/docs/`

| Path | Today | Disposition | Notes |
|---|---|---|---|
| `/docs/` | Home / hero | Replace | New hero per the landing redesign principles + nav into the new product-docs section. |

### `/docs/getting-started/`

| Path | Today | Disposition |
|---|---|---|
| `/docs/getting-started/` | Overview | Update — add product-docs to the list |
| `/docs/getting-started/playwright` | Install annot-playwright | Keep |
| `/docs/getting-started/mcp` | Install annot-mcp | Update — mention the 3 new tools |
| `/docs/getting-started/annotator` | Install annot-annotator | Keep |
| `/docs/getting-started/core` | Install annot-core | Keep |
| `/docs/getting-started/product-docs` | — | New |

### `/docs/api/`

| Path | Today | Disposition |
|---|---|---|
| `/docs/api/` | Overview | Update |
| `/docs/api/create-annotator` | Existing | Keep |
| `/docs/api/dsl` | Existing | Keep |
| `/docs/api/encode` | Existing | Keep |
| `/docs/api/playwright-fixture` | Existing | Keep |
| `/docs/api/svg-helpers` | Existing | Keep |
| `/docs/api/product-docs` | — | New |
| `/docs/api/product-docs-astro` | — | New |
| `/docs/api/product-docs-xlsx` | — | New |

### `/docs/recipes/`

| Path | Today | Disposition |
|---|---|---|
| `/docs/recipes/` | Overview | Update |
| `/docs/recipes/assertion-failure` | Existing | Keep |
| `/docs/recipes/dsl-on-failure` | Existing | Keep |
| `/docs/recipes/dom-locator` | Existing | Keep |
| `/docs/recipes/html-report` | Existing | Keep |
| `/docs/recipes/agent-bug-report` | Existing | Keep |
| `/docs/recipes/manual-from-screenshots` | Existing | Update — link to new product-docs flow |
| `/docs/recipes/living-product-docs` | — | New |

### `/docs/ai-agents/`

| Path | Today | Disposition |
|---|---|---|
| `/docs/ai-agents/` | Overview | Update — three new tools |
| `/docs/ai-agents/install` | Install guide | Keep |
| `/docs/ai-agents/tools` | MCP tools reference | Update — add 3 new tool sections |

### `/docs/pwa/`

| Path | Today | Disposition |
|---|---|---|
| `/docs/pwa/` → `/docs/app/` | Overview | Update — rename to `/docs/app/`, 301 redirect, drop "PWA" in titles + body in favour of "Annot web app" |
| `/docs/pwa/sign-in` → `/docs/app/sign-in` | Existing | Update — same rename + redirect |
| `/docs/pwa/storage-backends` → `/docs/app/storage-backends` | Existing | Update — same rename + redirect |
| `/docs/pwa/share-links` → `/docs/app/share-links` | Existing | Update — same rename + redirect |

### `/docs/product-docs/` (new section)

| Path | Disposition |
|---|---|
| `/docs/product-docs/` | New — section landing |
| `/docs/product-docs/concepts` | New |
| `/docs/product-docs/playwright-tour` | New |
| `/docs/product-docs/astro-integration` | New |
| `/docs/product-docs/xlsx-templates` | New |
| `/docs/product-docs/drift-detection` | New |
| `/docs/product-docs/annot-itself/*` | New (Phase 5 dogfood) |

### `/docs/contributing/`

| Path | Today | Disposition |
|---|---|---|
| `/docs/contributing/` | Overview | Keep |
| `/docs/contributing/local-setup` | Existing | Keep |
| `/docs/contributing/pr-workflow` | Existing | Keep |

## Out of scope (explicitly)

- **Japanese locale.** `launch-prep.md` locked English-only at
  launch. Japanese coverage is a future plan; this plan's content
  is English-only.
- **Algolia / paid search.** Pagefind covers it.
- **API typedoc auto-generation.** Manual hand-written API
  reference pages stay manual for the same reason
  `living-product-docs` rejected YAML sidecars: clarity beats
  auto-generation for a small surface.
- **PWA app redesign.** The PWA at `annot.work/app/*` is
  untouched. The hero may reference it, but the app itself is
  the existing build.
- **Versioned docs.** Starlight supports it; we don't need it
  yet (pre-1.0 for every published package).
- **Stripe / billing pages.** Pro tier is `annot-cloud` repo
  territory — `launch-prep.md` Phase 8 deliberately scoped
  billing out of the OSS marketing surface.
- **Blog / changelog.** Out of scope here; a separate plan if
  / when needed. The Changesets-generated `CHANGELOG.md` is
  enough for the dev audience.

## Verification

Pass criteria for the migration (Phases 1-2 + 6):

- Every `annot.work/docs/<path>` resolves to a 200 with content
  equivalent to today's content. The crawl-and-diff smoke
  test in Phase 6 covers this.
- Lighthouse score on `annot.work/docs/` is ≥ today's score
  (the page is fully static, so this is mechanical).
- Pagefind search index includes every migrated page; a search
  for "Playwright" returns the existing `getting-started/playwright`
  page in the top 3 results.

Pass criteria for the content refresh (Phases 3-4):

- The three new packages each have a quickstart page and an API
  reference page.
- The three new MCP tools each have a section in
  `/docs/ai-agents/tools`.
- The landing page's hero and features row mention the
  living-product-docs surface.
- A fresh visitor learns within 30 seconds that annot generates
  docs from Playwright tests, AND has a 5-line MDX example
  visible.

Pass criteria for the dogfood (Phase 5):

- At least one docs page is generated by the
  `annot-product-docs-astro` Image Service against a real
  Playwright tour of `annot.work/app/`.
- The page byline says "this section is generated by annot,
  from a Playwright tour" with a link to the tour spec on
  GitHub.

## Open questions / risks

### 1. Phase 5 dogfood scope

How much of the docs site should be dogfooded? Two extremes:

- **(a)** One demo page only (`/docs/annot-itself/`). Low risk;
  low marketing impact.
- **(b)** All the PWA-specific docs (`/docs/pwa/*`) are
  regenerated from a Playwright tour. High marketing impact;
  the tour has to be kept stable.

**Resolved (Phase 1 kick-off): all pages that explain the Annot
web app.** Concretely:

- Every page under `/docs/app/*` (the renamed `/docs/pwa/*`)
  is generated from a Playwright tour of `annot.work/app/`.
- Every `getting-started` and `recipes` page that ALREADY ships
  a UI screenshot today is regenerated through the same tour,
  with the rendered screenshots replacing the static images.
- API-reference pages, `contributing/*`, `ai-agents/*`, the
  product-docs section, and the home page stay as
  hand-written MDX — they don't show the web app UI.

The tour file lives at
`packages/docs-site-astro/tests/docs/annot-app.spec.ts` and runs
nightly + on PRs touching `packages/web/` (Phase 5 wires the
GitHub Actions workflow). Tour failures are advisory initially
(warning, not error) until the screen identifiers stabilise.

### 2. Cutover window

Phase 6 is an atomic Cloudflare binding swap. Three options for
when:

- **(a)** Friday afternoon JST (low US traffic, weekend recovery
  window).
- **(b)** Weekday morning JST (high observability, fast
  rollback).
- **(c)** Behind a feature flag — both workers run, a header /
  cookie picks which.

**Resolved (Phase 1 kick-off): (c) — feature-flag cutover.**
Both the Astro Starlight worker and the legacy VitePress worker
keep running through the cutover; a thin picker Worker reads a
cookie (`annot-docs-stack=astro`) or a query parameter
(`?docs-stack=astro`) to route the request to one or the other.
Default routing is "VitePress" on day one, flipped to "Astro"
in a follow-up commit once smoke tests pass under the cookie
opt-in. After a 7-day observation window the picker is removed
and the Astro worker claims the route directly (Phase 6.5,
folded into the Phase 6 PR as a TODO checklist).

### 3. Starlight customisation depth

Starlight's default theme is good but generic. Two depths:

- **(a)** Minimal customisation: brand colours via `customCss`,
  default everything else.
- **(b)** Heavy customisation: matched typography +
  spacing scales + dark-mode palette + custom sidebar
  component.

**Resolved (Phase 1 kick-off): (a).** Phase 4 redesigns the
marketing landing; the docs surface is fine as Starlight-default
for v1. (b) is a follow-up if visual consistency between `/`
and `/docs/` ends up jarring after cutover. The Phase 1 scaffold
implements the brand-accent override in
`packages/docs-site-astro/src/styles/brand.css`.

### 4. URL trailing-slash policy

VitePress and Starlight have different defaults for trailing
slashes on directory-index pages. Astro is configurable.

**Resolved (Phase 1 kick-off): `ignore`** (match marketing's
`trailingSlash: "ignore"`). This preserves both
`/docs/getting-started` and `/docs/getting-started/` resolving
to the same page, matching VitePress's current behaviour.
Set in `packages/docs-site-astro/astro.config.mjs`.

### 5. RSS / sitemap

Today VitePress emits neither. Starlight supports both.

**Resolved (Phase 1 kick-off): emit sitemap.xml** (free, helps
SEO) via `@astrojs/sitemap`. RSS deferred to a future "blog"
plan — there's nothing to feed yet.

### 6. `docs-site-astro/` naming

The temporary parallel name is awkward. Two paths:

- **(a)** Keep `docs-site-astro/` through Phases 1-6, then
  rename to `docs-site` in Phase 7.
- **(b)** Rename `docs-site/` to `docs-site-vitepress/` in
  Phase 1; new package takes the `docs-site` name immediately.

**Resolved (Phase 1 kick-off): (a).** Phase 1's PR is bigger if
it also renames an existing package. The (a) ordering keeps
each PR's diff focused.

### 7. `/docs/pwa/*` URL rename

Surfaced during Phase 1 kick-off: the existing VitePress
"PWA" section name predates the SPA reorg — the web app at
`annot.work/app/` no longer ships a service worker or
`manifest.json`, so the "PWA" label is misleading. Three options:

- **(a)** Keep `/docs/pwa/*` URLs to honour the URL preservation
  contract literally; rewrite only the page body copy.
- **(b)** Phase 2 ports the section under `/docs/app/*` AND
  installs a 301 redirect from each `/docs/pwa/<page>` →
  `/docs/app/<page>` in `worker.js`. Page titles + nav copy
  also drop "PWA" in favour of "Annot web app".
- **(c)** Defer to a follow-up plan; Phase 2 keeps `/docs/pwa/*`.

**Resolved (Phase 1 kick-off): (b).** The URL preservation
contract is honoured via 301s — external links keep working —
while the live URLs match the product naming. Phase 2 owns the
rewrite + the redirect rules in `worker.js`. The redirect map
covers `/docs/pwa/` (overview), `/docs/pwa/sign-in`,
`/docs/pwa/storage-backends`, `/docs/pwa/share-links`.

## References

### Internal

- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) — the
  three-vector strategy this plan surfaces on the marketing +
  docs sites.
- [`living-product-docs.md`](./living-product-docs.md) — Open
  Question #1 is closed by this plan.
- [`launch-prep.md`](./launch-prep.md) — Phase 8c VitePress
  decision is superseded by this plan; Phase 8d's URL routing
  table is reused unchanged.
- [`_done/desktop-electron-migration.md`](./_done/desktop-electron-migration.md)
  — precedent for the parallel-package-then-rename approach.
- `packages/marketing/` — existing Astro 6 setup this plan
  builds on.
- `packages/docs-site/` — existing VitePress setup this plan
  retires.

### External

- [Astro](https://astro.build) — the new toolchain.
- [Astro Starlight](https://starlight.astro.build) — the docs
  template.
- [Pagefind](https://pagefind.app) — the search engine
  Starlight uses.
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
  — the deploy mechanism (already in use for marketing + docs
  + app).
