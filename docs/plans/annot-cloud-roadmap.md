# Annot product roadmap — Excalidraw-route launch

> **Status:** Queued
> **Compatibility:** Touches every package (new `worker/` package,
>   new `AnnotCloudStore` StorageProvider, new auth surface in
>   `host-ui`, multi-tenant DB schema). New private `annot-cloud`
>   repo created late in the timeline (Phase 7) for Stripe / billing
>   code; the OSS repo `ingcreators/annot` carries everything else.
> **Risk:** **High** — this is a six-month product launch, not a
>   refactor. Mistakes here are visible to first paying customers.
>   Decision gates between phases let us pause if any single phase
>   surfaces blockers.

## Context

After a multi-pivot strategy session (full OSS → reconsider →
Excalidraw model), the product direction is locked in:

**Annot ships as an Excalidraw-style product**: OSS code (Apache-2.0,
`ingcreators/annot` public), free hosted instance at `annot.work`
funded as a loss-leader, and a paid Pro tier launching ~6 months
from this plan. Comparable models: Excalidraw, Sentry, Plausible,
PostHog, GitLab.

Confirmed parameters from the session:

- **Workload**: 40+ hours/week / full-time → 6-month launch realistic.
- **Burn tolerance**: $20–30/mo personal subsidy for **up to 2 years**.
  Break-even doesn't have to land at launch.
- **Pricing tiers (locked)**:
  - Free — 500 MB storage, 3 private shares, 5 Card Documents.
  - Pro $5/mo — unlimited.
  - Team $5/user/mo — workspaces + comments + real-time collab.
  - Playwright Cloud $29/project/mo — CI integration.
- **Auth providers**: GitHub OAuth + Google OAuth. No
  email/password. No magic-link.
- **Launch strategy**: hold until Phase 1–8 complete; no
  soft-launch. Show HN + Product Hunt on a single day in month 6.
- **Multi-tenant from day 1**: DB schema, plan-gates,
  quota-tracking infrastructure all present from the first
  Worker deploy; values just set permissively until Pro launch.

## Product positioning

### Competitive landscape

| Competitor | Category | Price | Where Annot beats |
|---|---|---|---|
| Tango | Step-by-step guides | $20/user/mo | Annot's Card Documents at 1/4 price |
| Scribe | Auto-generated tutorials | $24/user/mo | Same; plus Annot's editor flexibility |
| CleanShot Cloud | Screenshot hosting + share | $8/mo | Annot adds annotation + Card Documents |
| Loom | Screen recording + share | $8–15/user/mo | Different format (static vs video) |
| Zight / CloudApp | Screenshots + screen recording | $8–13/user/mo | Same comparison |
| Whimsical | Diagrams + flowcharts | $10/user/mo | Different surface (screenshots vs whiteboard) |
| Excalidraw+ | Hand-drawn diagrams + cloud | $6–7/user/mo | Same model, different surface |
| Percy / Chromatic | Visual regression CI | $89–249/team/mo | Annot's $29 Playwright Cloud at 1/3 price |

### Differentiation

Annot uniquely combines:

1. **Screenshot capture** (PWA + Chrome extension + Electron + VSCode).
2. **Editor** (SVG-first, multi-host, plugin-extensible).
3. **Card Documents** (`.annot.html`) — direct Tango / Scribe analog.
4. **Playwright integration** — `@ingcreators/annot-playwright`
   already lands in the headless-annotator track (Phases 0–2 of
   `_done/`).
5. **GitHub-native** — already-shipped GitHub Store; future
   GitHub App for Check Runs.

No competitor in our research covers all five.

### Target users

Primary persona:
- **Solo developer / small team writing technical documentation**.
  Pays for Tango / Scribe today, gets the Annot value at 1/4 price.
- **QA engineers running Playwright/Cypress**. Free tier of
  competitors (Percy/Chromatic) is restrictive; Annot's Playwright
  Cloud at $29 fills the gap below $89 Percy starts at.

Secondary persona:
- **OSS maintainers** annotating screenshots for issue reports
  / docs. Free tier carries them indefinitely; community marketing.

## Pricing tiers (locked)

### Free

- Storage: 500 MB / user
- Private shares: 3 concurrent
- Card Documents: 5 concurrent
- Annotation count / image: unlimited
- Auth: GitHub OR Google
- Hosting: `annot.work`
- SLA: none — "best-effort, data may be lost, no warranty"
- Self-host: fully supported (Worker + R2 + D1 on user's
  Cloudflare account)

