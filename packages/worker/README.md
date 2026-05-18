# `@ingcreators/annot-worker`

Cloudflare Worker hosting Annot's API surface — GitHub OAuth,
GitHub App, AnnotCloudStore endpoints, share / embed.

> **Status:** Phase 5. `/api/shares/*` landed:
> POST create / GET list (auth) + GET `/api/shares/:token` and
> `/api/shares/:token/payload` (public, cookie-less) + DELETE
> revoke (auth). Shares grant anonymous read access to one image
> or document; tokens are 22-char base62 URL slugs (~130 bits
> entropy). Active share count is plan-gated (free: 30 beta /
> 3 launch). `/api/usage` now also surfaces `activeShares` and
> `shareCount`. Migration `0003_shares.sql` adds the
> `share_links` table.
>
> Plan: [`docs/plans/annot-cloud-roadmap.md`](../../docs/plans/annot-cloud-roadmap.md).

## Local development

```sh
pnpm install
```

### Notes on `wrangler` invocation

Wrangler walks up the directory tree looking for config files,
and at each level prefers `.jsonc` over `.toml`. The repo root
has a `wrangler.jsonc` for the static PWA. If this package used
`wrangler.toml`, wrangler would walk past it and pick up the
root config by mistake.

This package therefore uses `wrangler.jsonc` (NOT `.toml`) so
wrangler stops at the closer match. All operator-facing wrangler
invocations are wrapped as npm scripts in
`packages/worker/package.json`; prefer those over raw
`pnpm exec` so the working directory is also correct.

### One-time setup (creates the Cloudflare resources)

After `wrangler login` (or with `CLOUDFLARE_API_TOKEN` set):

```sh
# Create the KV namespace (production + preview).
cd packages/worker
pnpm exec wrangler kv namespace create SESSIONS
pnpm exec wrangler kv namespace create SESSIONS --preview

# Create the D1 database.
pnpm exec wrangler d1 create annot-db

# Create the R2 bucket for image / document bytes.
pnpm exec wrangler r2 bucket create annot-objects
cd ../..
```

KV and D1 each print an `id`; replace the placeholder values in
`packages/worker/wrangler.jsonc`:

- `kv_namespaces[0].id`         ← from `kv namespace create SESSIONS`
- `kv_namespaces[0].preview_id` ← from `kv namespace create SESSIONS --preview`
- `d1_databases[0].database_id` ← from `d1 create annot-db`

R2 buckets are addressed by name, not id, so no wrangler.jsonc
edit is needed after `r2 bucket create annot-objects`.

### Apply migrations

```sh
# Local D1 (for `wrangler dev`):
pnpm --filter @ingcreators/annot-worker migrations:apply:local

# Remote D1 (for `wrangler deploy`):
pnpm --filter @ingcreators/annot-worker migrations:apply
```

### Set the OAuth secrets

```sh
pnpm --filter @ingcreators/annot-worker secrets:put:github-client-id
# (prompt — paste the GitHub OAuth App Client ID)

pnpm --filter @ingcreators/annot-worker secrets:put:github-client-secret
# (prompt — paste the Client Secret)

pnpm --filter @ingcreators/annot-worker secrets:put:google-client-id
# (prompt — paste the Google OAuth Client ID)

pnpm --filter @ingcreators/annot-worker secrets:put:google-client-secret
# (prompt — paste the Client Secret)
```

Verify the secrets list:

```sh
pnpm --filter @ingcreators/annot-worker secrets:list
```

### Run the Worker

```sh
pnpm --filter @ingcreators/annot-worker dev
```

`wrangler dev` boots on `http://localhost:8787`. Test:

```sh
curl http://localhost:8787/api/health
# { "ok": true, "service": "annot-api", "timestamp": "..." }

curl http://localhost:8787/api/health/bindings
# { "ok": true, "service": "annot-api", "kv": "ok", "db": "ok", "timestamp": "..." }
```

If `/api/health/bindings` returns `503` with `errors.kv` or
`errors.db`, the bindings haven't been configured — return to
the one-time setup section.

### Tail production logs

```sh
pnpm --filter @ingcreators/annot-worker tail
```

### Deploy

```sh
pnpm --filter @ingcreators/annot-worker cf:deploy
```

The script is named `cf:deploy` rather than `deploy` because
`pnpm deploy` is a built-in pnpm command (it copies a package to
a target directory for self-contained deployment, unrelated to
Cloudflare). The `cf:` prefix sidesteps the collision.

