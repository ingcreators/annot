# Annot product roadmap — Excalidraw-route launch

> **Status:** Phases 1–6 landed; Phase 6 follow-up (embedded
> editor + GitHub round-trip, living-spec 5y / 5z) + Phase 7
> (Stripe + Pro tier) + Phase 8 (Launch prep) queued.
>
> Phases 1–5 shipped through 2026-04 to 2026-05 across the
> broader `ingcreators/annot` Worker + storage development:
> `packages/worker/` is in production at `annot.work/api/*` with
> GitHub + Google OAuth, multi-tenant D1 schema
> (`users` / `workspaces` / `workspace_members` / `images` /
> `documents` / `share_links`), `packages/cloud-store/` for the
> client-side `AnnotCloudStore`, and the share/embed endpoints
> behind `/api/shares/*` + `/share/:token` + `/embed/:token`.
> Phase 6 (npm publish of `@ingcreators/annot-annotator` +
> `@ingcreators/annot-playwright`) shipped 2026-05-19 (annotator
> at `0.5.0`, playwright at `0.4.0`).
>
> The Phase 6 follow-up below — embedded editor + GitHub
> round-trip — inserts ahead of Phase 7 Stripe based on the
> 2026-05-23 follow-up decision that the round-trip editor is a
> stronger free-tier anchor than rushing the paid-tier launch.
> OSS-side pieces ([`living-spec-authoring-roadmap.md`](./living-spec-authoring-roadmap.md)
> Phase 5 sub-phases 5a–5h) already shipped via PRs
> [#1013](https://github.com/ingcreators/annot/pull/1013)–[#1020](https://github.com/ingcreators/annot/pull/1020).
>
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
  desktop/, vscode/, annotator/, playwright/, mcp/            ← existing
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

### Phase 6 follow-up — Embedded editor + GitHub round-trip (living-spec 5y / 5z)  *(~3-4 weeks)*

The OSS-side pieces of
[`living-spec-authoring-roadmap.md`](./living-spec-authoring-roadmap.md)
Phase 5 (sub-phases 5a–5h, PRs
[#1013](https://github.com/ingcreators/annot/pull/1013)–[#1020](https://github.com/ingcreators/annot/pull/1020))
shipped 2026-05-23. This phase adds the matching cloud-side
wiring on the existing Worker so visitors of ANY docs site
rendered by `@ingcreators/annot-product-docs-astro` can click
`<AnnotEditButton>` and round-trip edits through annot.work to
their own GitHub repo.

#### Why insert this here

- Phase 2–3's auth foundation (GitHub OAuth + session) is the
  only annot-cloud-side prerequisite; it has been in
  production at `annot.work/api/*` since the corresponding
  sub-phases landed.
- 5a–5h ships a working OSS button that's currently a no-op
  pending the cloud-side route. Closing that gap unlocks an
  immediate user-visible feature.
- The round-trip editor is a stronger free-tier anchor than
  rushing Stripe — visitors come for "edit your docs in one
  click" before they consider paying for Pro. Matches the
  Excalidraw-route positioning per
  [`project_excalidraw_route_pivot`](../../memory/project_excalidraw_route_pivot.md).

#### Sub-phases

The OSS-side numbering (5a–5h) was already consumed by the
living-spec plan; this phase uses `5y` / `5z` per that plan
to stay consistent across both documents. Each sub-phase
lands as an independent PR, merged on CI green before the
next starts, mirroring the OSS-side Phase 5 cadence.

| Sub | Output | Scope |
|---|---|---|
| **5y-1** | `annot-cloud-editor` GitHub App registration + D1 migration for `github_installations` extensions + Worker secrets surface. New file `packages/worker/src/embed/github-app.ts` declaring `GITHUB_APP_ID` / `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_WEBHOOK_SECRET` on the `Env` interface (private key as PEM string secret). D1 migration `0007_github_installations_embed.sql` extends the existing `github_installations` table from the Phase 3 schema with `repo_policy` (`'pr-mode' \| 'direct-push'`, default `'pr-mode'`), `default_branch_override` (nullable), `build_hook_url` (nullable, populated by 5z-1), `target_paths_json` (nullable JSON allowlist of `<repo>/<path-prefix>` pairs the App is authorised to commit under). Repo manifest committed at `packages/worker/embed-github-app-manifest.json` so customers can register their BYO App via [GitHub's manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest). Worker exposes a one-shot `/api/embed/setup` page (Pro-tier dashboard later) that POSTs the manifest to GitHub on the user's behalf for the self-host path. **No GitHub-side credentials in code** — the user creates the App at <https://github.com/settings/apps/new> (or imports the manifest) BEFORE this PR's tests can run end-to-end; the PR description carries the explicit user-action callout. | Tier A (Worker-only). Establishes the credential surface + schema columns the rest of 5y / 5z consume. No editor-mounting logic yet — landing it first means the secret-binding deploy gets a dedicated PR review. |
| **5y-2** | `/api/embed/load?repo=…&pngPath=…&annotationsPath=…` Worker endpoint. New file `packages/worker/src/embed/load.ts` plus `packages/worker/src/embed/github-app-token.ts` (App JWT signing via `crypto.subtle.importKey({...RSASSA-PKCS1-v1_5}, "spki" / "pkcs8")` + installation-token caching with 50-minute TTL in `SESSIONS` KV). Endpoint parses URL params via `parseEmbedRequestUrl` from `@ingcreators/annot-embed-protocol` (so the codec contract is the single source of truth for what the OSS-side `encodeEmbedRequestUrl` produces; 5b shipped in PR [#1015](https://github.com/ingcreators/annot/pull/1015)), looks up the installation row via `github_installations` + `target_paths_json` allowlist, mints an installation token, reads `pngPath` (binary) + `annotationsPath` (text) via the GitHub Contents API. Returns `{ pngBase64, annotationsYaml, repoState: { branch, headSha, sourceCommitSha } }` for the editor to consume. Visitor authorised via session (cloud-roadmap Phase 3 in production). Per the pricing tier mapping below: free-tier users can hit the endpoint only for PUBLIC repos; private-repo access requires `users.plan IN ('pro', 'team', 'enterprise')`. | Tier A (Worker-only). Independent PR because the App-token signing logic + the Contents API read path are testable end-to-end against a synthetic installation without the editor side mounted yet (we mock `/installations/:id/access_tokens` + `/repos/:owner/:repo/contents/:path` in vitest-with-miniflare). |
| **5y-3** | `/embed` static HTML route + `<annot-embed-shell>` LitElement. New files `packages/worker/src/embed/page.ts` (HTML emitter — the Worker serves the page directly since it's tiny and benefits from Cloudflare Pages's edge cache via the same Worker fetch handler) + `packages/host-ui/src/embed/embed-shell.ts` + `packages/host-ui/src/embed/github-app-store.ts`. `GitHubAppStorageProvider` is a `StorageProvider` impl whose reads / writes proxy to `/api/embed/load` / `/api/embed/commit` (5y-2 / 5y-4). `<annot-embed-shell>` mounts `EditorShell.mountFromRecord` from `@ingcreators/annot-host-ui` (the same shell the PWA boots through per `_done/editor-session-shell-switchover.md`) against `GitHubAppStorageProvider`, posts `EditorReady` via `createEmbedClientMessenger` from `@ingcreators/annot-embed-protocol` (5c, PR [#1015](https://github.com/ingcreators/annot/pull/1015)) when the URL params include `?mode=inline`, OR runs standalone for `?mode=newTab`. CSP set to `frame-ancestors *` for inline mode (relaxed from default `frame-ancestors 'none'`) since arbitrary docs sites embed us — origin validation lives in the message-channel layer per 5c's design. | Tier C (host-ui — DOM-bound). Independent PR because mounting `EditorShell` against the new `GitHubAppStorageProvider` exercises every read/write surface and is non-trivial to land alongside the commit endpoint. The Save button stays disabled until 5y-4 lands; `EditAbandoned` flows through 5y-5. |
| **5y-4** | `POST /api/embed/commit` endpoint with PR-mode / direct-push policy. New file `packages/worker/src/embed/commit.ts`. Reads the installation's `repo_policy`: `'direct-push'` commits straight to `default_branch_override ?? <repo default>` via the Contents API (`PUT /repos/:owner/:repo/contents/:path` with `sha` from 5y-2's `repoState`); `'pr-mode'` creates a branch `annot-edit/<editId>`, commits there, then opens a PR via `/repos/:owner/:repo/pulls` with the editor metadata (commit message includes `Annot edit via annot.work/embed`). On Contents-API 409 (sha mismatch — someone else pushed to the same path), 5y-4 returns `{ ok: false, error: "conflict" }` so the editor surfaces a "reload + retry" prompt per the [Conflict handling](./living-spec-authoring-roadmap.md#conflict-handling) section. The Worker emits an `audit_events` row per commit (`action: 'embed_commit'`, `metadata_json` carries the policy + branch + PR number + edit id). | Tier A. Independent PR because the policy switch + audit-event semantics are reviewable separately from the Editor-Save UX it unblocks. |
| **5y-5** | Hash-redirect on save / abandon. Adds `<annot-embed-shell>` save / abandon handlers: `mode=newTab` runs `window.location.replace(returnUrl + '#edit-complete=' + editId)` on commit success (or `'#edit-abandoned=1'` on abandon); `mode=inline` posts `EditCommitted({ editId, commitSha, prUrl? })` / `EditAbandoned()` via the 5c messenger. The OSS-side `<AnnotEditCompleteListener>` from Phase 5g (PR [#1019](https://github.com/ingcreators/annot/pull/1019)) parses the hash + renders the toast, so this PR's job is just to emit the hash byte-for-byte per 5b's `encodeEmbedReturnHash` shape. Worker emits `audit_events` for `embed_abandoned` to mirror the commit log. | Tier C (host-ui surface). Independent PR because the new-tab return flow is testable via Playwright end-to-end against the dogfood workflow-app docs site once 5y-2/-3/-4 have landed (a state we get to between 5y-4 and 5y-5). |
| **5z-1** | Build-trigger integration. After 5y-4 commits, the Worker `fetch()`-pings `github_installations.build_hook_url` (Cloudflare Pages deploy hook / Vercel deploy hook / GitHub Pages `repository_dispatch` URL). Per-installation config: 5y-1 added the `build_hook_url` column; this PR adds a `PATCH /api/embed/installations/:id` endpoint so the installation's owner can rotate the URL via curl / the future dashboard (no UI in this PR; CLI-only via session cookie). Failure is non-fatal — the commit still returns 200 and the build-hook outcome is logged to `audit_events` (`action: 'embed_build_hook'`, `metadata_json.http_status`). Idempotent retry on 5xx with a 30-second back-off (capped at 3 attempts). | Tier A. Independent PR because the build-trigger semantics + retry policy are orthogonal to the commit flow. |
| **5z-2** | On-prem deployable bundle + setup recipe. Adds `docs/plugin-api/embed-editor-self-host.md` walking through: (a) deploying `packages/worker/` to the customer's own Cloudflare account (`wrangler deploy --env=customer` recipe with the customer's `account_id`); (b) provisioning D1 + KV + R2 bindings via the existing `migrations/*.sql`; (c) registering a BYO GitHub App via the `embed-github-app-manifest.json` flow from 5y-1 (the same manifest URL but with `cloudUrl` = `https://annot.example.com`); (d) consuming the on-prem editor from a customer docs site by setting `editor.cloudUrl` in `annot-docs.config.ts` per Phase 5f (PR [#1018](https://github.com/ingcreators/annot/pull/1018)). New `packages/worker/scripts/setup-customer.ts` (Node CLI) bundles the wrangler config + secret-puts + D1 migrate steps into one command. No new Worker code — this PR is documentation + the CLI wrapper. | Tier A (docs + CLI). Independent PR because it's the closing publication step, depending on every preceding sub-phase being in production. |

##### 5y-1 user action required

The `5y-1` PR cannot be tested end-to-end until the user has
manually registered the GitHub App on `github.com`. **Before
opening the 5y-1 PR for merge**, do the following on the
GitHub-side (one-time, ~10 minutes):

1. Visit <https://github.com/settings/apps/new> while signed in
   to the GitHub user / org that will own the App
   (`ingcreators` for the production `annot.work` deployment;
   the customer's own org for self-host deployments).
2. Fill in the manifest fields per
   `packages/worker/embed-github-app-manifest.json` (this
   file lands in the 5y-1 PR — use it as the source of truth
   for `name` / `url` / `callback URLs` / `permissions` /
   `events`).
3. Once the App is created, generate the private key (PEM
   download) and capture: **App ID** (integer, shown on the
   App settings page) + **Client ID** + **Client secret** +
   **Webhook secret** (paste the value used at creation) +
   the downloaded `*.pem` private key file.
4. Set the Worker secrets via `wrangler secret put` against
   the `annot-api` Worker (one command per secret —
   `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`,
   `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`,
   `GITHUB_APP_PRIVATE_KEY`). The last one accepts a
   multi-line PEM — `wrangler secret put` reads stdin.
5. Confirm via `wrangler tail --env production` + a manual
   GET against the new `/api/embed/health` endpoint
   (shipped in 5y-1) that the secrets are present.

The PR description for 5y-1 ships with a copy-pasteable
version of these steps so the user can complete them right
before merging.

#### Pricing implications

Per the locked pricing tiers above, the round-trip editor
applies asymmetrically across tiers:

- **Free**: round-trip editing IS available for the user's
  own PUBLIC GitHub repos. This is the "Excalidraw-style"
  free-tier anchor that makes annot.work valuable even
  without paying — same shape as Excalidraw's free-tier
  unlimited drawing.
- **Pro** ($5/mo): unlocks the editor for PRIVATE GitHub
  repos, audit log of edits, per-repo embed-mode policy
  (force `newTab` for Enterprise-style customers).
- **Team** ($5/user/mo): adds workspace-scoped App install +
  shared audit log.
- **Enterprise** (per
  [`project_annot_cloud_enterprise_tier`](../../memory/project_annot_cloud_enterprise_tier.md)):
  on-prem `cloudUrl` deployment, SSO via Cloudflare Access,
  custom GitHub App registration, IP allowlist.

#### Repo split (OSS vs annot-cloud private)

Per the top-level "Compatibility" note, only Phase 7 onward
goes to the private `annot-cloud` repo. The 5y / 5z code
itself (Worker route + GitHub App glue + Worker proxy +
build trigger + on-prem bundle) lives in this OSS repo
under `packages/worker/src/embed/` (or similar). The split
mirrors Excalidraw / Plausible / Sentry — the editor + the
core wiring is OSS, only billing + Enterprise-tier SSO
connectors are private.

#### Decision gate

A logged-in test user clicks `<AnnotEditButton>` on the
workflow-app docs site (the 5h dogfood), the new tab opens
`annot.work/embed`, the editor loads a real PNG +
annotations yaml from a test repo, the user edits + saves,
the commit lands on the configured branch, and the docs
site receives the post-edit hash + renders the Phase 5g
toast. On-prem variant verified by deploying the Worker
bundle to a test Cloudflare account and round-tripping
against a different test repo.

#### OSS-side surface consumed (canonical reference)

Phase 5 OSS-side shipped through PRs
[#1013](https://github.com/ingcreators/annot/pull/1013)–[#1020](https://github.com/ingcreators/annot/pull/1020),
matching the living-spec roadmap's sub-phases 5a–5h. The
cloud-side 5y / 5z consume the following surfaces verbatim
(no shape changes — if the cloud-side wants different
bytes, the request comes back through a new
embed-protocol PR first):

- **`@ingcreators/annot-embed-protocol`** —
  - `EmbedMode = "newTab" | "inline" | "disabled"` (5a)
  - `EmbedEvent` discriminated union (`EditorReady` /
    `EditRequested` / `EditCommitted` / `EditAbandoned` /
    `ResizeNeeded`) (5a)
  - `encodeEmbedRequestUrl` / `parseEmbedRequestUrl`
    (`?repo` / `?pngPath` / `?annotationsPath` / `?return` /
    `?mode`) (5b)
  - `encodeEmbedReturnHash` / `parseEmbedReturnHash`
    (`#edit-complete=<editId>` / `#edit-abandoned=1`) (5b)
  - `createEmbedHostMessenger` (consumer side, used by
    `<AnnotEditorIframeModal>`) /
    `createEmbedClientMessenger` (producer side, used by
    5y-3's `<annot-embed-shell>`) (5c)
- **`@ingcreators/annot-product-docs-astro` components** —
  - `<AnnotEditButton>` (5d / 5e) — emits the URL the
    Worker's `/embed` route must accept.
  - `<AnnotEditorIframeModal>` (5e) — consumes the
    `EditCommitted` / `EditAbandoned` / `ResizeNeeded`
    events the Worker's editor side posts via 5y-5.
  - `<AnnotEditCompleteListener>` (5g) — consumes the
    `#edit-complete=<id>` hash 5y-5 redirects to.
- **`annot-docs.config.ts`** `editor.cloudUrl`
  (Phase 5f) — every customer docs site points at the
  Worker route via this knob. The on-prem 5z-2 recipe is
  the customer changing the `cloudUrl` value, nothing more.

#### Out of scope for this phase

- Stripe billing for the Pro / Team / Enterprise tiers —
  Phase 7 remains the canonical home.
- Real-time multi-editor collaboration on the same yaml —
  see [`living-spec-authoring-roadmap.md`](./living-spec-authoring-roadmap.md)
  OQ-07.
- Mobile editor support — desktop-only in v1 per the parent
  plan.

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