### Pro — $5/month

- Storage: 50 GB / user
- Private shares: unlimited
- Card Documents: unlimited
- Password-protected shares
- Custom branding on shares
- Version history (30 days)
- Email support

### Team — $5/user/month (min 3 users)

- Everything in Pro
- Shared workspaces
- Comments + mentions
- Real-time collaborative editing
- Admin role + audit log
- SSO (GitHub Organizations only, no full SAML yet)

### Playwright Cloud — $29/project/month

- Annotated screenshot dashboard
- Auto-post to PR as Check Run + comment
- Test history (90 days)
- API tokens for CI
- Slack / Teams notifications

Annual billing: -2 months (~17% discount).

## Technical architecture

### Stack

| Layer | Service | Why |
|---|---|---|
| Static PWA | Cloudflare Pages | Existing; free; integrates with Workers |
| API | Cloudflare Workers (Hono router) | Edge, free tier covers small scale |
| Database | Cloudflare D1 (SQLite) | Free tier; SQL; integrates |
| Object storage | Cloudflare R2 | No egress fees (critical for image hosting) |
| Sessions / CSRF | Cloudflare KV | Fast; free tier |
| Email (later) | Cloudflare Email Routing or Resend | Only for receipts; OAuth handles auth |
| Payments | Stripe (Japan) | Standard; supports 個人事業主 |
| Marketing site | Astro on Cloudflare Pages (separate deploy) | SEO; independent of PWA |
| Docs site | VitePress on Cloudflare Pages | Lightweight; markdown |

### Workspace package structure (post-Phase 4)

```
packages/
  core/, editor/, render/, host-ui/, web/, extension/,
  desktop/, vscode/, imagequant/, annotator/, playwright/     ← existing
  worker/         ← Phase 2: GitHub OAuth + GitHub App + webhook +
                    auth + AnnotCloudStore API endpoints
  cloud-store/    ← Phase 4: client-side AnnotCloudStore
                    (StorageProvider impl talking to worker)
  marketing/      ← Phase 8: Astro landing site (separate deploy)
  docs-site/      ← Phase 8: VitePress documentation
```

`packages/worker/` is the single Worker monolith — all API
endpoints in one deploy. `packages/cloud-store/` is the
browser-side `StorageProvider` implementation that consumes the
Worker API; lives alongside the existing storage backends.

### Multi-tenant DB schema (D1)

Designed from day 1 to support paid plans without migration:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  github_id TEXT UNIQUE,
  google_id TEXT UNIQUE,
  display_name TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  stripe_subscription_id TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'member'
  invited_at INTEGER NOT NULL,
  accepted_at INTEGER,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE images (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  path TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  annotations_svg_r2_key TEXT,
  thumbnail_r2_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (workspace_id, path)
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  path TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (workspace_id, path)
);

