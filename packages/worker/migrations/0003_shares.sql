-- Phase 5 — share links.
--
-- A `share_link` is a long-lived URL-safe token that grants
-- anonymous read access to one image OR one document. The token
-- itself is the primary key (caller-supplied) so the URL is the
-- canonical reference; there's no internal numeric id to leak.
--
-- Public read paths (`/api/shares/:token` + `/api/shares/:token/payload`)
-- accept the cookie-less request and resolve the share via this
-- table. The PWA's `/share/:token` and `/embed/:token` routes are
-- pure static HTML that fetch through those API paths client-side.
--
-- Quota policy:
-- - Free tier limits the number of *non-revoked* share links per
--   workspace. The Phase 4e `plan-gates.ts` table grows an
--   `activeShares` field; Phase 5 wires the check.
-- - Revoking a share frees the slot. The row itself is kept (with
--   `revoked_at` set) so that audit lookups can still trace the
--   share's lifecycle.
--
-- Pro-only fields (`password_hash`, `expires_at`) are reserved
-- here so Phase 7 can light them up without a schema change. The
-- Phase 5 endpoint surface ignores them.

CREATE TABLE IF NOT EXISTS share_links (
  -- The token itself. URL-safe base62 / base64url; ~22 chars for
  -- ~128 bits of entropy. The `id` column doubles as the URL slug.
  id                          TEXT PRIMARY KEY,
  -- 'image' | 'document'. Drives which storage row + R2 key the
  -- payload endpoint fetches from.
  resource_type               TEXT NOT NULL CHECK (resource_type IN ('image', 'document')),
  resource_id                 TEXT NOT NULL,
  workspace_id                TEXT NOT NULL REFERENCES workspaces(id),
  created_by_user_id          TEXT NOT NULL REFERENCES users(id),
  -- View counter — incremented by the public payload endpoint.
  -- Best-effort; race-y writes are acceptable (an off-by-one in
  -- the count isn't a privacy / security concern).
  view_count                  INTEGER NOT NULL DEFAULT 0,
  -- Pro-tier fields. Phase 5 doesn't read these; Phase 7
  -- lights them up.
  password_hash               TEXT,
  expires_at                  INTEGER,
  -- Revocation. Soft-delete equivalent: revoked shares fail
  -- public lookups but the row stays in D1 for audit.
  revoked_at                  INTEGER,
  created_at                  INTEGER NOT NULL
);

-- Look up all shares a workspace owns (gallery panel).
-- Filtered by NOT revoked for the "active shares" listing.
CREATE INDEX IF NOT EXISTS idx_shares_workspace_created
  ON share_links(workspace_id, created_at DESC) WHERE revoked_at IS NULL;

-- Look up shares pointing at a specific resource — useful for
-- the "this image already has a share, here's the existing
-- link" affordance and for the DELETE-image cascade revoke.
CREATE INDEX IF NOT EXISTS idx_shares_resource
  ON share_links(resource_type, resource_id) WHERE revoked_at IS NULL;
