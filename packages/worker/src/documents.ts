// `/api/documents/*` endpoints — Phase 4d.
//
// Surface:
//   POST   /api/documents?path=<path>     upload document bytes
//   GET    /api/documents?folder=&limit=&offset list (paginated)
//   GET    /api/documents/:id             metadata
//   GET    /api/documents/:id/content     document HTML bytes
//   PATCH  /api/documents/:id             metadata patch (JSON)
//   PATCH  /api/documents/:id/content     overwrite document bytes
//   DELETE /api/documents/:id             soft-delete + R2 cleanup
//
// Mirrors the Phase 4c `/api/images/*` shape one-for-one for
// `.annot.html` documents. Differences vs images:
//   - No annotations sidecar: documents are a single HTML blob.
//     The PWA's existing `.annot.html` workflow already stores
//     annotations inline as SVG inside the HTML.
//   - No thumbnail key.
//   - Upload cap raised to 50 MB (documents embed base64 image
//     data so they're chunkier than the equivalent images).
//
// All endpoints require an authenticated session (Phase 3
// `userId` + `workspaceId`). Bytes go to R2 keyed by
// `<workspace_id>/documents/<document_id>/document.html`;
// metadata is in D1 via `storage-repo.ts`.

import type { Context } from "hono";
import { requireAuth } from "./auth-middleware.js";
import type { Env } from "./index.js";
import { MAX_DOCUMENT_UPLOAD_BYTES_VALUE, validatePath, validateUploadSize } from "./path-utils.js";
import { checkUploadQuota } from "./plan-gates.js";
import {
  type DocumentRow,
  findDocumentById,
  findDocumentByPath,
  insertDocument,
  listDocuments,
  recordAuditEvent,
  softDeleteDocument,
  updateDocument,
} from "./storage-repo.js";

/** Shape the API returns to clients. Snake_case D1 column names
 *  are mapped to camelCase for the wire format. */
export interface DocumentWire {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  path: string;
  sizeBytes: number;
  title: string | null;
  blockCount: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Defensive 400 for the `:id` path-param miss. Hono's typed
 *  param accessor would need per-route chained generics to
 *  narrow this away; centralising the response keeps callers
 *  one-liner. Mirrors the `images.ts` helper. */
function missingIdResponse(c: Context<{ Bindings: Env }>): Response {
  return c.json(
    { ok: false, error: "invalid_request", message: "Missing :id path parameter." },
    400,
  );
}

function toWire(row: DocumentRow): DocumentWire {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdByUserId: row.created_by_user_id,
    path: row.path,
    sizeBytes: row.size_bytes,
    title: row.title,
    blockCount: row.block_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseIntHeader(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ─── POST /api/documents ────────────────────────────────────────

export async function handleDocumentUpload(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const path = c.req.query("path");
  if (!path) {
    return c.json(
      { ok: false, error: "invalid_request", message: "Missing `path` query parameter." },
      400,
    );
  }
  const pathError = validatePath(path);
  if (pathError) {
    return c.json({ ok: false, error: "invalid_path", message: pathError }, 400);
  }

  const sizeError = validateUploadSize(
    c.req.header("Content-Length") ?? null,
    MAX_DOCUMENT_UPLOAD_BYTES_VALUE,
  );
  if (sizeError) {
    return c.json({ ok: false, error: "payload_too_large", message: sizeError }, 413);
  }

  // Conflict check: a non-deleted document already at this path?
  const existing = await findDocumentByPath(c.env.DB, auth.workspaceId, path);
  if (existing) {
    return c.json(
      {
        ok: false,
        error: "path_conflict",
        message: `A document already exists at "${path}".`,
        existingDocumentId: existing.id,
      },
      409,
    );
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return c.json({ ok: false, error: "empty_body", message: "Upload body is empty." }, 400);
  }
  if (c.req.header("Content-Length") === null) {
    const postCheck = validateUploadSize(String(bytes.byteLength), MAX_DOCUMENT_UPLOAD_BYTES_VALUE);
    if (postCheck) {
      return c.json({ ok: false, error: "payload_too_large", message: postCheck }, 413);
    }
  }

  // Per-workspace quota gate (Phase 4e). New document uploads
  // both add bytes AND increment the active-document count.
  const quota = await checkUploadQuota(c.env.DB, auth.workspaceId, bytes.byteLength, {
    incrementsDocumentCount: true,
  });
  if (!quota.ok) {
    return c.json(
      {
        ok: false,
        error: "quota_exceeded",
        exceeded: quota.exceeded,
        plan: quota.plan,
        usage: quota.usage,
        limits: quota.limits,
        message: quota.message,
      },
      413,
    );
  }

  const title = c.req.header("X-Annot-Title") ?? null;
  const blockCount = parseIntHeader(c.req.header("X-Annot-Block-Count"));

  // Insert metadata first so we have an id for the R2 key. If
  // the R2 upload fails afterwards, we soft-delete the row to
  // keep D1 consistent with R2.
  let row: DocumentRow;
  try {
    row = await insertDocument(c.env.DB, {
      workspaceId: auth.workspaceId,
      createdByUserId: auth.userId,
      path,
      sizeBytes: bytes.byteLength,
      title,
      blockCount,
    });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: "db_error",
        message: err instanceof Error ? err.message : "Document insert failed.",
      },
      500,
    );
  }

  try {
    await c.env.OBJECTS.put(row.document_r2_key, bytes, {
      httpMetadata: { contentType: "text/html" },
    });
  } catch (err) {
    await softDeleteDocument(c.env.DB, auth.workspaceId, row.id);
    return c.json(
      {
        ok: false,
        error: "r2_error",
        message: err instanceof Error ? err.message : "R2 upload failed.",
      },
      500,
    );
  }

  await recordAuditEvent(c.env.DB, {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "document.upload",
    resourceType: "document",
    resourceId: row.id,
    metadata: { sizeBytes: bytes.byteLength, path },
  });

  return c.json({ ok: true, document: toWire(row) }, 201);
}

// ─── GET /api/documents ─────────────────────────────────────────

export async function handleDocumentList(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const folder = c.req.query("folder");
  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");
  const limit = limitParam ? Number.parseInt(limitParam, 10) || 100 : 100;
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) || 0 : 0;

