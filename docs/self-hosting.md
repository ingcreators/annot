# Self-hosting Annot

Annot's hosted version lives at [annot.work](https://annot.work).
The entire monorepo is Apache-2.0 — you can deploy your own copy
under a different domain. This page walks through what to change.

> **Scope of this guide**: deploying the **PWA + API worker**
> under your own domain. The marketing site (`/`), docs site
> (`/docs`), and Chrome extension are optional — most self-host
> deployments only need the PWA + API.

## Prerequisites

- A Cloudflare account with a zone for your domain (let's call it
  `annot.example.com` in this guide).
- A GitHub OAuth App + Google OAuth Client registered with
  callback URLs under that domain.
- Node 24+ and pnpm 11.
- `wrangler login` configured.

## Step 1 — Configure build-time URLs via `.env.local`

Copy the example file at the repo root and edit:

```bash
cp .env.example .env.local
```

For a typical self-host where the PWA serves at
`annot.example.com/app` (mirroring `annot.work`'s layout):

```ini
# .env.local
VITE_PWA_BASE=/app/
VITE_ANNOTATION_URL=https://annot.example.com/app
VITE_EXT_EXTERNALLY_CONNECTABLE_MATCHES=https://annot.example.com/*,http://localhost:3000/*
```

For a minimal self-host where the PWA serves at the domain root:

```ini
# .env.local
VITE_PWA_BASE=/
VITE_ANNOTATION_URL=https://annot.example.com
VITE_EXT_EXTERNALLY_CONNECTABLE_MATCHES=https://annot.example.com/*,http://localhost:3000/*
```

Vite + the manifest-build script read these values at build time
and bake them into the produced PWA bundle + extension manifest.

## Step 2 — Edit the `wrangler.jsonc` files

Cloudflare's route bindings can't be expressed via env vars — they
need to live in `wrangler.jsonc`. Update the `routes` field +
`zone_name` in each of these files:

| File | What to change |
|------|----------------|
| `./wrangler.jsonc` (PWA) | `routes[].pattern` → `annot.example.com/app/*`, `zone_name` → `annot.example.com` |
| `packages/worker/wrangler.jsonc` (API) | `routes[].pattern` → `annot.example.com/api/*`, `zone_name` → `annot.example.com` |
| `packages/marketing/wrangler.jsonc` (optional) | `routes[].pattern` → `annot.example.com/*`, `zone_name` → `annot.example.com` |
| `packages/docs-site/wrangler.jsonc` (optional) | `routes[].pattern` → `annot.example.com/docs/*`, `zone_name` → `annot.example.com` |

If you're NOT deploying the marketing / docs / extension surfaces,
delete those subdirectories or just ignore them.

If you change `VITE_PWA_BASE` to `/` (PWA at root), use
`annot.example.com/*` as the PWA worker's route pattern AND delete
the marketing wrangler config (otherwise both workers fight for
`/*`).

## Step 3 — Cloudflare resources

The API worker requires three Cloudflare resources:

```bash
# KV namespace for session cookies + OAuth CSRF state
wrangler kv namespace create SESSIONS

# D1 database for users / workspaces / images / documents
wrangler d1 create annot-db

# R2 bucket for image + document bytes
wrangler r2 bucket create annot-objects
```

Each command prints an ID. Paste those IDs into
`packages/worker/wrangler.jsonc`'s `kv_namespaces[0].id`,
`d1_databases[0].database_id`, and the R2 binding (R2 references
the bucket by name, no ID needed).

## Step 4 — OAuth apps

Register a GitHub OAuth App and a Google OAuth Client with these
callback URLs:

- GitHub: `https://annot.example.com/api/auth/github/callback`
- Google: `https://annot.example.com/api/auth/google/callback`

Then upload the secrets to the worker:

```bash
cd packages/worker
pnpm secrets:put:github-client-id
pnpm secrets:put:github-client-secret
pnpm secrets:put:google-client-id
pnpm secrets:put:google-client-secret
```

## Step 5 — Migrate the D1 schema

```bash
pnpm --filter @ingcreators/annot-worker migrations:apply
```

## Step 6 — Build + deploy

```bash
# Apply schema, then deploy each Worker.
pnpm install
pnpm -r build
pnpm --filter @ingcreators/annot-worker cf:deploy
pnpm exec wrangler deploy                                # PWA
pnpm --filter @ingcreators/annot-marketing cf:deploy     # if used
pnpm --filter @ingcreators/annot-docs-site cf:deploy     # if used
```

## Step 7 — Marketing + docs content (optional)

If you deploy the marketing site, you'll want to update:

- `packages/marketing/astro.config.mjs` — `site` URL
- `packages/marketing/src/pages/*.astro` — replace `annot.work` /
  `ingcreators` literal references with your branding
- `packages/marketing/public/brand/` — replace the SVGs with your
  own brand assets

These are content edits — no env-var-friendly. The OSS pattern is
to fork + maintain your own marketing branch.

For the docs site:

- `packages/docs-site/.vitepress/config.ts` — `site`, `title`,
  nav links pointing at `annot.work`
- `packages/docs-site/**/*.md` — content references to
  `annot.work`

## Step 8 — Chrome extension

If you want to publish your own Chrome extension build for your
self-hosted PWA:

```bash
# Build with the env vars from .env.local
pnpm --filter @ingcreators/annot-extension package:chrome
```

The output ZIP lives in `packages/extension/dist-chrome.zip`.
Upload it to the Chrome Web Store under your own developer
account.

The extension's manifest will carry `externally_connectable`
matches based on `VITE_EXT_EXTERNALLY_CONNECTABLE_MATCHES`, and
its `ANNOTATION_URL` will be `VITE_ANNOTATION_URL`. Both bake into
the bundle at build time.

## What's NOT configurable via env vars

- **Cloudflare Worker route patterns** — see Step 2; lives in
  `wrangler.jsonc`.
- **The `@ingcreators/` npm scope** — the workspace packages all
  publish under this scope. If you republish your fork, rename via
  `package.json` (search for `@ingcreators/annot-` across the
  monorepo).
- **The annot:// URL scheme** — reserved for the project; no
  conflict with self-hosted deployments since the scheme is
  global, not domain-scoped.
- **Marketing / docs content** — re-brand by editing files; the
  content is too freeform to template.

## Maintenance

When pulling upstream changes from `ingcreators/annot`:

- `.env.local` stays local (gitignored), so your overrides aren't
  affected.
- `wrangler.jsonc` files conflict on `routes` / `zone_name` / IDs
  — resolve by keeping your values. (Consider maintaining a
  `wrangler.local.jsonc` override pattern if these conflicts
  become frequent; wrangler doesn't natively support overlays,
  but `git merge -s ours -- path/to/wrangler.jsonc` is the
  manual workaround.)
- Marketing / docs content conflicts on rebrand-affected lines.
  Same workaround.

If self-host config drifts in a painful way, file an issue at
[github.com/ingcreators/annot/issues](https://github.com/ingcreators/annot/issues)
— upstream is open to additional env-var hooks where they keep
the maintenance burden low.