CREATE TABLE share_links (
  id TEXT PRIMARY KEY,                  -- random URL-safe token
  resource_type TEXT NOT NULL,           -- 'image' | 'document'
  resource_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  password_hash TEXT,                    -- nullable; Pro feature
  view_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,                    -- nullable; Pro feature
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE github_installations (
  id INTEGER PRIMARY KEY,                -- GitHub-assigned installation id
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,            -- 'User' | 'Organization'
  workspace_id TEXT REFERENCES workspaces(id),
  installed_at INTEGER NOT NULL,
  suspended_at INTEGER
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);
```

Quotas live as constants in code (`packages/worker/src/plan-gates.ts`)
rather than DB rows so they're cache-friendly and version-controlled.
Changing a quota for an existing plan is a code change + redeploy,
not a DB migration.

### Plan gating

```ts
// packages/worker/src/plan-gates.ts
export const PLAN_LIMITS = {
  free: {
    storageBytes:        500_000_000,       // 500 MB
    activeShares:        3,
    activeDocuments:     5,
    privateShares:       false,
    passwordShares:      false,
    versionHistoryDays:  0,
    realtimeCollab:      false,
  },
  pro: {
    storageBytes:        50_000_000_000,    // 50 GB
    activeShares:        Infinity,
    activeDocuments:     Infinity,
    privateShares:       true,
    passwordShares:      true,
    versionHistoryDays:  30,
    realtimeCollab:      false,
  },
  team: { /* ... */ },
} as const;
```

Each API endpoint checks the relevant gate before mutating. Free
tier values are set high enough at Phase 4 (during pre-launch
beta) that no real user hits them; tightened to the launch values
in Phase 7 right before Stripe goes live.

### Auth flow

```
1. User clicks "Sign in with GitHub" on annot.work
2. Browser → Worker: GET /api/auth/github
3. Worker generates CSRF state, stores in KV (10min TTL),
   redirects to GitHub OAuth
4. GitHub → Worker: GET /api/auth/github/callback?code=…&state=…
5. Worker verifies state, exchanges code → access_token via
   GitHub API
6. Worker calls GitHub /user, finds-or-creates row in `users`,
   creates personal `workspace` if none exists
7. Worker mints session cookie (httpOnly, Secure, SameSite=Lax),
   stores session in KV (30d TTL)
8. Redirect to annot.work/?signed_in=1
```

GitHub OAuth App requires a registered callback URL — we register
both `https://annot.work/api/auth/github/callback` (prod) and
`http://localhost:8787/api/auth/github/callback` (local dev).
Self-hosters register their own OAuth App.

Same shape for Google OAuth, using `scope=email profile`.

### AnnotCloudStore on the browser side

```ts
// packages/cloud-store/src/index.ts
export class AnnotCloudStore implements StorageProvider {
  constructor(opts: {
    baseUrl: string;          // https://annot.work (or self-hosted)
    fetchImpl?: typeof fetch;
  });
  // implements all StorageProvider methods by calling Worker API
}
```

Wired into `packages/web` via `storage/bridge.ts` as one of the
selectable backends. Default for new users when signed in;
existing storage backends (Browser / Device / GitHub / Drive)
remain available.

## 8-phase technical roadmap

Each phase is its own PR (auto-merged per Excalidraw-route memory
authorization). Sub-phases land separately when too large for one
diff.

### Phase 1 — GitHub public化 + repo hygiene  *(1 week)*

- Apply secret audit findings (already verified clean).
- Land `pre-release-final-pieces.md` Stage 1:
  - `.github/ISSUE_TEMPLATE/bug.yml` + `feature.yml`
  - `.github/PULL_REQUEST_TEMPLATE.md`
  - `CODEOWNERS`
  - `FUNDING.yml`
  - `SECURITY.md` polish
- Flip `ingcreators/annot` from private to public.
- Enable Dependabot + secret-scanning.
- Branch protection on `main`.

**Decision gate**: green only if `pnpm test` + `pnpm lint` +
`pnpm -r typecheck` still pass after templates land.

### Phase 2 — Cloudflare Worker scaffold + GitHub OAuth  *(3 weeks)*

Sub-phases:

- **2a**: `packages/worker/` package scaffold. Wrangler config,
  Hono router skeleton, vitest-with-miniflare test setup,
  `/api/health` endpoint, CI deploy to `*.workers.dev` dev URL.
- **2b**: KV namespace + D1 binding wiring. Migration SQL files
  in `packages/worker/migrations/`. Empty schema first; tables
  land in Phase 3.
- **2c**: GitHub OAuth code → token exchange endpoint.
  `/api/auth/github` start, `/api/auth/github/callback` finish.
  CSRF state via KV. PAT path remains as fallback.

**Decision gate**: a logged-in test user, identified by GitHub
ID, persists across a tab reload. The web app reads the session
cookie via `/api/auth/me`.

### Phase 3 — Auth foundation + multi-tenant DB  *(2 weeks)*

- D1 migrations for `users`, `workspaces`, `workspace_members`.
- Google OAuth (mirrors GitHub OAuth code path).
- `/api/auth/me`, `/api/auth/logout`, `/api/auth/session`.
- Session refresh + invalidation.
- Personal workspace auto-created on first login.
- `packages/host-ui` gains a `<annot-sign-in-button>` LitElement
  that drives the OAuth start.

**Decision gate**: Both GitHub and Google paths produce a
distinct `users` row with a personal `workspaces` row. Logout
invalidates the session.

### Phase 4 — `AnnotCloudStore` (images + documents)  *(4 weeks)*

Sub-phases:

- **4a**: D1 migrations for `images`, `documents`, `audit_events`.
- **4b**: Worker endpoints:
  - `POST /api/images` (upload via multipart or pre-signed R2 URL)
  - `GET /api/images/:id` (signed-URL redirect to R2)
  - `PATCH /api/images/:id` (update annotations)
  - `DELETE /api/images/:id`
  - `GET /api/images?folder=…` (list)
  - Same shape for `/api/documents/*`
- **4c**: `packages/cloud-store/` package — client-side
  `StorageProvider` impl.
- **4d**: Wire into `packages/web/src/storage/bridge.ts`. Add a
  "Sign in to save to Annot Cloud" affordance on the gallery.
- **4e**: Per-workspace quota check on every write; HTTP 413 on
  exceed with a localised error message.

**Decision gate**: Upload an annotated screenshot via the PWA,
sign out, sign in on a different device, see it. Capture +
sign-out + sign-in cycle proves it on the extension. Same flow
for a Card Document.

### Phase 5 — Share / embed  *(2 weeks)*

- D1 migration for `share_links`.
- Worker endpoints:
  - `POST /api/shares` — create.
  - `GET /api/shares/:token` — view metadata.
  - `GET /api/shares/:token/payload` — view content (auth-aware).
  - `DELETE /api/shares/:token` — revoke.
- New `annot.work/share/:token` and `annot.work/embed/:token`
  routes (server-rendered HTML wrapping the view-only PWA
  surface).
- "Copy share link" affordance in the PWA + extension.
- `<iframe>`-embedding sandbox sandboxed with strict CSP.

**Decision gate**: An anonymous user (no Annot account) can view
a public share link in a fresh browser. Embeds work on a third-
party page (test on a fresh static HTML).

### Phase 6 — npm publish (annot-annotator + annot-playwright)  *(1 week)*

Inherits the headless-annotator-publish plan (now archived at
`docs/plans/_done/headless-annotator-publish.md`). Five sub-stages
within this phase:

- Vite library builds for `annotator` + `playwright`.
- `private: false` + `files` allowlist + `0.1.0` versions.
- Changesets bootstrap (`pre-release-final-pieces.md` Stage 2).
- Publish CI workflow (`workflow_dispatch`).
- First publish via manual trigger.

**Decision gate**: `npm install @ingcreators/annot-annotator`
from a fresh Node 24 project runs the README quickstart unmodified.

### Phase 7 — Stripe + Pro tier feature gates  *(3 weeks)*

Sub-phases:

- **7a**: `annot-cloud` private repo creation. Holds Stripe
  integration code, billing logic, future SSO. Pulled into the
  Worker deploy via a private npm package or git submodule.
- **7b**: Stripe Japan account creation + 個人事業主届 提出
  in parallel.
- **7c**: Stripe checkout integration. `POST /api/billing/checkout`
  → checkout session. `POST /api/billing/portal` → customer portal.
  `POST /api/webhooks/stripe` → subscription lifecycle.
- **7d**: Plan-gate enforcement tightened — free quotas
  reduced to launch values (500 MB / 3 shares / 5 documents).
  Existing pre-launch users get grandfathered into a special
  `early_supporter` plan (same as Pro, free forever).
- **7e**: Billing UI in `<annot-settings-dialog>`. Subscribe,
  manage, cancel.

**Decision gate**: A test Stripe customer (test mode) can sign
up, get upgraded to Pro, see the quota lifted, downgrade, see
the quota reapplied. Live mode tested with a real $5 charge
on the maintainer's own card, then refunded.

### Phase 8 — Launch prep  *(2 weeks)*

- `packages/marketing/` — Astro landing page at `annot.work/`
  (the PWA moves to `annot.work/app`).
- `packages/docs-site/` — VitePress documentation.
- Demo video (Loom or self-recorded). 90-second product walkthrough.
- Show HN draft (technical post; emphasis on Playwright + GitHub
  + OSS).
- Product Hunt submission draft.
- Twitter / Bluesky / X content stockpile (4–6 posts).
- Blog post: "Why we OSS'd the annotator core" (positioning).
- Press kit page on annot.work/press.

**Decision gate**: Two beta users complete the full sign-up →
upgrade → use → share flow without manual assistance. Launch
date scheduled.

## Legal / operations track (parallel)

Starts month 2, completes by month 5.

### 個人事業主届 (month 5)

Sole-proprietor registration in Japan:

- Submit `開業届` to local 税務署 (one A4 form, free).
- Submit `青色申告承認申請書` for tax benefit (optional but
  recommended).
- Open a dedicated business bank account (rakuten / paypay /
  住信SBI — supports Stripe Japan).
- 30-minute task at the 税務署 counter; 1 week processing.

**Critical**: not required for Phase 1–6. Required for Stripe
Japan registration in Phase 7.

### Stripe Japan onboarding (month 4-5)

- 2–4 weeks review cycle.
- Requirements: 開業届の控え, 銀行口座, 本人確認書類, business
  description, website URL (annot.work).
- 始められること: test mode immediately; live mode after
  approval.

### Privacy policy + Terms of Service (month 3)

- Draft using established templates (e.g. plain-language ToS
  generator; review against IPA template).
- Sections required for the Annot use case:
  - What we store (images, documents, account info).
  - How we use it (account function, not for ads).
  - Third-party processors (Cloudflare, Stripe, GitHub, Google).
  - Data retention (90 days after account deletion).
  - Data export (one-click ZIP via /api/account/export).
  - Data deletion (one-click via /api/account/delete).
  - GDPR rights (even though Japan-based, EU users need this).
  - Contact for privacy issues.
- **Optional but recommended**: lawyer review (~¥30,000–¥50,000
  for a one-time review of a SaaS ToS).
- Host at `annot.work/privacy` and `annot.work/terms`.

### Google OAuth verification (month 4)

- `drive.file` scope is non-sensitive so verification is light
  but still required for >100 users.
- Requirements: privacy policy URL, ToS URL, app logo (already
  generated in `brand/generated/oauth-logo-120.png`), demo video.
- 2–6 weeks review.
- Submit by end of month 4 to ensure approval before month 6 launch.

### GitHub App registration (month 4)

- Public GitHub App created under the `ingcreators` org.
- Permissions: repository contents (read/write for storage),
  checks (write for Check Runs), pull requests (write for
  comments), metadata (read).
- Webhook URL: `https://annot.work/api/webhooks/github`.
- Webhook secret stored as Worker secret.

### Content moderation policy (month 5)

- Public abuse report email: `abuse@annot.work` (forward to
  personal).
- DMCA takedown process documented at
  `annot.work/legal/dmca`.
- CSAM scanning: enabled by default on R2 via Cloudflare's
  built-in service (zero cost).
- 24-hour response SLA for abuse reports during launch month,
  loosened to 72h afterward.

## Marketing track (parallel)

Starts month 4, ramps in month 5–6.

- Twitter / Bluesky account creation (use ingcreators name).
- Periodic build-in-public posts (1–2/week) showing progress.
- Landing page mockups iterate in months 4–5.
- Demo video shot in month 5, polished in month 6.
- Show HN: title drafted, content drafted. Aim for Tuesday or
  Wednesday morning JST = late evening US west coast.
- Product Hunt: submitted same week as Show HN for compounding.
- Optional: paid Twitter promotion on launch day ($30).

## Risk register

### High-impact risks

1. **Solo dev burnout over 6 months of full-time work**.
   - Mitigation: take Sundays off; track weekly hours; if any
     single week exceeds 50 hours, scale back the next week.
2. **OAuth verification approval slippage**.
   - Mitigation: submit Google verification end of month 4; have
     PAT-only fallback documented as a workaround if verification
     stalls.
3. **First Stripe charge timing**.
   - Mitigation: 個人事業主届 + Stripe registration both have
     hard dependencies. Start month 4 latest.
4. **Security incident during pre-launch beta**.
   - Mitigation: weekly `pnpm audit`; staticxss scan SVG inputs
     server-side; rate limiting; Cloudflare WAF.
5. **R2 / D1 service outage during launch week**.
   - Mitigation: Cloudflare status page subscribed; status page
     at `status.annot.work` (Cloudflare Pages, simple); user
     comms via Twitter.

### Medium-impact risks

6. **Slow paying-customer adoption** (only 0–5 paying users for
   first 6 months post-launch).
   - Mitigation: 2-year burn budget pre-confirmed; product
     improvements driven by Free tier feedback; Twitter audience
     building.
7. **Self-hosters expect feature parity with `annot.work`**.
   - Mitigation: self-host docs explicitly call out which features
     require Stripe (only Pro tier billing; Free / Team plan-gates
     are code-level and self-host gets them too).
8. **CSAM / copyrighted content uploaded by malicious users**.
   - Mitigation: Cloudflare CSAM scanning on R2; abuse@annot.work
     email; legal/dmca page; account ban procedure documented.

### Low-impact risks

9. **GitHub App webhook delivery failures**.
   - Mitigation: idempotent processing; replay endpoint at
     `/api/webhooks/github/replay`.
10. **Stripe payment failures** (declined cards, expired cards).
    - Mitigation: Stripe handles retries automatically; dunning
      emails via Stripe; downgrade-to-free fallback on prolonged
      failure.

## Decision gates summary

| Phase | Exit criterion | If failed |
|---|---|---|
| 1 | Public repo, CI green | Revert visibility, fix |
| 2 | OAuth round-trip works | Stay in dev; debug |
| 3 | Two providers, sessions persist | Stay in dev; fix |
| 4 | Cross-device upload + download | Stay in dev; fix |
| 5 | Anonymous view works on share link | Stay in dev; fix |
| 6 | `npm install` quickstart works | Defer publish; ship the rest |
| 7 | Test mode charge → live mode charge | Stay in dev; fix |
| 8 | Beta users complete sign-up → upgrade → share | Push launch back 2 weeks |

## Reconciling with earlier session decisions

Earlier in the session, while exploring "complete OSS / no
monetization", several actions were proposed. With the
Excalidraw-route now locked in, those actions are **reversed**
(no PRs were merged for them):

| Earlier proposal | Status now |
|---|---|
| Archive `oss-cloud-split.md` | **Cancelled** — stays Active; gets revised to align with this roadmap |
| Strip commercial strategy detail from public docs | **Cancelled** — keep all content; Sentry / Plausible pattern |
| Remove `annot-cloud` private repo concept | **Cancelled** — actually created in Phase 7a |
| Remove commercial framing from `PRODUCT_DIRECTION.md` | **Cancelled** — stays |
| Skip privacy policy / ToS | **Cancelled** — required (Phase 7-Legal track) |

The session also confirmed pre-public-audit findings (secret
scan clean, no hard sensitive content). Those findings stand;
the proposed "consider revising" items in
`oss-cloud-split.md` are now **kept verbatim** since they're
part of the disclosed strategy.

## Open questions (decide before the relevant phase)

- **Q1 (Phase 5)**: Public-share storage cleanup policy — auto-
  expire abandoned shares after 1 year? Keep forever for paid
  users?
- **Q2 (Phase 7)**: Annual vs. monthly billing — annual gives
  -2 months discount but locks in 12-month commitment. Default?
- **Q3 (Phase 7)**: Trial period — 14 days of Pro for new
  signups? Or freemium forever?
- **Q4 (Phase 8)**: Marketing site framework — Astro is queued
  but maybe consider Mintlify (combined docs + marketing) for
  speed?
- **Q5 (Post-launch)**: When to start real-time collaboration
  (Team tier marquee feature)? Q1 post-launch or later?

## Verification

This is a roadmap, not an implementation. "Verification" means:

- Each of Phase 1 through 8 ships behind its own decision gate.
- Pre-launch beta with 10 invited users (developer friends,
  Twitter early followers) starting end of month 5.
- Launch day = `annot.work` public, Show HN + Product Hunt live,
  Pro tier purchasable, all 8 phases green.
- Post-launch milestones:
  - **Month 7**: 100 free users.
  - **Month 9**: First 5 Pro subscribers.
  - **Month 12**: Break-even (10+ Pro subscribers).
  - **Month 18**: Sustainability (50+ Pro + maybe 1–2 Team).
  - **Month 24**: Decision on full-time sustainability vs. seeking
    funding / co-founder / acquisition.

## Migration notes

None — this is greenfield product launch work. No data
migration (no production users yet). No schema changes to
existing OSS storage backends (Browser / Device / GitHub /
Drive remain unchanged); `AnnotCloudStore` is purely additive.

## References

- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) —
  strategic vectors (Playwright + GitHub).
- [`docs/plans/oss-cloud-split.md`](./oss-cloud-split.md) —
  architectural guardrails (G1–G6); plan stays Active and
  becomes the reference for the cloud track architecture.
- [`docs/plans/github-integration.md`](./github-integration.md) —
  existing OSS GitHub Store; Phase 5+ commercial section is
  superseded by Phase 2 + Phase 7 of this roadmap.
- [`docs/plans/google-drive-integration.md`](./google-drive-integration.md) —
  existing OSS Drive Store; OAuth Verification covered in this
  roadmap's Legal track.
- [`docs/plans/_done/headless-annotator-publish.md`](./_done/headless-annotator-publish.md) —
  became Phase 6 of this roadmap; archived after first publishes landed.
- [`docs/plans/pre-release-final-pieces.md`](./pre-release-final-pieces.md) —
  Stage 1 (templates) becomes Phase 1; Stage 2 (Changesets)
  becomes part of Phase 6.