  const rows = await listDocuments(c.env.DB, auth.workspaceId, {
    pathPrefix: folder ?? undefined,
    limit,
    offset,
  });
  return c.json({
    ok: true,
    documents: rows.map(toWire),
    limit,
    offset,
    count: rows.length,
  });
}

// ─── GET /api/documents/:id ─────────────────────────────────────

export async function handleDocumentGet(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  const row = await findDocumentById(c.env.DB, auth.workspaceId, id);
  if (!row) {
    return c.json({ ok: false, error: "not_found", message: "Document not found." }, 404);
  }
  return c.json({ ok: true, document: toWire(row) });
}

// ─── PATCH /api/documents/:id ───────────────────────────────────

export async function handleDocumentPatch(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  let body: {
    title?: string | null;
    blockCount?: number | null;
    path?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { ok: false, error: "invalid_request", message: "Request body must be JSON." },
      400,
    );
  }

  if (body.path !== undefined) {
    const pathError = validatePath(body.path);
    if (pathError) {
      return c.json({ ok: false, error: "invalid_path", message: pathError }, 400);
    }
    const current = await findDocumentById(c.env.DB, auth.workspaceId, id);
    if (!current) {
      return c.json({ ok: false, error: "not_found", message: "Document not found." }, 404);
    }
    if (body.path !== current.path) {
      const collide = await findDocumentByPath(c.env.DB, auth.workspaceId, body.path);
      if (collide) {
        return c.json(
          {
            ok: false,
            error: "path_conflict",
            message: `A document already exists at "${body.path}".`,
            existingDocumentId: collide.id,
          },
          409,
        );
      }
    }
  }

  const updated = await updateDocument(c.env.DB, auth.workspaceId, id, body);
  if (!updated) {
    return c.json({ ok: false, error: "not_found", message: "Document not found." }, 404);
  }

  await recordAuditEvent(c.env.DB, {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "document.patch",
    resourceType: "document",
    resourceId: id,
    metadata: { fields: Object.keys(body) },
  });

  return c.json({ ok: true, document: toWire(updated) });
}

// ─── DELETE /api/documents/:id ──────────────────────────────────

