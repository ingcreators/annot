// `/api/images/*` endpoints — Phase 4c.
//
// Surface:
//   POST   /api/images?path=<path>           upload original bytes
//   GET    /api/images?folder=&limit=&offset list (paginated, folder-filtered)
//   GET    /api/images/:id                   metadata
//   GET    /api/images/:id/original          original bytes
//   GET    /api/images/:id/annotations       annotations SVG bytes
//   PATCH  /api/images/:id                   metadata patch (JSON)
//   PATCH  /api/images/:id/annotations       annotations SVG upload
//   DELETE /api/images/:id                   soft-delete + R2 cleanup
//
// All endpoints require an authenticated session (Phase 3
// `userId` + `workspaceId`). Bytes are read from / written to R2
// keyed by `<workspace_id>/images/<image_id>/...`; metadata is
// kept in D1 via `storage-repo.ts`.
//
// Phase 4c skips:
//   - thumbnail endpoints (separate PR)
//   - quota gates (Phase 4e)

import type { Context } from "hono";
import { requireAuth } from "./auth-middleware.js";
import type { Env } from "./index.js";
import { validatePath, validateUploadSize } from "./path-utils.js";
import { checkUploadQuota } from "./plan-gates.js";
import {
  findImageById,
  findImageByPath,
  type ImageRow,
  insertImage,
  listImages,
  recordAuditEvent,
  softDeleteImage,
  updateImage,
} from "./storage-repo.js";

/** Shape the API returns to clients. Snake_case D1 column names
 *  are mapped to camelCase for the wire format; tags JSON is
 *  parsed back into a real object. */
export interface ImageWire {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  path: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  sourceUrl: string | null;
  tags: Record<string, string>;
  hasAnnotations: boolean;
  hasThumbnail: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Route compile-time guarantees `:id` is always present, but
 *  Hono's typed param accessor can't narrow that without
 *  per-route chained generics. This helper centralises the
 *  defensive 400 response so the call site stays one line. */
function missingIdResponse(c: Context<{ Bindings: Env }>): Response {
  return c.json(
    { ok: false, error: "invalid_request", message: "Missing :id path parameter." },
    400,
  );
}

function toWire(row: ImageRow): ImageWire {
  let tags: Record<string, string> = {};
  if (row.tags_json) {
    try {
      tags = JSON.parse(row.tags_json) as Record<string, string>;
    } catch {
      // Malformed JSON — surface as empty so the response stays
      // stable. The bad bytes are still in D1 for forensics.
    }
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdByUserId: row.created_by_user_id,
    path: row.path,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    mimeType: row.mime_type,
    sourceUrl: row.source_url,
    tags,
    hasAnnotations: row.annotations_r2_key !== null,
    hasThumbnail: row.thumbnail_r2_key !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── POST /api/images ───────────────────────────────────────────

export async function handleImageUpload(c: Context<{ Bindings: Env }>): Promise<Response> {
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

  const sizeError = validateUploadSize(c.req.header("Content-Length") ?? null);
  if (sizeError) {
    return c.json({ ok: false, error: "payload_too_large", message: sizeError }, 413);
  }

  // Conflict check: a non-deleted image already at this path?
  const existing = await findImageByPath(c.env.DB, auth.workspaceId, path);
  if (existing) {
    return c.json(
      {
        ok: false,
        error: "path_conflict",
        message: `An image already exists at "${path}".`,
        existingImageId: existing.id,
      },
      409,
    );
  }

  // Read body bytes. Hono's `c.req.arrayBuffer()` consumes the
  // request body once; we use it directly.
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return c.json({ ok: false, error: "empty_body", message: "Upload body is empty." }, 400);
  }
  // Cap actual body size in case Content-Length was missing /
  // misreported. Same threshold as `validateUploadSize`.
  if (sizeError === null && c.req.header("Content-Length") === null) {
    const postCheck = validateUploadSize(String(bytes.byteLength));
    if (postCheck) {
      return c.json({ ok: false, error: "payload_too_large", message: postCheck }, 413);
    }
  }

  // Per-workspace quota gate (Phase 4e). Runs AFTER the body is in
  // memory so we know the exact byte count; runs BEFORE the D1
  // insert / R2 upload to short-circuit those when the workspace
  // is over quota.
  const quota = await checkUploadQuota(c.env.DB, auth.workspaceId, bytes.byteLength);
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

  const mimeType = c.req.header("Content-Type") ?? null;
  const sourceUrlHeader = c.req.header("X-Annot-Source-Url");
  const widthHeader = c.req.header("X-Annot-Width");
  const heightHeader = c.req.header("X-Annot-Height");
  const width = widthHeader ? Number.parseInt(widthHeader, 10) || null : null;
  const height = heightHeader ? Number.parseInt(heightHeader, 10) || null : null;

  // Insert metadata row first so we have an id for the R2 key.
  // If the R2 upload fails afterwards we soft-delete the row
  // to keep D1 consistent with R2.
  let row: ImageRow;
  try {
    row = await insertImage(c.env.DB, {
      workspaceId: auth.workspaceId,
      createdByUserId: auth.userId,
      path,
      sizeBytes: bytes.byteLength,
      width,
      height,
      mimeType,
      sourceUrl: sourceUrlHeader ?? null,
    });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: "db_error",
        message: err instanceof Error ? err.message : "Image insert failed.",
      },
      500,
    );
  }

