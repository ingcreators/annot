// `/api/shares/*` endpoints — Phase 5.
//
// Surface:
//   POST   /api/shares                  create (auth)
//   GET    /api/shares                  list workspace's active shares (auth)
//   GET    /api/shares/:token           public metadata (no auth)
//   GET    /api/shares/:token/payload   public payload (no auth)
//   DELETE /api/shares/:token           revoke (auth, workspace-scoped)
//
// The public endpoints are deliberately cookie-less so anonymous
// browsers can view a shared link in a fresh session. The token
// IS the access credential — anyone with the URL gets read access
// until the owner revokes.
//
// Quota: POST checks `incrementsShareCount: true` against the
// Phase 4e plan-gates. Free-tier shares are capped at 30 in beta
// (3 at Phase 7d launch). Pro / Team are unlimited.
//
// Phase 5 deliberately omits:
//   - Password-protected shares (`password_hash` column)  → Pro / Phase 7
//   - Time-limited shares (`expires_at` column)           → Pro / Phase 7

import type { Context } from "hono";
import { requireAuth } from "./auth-middleware.js";
import type { Env } from "./index.js";
import { checkUploadQuota } from "./plan-gates.js";
import {
  findDocumentById,
  findImageById,
  findShareByToken,
  incrementShareViewCount,
  insertShareLink,
  listShareLinks,
  recordAuditEvent,
  revokeShareLink,
  type ShareLinkRow,
} from "./storage-repo.js";

/** Wire shape returned to authenticated callers (workspace
 *  owner). Excludes Pro-only fields (`password_hash`,
 *  `expires_at`) until Phase 7 lights them up. */
export interface ShareWire {
  token: string;
  resourceType: "image" | "document";
  resourceId: string;
  workspaceId: string;
  createdByUserId: string;
  viewCount: number;
  createdAt: number;
  revokedAt: number | null;
}

/** Wire shape returned to anonymous public callers. Strips
 *  workspace + user ids (no information leakage about who owns
 *  the share). */
export interface PublicShareWire {
  token: string;
  resourceType: "image" | "document";
  createdAt: number;
}

