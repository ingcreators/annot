# `@ingcreators/annot-worker`

Cloudflare Worker hosting Annot's API surface — GitHub OAuth,
GitHub App, AnnotCloudStore endpoints, share / embed.

> **Status:** Phase 2a scaffold. The Worker has a single
> `/api/health` endpoint and is bound to a `*.workers.dev`
> subdomain. Phase 2b adds KV + D1 bindings; Phase 2c adds GitHub
> OAuth and the `api.annot.work` route binding.
>
> Plan: [`docs/plans/annot-cloud-roadmap.md`](../../docs/plans/annot-cloud-roadmap.md).

## Local development

```sh
pnpm install
pnpm --filter @ingcreators/annot-worker dev
```

`wrangler dev` boots the Worker on `http://localhost:8787`. Test
the health endpoint:

```sh
curl http://localhost:8787/api/health
# { "ok": true, "service": "annot-api", "timestamp": "..." }
```

## Tests

Pure-function tests via `vitest` + Hono's `app.request()`:

```sh
pnpm vitest run packages/worker
```

These don't boot Miniflare — they invoke handlers directly. Once
Phase 2b adds KV / D1 bindings, binding-aware tests will use
`@cloudflare/vitest-pool-workers`; the current smoke tests stay
as fast pure-handler coverage.

## Deployment

```sh
pnpm --filter @ingcreators/annot-worker deploy
```

Requires `wrangler login` first, or a `CLOUDFLARE_API_TOKEN`
environment variable. CI auto-deploy lands in a later phase
(needs the `CLOUDFLARE_API_TOKEN` repo secret to be set).

## Architecture

| Concern | Location |
|---|---|
| Static PWA at `annot.work` | Repo-root `wrangler.jsonc` (separate Worker, name `annot`) |
| API at `api.annot.work` (post Phase 2c) | This package, name `annot-api` |
| Database | Cloudflare D1 (multi-tenant SQLite) |
| Object storage | Cloudflare R2 (image / document bytes) |
| Sessions / CSRF state | Cloudflare KV |
| Payments | Stripe (Phase 7) |

## Roadmap

- **Phase 2a** (this): scaffold + `/api/health`.
- **Phase 2b**: KV namespace + D1 binding wiring (empty schema).
- **Phase 2c**: GitHub OAuth endpoints (`/api/auth/github`,
  `/api/auth/github/callback`), session cookies, `api.annot.work`
  route binding.
- **Phase 3**: Google OAuth, `users` / `workspaces` tables,
  `/api/auth/me`.
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