  try {
    await c.env.OBJECTS.put(row.original_r2_key, bytes, {
      httpMetadata: mimeType ? { contentType: mimeType } : undefined,
    });
  } catch (err) {
    // Best-effort cleanup so the D1 row doesn't dangle pointing
    // at non-existent R2 bytes.
    await softDeleteImage(c.env.DB, auth.workspaceId, row.id);
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
    action: "image.upload",
    resourceType: "image",
    resourceId: row.id,
    metadata: { sizeBytes: bytes.byteLength, path },
  });

  return c.json({ ok: true, image: toWire(row) }, 201);
}

// ─── GET /api/images ────────────────────────────────────────────

export async function handleImageList(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const folder = c.req.query("folder");
  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");
  const limit = limitParam ? Number.parseInt(limitParam, 10) || 100 : 100;
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) || 0 : 0;

  const rows = await listImages(c.env.DB, auth.workspaceId, {
    pathPrefix: folder ?? undefined,
    limit,
    offset,
  });
  return c.json({
    ok: true,
    images: rows.map(toWire),
    limit,
    offset,
    count: rows.length,
  });
}

// ─── GET /api/images/:id ────────────────────────────────────────

export async function handleImageGet(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  const row = await findImageById(c.env.DB, auth.workspaceId, id);
  if (!row) {
    return c.json({ ok: false, error: "not_found", message: "Image not found." }, 404);
  }
  return c.json({ ok: true, image: toWire(row) });
}

// ─── PATCH /api/images/:id ──────────────────────────────────────

export async function handleImagePatch(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  let body: {
    width?: number | null;
    height?: number | null;
    mimeType?: string | null;
    sourceUrl?: string | null;
    tags?: Record<string, string> | null;
    path?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        ok: false,
        error: "invalid_request",
        message: "Request body must be JSON.",
      },
      400,
    );
  }

  if (body.path !== undefined) {
    const pathError = validatePath(body.path);
    if (pathError) {
      return c.json({ ok: false, error: "invalid_path", message: pathError }, 400);
    }
    // Move requires conflict check (only if target path differs
    // from current).
    const current = await findImageById(c.env.DB, auth.workspaceId, id);
    if (!current) {
      return c.json({ ok: false, error: "not_found", message: "Image not found." }, 404);
    }
    if (body.path !== current.path) {
      const collide = await findImageByPath(c.env.DB, auth.workspaceId, body.path);
      if (collide) {
        return c.json(
          {
            ok: false,
            error: "path_conflict",
            message: `An image already exists at "${body.path}".`,
            existingImageId: collide.id,
          },
          409,
        );
      }
    }
  }

  const updated = await updateImage(c.env.DB, auth.workspaceId, id, body);
  if (!updated) {
    return c.json({ ok: false, error: "not_found", message: "Image not found." }, 404);
  }

  await recordAuditEvent(c.env.DB, {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "image.patch",
    resourceType: "image",
    resourceId: id,
    metadata: { fields: Object.keys(body) },
  });

  return c.json({ ok: true, image: toWire(updated) });
}

// ─── DELETE /api/images/:id ─────────────────────────────────────

