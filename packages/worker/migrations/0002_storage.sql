-- Phase 4b — storage schema: images, documents, audit_events.
--
-- Tables hold METADATA only. The actual bytes (original
-- screenshot, annotation SVG, thumbnail, .annot.html document)
-- live in R2 under keys derived from the row IDs:
--
--   <workspace_id>/images/<image_id>/original.<ext>
--   <workspace_id>/images/<image_id>/annotations.svg
--   <workspace_id>/images/<image_id>/thumbnail.png
--   <workspace_id>/documents/<document_id>/document.html
--
-- Splitting bytes from rows means: R2's pricing model (free
-- egress) handles the bulk; D1's pricing model (per-row /
-- per-query) handles the structured metadata; no double-billing.
--
-- Conventions match `0001_auth.sql`:
-- - IDs: random URL-safe strings (`crypto.randomUUID()`).
-- - Timestamps: Unix milliseconds (INTEGER, `Date.now()`).
-- - Soft delete via nullable `deleted_at`; never hard-delete in
--   v1 so audit / abuse-reporting workflows can still see the
--   row that produced a flag.
-- - `path` is the workspace-relative folder path (mirrors the
--   `ImageRecord.path` field in `@ingcreators/annot-core/storage`).
--   UNIQUE per workspace so a UI listing matches the on-disk
--   StorageProvider semantics.
-- - Foreign keys are documentary (D1 doesn't enforce by default).
--
-- Verified test fixtures live in
-- `packages/worker/src/storage-repo.test.ts`.

-- ─── images ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS images (
  id                          TEXT PRIMARY KEY,
  workspace_id                TEXT NOT NULL REFERENCES workspaces(id),
  created_by_user_id          TEXT NOT NULL REFERENCES users(id),
  path                        TEXT NOT NULL,
  -- R2 keys split out so a future move to a different storage
  -- backend (or a different keying scheme) is a code change, not
  -- a schema change.
  original_r2_key             TEXT NOT NULL,
  annotations_r2_key          TEXT,           -- nullable; null until first save
  thumbnail_r2_key            TEXT,           -- nullable; lazy-generated
  size_bytes                  INTEGER NOT NULL,
  width                       INTEGER,
  height                      INTEGER,
  mime_type                   TEXT,
  source_url                  TEXT,           -- URL of page captured, when set
  tags_json                   TEXT,           -- JSON-encoded `Record<string, string>`
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL,
  deleted_at                  INTEGER
);

-- Path uniqueness scoped to (workspace, deleted_at IS NULL) so
-- a soft-deleted image doesn't block re-uploading at the same path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_images_workspace_path
  ON images(workspace_id, path) WHERE deleted_at IS NULL;

-- Folder-prefix listing: `WHERE workspace_id = ? AND path LIKE 'foo/%'`.
CREATE INDEX IF NOT EXISTS idx_images_workspace_created
  ON images(workspace_id, created_at DESC) WHERE deleted_at IS NULL;

-- Look up images by creator (for "my recent uploads" UIs).
CREATE INDEX IF NOT EXISTS idx_images_creator
  ON images(created_by_user_id, created_at DESC) WHERE deleted_at IS NULL;

-- ─── documents ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id                          TEXT PRIMARY KEY,
  workspace_id                TEXT NOT NULL REFERENCES workspaces(id),
  created_by_user_id          TEXT NOT NULL REFERENCES users(id),
  path                        TEXT NOT NULL,
  -- R2 key for the .annot.html bytes. The HTML is self-contained
  -- (inline SVG / CSS) so a single R2 fetch returns the full doc.
  document_r2_key             TEXT NOT NULL,
  size_bytes                  INTEGER NOT NULL,
  title                       TEXT,
  -- Number of block-level elements; lets the gallery preview
  -- show "12 blocks" without fetching the document body.
  block_count                 INTEGER,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL,
  deleted_at                  INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_workspace_path
  ON documents(workspace_id, path) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_workspace_created
  ON documents(workspace_id, created_at DESC) WHERE deleted_at IS NULL;

-- ─── audit_events ───────────────────────────────────────────────
--
-- Log table for security-relevant actions (uploads, deletes,
-- shares, plan changes, account deletions). Phase 5 starts writing
-- shares here; Phase 7 adds billing events. Phase 4b just creates
-- the table so future inserts have a target.
CREATE TABLE IF NOT EXISTS audit_events (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  user_id         TEXT,
  action          TEXT NOT NULL,        -- e.g. 'image.upload', 'image.delete', 'share.create'
  resource_type   TEXT,
  resource_id     TEXT,
  metadata_json   TEXT,                 -- arbitrary action-specific payload
  created_at      INTEGER NOT NULL
);

-- The two most common audit lookups: by workspace (admin views)
-- and by user (account export). Composite indexes order by
-- created_at DESC so timeline queries are pre-sorted.
CREATE INDEX IF NOT EXISTS idx_audit_workspace_created
  ON audit_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_user_created
  ON audit_events(user_id, created_at DESC) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_events(resource_type, resource_id) WHERE resource_id IS NOT NULL;
