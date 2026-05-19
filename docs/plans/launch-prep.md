# Launch prep (Phase 8 of `annot-cloud-roadmap.md`)

> **Status:** In progress (8a–8g shipped; 8d in flight).
> **Compatibility:** PWA URL moves from `annot.work/` to
>   `annot.work/app`. The old path stops working unless we add a
>   redirect (we will, see "PWA path migration" below). New
>   landing site at `annot.work/`; new docs site at
>   `annot.work/docs`.
> **Risk:** Medium. The PWA URL change is visible to any
>   existing user who bookmarked the old root; a permanent
>   redirect handles it but breaks the back-button affordance
>   during the migration window. The landing + docs sites are
>   net-new — no existing-user impact.

## Phase tracker (actual)

The phases below shipped in a different order than the original
8b/c/d layout — sub-phases were re-numbered to land the
scaffolds before the atomic URL switchover so every PR left
`main` shippable.

| # | What | PR | Status |
|---|------|-----|--------|
| 8a | Plan doc (this file) | [#800](https://github.com/ingcreators/annot/pull/800) | Merged |
| 8b | Astro landing scaffold (no deploy) | [#801](https://github.com/ingcreators/annot/pull/801) | Merged |
| 8c | VitePress docs scaffold (no deploy) | [#802](https://github.com/ingcreators/annot/pull/802) | Merged |
| 8e | Privacy + Terms drafts | [#806](https://github.com/ingcreators/annot/pull/806) | Merged |
| 8f | Show HN + blog + social + Product Hunt drafts | [#807](https://github.com/ingcreators/annot/pull/807) | Merged |
| 8g | Press kit page (`/press`) + brand assets | [#809](https://github.com/ingcreators/annot/pull/809) | Merged |
| 8d | **Atomic URL switchover** | (this PR) | In flight |

## Context

Phase 8 of [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md).
Phases 4–7 land the infrastructure; Phase 8 lands the marketing
+ docs surface that turns "the API works" into "people can
discover and adopt the product."

The strategic moat this phase enables is the **Playwright
headless story**. The npm packages went live in Phase 6
(`annot-core@0.1.0` + `annot-annotator@0.1.0` +
`annot-playwright@0.1.0`); without a docs site and a landing
page that frames "annot for CI tests," those packages get
roughly zero organic discovery.

## Locked-in decisions (operator-confirmed)

- **Domain layout (A1)**: `annot.work/` = Astro landing,
  `annot.work/app` = PWA, `annot.work/docs` = VitePress docs,
  `annot.work/api/*` = worker (unchanged from Phase 5). One
  zone, no subdomain split — keeps the existing same-origin
  cookie story intact for `/api/*` + `/app`.
- **Docs path (B1)**: `annot.work/docs`, not `docs.annot.work`.
  Same rationale.
- **Localisation**: English-only at launch. Show HN audience is
  international OSS; Japanese-locale launch (Zenn / Qiita /
  Twitter Japan) is a follow-up after English Show HN lands.
- **Auth on landing / docs**: none — both surfaces are static
  HTML, no session cookie required to view.

## Phased plan

Each phase ships as its own PR. Estimated 6–8 PRs total.

### Phase 8a — Plan doc (this PR)

You're reading it. Locks the decisions above + breaks the rest
of Phase 8 into discrete shippable units.

### Phase 8b — PWA path migration

Move the PWA from serving at `annot.work/*` to
`annot.work/app/*`.

- **`wrangler.jsonc` (root)** — change `assets.directory`
  serving behaviour: PWA assets still live at
  `./packages/web/dist/`, but the worker mounts them at the
  `/app` URL prefix.
- **PWA's Vite config** — set `base: "/app/"` so all asset
  URLs in the built `index.html` use the new prefix.
- **PWA's router** — strip `/app` from incoming paths so the
  SPA's internal routing doesn't double-handle the prefix.
- **OAuth callback URLs** — update GitHub + Google OAuth
  app configurations: `https://annot.work/app/?signed_in=1`
  is the new post-OAuth landing (and the worker's
  `POST_LOGIN_REDIRECT` from `/api/auth/success` already
  closes the popup, so the `signed_in=1` is informational
  for users who land in a top-level tab).
- **Cloudflare worker route binding** — the new `annot`
  worker (landing assets, this phase) claims `annot.work/*`,
  the existing PWA worker keeps everything under `/app/*`.
  Conflicting routes: Cloudflare picks the most-specific
  match, so this works mechanically. The existing
  `annot.work/api/*` (annot-api) is untouched.
- **Old root redirect** — landing site has a permanent
  redirect from `/` → `/` (i.e. shows landing). The PWA
  itself has no "you've been moved" banner — once landed,
  it's done.

This phase ships in coordination with Phase 8c so visitors
landing on `annot.work/` after the migration see the new
landing page, not a broken PWA bootstrap.

### Phase 8c — Astro landing site

`packages/marketing/` — Astro project deploying to
`annot.work/*` as a Cloudflare Workers static-assets worker
(separate `wrangler.jsonc`). Initial content:

- **Hero**: tagline + a Playwright code snippet that shows
  `annotator.annotateScreenshot(page, { annotationsSvg })`.
  This is the moat-anchor; treat it as the most important
  pixel above the fold.
- **Three flow showcases**:
  1. "Annotate a screenshot after a failing assertion"
  2. "Annotate by DOM locator (capture bbox via fixture)"
  3. "Attach to the Playwright HTML report"
- **Install CTAs** — `npm install @ingcreators/annot-playwright`
  copy button; secondary CTA links for `annot-annotator` +
  `annot-core` (mostly directs to the docs page).
- **PWA CTA** — "Try the editor at annot.work/app".
- **Footer** — links to `/docs`, GitHub repo, npm packages,
  `/privacy`, `/terms`, `/press`.

Built artefact lives in `packages/marketing/dist/`. Deploy via
its own root-relative `wrangler.jsonc` (alongside the existing
PWA root config, until the existing one is repurposed for the
new worker).

### Phase 8d — VitePress docs site

`packages/docs-site/` — VitePress project deploying to
`annot.work/docs/*` via Cloudflare Workers static assets. Initial
content:

- **Getting started** — `npm install` walkthrough for each
  of the three packages
- **API reference** — typedoc-generated entries for
  `createAnnotator`, the Playwright fixture, exported helpers
  (`rectForBoundingBox`, `arrowBetween`, `textAt`)
- **Recipes / cookbook** — the three flows from the landing
  page, expanded with full working code + screenshots
- **Annot Cloud (PWA)** — how to sign in, switch storage
  backends, generate share links
- **Contributing** — how to clone, build, contribute via PR

### Phase 8e — Privacy + Terms placeholder pages

Plain Markdown pages under `packages/marketing/src/pages/`:

- `/privacy` — what we store / how we use it / retention /
  third-party processors / GDPR rights / contact
- `/terms` — usage terms, prohibited uses, account suspension
  conditions, IP ownership, liability cap

Both pages carry an explicit "draft pending lawyer review"
banner until the operator commissions a ¥30,000–¥50,000 SaaS
ToS review (recommended before public traffic but not a launch
blocker — Cloudflare T&C disclaimer covers the immediate gap).

### Phase 8f — Show HN + blog + social drafts

Text-only PR adding:

- `docs/launch/show-hn.md` — Show HN post (technical bias)
- `docs/launch/blog-oss.md` — "Why we OSS'd the annotator
  core" positioning post
- `docs/launch/social-posts.md` — 4–6 ready-to-go posts for
  Twitter / Bluesky / Mastodon. Each ~280 chars.
- `docs/launch/product-hunt.md` — Product Hunt submission
  (gallery images, tagline, first comment from maker)

These are NOT published in this PR — just drafted in the repo
for the operator to copy-paste at launch time.

### Phase 8g — Press kit page

`/press` route on the Astro landing site:

- Brand assets (icons + wordmarks from `brand/`)
- One-paragraph product description (~150 words)
- Three product screenshots + 30s demo video embed
- Maker contact (Naoki's name + email)
- "Annot.work in 30 seconds" elevator pitch
- Downloadable press-kit ZIP with all assets

## Verification

- **Pre-launch**: visit `annot.work/` and see the landing
  page; visit `annot.work/app` and see the PWA;
  `annot.work/docs` returns the VitePress homepage;
  `annot.work/api/health` returns `ok: true`.
- **Launch day**: Show HN post lives; demo video accessible;
  press kit downloads; npm packages still installable from
  fresh Node 20+ projects.
- **Post-launch**: weekly review of npm install counts +
  Cloudflare analytics for the landing site.

## Operator action — Phase 8d cutover checklist

The atomic URL switchover is the only Phase 8 step that requires
operator-side Cloudflare dashboard work. Code changes for the
switchover live in the Phase 8d PR; the dashboard steps below
have to be coordinated by hand. Recommended order:

1. **Pre-deploy** — before merging the Phase 8d PR:
   - Confirm GitHub OAuth App (`Settings → Developer Settings →
     OAuth Apps → Annot`) callback URL is still
     `https://annot.work/api/auth/github/callback`. The OAuth
     callback path itself doesn't change (it stays under
     `/api/*`); only the PWA's post-login landing moves to
     `/app/`. **No GitHub-side change needed.**
   - Confirm Google OAuth Client redirect URI is still
     `https://annot.work/api/auth/google/callback`. **No
     Google-side change needed.**
   - In the Cloudflare dashboard
     (Workers & Pages → annot → Settings → Triggers): note the
     existing `annot.work/*` route binding. We'll remove this
     after the Phase 8d deploy completes.

2. **Merge + deploy** the Phase 8d PR. The unified `deploy.yml`
   workflow ships three workers in lockstep:
   - `annot` (PWA) — now bound to `annot.work/app/*`
   - `annot-marketing` — bound to `annot.work/*`
   - `annot-docs-site` — bound to `annot.work/docs/*`

3. **Post-deploy cleanup** — within 30 minutes of the deploy
   completing:
   - In the `annot` worker's Triggers panel, **delete** the
     stale `annot.work/*` route binding (the old PWA-at-root
     registration). Wrangler doesn't garbage-collect routes
     that fall out of `wrangler.jsonc`; without this step, both
     the PWA worker and the marketing worker would claim `/*`
     and Cloudflare's resolution is undefined.
   - Smoke test by hand from a logged-out browser:
     - `https://annot.work/` → landing page (NEW)
     - `https://annot.work/app/` → PWA root
     - `https://annot.work/app/edit/img/browser/...` → PWA deep
       link (should still work — old deep links break, see
       "Known gaps" below)
     - `https://annot.work/docs/` → docs home
     - `https://annot.work/api/health/bindings` → API health
       JSON

4. **Communicate the change** (optional, not strictly needed):
   - The Show HN / blog launch posts already use
     `annot.work/app/` URLs; existing users land on
     `annot.work/` (now the landing page) and click "Open
     editor" to reach the PWA.
   - No email blast required; this is a path move, not a
     functional change.

### Known gaps after 8d

- **Old PWA deep links break.** Bookmarks like
  `annot.work/folder/Screenshots/Mobile` 404 because the
  marketing worker now serves `/folder/...` (and Astro returns
  its own 404 page). Mitigation: a follow-up PR can add a
  catch-all Astro route at `src/pages/[...slug].astro` that
  detects PWA-shaped paths (e.g. `/edit/`, `/folder/`,
  `/capture`) and 301-redirects to the matching `/app/`
  variant. Deferred — would have bloated the 8d PR; the
  pre-launch user base is tiny enough that hand-fixing
  bookmarks isn't a concern.
- **`mailto:` links in privacy/terms point at hello@annot.work
  + security@annot.work** which may not yet have inboxes set
  up. Operator action: configure the inboxes (Cloudflare Email
  Routing → forward to operator's personal inbox) before
  publicising the URLs.

## Operator action — other phases (already shipped)

- **8e** (PR #806): optional lawyer review of the privacy /
  terms drafts before launch. Banner on each page already says
  "draft pending lawyer review".
- **8f** (PR #807): operator's call when to copy-paste each
  draft to the live channel. Posting cadence in
  `docs/launch/README.md`.
- **8g** (PR #809): record the 30s demo video (Loom or
  self-recorded; output as MP4 + GIF). Asset goes in
  `packages/marketing/public/demo.mp4`. Take three product
  screenshots — PWA editor, Playwright HTML report
  attachment, Chrome extension capture — and drop them under
  `packages/marketing/public/screenshots/` for the press page
  to pick up.

## Out of scope for Phase 8

- **Stripe / paid Pro tier** — Phase 7, separate track
- **Open Graph metadata audit** — best-effort in 8c, full
  audit deferred to post-launch
- **i18n / Japanese locale** — follow-up after English Show
  HN lands
- **A/B testing on landing copy** — premature for v1
- **SEO blog content** — separate effort, content team / AI
  drafts post-launch
