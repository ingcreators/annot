// Storage metadata persistence — Phase 4b (multi-tenant
// storage schema).
//
// Holds METADATA only. The actual bytes of every image, every
// annotation SVG, every thumbnail, and every `.annot.html`
// document live in R2 under keys derived from the row IDs.
// Splitting metadata (D1) from bytes (R2) keeps each storage
// service on its preferred pricing curve.
//
// Per-call surface stays narrow enough that the OAuth callback
// (Phase 4c, when the images endpoint lands) can call into this
// without needing a transaction abstraction. Multi-row writes
// use `db.batch([...])` so they're atomic.
//
// Production src — MUST NOT import from `node:*`.

const NOW = () => Date.now();
const newId = () => crypto.randomUUID();

/** Mirrors the `images` table. INTERNAL representation; the
 *  Phase 4c API layer maps this to the public response shape. */
export interface ImageRow {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  path: string;
  original_r2_key: string;
  annotations_r2_key: string | null;
  thumbnail_r2_key: string | null;
  size_bytes: number;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  source_url: string | null;
  tags_json: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Mirrors the `documents` table. */
export interface DocumentRow {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  path: string;
  document_r2_key: string;
  size_bytes: number;
  title: string | null;
  block_count: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Mirrors the `audit_events` table. */
export interface AuditEventRow {
  id: string;
  workspace_id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata_json: string | null;
  created_at: number;
}

// ─── images ─────────────────────────────────────────────────────

export interface InsertImageInput {
  workspaceId: string;
  createdByUserId: string;
  path: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
  sourceUrl?: string | null;
  tags?: Record<string, string> | null;
}

/**
 * Insert a new image row. The caller is expected to have already
 * decided on the path (verified UNIQUE within the workspace) and
 * uploaded the bytes to R2. Returns the inserted row including
 * its generated `id` + r2 key.
 */
export async function insertImage(db: D1Database, input: InsertImageInput): Promise<ImageRow> {
  const id = newId();
  const now = NOW();
  const originalR2Key = `${input.workspaceId}/images/${id}/original`;

  await db
    .prepare(
      `INSERT INTO images (
        id, workspace_id, created_by_user_id, path,
        original_r2_key, annotations_r2_key, thumbnail_r2_key,
        size_bytes, width, height, mime_type, source_url, tags_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.workspaceId,
      input.createdByUserId,
      input.path,
      originalR2Key,
      input.sizeBytes,
      input.width ?? null,
      input.height ?? null,
      input.mimeType ?? null,
      input.sourceUrl ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      now,
      now,
    )
    .run();

  const row = await db.prepare("SELECT * FROM images WHERE id = ?").bind(id).first<ImageRow>();
  if (!row) {
    throw new Error(`Image row vanished immediately after INSERT (id=${id}).`);
  }
  return row;
}

/** Find an image by id within a workspace. Honours soft-delete
 *  (returns null for soft-deleted rows). */
export async function findImageById(
  db: D1Database,
  workspaceId: string,
  imageId: string,
): Promise<ImageRow | null> {
  return await db
    .prepare(
      `SELECT * FROM images
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(imageId, workspaceId)
    .first<ImageRow>();
}

/** Find an image by its workspace-relative path. Useful for the
 *  upload path's "does the user already have an image at this
 *  path?" check. */
export async function findImageByPath(
  db: D1Database,
  workspaceId: string,
  path: string,
): Promise<ImageRow | null> {
  return await db
    .prepare(
      `SELECT * FROM images
       WHERE workspace_id = ? AND path = ? AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(workspaceId, path)
    .first<ImageRow>();
}

export interface UpdateImageInput {
  annotationsR2Key?: string | null;
  thumbnailR2Key?: string | null;
  sizeBytes?: number;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
  sourceUrl?: string | null;
  tags?: Record<string, string> | null;
  // Move under a different path; UNIQUE per-workspace check is
  // the caller's responsibility.
  path?: string;
}

/**
 * Patch an existing image row. Only updates the fields explicitly
 * provided in `updates`; everything else stays untouched. Returns
 * the post-update row, or null when the image doesn't exist
 * (i.e. caller should 404).
 */
export async function updateImage(
  db: D1Database,
  workspaceId: string,
  imageId: string,
  updates: UpdateImageInput,
): Promise<ImageRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (updates.annotationsR2Key !== undefined) {
    sets.push("annotations_r2_key = ?");
    binds.push(updates.annotationsR2Key);
  }
  if (updates.thumbnailR2Key !== undefined) {
    sets.push("thumbnail_r2_key = ?");
    binds.push(updates.thumbnailR2Key);
  }
  if (updates.sizeBytes !== undefined) {
    sets.push("size_bytes = ?");
    binds.push(updates.sizeBytes);
  }
  if (updates.width !== undefined) {
    sets.push("width = ?");
    binds.push(updates.width);
  }
  if (updates.height !== undefined) {
    sets.push("height = ?");
    binds.push(updates.height);
  }
  if (updates.mimeType !== undefined) {
    sets.push("mime_type = ?");
    binds.push(updates.mimeType);
  }
  if (updates.sourceUrl !== undefined) {
    sets.push("source_url = ?");
    binds.push(updates.sourceUrl);
  }
  if (updates.tags !== undefined) {
    sets.push("tags_json = ?");
    binds.push(updates.tags ? JSON.stringify(updates.tags) : null);
  }
  if (updates.path !== undefined) {
    sets.push("path = ?");
    binds.push(updates.path);
  }

  if (sets.length === 0) {
    // No-op call — just re-fetch and return.
    return await findImageById(db, workspaceId, imageId);
  }

  // Always bump updated_at; track timing relative to NOW().
  sets.push("updated_at = ?");
  binds.push(NOW());

  binds.push(imageId, workspaceId);
  const result = await db
    .prepare(
      `UPDATE images SET ${sets.join(", ")}
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(...binds)
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    return null;
  }

  return await findImageById(db, workspaceId, imageId);
}

/**
 * Soft-delete an image. Returns true if a row was affected, false
 * if the image wasn't found (or was already soft-deleted).
 */
export async function softDeleteImage(
  db: D1Database,
  workspaceId: string,
  imageId: string,
): Promise<boolean> {
  const now = NOW();
  const result = await db
    .prepare(
      `UPDATE images SET deleted_at = ?
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(now, imageId, workspaceId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export interface ListImagesOptions {
  /** Filter by path prefix (e.g. `"screenshots/"` for that folder). */
  pathPrefix?: string;
  /** Max rows per page. Defaults to 100; capped at 500. */
  limit?: number;
  /** Offset for paging. The caller's UI typically uses
   *  cursor-based paging instead; offset works fine for the
   *  small-N gallery views we have today. */
  offset?: number;
}

/**
 * List images in a workspace, ordered by creation time (newest
 * first). Pagination via `limit` + `offset`. Returns soft-deleted
 * rows filtered out.
 */
export async function listImages(
  db: D1Database,
  workspaceId: string,
  options: ListImagesOptions = {},
): Promise<ImageRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  const stmt = options.pathPrefix
    ? db
        .prepare(
          `SELECT * FROM images
         WHERE workspace_id = ? AND deleted_at IS NULL AND path LIKE ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        )
        .bind(workspaceId, `${options.pathPrefix}%`, limit, offset)
    : db
        .prepare(
          `SELECT * FROM images
         WHERE workspace_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        )
        .bind(workspaceId, limit, offset);
  const result = await stmt.all<ImageRow>();
  return result.results;
}

/** Sum of `size_bytes` across all non-deleted images + documents
 *  in a workspace. Used by the Phase 4e quota gate. */
export async function totalStorageUsedBytes(db: D1Database, workspaceId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(size_bytes), 0) FROM images
            WHERE workspace_id = ? AND deleted_at IS NULL) +
         (SELECT COALESCE(SUM(size_bytes), 0) FROM documents
            WHERE workspace_id = ? AND deleted_at IS NULL)
         AS total`,
    )
    .bind(workspaceId, workspaceId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

// ─── documents ──────────────────────────────────────────────────

export interface InsertDocumentInput {
  workspaceId: string;
  createdByUserId: string;
  path: string;
  sizeBytes: number;
  title?: string | null;
  blockCount?: number | null;
}

/** Insert a new `.annot.html` document row. */
export async function insertDocument(
  db: D1Database,
  input: InsertDocumentInput,
): Promise<DocumentRow> {
  const id = newId();
  const now = NOW();
  const documentR2Key = `${input.workspaceId}/documents/${id}/document.html`;

  await db
    .prepare(
      `INSERT INTO documents (
        id, workspace_id, created_by_user_id, path,
        document_r2_key, size_bytes, title, block_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.workspaceId,
      input.createdByUserId,
      input.path,
      documentR2Key,
      input.sizeBytes,
      input.title ?? null,
      input.blockCount ?? null,
      now,
      now,
    )
    .run();

  const row = await db
    .prepare("SELECT * FROM documents WHERE id = ?")
    .bind(id)
    .first<DocumentRow>();
  if (!row) {
    throw new Error(`Document row vanished immediately after INSERT (id=${id}).`);
  }
  return row;
}

export async function findDocumentById(
  db: D1Database,
  workspaceId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  return await db
    .prepare(
      `SELECT * FROM documents
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(documentId, workspaceId)
    .first<DocumentRow>();
}

export async function findDocumentByPath(
  db: D1Database,
  workspaceId: string,
  path: string,
): Promise<DocumentRow | null> {
  return await db
    .prepare(
      `SELECT * FROM documents
       WHERE workspace_id = ? AND path = ? AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(workspaceId, path)
    .first<DocumentRow>();
}

export interface UpdateDocumentInput {
  sizeBytes?: number;
  title?: string | null;
  blockCount?: number | null;
  path?: string;
}

export async function updateDocument(
  db: D1Database,
  workspaceId: string,
  documentId: string,
  updates: UpdateDocumentInput,
): Promise<DocumentRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (updates.sizeBytes !== undefined) {
    sets.push("size_bytes = ?");
    binds.push(updates.sizeBytes);
  }
  if (updates.title !== undefined) {
    sets.push("title = ?");
    binds.push(updates.title);
  }
  if (updates.blockCount !== undefined) {
    sets.push("block_count = ?");
    binds.push(updates.blockCount);
  }
  if (updates.path !== undefined) {
    sets.push("path = ?");
    binds.push(updates.path);
  }
  if (sets.length === 0) {
    return await findDocumentById(db, workspaceId, documentId);
  }
  sets.push("updated_at = ?");
  binds.push(NOW());
  binds.push(documentId, workspaceId);

  const result = await db
    .prepare(
      `UPDATE documents SET ${sets.join(", ")}
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(...binds)
    .run();

  if ((result.meta.changes ?? 0) === 0) return null;
  return await findDocumentById(db, workspaceId, documentId);
}

export async function softDeleteDocument(
  db: D1Database,
  workspaceId: string,
  documentId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE documents SET deleted_at = ?
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(NOW(), documentId, workspaceId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Count of non-deleted document rows in a workspace. Used by
 *  the Phase 4e quota gate's `activeDocuments` check. */
export async function activeDocumentCount(db: D1Database, workspaceId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM documents
       WHERE workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(workspaceId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listDocuments(
  db: D1Database,
  workspaceId: string,
  options: ListImagesOptions = {},
): Promise<DocumentRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  const stmt = options.pathPrefix
    ? db
        .prepare(
          `SELECT * FROM documents
         WHERE workspace_id = ? AND deleted_at IS NULL AND path LIKE ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        )
        .bind(workspaceId, `${options.pathPrefix}%`, limit, offset)
    : db
        .prepare(
          `SELECT * FROM documents
         WHERE workspace_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        )
        .bind(workspaceId, limit, offset);
  const result = await stmt.all<DocumentRow>();
  return result.results;
}

// ─── audit_events ───────────────────────────────────────────────

export interface RecordAuditInput {
  workspaceId: string;
  userId: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Best-effort audit log write. Swallows errors so a transient D1
 * failure doesn't break the user-facing request; audit gaps are
 * acceptable for a single-tenant solo project but should be
 * monitored if the rate gets noticeable.
 */
export async function recordAuditEvent(db: D1Database, input: RecordAuditInput): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_events (
          id, workspace_id, user_id, action,
          resource_type, resource_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId(),
        input.workspaceId,
        input.userId,
        input.action,
        input.resourceType ?? null,
        input.resourceId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        NOW(),
      )
      .run();
  } catch (err) {
    console.warn(`[storage-repo] recordAuditEvent failed for ${input.action}:`, err);
  }
}
