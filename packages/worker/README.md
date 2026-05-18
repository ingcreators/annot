# `@ingcreators/annot-worker`

Cloudflare Worker hosting Annot's API surface — GitHub OAuth,
GitHub App, AnnotCloudStore endpoints, share / embed.

> **Status:** Phase 2c. The Worker has the full GitHub OAuth
> sign-in flow (start + callback), session cookies, `/api/auth/me`,
> and `/api/auth/logout`. KV-backed sessions (30-day TTL),
> CSRF-state KV keys (10-min TTL), httpOnly + Secure + SameSite=Lax
> cookies. Operator action required before deploy: register a
> GitHub OAuth App and set the client ID + secret via
> `wrangler secret put`. The `api.annot.work` route binding is the
> last step (see *Operator action* section).
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
cd ../..
```

Each command prints an `id`. Replace the `<placeholder>` strings
(if any) in `packages/worker/wrangler.toml`:

- `[[kv_namespaces]].id`         ← from `kv namespace create SESSIONS`
- `[[kv_namespaces]].preview_id` ← from `kv namespace create SESSIONS --preview`
- `[[d1_databases]].database_id` ← from `d1 create annot-db`

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
pnpm --filter @ingcreators/annot-worker deploy
```

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

Not wired yet. CI lands when a `CLOUDFLARE_API_TOKEN` repo
secret is set; until then `pnpm --filter @ingcreators/annot-worker
deploy` runs manually from a developer machine.

## Architecture

| Concern | Location |
|---|---|
| Static PWA at `annot.work` | Repo-root `wrangler.jsonc` (separate Worker, name `annot`) |
| API at `api.annot.work` (post Phase 2c) | This package, name `annot-api` |
| Database | Cloudflare D1 (multi-tenant SQLite) |
| Object storage | Cloudflare R2 (image / document bytes) |
| Sessions / CSRF state | Cloudflare KV |
| Payments | Stripe (Phase 7) |

## Operator action required for Phase 2c deploy

This sub-phase ships the OAuth code but not the credentials. To
make sign-in work end-to-end, the operator:

1. Registers a GitHub OAuth App at
   <https://github.com/settings/developers> → "New OAuth App"
   - Homepage URL: `https://annot.work`
   - Authorization callback URL:
     `https://annot.work/api/auth/github/callback` (and the
     `*.workers.dev` URL for testing, if separate)
2. Sets the client ID + secret as Worker secrets:
   ```sh
   pnpm --filter @ingcreators/annot-worker exec wrangler secret put GITHUB_OAUTH_CLIENT_ID
   pnpm --filter @ingcreators/annot-worker exec wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
   ```
3. Configures the route binding from `annot.work/api/*` to the
   `annot-api` Worker (separate follow-up PR — adds the `routes`
   stanza to `wrangler.toml`).

Until step 1+2 are done, `/api/auth/github` returns
`500 oauth_not_configured`. Until step 3 is done, callers must
use the `*.workers.dev` URL.

## Roadmap

- **Phase 2a** ✅: scaffold + `/api/health`.
- **Phase 2b** ✅: KV (`SESSIONS`) + D1 (`DB`) binding wiring
  (empty schema), `/api/health/bindings` smoke probe, migrations
  directory.
- **Phase 2c** ✅ (this PR): GitHub OAuth endpoints (start +
  callback), `/api/auth/me`, `/api/auth/logout`, session cookies.
  Operator follow-up: register OAuth App, set secrets, bind
  `api.annot.work` route.
- **Phase 3**: Google OAuth, `users` / `workspaces` D1 tables,
  promote KV-only sessions onto user/workspace rows.
- **Phase 4**: AnnotCloudStore CRUD endpoints (`/api/images`,
  `/api/documents`).
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
