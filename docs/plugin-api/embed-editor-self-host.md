# Self-hosting the annot-cloud embed editor

This guide walks customer admins through standing up their own
copy of the `<AnnotEditButton>` round-trip editor on a private
Cloudflare account. The deployment lives wholly inside the
customer's tenant — annot.work has zero visibility into the
hosted instance.

The same code that powers `annot.work/embed` powers the on-prem
build. Per the [Excalidraw-route product
direction](../plans/_done/excalidraw-route-pivot.md), only
billing + Enterprise SSO connectors live outside the OSS repo;
the embed editor + Worker route are in
`packages/worker/` + `packages/host-ui/src/embed/` here.

## Why self-host?

| Driver | What self-hosting unlocks |
|---|---|
| Compliance / data residency | Annotations + repo blobs never leave the customer's Cloudflare account. |
| Air-gapped or VPC-restricted networks | `cloudUrl` points at an internal hostname; no public-internet round-trip. |
| Bring-your-own GitHub App | The customer's GitHub org installs THEIR App (with their permissions / branding), not annot-cloud's. |
| Enterprise SSO | Cloudflare Access (or any reverse-proxy auth) sits in front of the `/embed` route; the editor inherits the SSO session. |

See the `Pricing tier mapping` row in
[`docs/plans/annot-cloud-roadmap.md`](../plans/annot-cloud-roadmap.md#pricing-tier-mapping)
for which features are gated to which Annot Cloud tier.

## Prerequisites

1. **Cloudflare account** with Workers + KV + D1 + R2 enabled.
   Free tier is sufficient for ≲ 100k embed-edit events per
   month; Workers Paid is recommended for higher throughput.
2. **`wrangler` CLI** at version 4.x or above.
3. **A GitHub user or organisation** that owns the repos
   you want the editor to write to. Personal GitHub accounts
   work for individual deployments; orgs are required for
   team / enterprise setups.
4. **`pnpm` 9.x** (matches the repo's pinned version).

## Quickstart (10 minutes)

### 1. Clone + install

```sh
git clone https://github.com/ingcreators/annot.git
cd annot
pnpm install
```

### 2. Provision Cloudflare resources

```sh
pnpm --filter @ingcreators/annot-worker exec wrangler kv namespace create SESSIONS
pnpm --filter @ingcreators/annot-worker exec wrangler d1 create annot-db
pnpm --filter @ingcreators/annot-worker exec wrangler r2 bucket create annot-objects
```

Copy the IDs printed by each command into
`packages/worker/wrangler.jsonc` (the file's
`<replace-with-…>` placeholders are clearly labelled).

### 3. Apply the D1 migrations

```sh
pnpm --filter @ingcreators/annot-worker exec wrangler d1 migrations apply annot-db --remote
```

This applies every migration through `0004_github_apps.sql`,
creating the `github_installations` table the embed flow
consumes.

### 4. Register your GitHub App

Visit `https://annot.example.com/api/embed/setup` (after the
first Worker deploy in step 5 — or use the manifest-flow
form rendered there to register a fresh App in one click).
The setup page pre-fills the manifest with YOUR deployment's
callback URLs, so the resulting App points back at your
domain.

Capture from the App's settings page:

- **App ID** (integer, surfaced as a string secret).
- **Client ID** + **Client Secret**.
- **Webhook Secret** (the value you pasted at App creation).
- **Private key** — generate + download a `*.pem`. The
  WebCrypto importer expects PKCS#8; if the GitHub UI gives
  you PKCS#1 (`BEGIN RSA PRIVATE KEY`), convert with:
  ```sh
  openssl pkey -in app.pem -out app.pkcs8.pem
  ```

### 5. Bind the secrets + deploy

```sh
# Set the GitHub OAuth credentials (Phase 3 sign-in flow):
wrangler secret put GITHUB_OAUTH_CLIENT_ID
wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
wrangler secret put GOOGLE_OAUTH_CLIENT_ID
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET

# Set the GitHub App credentials (5y-1):
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_CLIENT_ID
wrangler secret put GITHUB_APP_CLIENT_SECRET
wrangler secret put GITHUB_APP_WEBHOOK_SECRET
wrangler secret put GITHUB_APP_PRIVATE_KEY   # paste the multi-line PEM via stdin

# Optionally point the /embed page at a custom JS bundle URL:
wrangler secret put EMBED_SHELL_BUNDLE_URL   # defaults to "/embed/shell.js"

pnpm --filter @ingcreators/annot-worker exec wrangler deploy
```

### 6. Verify

```sh
curl https://annot.example.com/api/embed/health
```

Expect `{ "ok": true, "feature": "embed", "secrets": { ... all true ... }, ... }`.

### 7. Install the App on your repo

Visit your GitHub App's public URL (the App settings page
links to the install flow) and install it on the repo(s)
you want the editor to commit to.

### 8. Wire `<AnnotEditButton>` to your `cloudUrl`

In your docs site's `annot-docs.config.ts`
([Phase 5f](../plans/_done/living-spec-authoring-roadmap.md#sub-phases)):

```ts
import { defineConfig } from "@ingcreators/annot-product-docs";

export default defineConfig({
  editor: {
    embedMode: "newTab",                       // or "inline"
    cloudUrl: "https://annot.example.com",     // your on-prem origin
  },
});
```

Or per-call:

```mdx
<AnnotEditButton
  repo="acme-inc/docs"
  path="screenshots/login.png"
  annotations="annotations/login.annotations.yaml"
  cloudUrl="https://annot.example.com"
/>
```

That's it. Visitors clicking the button get bounced through
your on-prem editor, save lands a commit via YOUR GitHub App,
and the post-edit hash redirects back to the originating docs
page.

## The setup CLI

`packages/worker/scripts/setup-customer.ts` bundles steps 2 +
3 + 5 into one command. Useful for repeatable on-prem
deployments (e.g. CI-driven provisioning of preview / staging
environments):

```sh
pnpm tsx packages/worker/scripts/setup-customer.ts \
  --workerName annot-cloud-acme \
  --account-id <your-cloudflare-account-id>
```

The CLI is a thin wrapper: it shells out to `wrangler` for
every operation, prompts interactively for secret values, and
prints the resulting binding IDs so you can paste them into
`wrangler.jsonc`. It does NOT:

- Register the GitHub App (manual one-time step on github.com).
- Set the OAuth secrets — those are unrelated to the embed
  flow and need to live as their own decisions.

## Operational notes

- **Claim the installation before first use**: `/api/embed/load`
  and `/api/embed/commit` only serve installations claimed by the
  caller's workspace (`github_installations.workspace_id`).
  Webhook-created rows start unclaimed; claim one by issuing any
  `PATCH /api/embed/installations/:id` while signed in to the
  owning workspace (an empty-change PATCH like
  `{ "repoPolicy": "pr-mode" }` is enough — the first PATCH
  claims an unclaimed installation for the caller's workspace):
  ```sh
  curl -X PATCH https://annot.example.com/api/embed/installations/<id> \
    -H "Cookie: annot_session=<your-session-cookie>" \
    -H "Content-Type: application/json" \
    -d '{ "repoPolicy": "pr-mode" }'
  ```
- **GitHub App webhook**: not consumed by 5z-1; future
  installation-lifecycle handling lives here.
- **Build hooks**: configure per-installation via
  `PATCH /api/embed/installations/:id` (5z-1) with
  `{ "buildHookUrl": "https://api.cloudflare.com/...deploy_hook" }`.
- **`repo_policy`**: defaults to `pr-mode` (safer for public
  repos). Set to `direct-push` for solo / trusted-team setups
  where the visitor's edits go straight to the default
  branch:
  ```sh
  curl -X PATCH https://annot.example.com/api/embed/installations/<id> \
    -H "Cookie: annot_session=<your-session-cookie>" \
    -H "Content-Type: application/json" \
    -d '{ "repoPolicy": "direct-push" }'
  ```
- **Audit log**: every commit + build-hook ping writes to the
  D1 `audit_events` table. Query directly via:
  ```sh
  pnpm --filter @ingcreators/annot-worker exec wrangler d1 execute annot-db \
    --command "SELECT * FROM audit_events WHERE action LIKE 'embed_%' ORDER BY created_at DESC LIMIT 50"
  ```
- **Logs / observability**: enable `observability.logs` in
  `wrangler.jsonc` for Workers Logs; tail with:
  ```sh
  pnpm --filter @ingcreators/annot-worker exec wrangler tail
  ```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `/api/embed/health` returns `ok: false` with one secret false | The matching `wrangler secret put` step was skipped. Re-run it and redeploy. |
| Load / Save returns `not_authorised` (403) | The installation is unclaimed, or claimed by a different workspace. Claim it via `PATCH /api/embed/installations/:id` from the owning workspace (see "Claim the installation" above). |
| Load / Save returns `path_not_allowed` (403) | The requested paths fall outside the installation's `target_paths_json` allowlist. Widen (or NULL) the allowlist on the `github_installations` row. |
| The editor loads, but Save 404s | The GitHub App isn't installed on the target repo. Visit the App's settings page → Install. |
| Save returns `plan_required` (403) | The user account's plan doesn't allow private repos. Use a public repo OR upgrade the user's `users.plan` row. |
| `Save → conflict` (409) on every save | Someone else pushed to the same file between load + save. Reload the editor (the load endpoint refreshes the blob sha) and re-save. |
| The post-save hash redirect lands but no toast | `<AnnotEditCompleteListener>` isn't mounted on the destination page. Add it inside your docs site's layout (see [Phase 5g](../plans/_done/living-spec-authoring-roadmap.md#sub-phases)). |
| Build hook never fires | The installation row's `build_hook_url` is null. PATCH the installation via `/api/embed/installations/:id`. |
| `GITHUB_APP_PRIVATE_KEY is in PKCS#1 format` error in logs | The PEM you bound is in PKCS#1 format. Convert with `openssl pkey -in app.pem -out app.pkcs8.pem` and re-bind. |

## See also

- [`docs/plans/annot-cloud-roadmap.md` § Phase 6 follow-up](../plans/annot-cloud-roadmap.md#phase-6-follow-up--embedded-editor--github-round-trip-living-spec-5y--5z) — sub-phase decomposition + acceptance criteria.
- [`docs/plans/living-spec-authoring-roadmap.md` § Phase 5](../plans/living-spec-authoring-roadmap.md#phase-5--embedded-editor--github-round-trip) — OSS-side `<AnnotEditButton>` + protocol design.
- [`packages/worker/embed-github-app-manifest.json`](../../packages/worker/embed-github-app-manifest.json) — the canonical GitHub App manifest.
