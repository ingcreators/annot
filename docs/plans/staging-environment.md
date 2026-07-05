# Staging environment (`staging.annot.work`)

> **Status:** In progress — Phases 1–4 landed 2026-07-05.
>   Phase 2 provisioning done (`annot-db-staging` `91c08b5d…`,
>   `annot-sessions-staging` `a33e1573…`, `annot-objects-staging`,
>   proxied `staging` DNS). Phase 3 (`env.staging` × 4 +
>   `deploy-staging.yml`) landed + verified — a manual
>   `deploy-staging` run deployed all four staging Workers, applied
>   migrations to the isolated staging D1, and smoked
>   `staging.annot.work` green (bindings ok; `/`, `/app/`, `/docs/`
>   all 200). Phase 4 rewrote `deploy.yml` to the staging→gate→prod
>   flow. **Remaining (optional, non-blocking):** staging OAuth
>   callbacks + `wrangler secret put --env staging` to enable
>   sign-in ON staging (the stack + smoke work without them; OQ-1).
> **Compatibility:** Adds a parallel `staging.annot.work` stack
>   (four new Worker names + isolated D1 / KV / R2 for the API).
>   No change to the production `annot.work` behaviour until the
>   Phase 4 pipeline flip; no schema change; additive.
> **Risk:** Medium-high — this rewires the production deploy
>   pipeline (`.github/workflows/deploy.yml`) to gate prod on a
>   green staging deploy + smoke. Landed out of order it bricks
>   prod deploys, hence the strict phase ordering below. Isolated
>   staging bindings mean staging traffic never touches prod data.

## Context

Today all four `annot.work` Workers deploy **straight to
production** on merge to `main` (`.github/workflows/deploy.yml`,
`push` trigger). The only guardrail is a **post-deploy** health
curl — by the time it can fail, `wrangler deploy` has already
shipped the version. The 2026-07-03 friction audit flagged this:
"a bad worker / PWA build is live before the smoke can fail",
and separately "the manual, untested D1 migration path" (the
drift gate only *detects* pending migrations; nothing proves they
apply cleanly to a real remote DB before prod).

A staging environment closes both: deploy + migrate + smoke a
**staging** copy first, and only promote to production when
staging is green. Staging gets **isolated** D1 / KV / R2 so its
traffic + test data never touch production.

Current production surface (all on the `annot.work` zone, see
[`packages/worker/wrangler.jsonc`](../../packages/worker/wrangler.jsonc),
root [`wrangler.jsonc`](../../wrangler.jsonc),
[`packages/marketing/wrangler.jsonc`](../../packages/marketing/wrangler.jsonc),
[`packages/docs-site/wrangler.jsonc`](../../packages/docs-site/wrangler.jsonc)):

| Worker | Route | Stateful bindings |
|---|---|---|
| `annot-api` | `annot.work/api/*` | KV `SESSIONS`, D1 `annot-db`, R2 `annot-objects` |
| `annot` (PWA) | `annot.work/app*` | static assets (+ a stray SESSIONS/D1 bind — see note) |
| `annot-marketing` | `annot.work/` | static assets |
| `annot-docs-site` | `annot.work/docs/*` | static assets |

## Design

### Topology — a parallel stack on `staging.annot.work`

Four staging Workers, mirroring prod one-for-one, all routed under
the `staging.annot.work` host on the **same** `annot.work` zone
(so the existing zone-level `Workers Routes:Edit` on the CI
Cloudflare token already covers them — no new CI secret):

| Staging Worker | Route | Bindings |
|---|---|---|
| `annot-api-staging` | `staging.annot.work/api/*` | KV `annot-sessions-staging`, D1 `annot-db-staging`, R2 `annot-objects-staging` |
| `annot-staging` (PWA) | `staging.annot.work/app*` | static assets only |
| `annot-marketing-staging` | `staging.annot.work/` | static assets |
| `annot-docs-site-staging` | `staging.annot.work/docs/*` | static assets |

Isolated bindings are the whole point: staging smoke tests write
to `annot-db-staging` / `annot-objects-staging`, never prod.

### Config — `env.staging` in each wrangler config

Each of the four wrangler configs gains an `env.staging` block
overriding `name` + `routes` (+ binding ids for the API). Deploy
with `wrangler deploy --env staging`. Sketch for the API
(`packages/worker/wrangler.jsonc`):

```jsonc
{
  "name": "annot-api",
  // …existing prod top-level config (routes, bindings) unchanged…
  "env": {
    "staging": {
      "name": "annot-api-staging",
      "routes": [{ "pattern": "staging.annot.work/api/*", "zone_name": "annot.work" }],
      "kv_namespaces": [{ "binding": "SESSIONS", "id": "<staging-kv-id>" }],
      "d1_databases": [{
        "binding": "DB",
        "database_name": "annot-db-staging",
        "database_id": "<staging-d1-id>",
        "migrations_dir": "migrations"
      }],
      "r2_buckets": [{ "binding": "OBJECTS", "bucket_name": "annot-objects-staging" }]
    }
  }
}
```

