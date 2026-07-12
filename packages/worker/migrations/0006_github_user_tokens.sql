-- github-app-user-tokens plan Phase 1 — user-to-server tokens.
--
-- One row per annot.work user holding the GitHub App
-- user-to-server access + refresh token pair minted by
-- `GET /api/github/app/callback`. `GET /api/github/token`
-- reads (and rotates) the row; `DELETE /api/github/token`
-- removes it.
--
-- Design notes:
-- - PK = user_id (users.id). Re-authorizing overwrites the row —
--   GitHub invalidates the previous grant's tokens on
--   re-authorization anyway, so keeping history would only retain
--   dead credentials.
-- - Tokens are stored plaintext, matching the posture of the
--   installation tokens already cached in the SESSIONS KV
--   namespace: D1 is single-tenant to the deployment and
--   encrypting with a Worker-held key would not change the
--   threat model (the key would live next to the data).
-- - `access_token_expires_at` / `refresh_token` are nullable:
--   GitHub Apps with "expire user authorization tokens" disabled
--   issue non-expiring access tokens with no refresh token.
-- - Timestamps are Unix milliseconds (INTEGER, Date.now() in JS),
--   matching every other table.
-- - The REFERENCES clause is documentary; D1 doesn't enforce
--   foreign keys (see 0001_auth.sql).

CREATE TABLE IF NOT EXISTS github_user_tokens (
  user_id                  TEXT PRIMARY KEY REFERENCES users(id),
  github_login             TEXT,
  access_token             TEXT NOT NULL,
  access_token_expires_at  INTEGER,
  refresh_token            TEXT,
  refresh_token_expires_at INTEGER,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