function toWire(row: ShareLinkRow): ShareWire {
  return {
    token: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    workspaceId: row.workspace_id,
    createdByUserId: row.created_by_user_id,
    viewCount: row.view_count,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

function toPublicWire(row: ShareLinkRow): PublicShareWire {
  return {
    token: row.id,
    resourceType: row.resource_type,
    createdAt: row.created_at,
  };
}

/** URL-safe token generator. 22 chars of base62 ≈ 130 bits of
 *  entropy. Built from `crypto.getRandomValues` so it's CSPRNG
 *  on the Worker runtime. */
const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 22;

function generateToken(): string {
  const buf = new Uint8Array(TOKEN_LENGTH);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    // Modulo bias is negligible at 62/256 — acceptable for a
    // random URL slug that's already 130 bits of entropy.
    out += TOKEN_ALPHABET[buf[i]! % TOKEN_ALPHABET.length];
  }
  return out;
}

function missingTokenResponse(c: Context<{ Bindings: Env }>): Response {
  return c.json(
    { ok: false, error: "invalid_request", message: "Missing :token path parameter." },
    400,
  );
}

// ─── POST /api/shares (auth) ────────────────────────────────────

export async function handleShareCreate(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  let body: { resourceType?: string; resourceId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { ok: false, error: "invalid_request", message: "Request body must be JSON." },
      400,
    );
  }

  if (body.resourceType !== "image" && body.resourceType !== "document") {
    return c.json(
      {
        ok: false,
        error: "invalid_request",
        message: "`resourceType` must be 'image' or 'document'.",
      },
      400,
    );
  }
  if (typeof body.resourceId !== "string" || body.resourceId.length === 0) {
    return c.json(
      { ok: false, error: "invalid_request", message: "`resourceId` is required." },
      400,
    );
  }

  // Verify the resource exists and belongs to the caller's
  // workspace. Without this check a malicious caller could mint
  // share tokens for arbitrary resources by guessing the id.
  const resource =
    body.resourceType === "image"
      ? await findImageById(c.env.DB, auth.workspaceId, body.resourceId)
      : await findDocumentById(c.env.DB, auth.workspaceId, body.resourceId);
  if (!resource) {
    return c.json(
      {
        ok: false,
        error: "not_found",
        message: `${body.resourceType === "image" ? "Image" : "Document"} not found.`,
      },
      404,
    );
  }

  // Active share quota (Phase 4e plan-gates extended in Phase 5).
  // 0 additionalBytes — shares don't consume storage.
  const quota = await checkUploadQuota(c.env.DB, auth.workspaceId, 0, {
    incrementsShareCount: true,
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

  // Generate a fresh token. Retry once on the extraordinarily
  // unlikely PK collision so a transient duplicate doesn't 500
  // the user; after one retry the odds are <2^-260.
  let row: ShareLinkRow;
  try {
    row = await insertShareLink(c.env.DB, {
      id: generateToken(),
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      workspaceId: auth.workspaceId,
      createdByUserId: auth.userId,
    });
  } catch {
    row = await insertShareLink(c.env.DB, {
      id: generateToken(),
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      workspaceId: auth.workspaceId,
      createdByUserId: auth.userId,
    });
  }

  await recordAuditEvent(c.env.DB, {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "share.create",
    resourceType: body.resourceType,
    resourceId: body.resourceId,
    metadata: { token: row.id },
  });

  return c.json({ ok: true, share: toWire(row) }, 201);
}

// ─── GET /api/shares (auth) ─────────────────────────────────────

export async function handleShareList(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");
  const limit = limitParam ? Number.parseInt(limitParam, 10) || 100 : 100;
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) || 0 : 0;

  const rows = await listShareLinks(c.env.DB, auth.workspaceId, { limit, offset });
  return c.json({
    ok: true,
    shares: rows.map(toWire),
    limit,
    offset,
    count: rows.length,
  });
}

// ─── GET /api/shares/:token (public, no auth) ───────────────────

export async function handleShareGet(c: Context<{ Bindings: Env }>): Promise<Response> {
  const token = c.req.param("token");
  if (!token) return missingTokenResponse(c);
  const row = await findShareByToken(c.env.DB, token);
  if (!row) {
    return c.json({ ok: false, error: "not_found", message: "Share not found." }, 404);
  }
  return c.json({ ok: true, share: toPublicWire(row) });
}

// ─── GET /api/shares/:token/payload (public, no auth) ───────────

export async function handleSharePayload(c: Context<{ Bindings: Env }>): Promise<Response> {
  const token = c.req.param("token");
  if (!token) return missingTokenResponse(c);
  const share = await findShareByToken(c.env.DB, token);
  if (!share) {
    return c.json({ ok: false, error: "not_found", message: "Share not found." }, 404);
  }

  // Increment view count (best-effort, swallows errors).
  await incrementShareViewCount(c.env.DB, token);

  if (share.resource_type === "image") {
    const row = await findImageById(c.env.DB, share.workspace_id, share.resource_id);
    if (!row) {
      // Resource was deleted after the share was minted. Treat
      // as 404 — the share is effectively orphaned. The owner
      // can revoke + remint.
      return c.json(
        { ok: false, error: "resource_gone", message: "Shared image is no longer available." },
        404,
      );
    }
    const obj = await c.env.OBJECTS.get(row.original_r2_key);
    if (!obj) {
      return c.json(
        { ok: false, error: "bytes_missing", message: "Image bytes are missing." },
        500,
      );
    }
    return new Response(obj.body, {
      status: 200,
      headers: {
        "Content-Type": row.mime_type ?? "application/octet-stream",
        // Public shares get a slightly longer cache lifetime than
        // authenticated reads. The mutable annotations sidecar is
        // intentionally NOT exposed via /payload — only the
        // baseline original bytes are shared.
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  // Document
  const row = await findDocumentById(c.env.DB, share.workspace_id, share.resource_id);
  if (!row) {
    return c.json(
      { ok: false, error: "resource_gone", message: "Shared document is no longer available." },
      404,
    );
  }
  const obj = await c.env.OBJECTS.get(row.document_r2_key);
  if (!obj) {
    return c.json(
      { ok: false, error: "bytes_missing", message: "Document bytes are missing." },
      500,
    );
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}

// ─── DELETE /api/shares/:token (auth) ───────────────────────────

export async function handleShareRevoke(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  const token = c.req.param("token");
  if (!token) return missingTokenResponse(c);

  const ok = await revokeShareLink(c.env.DB, auth.workspaceId, token);
  if (!ok) {
    // Either the token doesn't exist, was already revoked, or
    // belongs to a different workspace. We return 404 in all
    // three cases — leaking "this exists but isn't yours" gives
    // a workspace-id enumeration oracle.
    return c.json({ ok: false, error: "not_found", message: "Share not found." }, 404);
  }

  await recordAuditEvent(c.env.DB, {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "share.revoke",
    resourceType: "share",
    resourceId: token,
    metadata: null,
  });

  return new Response(null, { status: 204 });
}