## Tests

Pure-function tests via `vitest` + Hono's `app.request()`:

```sh
pnpm vitest run packages/worker
```

These don't boot Miniflare — they invoke handlers directly with
in-memory KV / D1 mocks (`src/test-helpers.ts`). Phase 4 may
graduate binding-aware paths to
`@cloudflare/vitest-pool-workers` if mock fidelity becomes the
bottleneck; today's mocks are sufficient.

## CI auto-deploy

[`.github/workflows/worker-deploy.yml`](../../.github/workflows/worker-deploy.yml)
deploys to Cloudflare on every `main` push that touches
`packages/worker/**`, plus a manual `workflow_dispatch`
trigger for re-deploys / rollbacks.

### Required repo secrets

| Name | Source | Permissions |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → Manage Account → API Tokens → "Create Token" | Account: Workers Scripts:Edit + Workers R2 Storage:Edit + D1:Edit; Zone: Workers Routes:Edit + Zone:Read (on `annot.work`) |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard → Workers & Pages → right sidebar | none (just an identifier; recommended for explicit account binding) |

The "Edit Cloudflare Workers" template gets you most of the
permissions; add **D1:Edit** manually so the workflow's
schema-drift check can read `d1_migrations`. (Cloudflare
doesn't expose a read-only D1 scope, but D1:Edit is the
narrowest available.)

Set both in **Settings → Secrets and variables → Actions → New
repository secret**.

### Schema-drift guard

The workflow is **deliberately split-brain**: auto-deploys
code, but does **not** auto-apply D1 migrations. To prevent
"new code SELECTs a column the remote DB doesn't have yet"
500s, the deploy fails fast when local
`packages/worker/migrations/*.sql` files don't all appear in
the remote `d1_migrations` table.

When the guard fires:

```sh
pnpm --filter @ingcreators/annot-worker migrations:apply
```

Then re-dispatch the workflow from **Actions → Worker deploy
→ Run workflow** (no code change needed — the
`workflow_dispatch` lever exists for exactly this).

### Path filter

The workflow ignores edits that don't change the deployed
Worker bundle:

- `packages/worker/README.md` — docs only
- `packages/worker/migrations/**` — schema files are
  operator-applied, not code-deployed (apply manually, then
  push a code change or `workflow_dispatch` to trigger
  deploy)

### What the workflow does NOT do

- **Apply D1 migrations.** A bad migration can brick
  production; `migrations:apply` stays manual. The drift
  guard above is the safety net against forgetting.
- **Manage secrets.** `wrangler secret put` is also manual
  (one-time bootstrap; rotations are operator-driven).
- **Deploy the PWA worker.** The PWA's static-assets deploy
  story lives in the repo-root `wrangler.jsonc` and isn't
  wired into CI yet.

### Post-deploy smoke check

The workflow finishes with a `curl https://annot.work/api/health/bindings`
that asserts `ok: true` across KV/D1/R2 (with up to 30s of
retry to absorb Cloudflare edge propagation). A failure here
surfaces a regression immediately instead of via the first
real user request.

## Architecture

| Concern | Location |
|---|---|
| Static PWA at `annot.work` | Repo-root `wrangler.jsonc` (separate Worker, name `annot`) |
| API at `annot.work/api/*` (same-origin with the PWA) | This package, name `annot-api` |
| Database | Cloudflare D1 (multi-tenant SQLite) |
| Object storage | Cloudflare R2 (image / document bytes) |
| Sessions / CSRF state | Cloudflare KV |
| Payments | Stripe (Phase 7) |

## Operator action required for deploy

The Worker code ships with the OAuth flow + route binding wired,
but neither the credentials nor the Cloudflare zone setup ride
along in source. To make sign-in work end-to-end the operator:

1. **Registers a GitHub OAuth App** at
   <https://github.com/settings/developers> → "New OAuth App"
   - Homepage URL: `https://annot.work`
   - Authorization callback URL:
     `https://annot.work/api/auth/github/callback`
2. **Registers a Google OAuth Client** at
   <https://console.cloud.google.com> → APIs & Services →
   Credentials → OAuth client (Web application)
   - Authorised redirect URI:
     `https://annot.work/api/auth/google/callback`
3. **Sets the client IDs + secrets** as Worker secrets:
   ```sh
   pnpm --filter @ingcreators/annot-worker secrets:put:github-client-id
   pnpm --filter @ingcreators/annot-worker secrets:put:github-client-secret
   pnpm --filter @ingcreators/annot-worker secrets:put:google-client-id
   pnpm --filter @ingcreators/annot-worker secrets:put:google-client-secret
   ```