export async function handleImageDelete(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  const row = await findImageById(c.env.DB, auth.workspaceId, id);
  if (!row) {
    return c.json({ ok: false, error: "not_found", message: "Image not found." }, 404);
  }

  const ok = await softDeleteImage(c.env.DB, auth.workspaceId, id);
  if (!ok) {
    // Shouldn't happen given the findImageById check above, but
    // a race-deleted row falls through here.
    return c.json({ ok: false, error: "not_found", message: "Image not found." }, 404);
  }

  // Best-effort R2 cleanup. Soft-delete keeps the D1 row; we
  // delete the bytes immediately to free storage. If R2 fails
  // we log + continue — the next compaction job (Phase 5+) can
  // sweep orphaned keys.
  const keysToDelete = [row.original_r2_key, row.annotations_r2_key, row.thumbnail_r2_key].filter(
    (k): k is string => Boolean(k),
  );
  try {
    if (keysToDelete.length > 0) {
      await c.env.OBJECTS.delete(keysToDelete);
    }
  } catch (err) {
    console.warn(`[images] R2 cleanup failed for image ${id}:`, err);
  }

  await recordAuditEvent(c.env.DB, {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "image.delete",
    resourceType: "image",
    resourceId: id,
    metadata: { path: row.path },
  });

  return new Response(null, { status: 204 });
}

// ─── GET /api/images/:id/original ───────────────────────────────

export async function handleImageOriginalGet(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  const row = await findImageById(c.env.DB, auth.workspaceId, id);
  if (!row) {
    return c.json({ ok: false, error: "not_found", message: "Image not found." }, 404);
  }
  const obj = await c.env.OBJECTS.get(row.original_r2_key);
  if (!obj) {
    return c.json(
      {
        ok: false,
        error: "bytes_missing",
        message: "Image metadata exists but R2 bytes are missing.",
      },
      500,
    );
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": row.mime_type ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    },
  });
}

// ─── GET /api/images/:id/annotations ────────────────────────────

export async function handleImageAnnotationsGet(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  const row = await findImageById(c.env.DB, auth.workspaceId, id);
  if (!row) {
    return c.json({ ok: false, error: "not_found", message: "Image not found." }, 404);
  }
  if (!row.annotations_r2_key) {
    return c.json(
      {
        ok: false,
        error: "no_annotations",
        message: "Image has no annotations yet.",
      },
      404,
    );
  }
  const obj = await c.env.OBJECTS.get(row.annotations_r2_key);
  if (!obj) {
    return c.json(
      {
        ok: false,
        error: "bytes_missing",
        message: "Annotations metadata exists but R2 bytes are missing.",
      },
      500,
    );
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "private, max-age=60",
    },
  });
}

// ─── PATCH /api/images/:id/annotations ──────────────────────────

export async function handleImageAnnotationsPatch(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const id = c.req.param("id");
  if (!id) return missingIdResponse(c);
  const row = await findImageById(c.env.DB, auth.workspaceId, id);
  if (!row) {
    return c.json({ ok: false, error: "not_found", message: "Image not found." }, 404);
  }

  const sizeError = validateUploadSize(c.req.header("Content-Length") ?? null);
  if (sizeError) {
    return c.json({ ok: false, error: "payload_too_large", message: sizeError }, 413);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return c.json({ ok: false, error: "empty_body", message: "Annotations body is empty." }, 400);
  }
  // Final size check in case Content-Length was missing.
  if (sizeError === null && c.req.header("Content-Length") === null) {
    const postCheck = validateUploadSize(String(bytes.byteLength));
    if (postCheck) {
      return c.json({ ok: false, error: "payload_too_large", message: postCheck }, 413);
    }
  }

  const annotationsKey = `${auth.workspaceId}/images/${row.id}/annotations.svg`;
  try {
    await c.env.OBJECTS.put(annotationsKey, bytes, {
      httpMetadata: { contentType: "image/svg+xml" },
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

  const updated = await updateImage(c.env.DB, auth.workspaceId, id, {
    annotationsR2Key: annotationsKey,
  });
  if (!updated) {
    // Image was soft-deleted between findImageById and the
    // patch. Roll back the R2 write.
    try {
      await c.env.OBJECTS.delete(annotationsKey);
    } catch {
      /* best-effort */
    }
    return c.json({ ok: false, error: "not_found", message: "Image not found." }, 404);
  }

  await recordAuditEvent(c.env.DB, {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "image.annotations.patch",
    resourceType: "image",
    resourceId: id,
    metadata: { sizeBytes: bytes.byteLength },
  });

  return c.json({ ok: true, image: toWire(updated) });
}