The binding *names* (`SESSIONS` / `DB` / `OBJECTS`) stay identical
so the worker code is env-agnostic — only the underlying resources
differ. The static workers' `env.staging` blocks only override
`name` + `routes` (no data bindings). While here, **drop the stray
`SESSIONS` + `DB` bindings from the root PWA `wrangler.jsonc`** (the
audit's "unnecessary attack surface" note) rather than mirror them
into staging.

### Pipeline — deploy staging → smoke → promote to prod

`deploy.yml` becomes (on `push` to `main`):

```
1. worker typecheck
2. deploy the 4 staging Workers  (wrangler deploy --env staging)
3. apply pending migrations to annot-db-staging  (AUTO — staging
   is where a bad migration should fail, before prod)
4. smoke staging: GET staging.annot.work/api/health/bindings == ok
   + the three static-surface 200 checks on staging.annot.work
5. ── GATE: only if 2–4 all green ──
6. prod D1 drift gate            (unchanged — prod migrations stay
                                  operator-applied via apply-migrations.yml)
7. deploy the 4 prod Workers     (unchanged order: api → smoke → statics)
8. smoke prod                    (unchanged)
```

Net effect: production only ever fronts a build that already
deployed + smoked + migrated cleanly on staging. Migration bugs
surface at step 3 (staging), never step 7 (prod). Prod migration
application stays the deliberate manual step it is today — staging
just proves the SQL applies before the operator runs it on prod.

### Secrets

`annot-api-staging` needs its own secrets (`wrangler secret put
--env staging`): OAuth client id/secret + GitHub App creds scoped
to `staging.annot.work` callback URLs. This requires the operator
to register **staging OAuth callbacks** (a second GitHub/Google
OAuth app, or additional callback URLs on the existing apps
pointing at `staging.annot.work/api/auth/*`). Until staging
secrets are set, `staging.annot.work/api/auth/*` won't complete a
login, but the health/bindings smoke (step 4) doesn't need auth,
so the gate still functions.

## Operator provisioning checklist (Phase 2 — all operator, no code)

Run once, before the Phase 3/4 code lands:

```sh
# From packages/worker (uses the CLOUDFLARE_API_TOKEN / ACCOUNT_ID env or wrangler login)
wrangler d1 create annot-db-staging            # → copy the database_id
wrangler kv namespace create annot-sessions-staging   # → copy the id
wrangler r2 bucket create annot-objects-staging
```

1. In the Cloudflare dashboard, add a **proxied DNS record for
   `staging`** on the `annot.work` zone (e.g. an `AAAA` record to
   `100::` with the orange cloud on) so `staging.annot.work/*`
   routes resolve to Workers.
2. Register **staging OAuth callbacks**: add
   `https://staging.annot.work/api/auth/github/callback` +
   `…/google/callback` to the OAuth apps (or new staging apps).
3. Set staging secrets:
   `wrangler secret put GITHUB_OAUTH_CLIENT_ID --env staging`
   (+ secret, Google pair, GitHub App five). Reuse prod values or
   staging-specific — operator's call.
4. Hand the three resource ids (D1 / KV) to the Phase 3 PR (they
   fill the `<staging-*-id>` placeholders).

The CI `CLOUDFLARE_API_TOKEN` already carries Workers Scripts /
D1 / KV / R2 / zone Workers-Routes edit for the `annot.work` zone,
which covers the staging Workers + routes on the same zone — no
new CI secret needed. (Confirm the token's D1/KV/R2 scopes aren't
resource-pinned to the prod ids; broaden to account-level if so.)

## Phased plan

Strict ordering — Phase 4 bricks prod deploys if it lands before
staging resources exist.

- **Phase 1 — this plan doc.** (docs-only PR.)
- **Phase 2 — operator provisioning** (checklist above). No code;
  produces the resource ids + DNS + secrets Phase 3 needs.
- **Phase 3 — `env.staging` config + a NON-gating staging deploy.**
  Add `env.staging` to the four wrangler configs (real ids from
  Phase 2). Add a `deploy-staging.yml` (`workflow_dispatch` +
  optional push) that deploys the 4 staging Workers + applies
  staging migrations + smokes `staging.annot.work` — **without**
  touching prod's `deploy.yml`. This proves staging works end to
  end while prod keeps its current flow. Also drop the stray
  PWA-worker SESSIONS/D1 binding here.
- **Phase 4 — flip prod to gate on staging.** Rewrite `deploy.yml`
  per the pipeline above: staging stage first, prod stage gated on
  staging green. Revertable in isolation (revert → prod
  auto-deploys as it does today). Land only after Phase 3 has
  demonstrated a green staging run.

## Verification

- Phase 3: a manual `deploy-staging.yml` run deploys all four
  staging Workers, applies migrations to `annot-db-staging`, and
  the staging smoke (`GET staging.annot.work/api/health/bindings`
  → `ok:true` + three static 200s) passes. `staging.annot.work`
  serves each surface.
- Phase 4: a merge to `main` deploys+smokes staging, then prod;
  and an intentionally-broken staging build (or a bad migration on
  a scratch branch's staging DB) fails the staging stage and
  **prod is never touched** — the decision-gate the whole plan is
  for.

## Migration notes

No data migration. Staging D1 starts empty and is migrated from
the same `migrations/*.sql`. Production `annot.work` behaviour is
unchanged until Phase 4's pipeline flip; that flip is
config/workflow-only (no worker code change) and revertable.

## Open questions

- **OQ-1:** Reuse prod OAuth apps (add staging callback URLs) vs
  separate staging OAuth apps? Separate is cleaner isolation;
  reuse is less setup. Operator's call in Phase 2.
- **OQ-2:** Should the static staging surfaces (PWA / marketing /
  docs) also gate prod, or only the API stage? Chosen scope is all
  four, but a bad static build is low-risk + reverts cleanly — if
  the static staging deploys prove flaky, Phase 4 can gate prod on
  the API stage only and treat the static staging deploys as
  advisory. Decide during Phase 4.
- **OQ-3:** Auto-expire / scrub `annot-db-staging` + `annot-objects-staging`
  periodically so staging test data doesn't accumulate? Out of
  scope for v1; note for later.