export async function handleDocumentDelete(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  const row = await findDocumentById(c.env.DB, auth.workspaceId, id);
  if (!row) {
    return c.json({ ok: false, error: "not_found", message: "Document not found." }, 404);
  }

  const ok = await softDeleteDocument(c.env.DB, auth.workspaceId, id);
  if (!ok) {
    return c.json({ ok: false, error: "not_found", message: "Document not found." }, 404);
  }

  // Best-effort R2 cleanup. The soft-delete keeps the D1 row;
  // we delete the bytes immediately to free storage.
  try {
    await c.env.OBJECTS.delete(row.document_r2_key);
  } catch (err) {
    console.warn(`[documents] R2 cleanup failed for document ${id}:`, err);
  }

  await recordAuditEvent(c.env.DB, {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "document.delete",
    resourceType: "document",
    resourceId: id,
    metadata: { path: row.path },
  });

  return new Response(null, { status: 204 });
}

// ─── GET /api/documents/:id/content ─────────────────────────────

export async function handleDocumentContentGet(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  const row = await findDocumentById(c.env.DB, auth.workspaceId, id);
  if (!row) {
    return c.json({ ok: false, error: "not_found", message: "Document not found." }, 404);
  }
  const obj = await c.env.OBJECTS.get(row.document_r2_key);
  if (!obj) {
    return c.json(
      {
        ok: false,
        error: "bytes_missing",
        message: "Document metadata exists but R2 bytes are missing.",
      },
      500,
    );
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=60",
    },
  });
}

// ─── PATCH /api/documents/:id/content ───────────────────────────

export async function handleDocumentContentPatch(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  const row = await findDocumentById(c.env.DB, auth.workspaceId, id);
  if (!row) {
    return c.json({ ok: false, error: "not_found", message: "Document not found." }, 404);
  }

  const sizeError = validateUploadSize(
    c.req.header("Content-Length") ?? null,
    MAX_DOCUMENT_UPLOAD_BYTES_VALUE,
  );
  if (sizeError) {
    return c.json({ ok: false, error: "payload_too_large", message: sizeError }, 413);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return c.json({ ok: false, error: "empty_body", message: "Document body is empty." }, 400);
  }
  if (c.req.header("Content-Length") === null) {
    const postCheck = validateUploadSize(String(bytes.byteLength), MAX_DOCUMENT_UPLOAD_BYTES_VALUE);
    if (postCheck) {
      return c.json({ ok: false, error: "payload_too_large", message: postCheck }, 413);
    }
  }

  // Per-workspace quota gate (Phase 4e). Overwrites use the SIZE
  // DELTA (new bytes - old bytes) so re-saving a 1 MB document
  // inside a quota-exhausted workspace doesn't get rejected when
  // the byte count didn't actually grow. Document count is
  // unchanged on overwrite — `incrementsDocumentCount` is false.
  const delta = bytes.byteLength - row.size_bytes;
  if (delta > 0) {
    const quota = await checkUploadQuota(c.env.DB, auth.workspaceId, delta);
    if (!quota.ok) {
      return c.json(
        {
          ok: false,
          error: "quota_exceeded",
          exceeded: quota.exceeded,
          plan: quota.plan,
          usage: quota.usage,
          limits: quota.limits,
          message: quota.message,
        },
        413,
      );
    }
  }

  // Header-driven title / block-count updates piggyback on the
  // bytes write so the client can update both in one round trip.
  const titleHeader = c.req.header("X-Annot-Title");
  const blockCountHeader = c.req.header("X-Annot-Block-Count");

  try {
    await c.env.OBJECTS.put(row.document_r2_key, bytes, {
      httpMetadata: { contentType: "text/html" },
    });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: "r2_error",
        message: err instanceof Error ? err.message : "R2 upload failed.",
      },
      500,
    );
  }

  const updates: {
    sizeBytes: number;
    title?: string | null;
    blockCount?: number | null;
  } = { sizeBytes: bytes.byteLength };
  if (titleHeader !== undefined) updates.title = titleHeader;
  if (blockCountHeader !== undefined) {
    updates.blockCount = parseIntHeader(blockCountHeader);
  }

  const updated = await updateDocument(c.env.DB, auth.workspaceId, id, updates);
  if (!updated) {
    // Document was soft-deleted between findDocumentById and
    // the patch. The R2 write we just did is now orphaned — best-
    // effort delete to clean up.
    try {
      await c.env.OBJECTS.delete(row.document_r2_key);
    } catch {
      /* best-effort */
    }
    return c.json({ ok: false, error: "not_found", message: "Document not found." }, 404);
  }

  await recordAuditEvent(c.env.DB, {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "document.content.patch",
    resourceType: "document",
    resourceId: id,
    metadata: { sizeBytes: bytes.byteLength },
  });

  return c.json({ ok: true, document: toWire(updated) });
}