4. **Confirms the `annot.work` zone exists on the deploy
   account** and the API token used for `cf:deploy` has
   `Worker Routes:Edit` for it. Without that, the deploy fails
   with a 403 when wrangler tries to install the route binding
   from `wrangler.jsonc`.

Until step 1–3 are done, `/api/auth/*` returns
`500 oauth_not_configured`. Step 4 is required for the deploy
itself to succeed — without the zone permission, wrangler
fails the route-install step with a 403.

### Self-hosting

The deploying Cloudflare account doesn't have to own
`annot.work` to run this Worker. Fork the repo and edit
`wrangler.jsonc` to:

  - Replace the `pattern` / `zone_name` in the `routes` stanza
    with whatever zone the operator owns, OR
  - Drop the `routes` stanza entirely AND flip
    `workers_dev` back to `true`. Wrangler will then publish
    on the `*.workers.dev` subdomain. The PWA's cloud-connect
    modal "Advanced" override accepts that URL as the base.

## Roadmap

- **Phase 2a** ✅: scaffold + `/api/health`.
- **Phase 2b** ✅: KV (`SESSIONS`) + D1 (`DB`) binding wiring
  (empty schema), `/api/health/bindings` smoke probe, migrations
  directory.
- **Phase 2c** ✅: GitHub OAuth endpoints (start + callback),
  `/api/auth/me`, `/api/auth/logout`, session cookies.
- **Phase 3a/3b** ✅: `users` / `workspaces` / `workspace_members`
  D1 tables; OAuth callback persists a user row + personal
  workspace; session records carry `userId` / `workspaceId`;
  `/api/auth/me` returns the IDs and touches `users.last_seen_at`.
- **Phase 3c** ✅: Google OAuth (mirror of GitHub OAuth code
  path). Cross-provider account linking is intentionally NOT
  implemented — each provider is a separate identity row.
- **Phase 4a** ✅: R2 bucket binding wired (`OBJECTS`).
  `/api/health/bindings` now checks KV + D1 + R2.
- **Phase 4b** ✅: `0002_storage.sql` migration — `images`,
  `documents`, `audit_events` tables.
- **Phase 4c** ✅: `/api/images/*` CRUD endpoints (upload, get,
  list, patch, delete, original bytes, annotations SVG).
- **Phase 4d** ✅: `/api/documents/*` CRUD endpoints
  (`.annot.html` documents: upload, get, list, patch, delete,
  content bytes). Document upload cap is 50 MB (vs 25 MB for
  images) since `.annot.html` embeds base64 image data.
- **Phase 4e** ✅: per-workspace plan-gated quotas.
  `plan-gates.ts` holds the `PLAN_LIMITS` table (free / pro /
  team); `checkUploadQuota` runs before every byte-adding write
  and returns HTTP 413 `quota_exceeded` when exceeded.
  `/api/usage` exposes plan + usage + limits for the gallery
  storage bar.
- **Phase 5** ✅ (this PR): Share / embed endpoints.
  `share_links` table (migration `0003`); `/api/shares` create
  + list (auth); `/api/shares/:token` + `/api/shares/:token/payload`
  (public, anonymous read); `DELETE /api/shares/:token` revoke
  (auth, workspace-scoped). Active share count plan-gated
  (free: 30 beta → 3 launch). Pro-only fields (`password_hash`,
  `expires_at`) reserved in the schema but not yet wired.
- **Phase 5**: Share / embed (`/api/shares`).
- **Phase 7**: Stripe checkout + webhook (`/api/billing`,
  `/api/webhooks/stripe`).

## Why a separate Worker?

The existing `wrangler.jsonc` at the repo root deploys the static
PWA (`packages/web/dist/`) under the Worker name `annot`. Mixing
the API surface into that same Worker is technically possible
(via `main` script + asset fallthrough) but couples concerns we
want to keep separable:

- The PWA build artifact is the only thing that needs Cloudflare
  Static Assets; the API handler is server-side TS.
- Self-hosters wanting only the static PWA shouldn't have to
  configure D1 / KV / R2.
- Deploy cadence differs: PWA changes ship per PR, API changes
  need careful migration sequencing.

So: two Worker projects (`annot` for the PWA, `annot-api` for the
API). They live under the same Cloudflare account and can be
managed together via `wrangler` but deploy independently.
