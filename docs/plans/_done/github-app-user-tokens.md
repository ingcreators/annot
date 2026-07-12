# GitHub App user-to-server tokens (one-click GitHub connect)

> **Status:** Done (landed 2026-07-12 — plan
> [#1115](https://github.com/ingcreators/annot/pull/1115), Worker
> endpoints [#1116](https://github.com/ingcreators/annot/pull/1116),
> web auth-source plumbing
> [#1117](https://github.com/ingcreators/annot/pull/1117), connect
> UI + installation-scoped picker
> [#1118](https://github.com/ingcreators/annot/pull/1118), docs
> wrap-up in the same session).
>
> **Operator note (one-time, production App):** on the GitHub App
> settings page, add
> `https://annot.work/api/github/app/callback` to the callback
> URLs and confirm "Expire user authorization tokens" is enabled,
> then apply migration 0006 via the usual `apply-migrations`
> workflow. Self-host Apps registered through `/api/embed/setup`
> after #1118 come out pre-configured (the manifest carries both
> callback URLs).
>
> **Compatibility:** Additive. The PAT paste path stays exactly
> as-is — it remains the only auth path for self-hosted / static
> deployments and the fallback everywhere else. No
> `StorageProvider` interface changes; `GitHubStore` is untouched
> except for how its token is sourced. Worker gains four small
> endpoints + one D1 migration.
>
> **Risk:** External OAuth surface (GitHub App user authorization
> flow), token persistence in D1, silent-refresh corner cases.
> Bounded by reusing the session/state/KV machinery the existing
> `/api/auth/github` sign-in flow already proved out, and by the
> `github-api-client.ts` `setTokenRefresher` seam that already
> exists for exactly this purpose.

## Context

GitHubStore's only auth path today is a pasted personal access
token ([`github-auth.ts`](../../packages/web/src/storage/github-auth.ts)).
That was the right call for a static PWA — GitHub's OAuth token
endpoints don't send CORS headers, so neither Web Flow nor Device
Flow can complete client-side (see
[`github-integration.md`](./github-integration.md) §1). The
"proper one-click OAuth UX" was explicitly deferred to the
annot.work backend.

That backend now exists. The Worker (`packages/worker`) already
has:

- Cookie-session auth (`session.ts`, `auth-middleware.ts`) with
  same-origin routing (`annot.work/api/*` → no CORS, cookies just
  work).
- A registered GitHub App with `GITHUB_APP_ID` /
  `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` /
  `GITHUB_APP_PRIVATE_KEY` secrets, installation tracking
  (`github_installations`, migration 0004/0005), webhook handling,
  and JWT → installation-token minting
  (`embed/github-app-token.ts`).
- An OAuth CSRF-state helper (`createOAuthState` /
  `consumeOAuthState`) used by the sign-in flows.

This plan adds the **user-to-server token** flow: a signed-in
annot.work user authorizes the GitHub App once (popup), the Worker
stores the resulting user-to-server access + refresh tokens, and
the PWA's GitHubStore sources its bearer token from
`GET /api/github/token` instead of a pasted PAT.

Why user-to-server tokens beat the alternatives:

- **Scope** = intersection of the App installation's repo set and
  the user's own permissions. Equivalent to (or narrower than) a
  fine-grained PAT; strictly narrower than an OAuth App's `repo`
  scope.
- **Short-lived**: 8-hour access tokens + 6-month rotating refresh
  tokens (with "expire user authorization tokens" enabled on the
  App). A leaked localStorage token is worth 8 hours, not
  indefinitely like a PAT.
- **Attribution**: commits made with a user-to-server token are
  attributed to the user, same as with a PAT.
- **No new registration**: reuses the GitHub App the embed
  round-trip already registered (one settings change: enable the
  user-authorization callback URL).

## Design

### Worker (packages/worker)

New module `github-user-token.ts` + routes:

| Route | Auth | Behaviour |
|-------|------|-----------|
| `GET /api/github/app/connect` | session | Mint CSRF state in KV (bound to `userId`), 302 to `https://github.com/login/oauth/authorize?client_id=<GITHUB_APP_CLIENT_ID>&state=…`. GitHub Apps ignore `scope` — permissions come from the App. |
| `GET /api/github/app/callback` | session | Verify + consume state (must match the session's `userId`), exchange `code` at `login/oauth/access_token` (server-side, App client id + secret), fetch `/user` with the new token to capture `github_login`, upsert `github_user_tokens` row keyed by `user_id`, 302 to `/api/github/app/success`. |
| `GET /api/github/app/success` | — | Terminal popup page, clone of `/api/auth/success` posting `{ type: "annot-github-app-connected" }` to `window.opener` then `window.close()`. |
| `GET /api/github/token` | session | Return `{ ok, token, expiresAt, githubLogin }`. If the access token expires within 5 minutes, refresh first via `grant_type=refresh_token` and persist the rotated pair. `404 not_connected` when no row; `401 reauth_required` (row deleted) when the refresh grant fails / refresh token expired. |
| `DELETE /api/github/token` | session | Delete the row + best-effort revoke via `DELETE /applications/{client_id}/grant` (Basic auth `client_id:client_secret`). |
| `GET /api/github/app/meta` | session | `{ ok, slug, appName }` from `GET /app` (App JWT auth), cached in KV (24 h). The PWA uses `slug` to build the "install / configure the App" link (`https://github.com/apps/<slug>/installations/new`). |

D1 migration `0006_github_user_tokens.sql`:

```sql
CREATE TABLE IF NOT EXISTS github_user_tokens (
  user_id                  TEXT PRIMARY KEY,   -- users.id
  github_login             TEXT,
  access_token             TEXT NOT NULL,
  access_token_expires_at  INTEGER,            -- Unix ms; NULL = non-expiring
  refresh_token            TEXT,
  refresh_token_expires_at INTEGER,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
```

Notes:

- One row per user (PK = `user_id`); re-authorizing overwrites.
- Tokens stored plaintext in D1 — same posture as the installation
  tokens already cached in KV. D1 is single-tenant to the
  deployment and access requires account credentials; encrypting
  at rest with a Worker-held key would not change the threat model
  (the key lives next to the data).
- `access_token_expires_at` nullable: Apps without "expire user
  authorization tokens" return non-expiring tokens with no refresh
  token. The token endpoint handles both shapes.
- `createOAuthState` / `consumeOAuthState` get a widened provider
  union (`"github-app"`) and an optional payload (the `userId`
  binding) — additive change, existing callers unaffected.

### Web (packages/web)

**Auth-source abstraction** in `github-auth.ts`:

- New persisted key `annot-github-auth-source`: `"pat"` (default)
  | `"cloud"`.
- Cloud path: `connectViaCloud(baseUrl)` fetches
  `GET /api/github/token` (with `credentials: "include"` against
  `loadCloudBaseUrl() ?? ""`), persists the short-lived token into
  the existing `annot-github-token` slot plus a companion
  `annot-github-token-expires-at`. Everything downstream
  (`getAccessToken`, `authedGet`, `GitHubStore`) is unchanged —
  the token is a bearer token exactly like a PAT.
- `refreshCloudToken()` re-fetches `/api/github/token` silently
  (the Worker performs the refresh-token grant server-side). This
  is wired into `bridge.ts`'s `refreshGithubToken()`: when the
  auth source is `"cloud"`, try the silent path first; only fall
  back to the auth banner when the Worker says `reauth_required` /
  the cloud session itself is gone. PAT source keeps today's
  banner-only behaviour.

**Connect UI** (`github-setup-ui.ts`):

- The sign-in step gains a primary "Connect with annot.work"
  button above the PAT form, shown when a cloud session is
  plausible (a cloud base URL is persisted, or the deploy is
  same-origin `annot.work`). Clicking opens a popup to
  `${base}/api/github/app/connect` and resolves on the
  `annot-github-app-connected` postMessage (with a poll fallback,
  mirroring `cloud-setup-ui.ts`). On success it calls
  `connectViaCloud`, sets the auth source, and proceeds to the
  regular repo picker.
- **Repo picker in cloud mode** lists repos via
  `GET /user/installations` + `GET
  /user/installations/{id}/repositories` (user-to-server tokens
  enumerate exactly the repos the authorization can reach; the
  affiliation-based `/user/repos` listing is PAT-shaped). A
  footer link "Add repositories on GitHub ↗" points at
  `https://github.com/apps/<slug>/installations/new` using
  `/api/github/app/meta`. `verifyWriteAccess` (the impossible-SHA
  probe PUT) works unchanged and stays as the final gate.
- Disconnect: when the auth source is `"cloud"`, `signOut()` also
  fires `DELETE /api/github/token` best-effort.

### Operator setup (one-time, documented not coded)

On the GitHub App settings page:

1. Enable **Request user authorization (OAuth) during
   installation** _(optional but nice)_ and set the **Callback
   URL** to `https://annot.work/api/github/app/callback`.
2. Enable **Expire user authorization tokens** (on by default for
   new Apps).

The embed setup page's manifest (`embed/page.ts`) gains the
`callback_urls` field so newly-registered self-host Apps come out
correctly configured.

## Phases

Each phase is an independently-revertable PR, merged before the
next starts (standard landing rules).

- **Phase 1 — Worker.** Migration 0006, `github-user-token.ts`
  (state, exchange, refresh, revoke, meta), routes, success page,
  unit tests (fetch-stubbed, same style as `auth-github.test.ts`).
- **Phase 2 — Web plumbing.** Auth-source persistence + cloud
  token fetch / silent refresh in `github-auth.ts`; `bridge.ts`
  refresher branching; unit tests.
- **Phase 3 — Web UI.** One-click connect button + popup flow in
  `github-setup-ui.ts`; installation-scoped repo listing + "add
  repositories" link; cloud-aware disconnect; manifest
  `callback_urls`.
- **Phase 4 — Docs.** Update `github-integration.md` §1 (the
  deferred "proper one-click OAuth" is now real), CLAUDE.md's
  worker package blurb, operator setup notes; move this plan to
  `_done/`.

## Out of scope

- Replacing the PAT path (stays as default fallback forever —
  OSS/self-host guarantee).
- Using installation tokens (server-to-server) for GitHubStore —
  commits would be attributed to the App, and the Worker would
  have to proxy every Git operation.
- VSCode / desktop hosts (they keep PAT; a follow-up can lift the
  auth-source abstraction if demand shows up).
- Team workspaces sharing one authorization (per-user rows only).

## Open questions

- Should `GET /api/github/token` also return the token's
  installation list so the picker saves one round-trip? Deferred —
  keep the endpoints orthogonal until profiling says otherwise.
- Rate limits: user-to-server requests draw from the user's
  5,000/h pool (same as PAT), so the existing rate-limit banner
  logic carries over unchanged.
